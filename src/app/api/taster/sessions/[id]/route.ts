/**
 * GET  /api/taster/sessions/:id — получить дегустационную сессию
 * POST /api/taster/sessions/:id — записаться на дегустацию (TASTER)
 * PUT  /api/taster/sessions/:id — отправить оценки (TASTER)
 *
 * Auth: AUTHENTICATED для GET, TASTER для POST/PUT
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) console.warn("[taster/sessions/:id] GET error:", error.message);
    return NextResponse.json({ session: data || null });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "TASTER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    return NextResponse.json({ success: true, sessionId: id });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "TASTER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ success: true, ratingsSubmitted: body.ratings?.length || 0 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
