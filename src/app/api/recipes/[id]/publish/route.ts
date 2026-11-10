/**
 * POST /api/recipes/[id]/publish — публикация рецепта + неизменяемая версия
 * (RECIPE-02, RB.14/RB.15/RA.8.1, RA.13).
 *
 * Роли: автор или ADMIN (ownership серверно; чужой id → 403).
 *
 * Гейты:
 *   • SEC-11 (fail-closed): is_blocked из profiles — свежая серверная проверка,
 *     при ошибке БД доступ ЗАПРЕЩАЕТСЯ (fail-closed), ответ 403;
 *   • RA.13: если есть recipe_sources с rights_confirmed=false → 403
 *     «подтвердите права» (импорт без прав не публикуется; подтверждение —
 *     POST /api/recipes/[id]/rights-confirm);
 *
 * State machine (RB.15):
 *   • draft → published — напрямую в период Завис-2 (модерация не обязательна).
 *     Флаг обязательной модерации в системе ОТСУТСТВЕТ: по кодовой базе нет
 *     настройки moderation_required (moderation_queue существует, но
 *     recipes.status='pending_review' нигде в src/ не обрабатывается;
 *     переход pending_review→published выполняет модератор через /api/moderation
 *     вне этого маршрута). Опциональная поддержка: env
 *     RECIPE_MODERATION_REQUIRED=true переводит draft→pending_review БЕЗ
 *     создания версии (версию создаёт модераторский approve).
 *   • published → published: повторный POST без изменений контента →
 *     200 idempotent (последняя версия новее updated_at корня — снапшот
 *     актуален). После PATCH (updated_at свежее последней версии) создаётся
 *     НОВАЯ версия; статус остаётся published (RA.8.1: правки работают с
 *     рабочим состоянием корня, история — в версиях).
 *   • pending_review / rejected / archived → 409 (архив: сначала
 *     PATCH {status:"draft"}).
 *
 * Идемпотентность/конкурентность:
 *   • version_no = max(version_no)+1 читается серверно; конкурентные
 *     публикации защищены UNIQUE(recipe_id, version_no) — при 23505 повторяем
 *     чтение max и вставку (макс. 2 повтора, RB.14);
 *   • порядок «версия → статус»: при сбое смены статуса снапшот уже
 *     зафиксирован, повторный POST самолечится (idempotent-ветка завершит
 *     переход статуса без дубля версии).
 *
 * Ответ: 200 {data: {id, slug, status, versionNo}, idempotent?}.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handleRouteError, safeJsonBody } from "@/lib/http-helpers";
import { ensureRecipeVersionPublished } from "@/lib/recipes/publish-core";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Период Завис-2: обязательная модерация не включена (см. шапку).
 * RECIPE_MODERATION_REQUIRED=true переключает draft→pending_review.
 */
const MODERATION_REQUIRED = process.env.RECIPE_MODERATION_REQUIRED === "true";

const publishSchema = z.object({
  changelog: z.string().max(500).optional(),
});

