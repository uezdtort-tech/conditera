/**
 * GET  /api/franchise-exchange/listings — список франшиз на бирже (public)
 * POST /api/franchise-exchange/listings — выставить франшизу на продажу (FRANCHISEE или ADMIN)
 *
 * GET Query: ?region=&minPrice=&maxPrice=
 * POST Body: { region, price, description?, revenue?, confectionersCount?, reason?, includes? }
 *
 * Auth: GET public, POST FRANCHISEE/ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get("region");
    const minPrice = parseInt(searchParams.get("minPrice") || "0");
    const maxPrice = parseInt(searchParams.get("maxPrice") || "0");

    const { data: listings, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "franchise_listing")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.warn("[franchise-exchange/listings] GET error:", error.message);
    }

    // Фильтруем по параметрам
    let filtered = listings || [];
    if (region) {
      filtered = filtered.filter((l: any) => {
        const meta = (l.metadata as any) || {};
        return meta.region?.toLowerCase().includes(region.toLowerCase());
      });
    }
    if (minPrice > 0) {
      filtered = filtered.filter((l: any) => ((l.metadata as any)?.price || 0) >= minPrice);
    }
    if (maxPrice > 0) {
      filtered = filtered.filter((l: any) => ((l.metadata as any)?.price || 0) <= maxPrice);
    }

    return NextResponse.json({ listings: filtered, total: filtered.length });
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

    const body = await request.json();
    const { region, price, description, revenue, confectionersCount, reason, includes } = body;

    if (!region || !price) return NextResponse.json({ error: "Укажите region и price" }, { status: 400 });

    const { data: listing, error } = await supabaseAdmin
      .from("audit_log")
      .insert({
        user_id: user.id,
        action: "franchise_listing",
        entity_type: "franchise",
        entity_id: `fr_${Date.now()}`,
        metadata: {
          region, price,
          description: description || "",
          revenue: revenue || 0,
          confectionersCount: confectionersCount || 0,
          reason: reason || "Продажа франшизы",
          includes: includes || ["brand", "confectioners", "client_base"],
          status: "active",
          sellerId: user.id,
          views: 0,
          createdAt: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    // Уведомить админов (non-blocking)
    try {
      const { data: admins } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["ADMIN", "SUPER_ADMIN"])
        .eq("is_active", true);

      const { sendNotification } = await import("@/lib/notifications");
      for (const admin of admins || []) {
        await sendNotification({
          userId: admin.user_id,
          template: "NEW_MESSAGE",
          vars: { senderName: "Биржа франшиз", text: `Новая франшиза на продажу: ${region}, ${price}₽` },
          data: { type: "franchise_listing_new", listingId: listing?.id },
        });
      }
    } catch {}

    return NextResponse.json(
      { listingId: listing?.id || "temp", status: "active" },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
