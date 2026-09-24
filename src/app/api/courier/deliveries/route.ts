/**
 * GET /api/courier/deliveries — доставки курьера (активные и завершённые).
 *
 * Query параметры:
 *  - status: active | past | all (по умолчанию all)
 *  - limit: 1-200 (по умолчанию 50)
 *
 * Auth: COURIER role.
 *
 * Соответствует таблицам:
 *  - orders (доставки курьера)
 *  - order_items (данные позиций)
 *  - profiles (данные покупателя)
 *  - confectioners (данные кондитера)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const ACTIVE_STATUSES = ["READY", "IN_DELIVERY"];
const PAST_STATUSES = ["DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED"];

/**
 * GET /api/courier/deliveries — список доставок курьера.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверка роли — только COURIER
    const guard = await requireRole(user.id, "COURIER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const courierId = user.id;
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status") || "all";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );

    // Базовый запрос — заказы текущего курьера
    let query = supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, status, total, delivery_cost, delivery_address,
        delivery_date, delivery_time, payment_status, created_at,
        updated_at, user_id, confectioner_id
      `
      )
      .eq("courier_id", courierId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (statusFilter === "active") {
      query = query.in("status", ACTIVE_STATUSES);
    } else if (statusFilter === "past") {
      query = query.in("status", PAST_STATUSES);
    }

    const { data: deliveries, error } = await query;

    if (error) {
      console.error("[courier/deliveries] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    if (!deliveries || deliveries.length === 0) {
      return NextResponse.json({ deliveries: [], total: 0 });
    }

    // Получить items, customers, confectioners одним batch-запросом
    const orderIds = deliveries.map((o: any) => o.id);
    const userIds = deliveries.map((o: any) => o.user_id).filter(Boolean);
    const confIds = deliveries.map((o: any) => o.confectioner_id).filter(Boolean);

    const [itemsResult, customersResult, confResult] = await Promise.all([
      supabaseAdmin
        .from("order_items")
        .select("id, order_id, title, image, quantity")
        .in("order_id", orderIds),
      supabaseAdmin
        .from("profiles")
        .select("id, name, phone")
        .in("id", userIds),
      confIds.length > 0
        ? supabaseAdmin
            .from("confectioners")
            .select("id, business_name, city")
            .in("id", confIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Сгруппировать items по order_id
    const itemsByOrder = new Map<string, any[]>();
    for (const item of itemsResult.data || []) {
      const arr = itemsByOrder.get(item.order_id) || [];
      arr.push(item);
      itemsByOrder.set(item.order_id, arr);
    }

    const customerMap = new Map<string, any>();
    for (const c of customersResult.data || []) {
      customerMap.set(c.id, c);
    }
    const confMap = new Map<string, any>();
    for (const c of confResult.data || []) {
      confMap.set(c.id, c);
    }

    const result = deliveries.map((o: any) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: Number(o.total),
      delivery_cost: Number(o.delivery_cost || 0),
      delivery_address: o.delivery_address,
      delivery_date: o.delivery_date,
      delivery_time: o.delivery_time,
      payment_status: o.payment_status,
      created_at: o.created_at,
      updated_at: o.updated_at,
      items: itemsByOrder.get(o.id) || [],
      customer: customerMap.get(o.user_id) || null,
      confectioner: confMap.get(o.confectioner_id) || null,
    }));

    return NextResponse.json({ deliveries: result, total: result.length });
  } catch (error: any) {
    console.error("GET /api/courier/deliveries error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
