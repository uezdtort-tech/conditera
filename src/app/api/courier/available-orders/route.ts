/**
 * GET /api/courier/available-orders — список заказов, ожидающих курьера.
 *
 * Возвращает заказы в статусах READY или IN_DELIVERY, у которых ещё не
 * назначен курьер (courier_id IS NULL).
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

    // Найти заказы в статусе READY или IN_DELIVERY без курьера
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, status, total, delivery_address, delivery_date,
        delivery_time, delivery_cost, payment_method, payment_status,
        comment, created_at, user_id, confectioner_id
      `
      )
      .in("status", ["READY", "IN_DELIVERY"])
      .is("courier_id", null)
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

    // Получить items для всех заказов одним запросом
    const orderIds = orders.map((o: any) => o.id);
    const [{ data: items }, { data: customers }, { data: confectioners }] = await Promise.all([
      supabaseAdmin
        .from("order_items")
        .select("id, order_id, title, image, quantity")
        .in("order_id", orderIds),
      supabaseAdmin
        .from("profiles")
        .select("id, name, phone")
        .in("id", orders.map((o: any) => o.user_id).filter(Boolean)),
      supabaseAdmin
        .from("confectioners")
        .select("id, business_name, city")
        .in("id", orders.map((o: any) => o.confectioner_id).filter(Boolean)),
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
    const result = orders.map((o: any) => ({
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