/** Свежая серверная проверка блокировки (SEC-11, fail-closed, без кэша). */
async function checkNotBlocked(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_blocked")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false; // fail-closed: не можем проверить → запрещаем
  return data?.is_blocked !== true;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    // Rate-limit мутаций (каденция заказов; ключ по пользователю)
    const blockedRate = await enforceRateLimit(
      request,
      `recipe-publish:${user.userId}`,
      RATE_LIMITS.orders.limit,
      RATE_LIMITS.orders.windowMs
    );
    if (blockedRate) return blockedRate as unknown as NextResponse;

    const { data: root, error: fetchErr } = await supabaseAdmin
      .from("recipes")
      .select("id, author_id, title, slug, status, published_at, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !root) {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }

    // Ownership: автор или ADMIN
    const isAuthor = root.author_id === user.userId;
    const admin = await isAdmin(user.userId);
    if (!isAuthor && !admin) {
      return NextResponse.json(
        { error: "Только автор или администратор может публиковать рецепт" },
        { status: 403 }
      );
    }

    // SEC-11: fail-closed is_blocked (заблокированный не публикует)
    const notBlocked = await checkNotBlocked(user.userId);
    if (!notBlocked) {
      return NextResponse.json({ error: "Аккаунт заблокирован" }, { status: 403 });
    }

    // RA.13: импорт без подтверждённых прав не публикуется
    const { data: unconfirmed, error: srcErr } = await supabaseAdmin
      .from("recipe_sources")
      .select("id")
      .eq("recipe_id", root.id)
      .eq("rights_confirmed", false)
      .limit(1);

    if (srcErr) {
      console.error("[recipes/publish] sources check failed:", srcErr.message);
      return NextResponse.json({ error: "Ошибка при проверке прав" }, { status: 500 });
    }
    if (unconfirmed && unconfirmed.length > 0) {
      return NextResponse.json(
        {
          error:
            "Подтвердите права на импортированный контент: POST /api/recipes/" +
            root.id +
            "/rights-confirm",
        },
        { status: 403 }
      );
    }

    const { id: recipeId, status } = root as unknown as {
      id: string;
      status: string;
    };

    // ---------- State machine (RB.15) ----------
    if (status === "pending_review") {
      return NextResponse.json(
        { error: "Рецепт ожидает модерации — решение принимает модератор" },
        { status: 409 }
      );
    }
    if (status === "rejected") {
      return NextResponse.json(
        { error: "Рецепт отклонён модерацией — переход в publish запрещён" },
        { status: 409 }
      );
    }
    if (status === "archived") {
      return NextResponse.json(
        { error: 'Рецепт в архиве — сначала восстановите черновик: PATCH {status:"draft"}' },
        { status: 409 }
      );
    }

    const { data: body, error: parseErr } = await safeJsonBodyOptional(request);
    if (parseErr) return NextResponse.json({ error: parseErr }, { status: 400 });
    const parsed = publishSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Невалидное поле changelog" }, { status: 422 });
    }
    const changelog = parsed.data.changelog?.trim() || null;

    // Опциональный модерационный режим (см. шапку): draft→pending_review,
    // БЕЗ версии — версию создаёт модераторский approve (вне этого маршрута)
    if (status === "draft" && MODERATION_REQUIRED) {
      const { error: updErr } = await supabaseAdmin
        .from("recipes")
        .update({ status: "pending_review", updated_at: new Date().toISOString() })
        .eq("id", recipeId);
      if (updErr) {
        console.error("[recipes/publish] pending_review update failed:", updErr.message);
        return NextResponse.json({ error: "Ошибка при отправке на модерацию" }, { status: 500 });
      }
      return NextResponse.json({
        data: { id: recipeId, slug: root.slug, status: "pending_review" },
        message: "Рецепт отправлен на модерацию",
      });
    }

    // ---------- Ядро публикации: версия + переход статуса (publish-core) ----------
    // Идемпотентность/23505-ретраи/порядок «версия → статус» — в ядре (см. шапку).
    const core = await ensureRecipeVersionPublished(
      {
        id: recipeId,
        slug: (root.slug as string | null) ?? null,
        status,
        published_at: (root.published_at as string | null) ?? null,
        updated_at: (root.updated_at as string | null) ?? null,
      },
      user.userId,
      changelog
    );
    if (!core.ok) {
      return NextResponse.json(
        { error: core.error, details: core.details },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: { id: recipeId, slug: root.slug, status: "published", versionNo: core.versionNo },
      ...(core.idempotent
        ? {
            idempotent: true,
            message: "Контент не менялся с последней публикации — новая версия не создана",
          }
        : {}),
    });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/[id]/publish",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

/** Тело опционально: publish можно вызвать без тела вовсе. */
async function safeJsonBodyOptional(
  request: NextRequest
): Promise<{ data: unknown; error: string | null }> {
  try {
    const raw = await request.text();
    if (!raw) return { data: {}, error: null };
    return { data: JSON.parse(raw) as unknown, error: null };
  } catch (e: any) {
    return { data: null, error: `Невалидный JSON: ${e?.message || "parse error"}` };
  }
}
