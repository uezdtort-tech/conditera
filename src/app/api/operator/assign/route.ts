/**
 * POST /api/operator/assign — взять эскалацию в работу (ADMIN/SUPER_ADMIN/SUPPORT).
 * Body: { escalationId }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "SUPPORT"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { escalationId } = await request.json();
    if (!escalationId) return NextResponse.json({ error: "Укажите escalationId" }, { status: 400 });

    // Atomic: only pending escalations can be assigned
    const { data, error } = await supabaseAdmin
      .from("chat_escalations")
      .update({
        status: "assigned",
        assigned_to: user.id,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", escalationId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Эскалация не найдена или уже назначена" }, { status: 409 });
    }

    return NextResponse.json({ success: true, escalationId: data.id });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
