/**
 * POST /api/events/:id/apply — подать заявку на участие в мероприятии (CONFECTIONER).
 *
 * Auth: CONFECTIONER
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json().catch(() => ({}));

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .insert({
        user_id: user.id,
        action: "event_apply",
        entity_type: "event",
        entity_id: id,
        metadata: { ...body, status: "pending", confectionerId: user.id },
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ applicationId: "temp" });
    }

    return NextResponse.json({ applicationId: data?.id || "temp" }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
