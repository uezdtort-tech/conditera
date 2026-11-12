/**
 * GET /api/courier/dashboard — сводная статистика курьера.
 *
 * Stub mode: в dev (NODE_ENV=development) или если БД недоступна,
 * возвращает demo-данные со stub: true.
 *
 * Auth: COURIER role (или stub в dev).
 *
 * Соответствует таблицам:
 *  - orders (активные доставки по статусам READY/IN_DELIVERY)
 *  - deliveries (завершённые доставки, заработок — courier_earnings)
 *  - courier_profiles (rating, deliveries_count)
 *
 * A-3 (канонический источник заработка): earningsToday/Month и история считаются
 * по deliveries.courier_earnings — снимку выплаты, зафиксированному при переходе
 * DELIVERED (присваивание, не инкремент — повторная обработка не удваивает).
 * orders.delivery_cost — клиентская ЦЕНА доставки, заработком не является.
 * Legacy-строки с courier_earnings=NULL показываются по deliveries.cost БЕЗ
 * перезаписи финансовых данных (backfill — отдельная миграция по согласованию).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { getCourierOrderIds } from "@/lib/courier-assignments";

export const runtime = "nodejs";

/** Заработок строки доставки: зафиксированная выплата или снимок на момент назначения. */
function rowEarnings(d: { courier_earnings: number | null; cost: number | null }): number {
  return Number(d.courier_earnings ?? d.cost ?? 0);
}

const STUB_DATA = {
  stats: {
    activeDeliveries: 3,
    completedToday: 5,
    earningsToday: 4200,
    earningsMonth: 38400,
    rating: 4.9,
  },
  activeDeliveries: [
    { id: "d1", orderId: "ORD-2026-0042", customer: "Мария С.", address: "ул. Тверская, 12, кв 45", status: "PICKED_UP", deliveryTime: "14:30", distance: "3.2 км" },
    { id: "d2", orderId: "ORD-2026-0043", customer: "Иван П.", address: "пр. Мира, 23, кв 12", status: "ON_THE_WAY", deliveryTime: "15:00", distance: "1.8 км" },
    { id: "d3", orderId: "ORD-2026-0044", customer: "Елена В.", address: "ул. Арбат, 8, кв 56", status: "PICKED_UP", deliveryTime: "15:45", distance: "5.4 км" },
  ],
  history: [
    { id: "h1", orderId: "ORD-2026-0039", customer: "Анна К.", completedAt: "2026-08-17T13:15:00", earnings: 800, rating: 5 },
    { id: "h2", orderId: "ORD-2026-0038", customer: "Пётр И.", completedAt: "2026-08-17T12:45:00", earnings: 750, rating: 5 },
    { id: "h3", orderId: "ORD-2026-0037", customer: "Светлана М.", completedAt: "2026-08-17T12:00:00", earnings: 950, rating: 4 },
    { id: "h4", orderId: "ORD-2026-0036", customer: "Олег Д.", completedAt: "2026-08-17T11:15:00", earnings: 850, rating: 5 },
    { id: "h5", orderId: "ORD-2026-0035", customer: "Галина С.", completedAt: "2026-08-17T10:30:00", earnings: 850, rating: 5 },
  ],
  stub: true,
};

