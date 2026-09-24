/**
 * GET /api/franchisee/reports — отчёты по роялти (FRANCHISEE или ADMIN).
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

    const guard = await requireAnyRole(user.id, ["FRANCHISEE", "ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const defaultReport = { period, revenue: 0, royaltyRate: 0.03, royaltyAmount: 0, status: "pending" };

    try {
      const { data: reports, error } = await supabaseAdmin
        .from("audit_log")
        .select("*")
        .eq("action", "franchisee_report")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) throw error;
      return NextResponse.json({ reports: (reports || []).length > 0 ? reports : [defaultReport] });
    } catch {
      return NextResponse.json({ reports: [defaultReport] });
    }
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
