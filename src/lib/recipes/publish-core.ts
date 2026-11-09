/**
 * src/lib/recipes/publish-core.ts — ядро публикации рецепта (RECIPE-03).
 *
 * Спецификация: RB.14/RB.15/RA.8.1 (RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md).
 * Единственная реализация «неизменяемая версия + переход статуса»:
 *   • /api/recipes/[id]/publish (автор: draft→published, Завис-2);
 *   • /api/moderator/action type="recipe" approve (модератор: pending_review→published,
 *     D6-фикс — переход из очереди модерации создаёт ту же версию).
 *
 * Инварианты (идентичны маршруту publish, откуда код извлечён дословно):
 *   • version_no = max+1 читается серверно; конкурентные публикации защищены
 *     UNIQUE(recipe_id, version_no) — при 23505 перечитываем max и повторяем
 *     вставку (1 исходная + 2 повтора);
 *   • идемпотентность: если последняя версия новее updated_at корня — снапшот
 *     актуален, новая версия НЕ создаётся (повторный вызов → idempotent);
 *   • порядок «версия → статус»: при сбое смены статуса снапшот уже
 *     зафиксирован, повторный вызов самолечится (idempotent-ветка завершит
 *     переход статуса без дубля версии);
 *   • published_at не перезаписывается при повторной публикации.
 *
 * Гейты (auth/ownership/is_blocked/rights/state machine) остаются в вызывающих
 * маршрутах — ядро получает уже проверенный корень recipes.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchRecipeChildren,
  buildRecipeSnapshot,
} from "@/lib/recipes/recipe-content";

const MAX_PUBLISH_ATTEMPTS = 3; // 1 исходная + 2 повтора при 23505 (RB.14)

/** Минимальная форма корня recipes, необходимая ядру публикации. */
export interface RecipePublishRoot {
  id: string;
  slug: string | null;
  status: string;
  published_at: string | null;
  updated_at: string | null;
}

export type PublishCoreResult =
  | { ok: true; versionNo: number; idempotent: boolean }
  | { ok: false; error: string; details?: string };

/**
 * Зафиксировать неизменяемую версию (при необходимости) и перевести рецепт
 * в статус published. Идемпотентно по контенту (updated_at vs последняя версия).
 */
export async function ensureRecipeVersionPublished(
  root: RecipePublishRoot,
  actorUserId: string,
  changelog: string | null
): Promise<PublishCoreResult> {
  const recipeId = root.id;

  // ---------- Идемпотентность: последняя версия новее updated_at → снапшот актуален ----------
  const { data: latestRows, error: latestErr } = await supabaseAdmin
    .from("recipe_versions")
    .select("version_no, created_at")
    .eq("recipe_id", recipeId)
    .order("version_no", { ascending: false })
    .limit(1);
  if (latestErr) {
    console.error("[publish-core] latest version read failed:", latestErr.message);
    return { ok: false, error: "Ошибка чтения версий рецепта", details: latestErr.message };
  }
  const latest = latestRows?.[0] as { version_no: number; created_at: string } | undefined;

  const updatedAtMs = root.updated_at ? new Date(root.updated_at).getTime() : 0;
  const latestCreatedMs = latest?.created_at ? new Date(latest.created_at).getTime() : -1;
  const snapshotUpToDate = Boolean(latest && latestCreatedMs >= updatedAtMs);

  if (snapshotUpToDate) {
    // Прерванная публикация (версия есть, статус не сменился) — самолечение
    if (root.status !== "published") {
      const { error: healErr } = await supabaseAdmin
        .from("recipes")
        .update({
          status: "published",
          published_at: root.published_at ?? new Date().toISOString(),
        })
        .eq("id", recipeId);
      if (healErr) {
        console.error("[publish-core] heal status failed:", healErr.message);
        return { ok: false, error: "Ошибка при публикации", details: healErr.message };
      }
    }
    return { ok: true, versionNo: latest!.version_no, idempotent: true };
  }

  // ---------- Новая неизменяемая версия (RA.8.1) ----------
  const children = await fetchRecipeChildren(recipeId);
  const snapshot = buildRecipeSnapshot(
    root as unknown as Record<string, unknown>,
    children
  );

  let versionNo: number | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
    const { data: maxRows } = await supabaseAdmin
      .from("recipe_versions")
      .select("version_no")
      .eq("recipe_id", recipeId)
      .order("version_no", { ascending: false })
      .limit(1);
    const nextVersionNo = Number(maxRows?.[0]?.version_no ?? 0) + 1;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("recipe_versions")
      .insert({
        recipe_id: recipeId,
        version_no: nextVersionNo, // серверно; клиентский version_no невозможен
        snapshot, // JSONB NOT NULL — полный normalized-снимок
        origin: "publish",
        created_by: actorUserId,
        changelog,
      })
      .select("version_no")
      .single();

    if (!insertErr && inserted) {
      versionNo = Number((inserted as { version_no: number }).version_no);
      break;
    }

    lastError = insertErr?.message ?? "insert returned no row";
    const code = (insertErr as { code?: string } | null)?.code;
    if (code !== "23505") break; // не конкурентная публикация — не ретраим
    // 23505: конкурентный publish выиграл гонку — перечитать max и повторить
    console.warn(
      `[publish-core] version conflict (23505), attempt ${attempt}/${MAX_PUBLISH_ATTEMPTS}`
    );
  }

  if (versionNo === null) {
    console.error("[publish-core] version insert failed:", lastError);
    return { ok: false, error: "Не удалось зафиксировать версию рецепта", details: lastError ?? undefined };
  }

  // ---------- Переход статуса (после фиксации версии — см. шапку) ----------
  if (root.status !== "published") {
    const { error: statusErr } = await supabaseAdmin
      .from("recipes")
      .update({
        status: "published",
        published_at: root.published_at ?? new Date().toISOString(),
        // updated_at НЕ трогаем: publish не меняет контент, идемпотентность
        // сравнивает updated_at с created_at последней версии
      })
      .eq("id", recipeId);
    if (statusErr) {
      console.error("[publish-core] status update failed:", statusErr.message);
      return {
        ok: false,
        error: "Версия зафиксирована, но статус не обновлён — повторите запрос",
        details: statusErr.message,
      };
    }
  }

  return { ok: true, versionNo, idempotent: false };
}