/**
 * GET /api/courier/dashboard — получить сводную статистику курьера.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);

    // ZV31-007: fail-closed — dev-фолбэк на stub без авторизации удалён
    // (раньше GET без токена в dev возвращал 200 STUB_DATA).
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — только COURIER
    const guard = await requireRole(user.id, "COURIER");
    if (guard) {
      // ZV31-007: 403 в любом окружении — dev-фолбэк на stub возвращал
      // 200 покупателю (обход серверной авторизации).
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    try {
      const courierId = user.id;

      // P1 (courier-schema): назначение — deliveries.courier_id (orders.courier_id
      // в реальной схеме нет). Сначала id назначенных заказов, затем статусы.
      const myOrderIds = await getCourierOrderIds(courierId);

      // Реальные данные: активные доставки (status IN_DELIVERY) + завершённые за сегодня
      const today = new Date(new Date().setHours(0, 0, 0, 0));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const UUID0 = "00000000-0000-0000-0000-000000000000";
      const ordersIn = (
        select: string,
        opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }
      ) =>
        supabaseAdmin
          .from("orders")
          .select(select, opts)
          .in("id", myOrderIds.length > 0 ? myOrderIds : [UUID0]);

      // A-3: KPI заработка и история — из deliveries (courier_earnings,
      // снимок выплаты), а не из orders.delivery_cost (клиентская цена).
      // completedToday — по deliveries.delivered_at (та же семантика,
      // что у клиентского хука useCourierDashboard).
      const deliveredRowsIn = (fromIso: string, select: string) =>
        supabaseAdmin
          .from("deliveries")
          .select(select)
          .eq("courier_id", courierId)
          .eq("status", "delivered")
          .gte("delivered_at", fromIso);

      const [activeResult, todayDeliveriesResult, monthDeliveriesResult] =
        await Promise.all([
          // Активные доставки (заказы в пути)
          ordersIn("*", { count: "exact", head: true })
            .in("status", ["READY", "IN_DELIVERY"]),
          // Завершено сегодня (заработок + счётчик)
          deliveredRowsIn(
            today.toISOString(),
            "id, order_id, cost, courier_earnings, delivered_at"
          ),
          // Заработок за месяц
          deliveredRowsIn(
            monthStart.toISOString(),
            "id, cost, courier_earnings, delivered_at"
          ),
        ]);

      const todayDeliveries = ((todayDeliveriesResult.data || []) as unknown) as {
        id: string;
        order_id: string;
        cost: number | null;
        courier_earnings: number | null;
        delivered_at: string | null;
      }[];
      const monthDeliveries = ((monthDeliveriesResult.data || []) as unknown) as {
        cost: number | null;
        courier_earnings: number | null;
      }[];

      const earningsToday = todayDeliveries.reduce((sum, d) => sum + rowEarnings(d), 0);
      const earningsMonth = monthDeliveries.reduce((sum, d) => sum + rowEarnings(d), 0);

      // Получить рейтинг курьера из courier_profiles
      let rating = 5.0;
      try {
        const { data: profile } = await supabaseAdmin
          .from("courier_profiles")
          .select("rating")
          .eq("userId", courierId)
          .maybeSingle();
        if (profile?.rating) {
          rating = Number(profile.rating);
        }
      } catch {
        // Если таблицы courier_profiles нет — используем default 5.0
      }

      // Получить список активных доставок с детализацией
      const { data: activeOrders } = await ordersIn(
        "id, number, status, delivery_address, delivery_time, total, user_id, confectioner_id"
      )
        .in("status", ["READY", "IN_DELIVERY"])
        .order("updated_at", { ascending: false })
        .limit(10);

      // Получить имена клиентов для активных доставок
      const userIds = (activeOrders || []).map((o: any) => o.user_id).filter(Boolean);
      let customerMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: customers } = await supabaseAdmin
          .from("profiles")
          .select("id, name")
          .in("id", userIds);
        for (const c of customers || []) {
          customerMap.set(c.id, c.name || "—");
        }
      }

      // Получить последние завершённые (история) — A-3: из deliveries
      // (courier_earnings, снимок выплаты), номера заказов — батчем из orders.
      const UUID0b = "00000000-0000-0000-0000-000000000001";
      const { data: historyDeliveries, error: historyError } = await supabaseAdmin
        .from("deliveries")
        .select("id, order_id, delivered_at, cost, courier_earnings")
        .eq("courier_id", courierId)
        .eq("status", "delivered")
        .order("delivered_at", { ascending: false })
        .limit(10);
      if (historyError) {
        console.error("[courier/dashboard] history query error:", historyError.message);
        throw historyError;
      }

      const historyOrderIds = [...new Set((historyDeliveries || []).map((d: any) => d.order_id).filter(Boolean))];
      const orderInfo = new Map<string, { number: string | null; user_id: string | null }>();
      if (historyOrderIds.length > 0) {
        const { data: historyOrders } = await supabaseAdmin
          .from("orders")
          .select("id, number, user_id")
          .in("id", historyOrderIds.length > 0 ? historyOrderIds : [UUID0b]);
        for (const o of historyOrders || []) {
          orderInfo.set(o.id, { number: o.number ?? null, user_id: o.user_id ?? null });
        }
      }

      const historyUserIds = (historyDeliveries || [])
        .map((d: any) => orderInfo.get(d.order_id)?.user_id)
        .filter((id: string | null | undefined): id is string => !!id);
      if (historyUserIds.length > 0 && historyUserIds.some((id: string) => !customerMap.has(id))) {
        const { data: extraCustomers } = await supabaseAdmin
          .from("profiles")
          .select("id, name")
          .in("id", historyUserIds.filter((id: string) => !customerMap.has(id)));
        for (const c of extraCustomers || []) {
          customerMap.set(c.id, c.name || "—");
        }
      }

      return NextResponse.json({
        stats: {
          activeDeliveries: activeResult.count || 0,
          completedToday: todayDeliveries.length,
          earningsToday: Number(earningsToday.toFixed(2)),
          earningsMonth: Number(earningsMonth.toFixed(2)),
          rating,
        },
        activeDeliveries: (activeOrders || []).map((o: any) => ({
          id: o.id,
          orderId: o.number,
          customer: customerMap.get(o.user_id) || "—",
          address: o.delivery_address || "—",
          status: o.status,
          deliveryTime: o.delivery_time || "—",
          distance: "—", // пока не считаем; в v2.1 добавим через Yandex Maps API
        })),
        history: (historyDeliveries || []).map((d: any) => ({
          id: d.id,
          orderId: orderInfo.get(d.order_id)?.number || d.order_id,
          customer: customerMap.get(orderInfo.get(d.order_id)?.user_id || "") || "—",
          completedAt: d.delivered_at,
          // A-3: канонический источник — courier_earnings (legacy NULL → cost)
          earnings: rowEarnings(d),
          rating: 5, // в v2.1 добавим таблицу courier_ratings
        })),
        stub: false,
      });
    } catch (dbError: any) {
      console.warn("[courier/dashboard] DB unavailable, returning stub:", dbError?.message);
      return NextResponse.json(STUB_DATA);
    }
  } catch (error: any) {
    console.error("GET /api/courier/dashboard error:", error?.message);
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json(STUB_DATA);
    }
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
