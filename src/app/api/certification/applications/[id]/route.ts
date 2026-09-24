/**
 * GET /api/certification/applications/:id — карточка заявки
 *
 * Auth: [, ", C, E, R, T, I, F, I, C, A, T, I, O, N, _, A, G, E, N, T, ", ,,  , ", A, D, M, I, N, ", ]
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

    const guard = await requireAnyRole(user.id, ["CERTIFICATION_AGENT", "ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "certification_application")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) console.warn("[applications] GET error:", error.message);
    return NextResponse.json({ application: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
