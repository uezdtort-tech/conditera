/**
 * POST /api/nutritionist/certify — сертифицировать продукт (NUTRITIONIST).
 *
 * Body: { productId, ...certificationData }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "NUTRITIONIST");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();

    try {
      await supabaseAdmin.from("audit_log").insert({
        user_id: user.id,
        action: "nutritionist_certify",
        entity_type: "product",
        entity_id: body.productId || "unknown",
        metadata: { ...body, status: "certified" },
        created_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.warn("[nutritionist/certify] DB insert failed:", e?.message);
    }

    return NextResponse.json({
      certificationId: `cert_${Date.now()}`,
      productId: body.productId,
      status: "certified",
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
