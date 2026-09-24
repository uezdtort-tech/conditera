/**
 * POST /api/notifications/mark-read — отметить уведомления прочитанными.
 *
 * Тело запроса:
 *  { "notificationIds": ["uuid1", "uuid2"], "all": false }
 *  или
 *  { "all": true }  — отметить все непрочитанные как прочитанные
 *
 * Auth: AUTHENTICATED (может отмечать только свои уведомления)
 *
 * Соответствует таблице: notifications (update read_at=now, status='read')
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface MarkReadRequestBody {
  notificationIds?: string[];
  all?: boolean;
}

/**
 * POST /api/notifications/mark-read — отметить уведомления прочитанными.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = (await req.json()) as MarkReadRequestBody;
    const { notificationIds, all } = body;

    const nowIso = new Date().toISOString();

    // Вариант 1: отметить все непрочитанные как прочитанные
    if (all) {
      const { data, error } = await supabaseAdmin
        .from("notifications")
        .update({ read_at: nowIso, status: "read" })
        .eq("user_id", user.id)
        .eq("channel", "in_app")
        .is("read_at", null)
        .select("id");

      if (error) {
        console.error("[notifications/mark-read] update all error:", error.message);
        return NextResponse.json(
          { error: "Database update failed", details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        marked: "all",
        count: (data || []).length,
      });
    }

    // Вариант 2: отметить конкретные notificationIds
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json(
        { error: "Нужен notificationIds[] (массив UUID) или all=true" },
        { status: 400 }
      );
    }

    // Валидация: не более 1000 ID за раз
    if (notificationIds.length > 1000) {
      return NextResponse.json(
        { error: "Не более 1000 notificationIds за один запрос" },
        { status: 422 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: nowIso, status: "read" })
      .in("id", notificationIds)
      .eq("user_id", user.id)  // RLS: только свои уведомления
      .select("id");

    if (error) {
      console.error("[notifications/mark-read] update specific error:", error.message);
      return NextResponse.json(
        { error: "Database update failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      marked: (data || []).length,
    });
  } catch (error: any) {
    console.error("POST /api/notifications/mark-read error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
