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
 *   • reject: pending_review → rejected (терминальный статус RB.15;
 *     reason фиксируется в ответе/логе — колонки moderation_reason в
 *     recipes нет, миграции рецептурного контура завершены).
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
        title: string;
        slug: string | null;
        status: string;
        published_at: string | null;
        updated_at: string | null;
      };
      if (recipeRow.status !== "pending_review") {
        return NextResponse.json(
          {
            error: `Рецепт не в очереди модерации (статус: ${recipeRow.status}); действие применяется только к pending_review`,
          },
          { status: 409 }
        );
      }

      if (action === "reject") {
        const { error: rejErr } = await supabaseAdmin
          .from("recipes")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("id", id);
        if (rejErr) {
          console.error("[moderator/action] recipe reject failed:", rejErr.message);
          return NextResponse.json({ error: "DB error", details: rejErr.message }, { status: 500 });
        }
        console.log(
          `[moderator/action] recipe rejected: id=${id} reason=${reason ?? "—"} moderator=${user.id}`
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
