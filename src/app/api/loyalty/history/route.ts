/**
 * GET /api/loyalty/history — история начислений/списаний бонусов (AUTHENTICATED).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { data: transactions, error: txErr } = await supabaseAdmin
      .from("loyalty_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (txErr) console.warn("[loyalty/history] transactions error:", txErr.message);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("bonus_balance, loyalty_level")
      .eq("id", user.id)
      .maybeSingle();

    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("total")
      .eq("user_id", user.id)
      .eq("payment_status", "succeeded");

    const totalSpent = (orders || []).reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);

    return NextResponse.json({
      balance: Number(profile?.bonus_balance) || 0,
      level: profile?.loyalty_level || "BRONZE",
      totalSpent,
      transactions: transactions || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
