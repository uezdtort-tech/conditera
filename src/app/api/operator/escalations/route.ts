/**
 * GET /api/operator/escalations — список эскалаций (ADMIN/SUPER_ADMIN/SUPPORT).
 * Query: ?status=pending|assigned|resolved|all&limit=
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

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "SUPPORT"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

    let query = supabaseAdmin
      .from("chat_escalations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status !== "all") query = query.eq("status", status);

    const { data, error } = await query;
    if (error) console.warn("[operator/escalations] GET error:", error.message);

    return NextResponse.json({ escalations: data || [], total: (data || []).length });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
