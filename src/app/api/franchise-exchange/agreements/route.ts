/**
 * GET  /api/franchise-exchange/agreements — список договоров франшизы
 * POST /api/franchise-exchange/agreements — создать договор (FRANCHISEE или ADMIN)
 *
 * Auth: AUTHENTICATED для GET, FRANCHISEE/ADMIN для POST
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

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "franchise_agreement")
      .or(`user_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.warn("[franchise-exchange/agreements] GET error:", error.message);
    }

    // Фильтруем по участникам (metadata.sellerId или metadata.buyerId == user.id)
    const filtered = (data || []).filter((a: any) => {
      const meta = a.metadata || {};
      return meta.sellerId === user.id || meta.buyerId === user.id;
    });

    return NextResponse.json({ agreements: filtered });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["FRANCHISEE", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    const { listingId, buyerId, sellerId, price, region, terms } = await request.json();

    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .insert({
        user_id: user.id,
        action: "franchise_agreement",
        entity_type: "franchise",
        entity_id: `agreement_${Date.now()}`,
        metadata: {
          listingId, buyerId, sellerId, price, region,
          terms: terms || "Стандартные условия передачи франшизы",
          status: "draft",
          createdAt: new Date().toISOString(),
          stage: "draft",
        },
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ agreementId: "temp", status: "draft" }, { status: 201 });
    }

    return NextResponse.json({ agreementId: data?.id || "temp", status: "draft" }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
