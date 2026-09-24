/**
 * POST /api/venues/:id/book — забронировать площадку
 *
 * Auth: [, ", C, U, S, T, O, M, E, R, ", ,,  , ", E, V, E, N, T, _, O, R, G, A, N, I, Z, E, R, ", ,,  , ", A, D, M, I, N, ", ]
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

    const guard = await requireAnyRole(user.id, ["CUSTOMER", "EVENT_ORGANIZER", "ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "venue_booking")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) console.warn("[[id]] GET error:", error.message);
    return NextResponse.json({ booking: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
