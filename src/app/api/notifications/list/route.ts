/**
 * GET /api/notifications/list — список уведомлений пользователя.
 *
 * Query параметры:
 *  - limit:       1-200 (по умолчанию 50)
 *  - unreadOnly:  true/false (по умолчанию false)
 *  - cursor:      id последнего элемента для cursor-based пагинации (опционально)
 *
 * Auth: AUTHENTICATED
 *
 * Соответствует таблице: notifications (channel=in_app, status IN sent/delivered для unread)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * GET /api/notifications/list — получить список in_app уведомлений.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const cursor = searchParams.get("cursor");

    let query = supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("channel", "in_app")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.in("status", ["sent", "delivered"]).is("read_at", null);
    }

    if (cursor) {
      // Cursor-based pagination: получить элементы после cursor (по created_at)
      query = query.lt("created_at", cursor);
    }

    const { data: notifications, error } = await query;

    if (error) {
      console.error("[notifications/list] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    const list = notifications || [];
    const lastItem = list.length > 0 ? list[list.length - 1] : null;
    const nextCursor = lastItem ? (lastItem as any).created_at : null;

    return NextResponse.json({
      notifications: list,
      meta: {
        count: list.length,
        limit,
        unreadOnly,
        cursor: cursor || null,
        nextCursor,
      },
    });
  } catch (error: any) {
    console.error("GET /api/notifications/list error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
