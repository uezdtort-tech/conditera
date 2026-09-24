/**
 * GET /api/courier/earnings — сводка по заработку курьера.
 *
 * Считает:
 *   - totalEarnings: сумма delivery_cost по всем доставленным заказам
 *   - monthlyEarnings: то же за текущий месяц
 *   - deliveries: количество доставленных заказов
 *
 * Auth: COURIER role.
 *
 * Соответствует таблице: orders (фильтр по courier_id и status IN DELIVERED/COMPLETED)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

/**
 * GET /api/courier/earnings — получить сводку по заработку курьера.
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

    // Получить все доставленные заказы курьера
    const { data: deliveredOrders, error } = await supabaseAdmin
      .from("orders")
      .select("id, number, delivery_cost, total, status, created_at")
      .eq("courier_id", courierId)
      .in("status", ["DELIVERED", "COMPLETED"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[courier/earnings] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    const orders = deliveredOrders || [];

    // Total earnings — сумма delivery_cost по всем доставленным заказам
    const totalEarnings = orders.reduce(
      (sum: number, o: any) => sum + Number(o.delivery_cost || 0),
      0
    );

    // Monthly earnings — за текущий месяц
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartIso = monthStart.toISOString();

    const monthlyEarnings = orders
      .filter((o: any) => new Date(o.created_at) >= monthStart)
      .reduce((sum: number, o: any) => sum + Number(o.delivery_cost || 0), 0);

    // Кол-во доставленных заказов за месяц
    const monthlyDeliveries = orders.filter(
      (o: any) => new Date(o.created_at) >= monthStart
    ).length;

    return NextResponse.json({
      totalEarnings: Number(totalEarnings.toFixed(2)),
      monthlyEarnings: Number(monthlyEarnings.toFixed(2)),
      deliveries: orders.length,
      monthlyDeliveries,
    });
  } catch (error: any) {
    console.error("GET /api/courier/earnings error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
