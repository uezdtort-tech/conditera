/**
 * GET /api/notifications/unread-count — количество непрочитанных уведомлений.
 *
 * Возвращает число непрочитанных in_app уведомлений пользователя.
 *
 * Auth: AUTHENTICATED
 *
 * Соответствует таблице: notifications (channel=in_app, status IN sent/delivered, read_at IS NULL)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/notifications/unread-count — получить количество непрочитанных уведомлений.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { count, error } = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("channel", "in_app")
      .in("status", ["sent", "delivered"])
      .is("read_at", null);

    if (error) {
      console.error("[notifications/unread-count] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ count: count || 0 });
  } catch (error: any) {
    console.error("GET /api/notifications/unread-count error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
