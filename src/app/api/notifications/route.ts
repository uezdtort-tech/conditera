/**
 * /api/notifications — центральные уведомления пользователя (колокол в header).
 *
 * Таблица: public.notifications (миграция 0010): id, user_id, type, title,
 * body, channel, status, metadata, read_at, created_at.
 *
 * GET    — список своих уведомлений (50 свежих, новые сверху).
 *          Формат элемента: { id, type, title, message, createdAt, read }.
 * PATCH  — { id, read: true } — отметить одно; { readAll: true } — все.
 * DELETE — ?id=<uuid> — удалить одно; ?all=true — очистить все.
 *
 * Auth: Bearer (app-JWT или GoTrue-JWT). Без авторизации — 401:
 * клиентский колокол молча игнорирует не-2xx (res.ok), консоль не засоряет.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface NotificationRow {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("id, type, title, body, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) console.warn("[notifications] GET error:", error.message);

    const notifications = ((data || []) as unknown as NotificationRow[]).map((n) => ({
      id: n.id,
      type: n.type || "system",
      title: n.title || "Уведомление",
      message: n.body || "",
      createdAt: n.created_at,
      read: n.read_at != null,
    }));

    return NextResponse.json({
      notifications,
      unread: notifications.filter((n) => !n.read).length,
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Ошибка", detail }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      read?: boolean;
      readAll?: boolean;
    };

    const now = new Date().toISOString();

    if (body.readAll) {
      const { error } = await supabaseAdmin
        .from("notifications")
        .update({ read_at: now, status: "read" })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, readAll: true });
    }

    if (body.id) {
      const { error } = await supabaseAdmin
        .from("notifications")
        .update({ read_at: body.read === false ? null : now, status: body.read === false ? "unread" : "read" })
        .eq("id", body.id)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Нужен id или readAll" }, { status: 400 });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Ошибка", detail }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { searchParams } = new URL(request.url);

    if (searchParams.get("all") === "true") {
      const { error } = await supabaseAdmin
        .from("notifications")
        .delete()
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, cleared: true });
    }

    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Нужен id или all=true" }, { status: 400 });

    const { error } = await supabaseAdmin
      .from("notifications")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Ошибка", detail }, { status: 500 });
  }
}
