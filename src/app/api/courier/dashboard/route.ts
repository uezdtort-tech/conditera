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
      const today = new Date(new Date().setHours(0, 0, 0, 0));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const activeStatuses = ["assigned", "picked_up", "on_the_way"];

      const [
        activeCountResult,
        completedTodayResult,
        earningsTodayResult,
        earningsMonthResult,
        activeDeliveriesResult,
        historyDeliveriesResult,
      ] = await Promise.all([
        supabaseAdmin
          .from("deliveries")
          .select("id", { count: "exact", head: true })
          .eq("courier_id", courierId)
          .in("status", activeStatuses),
        supabaseAdmin
          .from("deliveries")
          .select("id", { count: "exact", head: true })
          .eq("courier_id", courierId)
          .eq("status", "delivered")
          .gte("delivered_at", today.toISOString()),
        supabaseAdmin
          .from("deliveries")
          .select("order_id, courier_earnings, delivered_at")
          .eq("courier_id", courierId)
          .eq("status", "delivered")
          .gte("delivered_at", today.toISOString()),
        supabaseAdmin
          .from("deliveries")
          .select("order_id, courier_earnings, delivered_at")
          .eq("courier_id", courierId)
          .eq("status", "delivered")
          .gte("delivered_at", monthStart.toISOString()),
        supabaseAdmin
          .from("deliveries")
          .select("id, order_id, status, address, estimated_time, cost, courier_earnings, updated_at")
          .eq("courier_id", courierId)
          .in("status", activeStatuses)
          .order("updated_at", { ascending: false })
          .limit(10),
        supabaseAdmin
          .from("deliveries")
          .select("id, order_id, status, address, delivered_at, courier_earnings, updated_at")
          .eq("courier_id", courierId)
          .eq("status", "delivered")
          .order("delivered_at", { ascending: false })
          .limit(10),
      ]);

      for (const result of [
        activeCountResult,
        completedTodayResult,
        earningsTodayResult,
        earningsMonthResult,
        activeDeliveriesResult,
        historyDeliveriesResult,
      ]) {
        if (result.error) throw new Error(result.error.message);
      }

      const earningsToday = (earningsTodayResult.data || []).reduce(
        (sum: number, delivery: any) => sum + Number(delivery.courier_earnings || 0) / 100,
        0
      );
      const earningsMonth = (earningsMonthResult.data || []).reduce(
        (sum: number, delivery: any) => sum + Number(delivery.courier_earnings || 0) / 100,
        0
      );

      const allDeliveries = [
        ...(activeDeliveriesResult.data || []),
        ...(historyDeliveriesResult.data || []),
      ];
      const orderIds = [...new Set(allDeliveries.map((delivery: any) => delivery.order_id))];
      const { data: orders, error: ordersError } = orderIds.length
        ? await supabaseAdmin
            .from("orders")
            .select("id, number, total, delivery_time, user_id")
            .in("id", orderIds)
        : { data: [], error: null };
      if (ordersError) throw new Error(ordersError.message);

      const orderMap = new Map<string, any>();
      for (const order of orders || []) orderMap.set(order.id, order);

      const userIds = [...new Set((orders || []).map((order: any) => order.user_id).filter(Boolean))];
      const { data: customers, error: customersError } = userIds.length
        ? await supabaseAdmin.from("profiles").select("id, name").in("id", userIds)
        : { data: [], error: null };
      if (customersError) throw new Error(customersError.message);

      const customerMap = new Map<string, string>();
      for (const customer of customers || []) customerMap.set(customer.id, customer.name || "—");

      let rating = 0;
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("courier_profiles")
        .select("rating")
        .eq("userId", courierId)
        .maybeSingle();
      if (!profileError && profile?.rating) rating = Number(profile.rating);

      return NextResponse.json({
        stats: {
          activeDeliveries: activeCountResult.count || 0,
          completedToday: completedTodayResult.count || 0,
          earningsToday: Number(earningsToday.toFixed(2)),
          earningsMonth: Number(earningsMonth.toFixed(2)),
          rating,
        },
        activeDeliveries: (activeDeliveriesResult.data || []).map((delivery: any) => {
          const order = orderMap.get(delivery.order_id);
          return {
            id: delivery.id,
            orderId: order?.number || delivery.order_id,
            customer: customerMap.get(order?.user_id) || "—",
            address: delivery.address || "—",
            status: delivery.status,
            deliveryTime: delivery.estimated_time || order?.delivery_time || "—",
            distance: "—",
            cost: Number(delivery.cost || 0),
          };
        }),
        history: (historyDeliveriesResult.data || []).map((delivery: any) => {
          const order = orderMap.get(delivery.order_id);
          return {
            id: delivery.id,
            orderId: order?.number || delivery.order_id,
            customer: customerMap.get(order?.user_id) || "—",
            address: delivery.address || "—",
            completedAt: delivery.delivered_at || delivery.updated_at,
            earnings: Number(delivery.courier_earnings || 0) / 100,
            rating: 0,
          };
        }),
        stub: false,
      });
    } catch (dbError: any) {
      console.error("[courier/dashboard] DB unavailable:", dbError?.message);
      return NextResponse.json(
        { error: "Данные курьера временно недоступны. Повторите попытку." },
        { status: 503 }
      );
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
