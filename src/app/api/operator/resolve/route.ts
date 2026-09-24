/**
 * POST /api/operator/resolve — закрыть эскалацию (ADMIN/SUPER_ADMIN/SUPPORT).
 * Body: { escalationId, resolution: "answered"|"redirected"|"no_action" }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const VALID_RESOLUTIONS = ["answered", "redirected", "no_action"];

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "SUPPORT"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { escalationId, resolution } = await request.json();
    if (!escalationId || !resolution) {
      return NextResponse.json({ error: "Укажите escalationId и resolution" }, { status: 400 });
    }
    if (!VALID_RESOLUTIONS.includes(resolution)) {
      return NextResponse.json({ error: `resolution должен быть: ${VALID_RESOLUTIONS.join(", ")}` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("chat_escalations")
      .update({
        status: "resolved",
        resolution,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", escalationId)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Эскалация не найдена" }, { status: 404 });
    }

    return NextResponse.json({ success: true, escalationId: data.id, resolution });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
