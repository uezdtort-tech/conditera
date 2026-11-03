/**
 * GET /api/courier/earnings — сводка по заработку курьера.
 *
 * A-3 (канонический источник заработка): суммы считаются по
 * deliveries.courier_earnings — снимку, зафиксированному в момент перехода
 * DELIVERED (CAS-присваивание, не инкремент — повторная обработка не удваивает
 * сумму). Раньше API суммировал orders.delivery_cost — ЦЕНА доставки для
 * покупателя, которая может быть изменена после назначения; из-за этого KPI
 * расходился с историей доставок и записями deliveries.
 *
 * Семантика величин (зафиксирована):
 *   • orders.delivery_cost  — клиентская цена доставки (продуктовая величина);
 *   • deliveries.cost       — стоимость доставки на момент назначения (снимок);
 *   • deliveries.courier_earnings — заработок курьера (выплата), канонический
 *     источник для всех KPI/историй/сверок.
 *
 * Legacy-строки (delivered до появления sync) с courier_earnings=NULL
 * показываются по deliveries.cost (снимок на момент назначения) — БЕЗ
 * скрытой перезаписи финансовых данных; обратная заливка (backfill) истории —
 * отдельная миграция по согласованию.
 *
 * Суммы — в рублях с дробной частью (как устроена существующая модель
 * numeric-колонок), округление ответа — до копеек (toFixed(2)).
 *
 * Auth: COURIER role.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

/** Заработок строки доставки: зафиксированная выплата или снимок на момент назначения. */
function rowEarnings(d: { courier_earnings: number | null; cost: number | null }): number {
  return Number(d.courier_earnings ?? d.cost ?? 0);
}

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

    // A-3: все завершённые доставки курьера — источник сумм deliveries
    // (courier_earnings), а не orders.delivery_cost.
    const { data: deliveredRows, error } = await supabaseAdmin
      .from("deliveries")
      .select("id, order_id, cost, courier_earnings, delivered_at")
      .eq("courier_id", courierId)
      .eq("status", "delivered")
      .order("delivered_at", { ascending: false });

    if (error) {
      console.error("[courier/earnings] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    const deliveries = deliveredRows || [];

    // Total earnings — сумма зафиксированных выплат по всем доставленным
    const totalEarnings = deliveries.reduce(
      (sum: number, d: { courier_earnings: number | null; cost: number | null }) =>
        sum + rowEarnings(d),
      0
    );

    // Monthly earnings — за текущий месяц (по дате доставки)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartIso = monthStart.toISOString();

    const monthlyRows = deliveries.filter(
      (d: { delivered_at: string | null }) =>
        !!d.delivered_at && new Date(d.delivered_at) >= monthStart
    );

    const monthlyEarnings = monthlyRows.reduce(
      (sum: number, d: { courier_earnings: number | null; cost: number | null }) =>
        sum + rowEarnings(d),
      0
    );

    return NextResponse.json({
      totalEarnings: Number(totalEarnings.toFixed(2)),
      monthlyEarnings: Number(monthlyEarnings.toFixed(2)),
      deliveries: deliveries.length,
      monthlyDeliveries: monthlyRows.length,
    });
  } catch (error: any) {
    console.error("GET /api/courier/earnings error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
