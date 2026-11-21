/**
 * GET /api/courier/available-orders — список заказов, ожидающих курьера.
 *
 * Возвращает только переданные кондитером заказы IN_DELIVERY,
 * для которых ещё нет активной записи в deliveries.
 *
 * Auth: COURIER role.
 *
 * Соответствует таблицам:
 *  - orders (поиск доступных заказов)
 *  - order_items (данные позиций)
 *  - profiles (данные покупателя)
 *  - confectioners (данные кондитера)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_ORDERS_RETURN = 100;

/**
 * GET /api/courier/available-orders — получить список заказов, готовых к доставке.
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

    // Найти переданные курьеру заказы IN_DELIVERY без назначения
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, status, total, delivery_address, delivery_date,
        delivery_time, delivery_cost, payment_method, payment_status,
        comment, created_at, user_id, confectioner_id
      `
      )
      .eq("status", "IN_DELIVERY")
      .eq("delivery_type", "delivery")
      .not("delivery_address", "is", null)
      .neq("delivery_address", "")
      .order("delivery_date", { ascending: true })
      .limit(MAX_ORDERS_RETURN);

    if (error) {
      console.error("[courier/available-orders] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({ orders: [], total: 0 });
    }

    // Назначение курьера хранится в deliveries, а не в orders.
    const candidateIds = orders.map((order: any) => order.id);
    const { data: activeAssignments, error: assignmentError } = await supabaseAdmin
      .from("deliveries")
      .select("order_id")
      .in("order_id", candidateIds)
      .in("status", ["assigned", "picked_up", "on_the_way"]);
    if (assignmentError) {
      console.error("[courier/available-orders] assignment lookup failed:", assignmentError.message);
      return NextResponse.json({ error: "Не удалось проверить назначения доставок" }, { status: 503 });
    }
    const assignedIds = new Set((activeAssignments || []).map((assignment: any) => assignment.order_id));
    const availableOrders = orders.filter((order: any) => !assignedIds.has(order.id));
    if (availableOrders.length === 0) {
      return NextResponse.json({ orders: [], total: 0 });
    }

    // Получить items для всех свободных заказов одним запросом
    const orderIds = availableOrders.map((o: any) => o.id);
    const [{ data: items }, { data: customers }, { data: confectioners }] = await Promise.all([
      supabaseAdmin
        .from("order_items")
        .select("id, order_id, title, image, quantity")
        .in("order_id", orderIds),
      supabaseAdmin
        .from("profiles")
        .select("id, name, phone")
        .in("id", availableOrders.map((o: any) => o.user_id).filter(Boolean)),
      supabaseAdmin
        .from("confectioners")
        .select("id, businessName, city")
        .in("id", availableOrders.map((o: any) => o.confectioner_id).filter(Boolean)),
    ]);

    // Сгруппировать items по order_id
    const itemsByOrder = new Map<string, any[]>();
    for (const item of items || []) {
      const arr = itemsByOrder.get(item.order_id) || [];
      arr.push(item);
      itemsByOrder.set(item.order_id, arr);
    }

    // Создать map покупателей и кондитеров
    const customerMap = new Map<string, any>();
    for (const c of customers || []) {
      customerMap.set(c.id, c);
    }
    const confMap = new Map<string, any>();
    for (const c of confectioners || []) {
      confMap.set(c.id, c);
    }

    // Собрать итоговый массив
    const result = availableOrders.map((o: any) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: Number(o.total),
      delivery_address: o.delivery_address,
      delivery_date: o.delivery_date,
      delivery_time: o.delivery_time,
      delivery_cost: Number(o.delivery_cost || 0),
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      comment: o.comment,
      created_at: o.created_at,
      items: itemsByOrder.get(o.id) || [],
      customer: customerMap.get(o.user_id) || null,
      confectioner: confMap.get(o.confectioner_id) || null,
    }));

    return NextResponse.json({ orders: result, total: result.length });
  } catch (error: any) {
    console.error("GET /api/courier/available-orders error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
