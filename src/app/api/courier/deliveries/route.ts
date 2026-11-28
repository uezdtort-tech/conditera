/**
 * GET /api/courier/deliveries — доставки текущего курьера.
 * Назначение хранится в deliveries.courier_id; orders не содержит courier_id.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const ACTIVE_STATUSES = ["assigned", "picked_up", "on_the_way"];
const PAST_STATUSES = ["delivered", "failed"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "COURIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status") || "all";
    const limit = Math.max(1, Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
      MAX_LIMIT
    ));

    let deliveryQuery = supabaseAdmin
      .from("deliveries")
      .select("id, order_id, status, address, estimated_time, cost, courier_earnings, created_at, updated_at, delivered_at")
      .eq("courier_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (statusFilter === "active") deliveryQuery = deliveryQuery.in("status", ACTIVE_STATUSES);
    else if (statusFilter === "past") deliveryQuery = deliveryQuery.in("status", PAST_STATUSES);

    const { data: deliveryRows, error: deliveryError } = await deliveryQuery;
    if (deliveryError) {
      console.error("[courier/deliveries] delivery query failed:", deliveryError.message);
      return NextResponse.json({ error: "Database query failed" }, { status: 503 });
    }
    if (!deliveryRows?.length) return NextResponse.json({ deliveries: [], total: 0 });

    const orderIds = [...new Set(deliveryRows.map((delivery: any) => delivery.order_id))];
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select("id, number, status, total, delivery_cost, delivery_address, delivery_date, delivery_time, payment_status, created_at, updated_at, user_id, confectioner_id")
      .in("id", orderIds);
    if (ordersError) {
      console.error("[courier/deliveries] order lookup failed:", ordersError.message);
      return NextResponse.json({ error: "Order details unavailable" }, { status: 503 });
    }

    const orderMap = new Map<string, any>();
    for (const order of orders || []) orderMap.set(order.id, order);
    const userIds = [...new Set((orders || []).map((order: any) => order.user_id).filter(Boolean))];
    const confectionerIds = [...new Set((orders || []).map((order: any) => order.confectioner_id).filter(Boolean))];

    const [itemsResult, customersResult, confectionersResult] = await Promise.all([
      supabaseAdmin.from("order_items").select("id, order_id, title, image, quantity").in("order_id", orderIds),
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, name, phone").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      confectionerIds.length
        ? supabaseAdmin.from("confectioners").select("id, businessName, city").in("id", confectionerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [itemsResult, customersResult, confectionersResult]) {
      if (result.error) {
        console.error("[courier/deliveries] related data lookup failed:", result.error.message);
        return NextResponse.json({ error: "Delivery details unavailable" }, { status: 503 });
      }
    }

    const itemsByOrder = new Map<string, any[]>();
    for (const item of itemsResult.data || []) {
      const list = itemsByOrder.get(item.order_id) || [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
    }
    const customerMap = new Map<string, any>();
    for (const customer of customersResult.data || []) customerMap.set(customer.id, customer);
    const confectionerMap = new Map<string, any>();
    for (const confectioner of confectionersResult.data || []) confectionerMap.set(confectioner.id, confectioner);

    const result = deliveryRows.map((delivery: any) => {
      const order = orderMap.get(delivery.order_id);
      return {
        id: order?.id || delivery.order_id,
        delivery_id: delivery.id,
        number: order?.number || delivery.order_id,
        status: order?.status || delivery.status,
        delivery_status: delivery.status,
        total: Number(order?.total || 0),
        delivery_cost: Number(delivery.cost || order?.delivery_cost || 0),
        courier_earnings: Number(delivery.courier_earnings || 0),
        delivery_address: delivery.address,
        delivery_date: order?.delivery_date || null,
        delivery_time: delivery.estimated_time || order?.delivery_time || null,
        payment_status: order?.payment_status || null,
        created_at: delivery.created_at,
        updated_at: delivery.updated_at,
        delivered_at: delivery.delivered_at,
        items: itemsByOrder.get(delivery.order_id) || [],
        customer: order?.user_id ? customerMap.get(order.user_id) || null : null,
        confectioner: order?.confectioner_id ? confectionerMap.get(order.confectioner_id) || null : null,
      };
    });

    return NextResponse.json({ deliveries: result, total: result.length });
  } catch (error: any) {
    console.error("GET /api/courier/deliveries error:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
