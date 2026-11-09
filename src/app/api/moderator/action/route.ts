/**
 * POST /api/moderator/action — выполнить действие модерации.
 *
 * Body: { type: "review"|"product"|"blog"|"recipe", id, action: "approve"|"reject"|"deactivate"|"activate", reason? }
 *
 * Auth: MODERATOR, ADMIN, SUPER_ADMIN.
 *
 * type="recipe" (D6-фикс, RB.15/RB.16) — выделенная ветка: у recipes нет
 * is_approved/moderation_status/moderated_*; переходы очереди модерации:
 *   • approve: pending_review → published ЧЕРЕЗ общее ядро публикации
 *     (ensureRecipeVersionPublished — неизменяемая версия version_no=max+1,
 *     идемпотентность, порядок «версия → статус»); гейт RA.13:
 *     recipe_sources с rights_confirmed=false → 403;
 *   • reject: pending_review → rejected (терминальный статус RB.15); UPDATE
 *     CAS .eq("status","pending_review") — 0 строк → 409; reason обязателен
 *     (400) и персистентен в recipes.moderation_reason (миграция 0076).
 *   • RELEASE-02 §7/RELEASE-03 (аудит 5-b/b88714b): самоодобрение запрещено
 *     (author_id === user.id → 403 для approve и reject); решения пишутся в
 *     audit_log (fail-safe, колонки — миграция 0018); персистентность решения
 *     — recipes.moderated_by/moderated_at/moderation_reason (0076).
 * Остальные типы — прежняя generic-ветка (is_approved/moderation_status).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { ensureRecipeVersionPublished } from "@/lib/recipes/publish-core";

export const runtime = "nodejs";

interface ActionBody {
  type: "review" | "product" | "blog" | "comment" | "recipe";
  id: string;
  action: "approve" | "reject" | "request_revision" | "deactivate" | "activate";
  reason?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["MODERATOR", "ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = (await request.json()) as ActionBody;
    const { type, id, action, reason } = body;

    if (!type || !id || !action) {
      return NextResponse.json({ error: "type, id, action обязательны" }, { status: 400 });
    }

    // ---------- D6-фикс: ветка модерации рецептов (RB.15) ----------
    if (type === "recipe") {
      if (action !== "approve" && action !== "reject") {
        return NextResponse.json(
          { error: "Для рецепта доступны действия approve и reject" },
          { status: 400 }
        );
      }
      const { data: recipe, error: fetchErr } = await supabaseAdmin
        .from("recipes")
        .select("id, author_id, title, slug, status, published_at, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) {
        console.error("[moderator/action] recipe fetch failed:", fetchErr.message);
        return NextResponse.json({ error: "Ошибка чтения рецепта" }, { status: 500 });
      }
      if (!recipe) {
        return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
      }
      const recipeRow = recipe as unknown as {
        id: string;
        author_id: string;
        title: string;
        slug: string | null;
        status: string;
        published_at: string | null;
        updated_at: string | null;
      };

      // RELEASE-03 (аудит 5-b/b88714b): модератор не модерирует собственный
      // рецепт (конфликт интересов) — одинаково для approve и reject.
      if (recipeRow.author_id === user.id) {
        return NextResponse.json(
          { error: "Модератор не может модерировать собственный рецепт" },
          { status: 403 }
        );
      }

      if (recipeRow.status !== "pending_review") {
        return NextResponse.json(
          {
            error: `Рецепт не в очереди модерации (статус: ${recipeRow.status}); действие применяется только к pending_review`,
          },
          { status: 409 }
        );
      }

      if (action === "reject") {
        // RELEASE-03 (аудит 5-b): персистентный reason — без него reject нет смысла
        if (!reason || !reason.trim()) {
          return NextResponse.json(
            { error: "reason обязателен для отклонения" },
            { status: 400 }
          );
        }
        const nowIso = new Date().toISOString();
        // CAS: UPDATE применяется только пока status="pending_review" —
        // защита от гонки с параллельным решением другого модератора.
        const { data: rejectedRows, error: rejErr } = await supabaseAdmin
          .from("recipes")
          .update({
            status: "rejected",
            updated_at: nowIso,
            moderated_by: user.id,
            moderated_at: nowIso,
            moderation_reason: reason.trim(),
          })
          .eq("id", id)
          .eq("status", "pending_review")
          .select("id");
        if (rejErr) {
          console.error("[moderator/action] recipe reject failed:", rejErr.message);
          return NextResponse.json({ error: "DB error", details: rejErr.message }, { status: 500 });
        }
        if (!rejectedRows || rejectedRows.length === 0) {
          return NextResponse.json(
            { error: "Статус изменился, повторите" },
            { status: 409 }
          );
        }
        await writeRecipeAuditLog(user.id, "recipe_reject", id, reason.trim(), recipeRow.title);
        console.log(
          `[moderator/action] recipe rejected: id=${id} reason=${reason} moderator=${user.id}`
        );
        return NextResponse.json({ success: true, type, id, action, status: "rejected" });
      }

      // approve: RA.13 — импорт без подтверждённых прав не публикуется
      const { data: unconfirmed, error: srcErr } = await supabaseAdmin
        .from("recipe_sources")
        .select("id")
        .eq("recipe_id", id)
        .eq("rights_confirmed", false)
        .limit(1);
      if (srcErr) {
        console.error("[moderator/action] sources check failed:", srcErr.message);
        return NextResponse.json({ error: "Ошибка при проверке прав" }, { status: 500 });
      }
      if (unconfirmed && unconfirmed.length > 0) {
        return NextResponse.json(
          { error: "Импортированный контент без подтверждённых прав не публикуется (rights_confirmed=false)" },
          { status: 403 }
        );
      }

      const core = await ensureRecipeVersionPublished(
        {
          id: recipeRow.id,
          slug: recipeRow.slug,
          status: recipeRow.status,
          published_at: recipeRow.published_at,
          updated_at: recipeRow.updated_at,
        },
        user.id,
        reason ? `Модерация: ${reason}` : "Одобрено модератором"
      );
      if (!core.ok) {
        return NextResponse.json({ error: core.error, details: core.details }, { status: 500 });
      }

      // RELEASE-03 (аудит 5-b/b88714b, миграция 0076): персистентность решения —
      // отдельный UPDATE после публикации (публикация не должна падать из-за аудита;
      // сбой метаданных логируется, но не откатывает решение).
      const { error: modMetaErr } = await supabaseAdmin
        .from("recipes")
        .update({
          moderated_by: user.id,
          moderated_at: new Date().toISOString(),
          moderation_reason: reason ?? null,
        })
        .eq("id", id);
      if (modMetaErr) {
        console.error("[moderator/action] moderation meta persist failed:", modMetaErr.message);
      }
      await writeRecipeAuditLog(user.id, "recipe_approve", id, reason ?? null, recipeRow.title);

      return NextResponse.json({
        success: true,
        type,
        id,
        action,
        status: "published",
        versionNo: core.versionNo,
        idempotent: core.idempotent,
      });
    }

    const tableMap: Record<string, string> = {
      review: "reviews",
      product: "products",
      blog: "blogs",
      comment: "blog_comments",
    };

    const tableName = tableMap[type];
    if (!tableName) return NextResponse.json({ error: "Неизвестный type" }, { status: 400 });

    let updateData: Record<string, unknown> = {};

    if (action === "approve") {
      updateData = { is_approved: true, moderation_status: "approved", moderation_reason: null };
    } else if (action === "reject") {
      updateData = { is_approved: false, moderation_status: "rejected", moderation_reason: reason || "Отклонено модератором" };
    } else if (action === "deactivate") {
      updateData = { is_active: false };
    } else if (action === "activate") {
      updateData = { is_active: true };
    }

    updateData.moderated_by = user.id;
    updateData.moderated_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from(tableName).update(updateData).eq("id", id);

    if (error) {
      return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, type, id, action });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

/**
 * RELEASE-03 (аудит 5-b/b88714b): запись модераторского решения в audit_log.
 * Колонки — реальная схема из миграции 0018 (snake_case): user_id / action /
 * entity_type / entity_id / metadata (actor_id/details — НЕ существуют).
 * Fail-safe: сбой аудита не ломает уже применённое решение.
 */
async function writeRecipeAuditLog(
  actorId: string,
  action: "recipe_approve" | "recipe_reject",
  recipeId: string,
  reason: string | null,
  title: string | null
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("audit_log").insert({
      user_id: actorId,
      action,
      entity_type: "recipe",
      entity_id: String(recipeId),
      metadata: { reason: reason ?? null, title: title ?? null },
    });
    if (error) {
      console.error("[moderator/action] audit_log insert failed:", error.message);
    }
  } catch (auditError) {
    console.error(
      "[moderator/action] audit_log unexpected:",
      (auditError as Error)?.message
    );
  }
}
