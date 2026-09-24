/**
 * GET  /api/events/:id — получить мероприятие по ID
 * PUT  /api/events/:id — обновить мероприятие (EVENT_ORGANIZER или ADMIN)
 *
 * Auth: AUTHENTICATED для GET, EVENT_ORGANIZER/ADMIN для PUT
 *
 * Соответствует таблице: audit_log (используется как временное хранилище для events)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/events/:id — получить мероприятие по ID.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("id", id)
      .eq("action", "event_create")
      .maybeSingle();

    if (error) {
      console.warn("[events/:id] GET error:", error.message);
    }

    return NextResponse.json({ event: data || null });
  } catch (error: any) {
    console.error("GET /api/events/:id error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/events/:id — обновить мероприятие.
 * Только EVENT_ORGANIZER или ADMIN.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли
    const guard = await requireAnyRole(user.id, ["EVENT_ORGANIZER", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .update({
        metadata: { updated: true, ...body },
      })
      .eq("id", id)
      .eq("action", "event_create")
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { error: "Мероприятие не найдено или нет прав" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, eventId: id });
  } catch (error: any) {
    console.error("PUT /api/events/:id error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
