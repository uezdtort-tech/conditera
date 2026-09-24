/**
 * GET  /api/team/events — список событий команды (календарь)
 * POST /api/team/events — создать событие
 *
 * Query: ?from=ISO&to=ISO (фильтр по диапазону дат)
 *
 * Auth: CONFECTIONER или STUDIO
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "STUDIO"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    let query = supabaseAdmin
      .from("team_events")
      .select("*")
      .eq("team_id", user.id)
      .order("date", { ascending: true });

    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);

    const { data: events, error } = await query;
    if (error) console.warn("[team/events] GET error:", error.message);

    return NextResponse.json({ events: events || [], total: (events || []).length });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "STUDIO"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();

    const { data: event, error } = await supabaseAdmin
      .from("team_events")
      .insert({
        team_id: user.id,
        title: body.title || "Untitled",
        description: body.description || null,
        date: body.date || new Date().toISOString(),
        type: body.type || "meeting",
        assigned_to: body.assignedTo || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
