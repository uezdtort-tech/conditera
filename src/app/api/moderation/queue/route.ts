/**
 * GET /api/moderation/queue — список контента для модерации.
 *
 * Query параметры:
 *  - status: pending | flagged | approved | rejected (опционально)
 *  - contentType: тип контента (review, blog_post, photo, и т.д.)
 *  - search: поиск по title/content/authorName (ILIKE)
 *  - limit: по умолчанию 50
 *  - offset: по умолчанию 0
 *
 * Auth: ADMIN, MODERATOR или SUPPORT
 *
 * Соответствует таблицам:
 *  - moderation_queue (список элементов)
 *  - moderation_reports (связанные жалобы)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * GET /api/moderation/queue — получить список контента для модерации.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — ADMIN, MODERATOR или SUPPORT
    const guard = await requireAnyRole(user.id, ["ADMIN", "MODERATOR", "SUPPORT"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const contentType = searchParams.get("contentType");
    const search = searchParams.get("search");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabaseAdmin
      .from("moderation_queue")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Фильтр по статусу
    if (status === "pending") {
      query = query.eq("manual_status", "pending");
    } else if (status === "flagged") {
      query = query.eq("auto_status", "flagged");
    } else if (status === "approved") {
      query = query.eq("auto_status", "approved");
    } else if (status === "rejected") {
      query = query.eq("auto_status", "rejected");
    }

    // Фильтр по типу контента
    if (contentType) {
      query = query.eq("content_type", contentType);
    }

    // Поиск
    if (search) {
      query = query.or(
        `title.ilike.%${search}%,content.ilike.%${search}%,author_name.ilike.%${search}%`
      );
    }

    const { data: items, count, error } = await query;

    if (error) {
      console.error("[moderation/queue] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    // Получить связанные reports (жалобы) для каждого элемента
    const itemIds = (items || []).map((i: any) => i.id);
    let reportsByItem = new Map<string, any[]>();
    if (itemIds.length > 0) {
      const { data: reports } = await supabaseAdmin
        .from("moderation_reports")
        .select("id, item_id, reason, reporter_name, created_at")
        .in("item_id", itemIds)
        .order("created_at", { ascending: false });

      for (const r of reports || []) {
        const arr = reportsByItem.get(r.item_id) || [];
        arr.push(r);
        reportsByItem.set(r.item_id, arr);
      }
    }

    const result = (items || []).map((item: any) => ({
      ...item,
      reports: reportsByItem.get(item.id) || [],
    }));

    return NextResponse.json({
      items: result,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("GET /api/moderation/queue error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
