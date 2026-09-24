/**
 * GET  /api/taster/sessions — список дегустационных сессий
 * POST /api/taster/sessions — создать сессию (CONFECTIONER или FOOD_SERVICE)
 *
 * Auth: AUTHENTICATED для GET, CONFECTIONER/FOOD_SERVICE для POST
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

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "taster_session")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) console.warn("[taster/sessions] GET error:", error.message);
    return NextResponse.json({ sessions: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "FOOD_SERVICE"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json().catch(() => ({}));

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .insert({
        user_id: user.id,
        action: "taster_session",
        entity_type: "session",
        entity_id: `session_${Date.now()}`,
        metadata: { ...body, status: "open", tasters: [] },
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ sessionId: "temp" }, { status: 201 });
    return NextResponse.json({ sessionId: data?.id || "temp" }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
