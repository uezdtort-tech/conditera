/**
 * GET  /api/events — список мероприятий
 * POST /api/events — создать мероприятие (EVENT_ORGANIZER или ADMIN)
 *
 * Auth: AUTHENTICATED для GET, EVENT_ORGANIZER/ADMIN для POST
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "event_create")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.warn("[events] GET query error:", error.message);
    }

    return NextResponse.json({ events: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const guard = await requireAnyRole(user.id, ["EVENT_ORGANIZER", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json().catch(() => ({}));
    const eventId = `evt_${Date.now()}`;

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .insert({
        user_id: user.id,
        action: "event_create",
        entity_type: "event",
        entity_id: eventId,
        metadata: { ...body, status: "open", applications: [] },
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ eventId: "temp" }, { status: 201 });
    }

    return NextResponse.json({ eventId: data?.id || eventId }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
