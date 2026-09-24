/**
 * GET /api/courier/dashboard — сводная статистика курьера.
 *
 * Stub mode: в dev (NODE_ENV=development) или если БД недоступна,
 * возвращает demo-данные со stub: true.
 *
 * Auth: COURIER role (или stub в dev).
 *
 * Соответствует таблицам:
 *  - orders (доставки курьера по courier_id)
 *  - courier_profiles (rating, deliveries_count)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

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

    // Stub mode в dev без авторизации
    if (!user) {
      if (process.env.NODE_ENV === "development") {
        return NextResponse.json(STUB_DATA);
      }
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — только COURIER
    const guard = await requireRole(user.id, "COURIER");
    if (guard) {
      if (process.env.NODE_ENV === "development") {
        return NextResponse.json(STUB_DATA);
      }
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    try {
      const courierId = user.id;

      // Реальные данные: активные доставки (status IN_DELIVERY) + завершённые за сегодня
      const today = new Date(new Date().setHours(0, 0, 0, 0));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const [activeResult, completedTodayResult, earningsTodayResult, earningsMonthResult] =
        await Promise.all([
          // Активные доставки
          supabaseAdmin
            .from("orders")
            .select("*", { count: "exact", head: true })
            .eq("courier_id", courierId)
            .in("status", ["READY", "IN_DELIVERY"]),
          // Завершено сегодня
          supabaseAdmin
            .from("orders")
            .select("*", { count: "exact", head: true })
            .eq("courier_id", courierId)
            .in("status", ["DELIVERED", "COMPLETED"])
            .gte("updated_at", today.toISOString()),
          // Заработок сегодня (сумма delivery_cost по завершённым)
          supabaseAdmin
            .from("orders")
            .select("delivery_cost")
            .eq("courier_id", courierId)
            .in("status", ["DELIVERED", "COMPLETED"])
            .gte("updated_at", today.toISOString()),
          // Заработок за месяц
          supabaseAdmin
            .from("orders")
            .select("delivery_cost")
            .eq("courier_id", courierId)
            .in("status", ["DELIVERED", "COMPLETED"])
            .gte("updated_at", monthStart.toISOString()),
        ]);

      const earningsToday = (earningsTodayResult.data || []).reduce(
        (sum: number, o: any) => sum + Number(o.delivery_cost || 0),
        0
      );
      const earningsMonth = (earningsMonthResult.data || []).reduce(
        (sum: number, o: any) => sum + Number(o.delivery_cost || 0),
        0
      );

      // Получить рейтинг курьера из courier_profiles
      let rating = 5.0;
      try {
        const { data: profile } = await supabaseAdmin
          .from("courier_profiles")
          .select("rating")
          .eq("user_id", courierId)
          .maybeSingle();
        if (profile?.rating) {
          rating = Number(profile.rating);
        }
      } catch {
        // Если таблицы courier_profiles нет — используем default 5.0
      }

      // Получить список активных доставок с детализацией
      const { data: activeOrders } = await supabaseAdmin
        .from("orders")
        .select(
          "id, number, status, delivery_address, delivery_time, total, user_id, confectioner_id"
        )
        .eq("courier_id", courierId)
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

      // Получить последние завершённые (история)
      const { data: historyOrders } = await supabaseAdmin
        .from("orders")
        .select(
          "id, number, delivery_cost, total, updated_at, user_id"
        )
        .eq("courier_id", courierId)
        .in("status", ["DELIVERED", "COMPLETED"])
        .order("updated_at", { ascending: false })
        .limit(10);

      const historyUserIds = (historyOrders || []).map((o: any) => o.user_id).filter(Boolean);
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
          completedToday: completedTodayResult.count || 0,
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
        history: (historyOrders || []).map((o: any) => ({
          id: o.id,
          orderId: o.number,
          customer: customerMap.get(o.user_id) || "—",
          completedAt: o.updated_at,
          earnings: Number(o.delivery_cost || 0),
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
