/**
 * GET /api/supplier/orders — входящие закупочные заказы поставщика.
 *
 * Серверная изоляция: supplier_id = user.id (чужие заказы недоступны).
 * Фильтры: ?status=SUBMITTED|…, ?unread — новые без подтверждения.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = Math.min(Number(searchParams.get("limit") ?? 50) || 50, 200);

    let query = supabaseAdmin
      .from("purchase_orders")
      .select(
        `id, number, buyer_id, status, subtotal, confirmed_subtotal, currency,
         delivery_method, delivery_address, requested_delivery_date,
         promised_shipment_date, buyer_comment, supplier_comment, rejection_reason,
         created_at, updated_at, confirmed_at, rejected_at, shipped_at, delivered_at, cancelled_at,
         items:purchase_order_items(id, product_id, product_name, unit, quantity, confirmed_quantity, unit_price, line_total)`
      )
      .eq("supplier_id", user.id) // только СВОИ входящие (изоляция поставщиков)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("[supplier/orders] GET error:", error.message);
      return NextResponse.json({ error: "Ошибка чтения заказов" }, { status: 500 });
    }

    // Имена покупателей (без приватных контактов — name из profiles).
    const buyerIds = [...new Set((data ?? []).map((o: any) => o.buyer_id))];
    const { data: buyers } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", buyerIds.length ? buyerIds : ["00000000-0000-0000-0000-000000000000"]);
    const namesById = new Map((buyers ?? []).map((b: any) => [b.id, b.name]));

    const orders = (data ?? []).map((o: Record<string, unknown>) => ({
      ...o,
      buyerName: namesById.get(String(o.buyer_id)) ?? "Кондитер",
    }));

    return NextResponse.json({ orders });
  } catch (e: any) {
    console.error("[supplier/orders] GET:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
