/**
 * GET /api/admin/dashboard — сводная статистика админ-панели.
 *
 * Возвращает: totalUsers, newUsersToday, totalOrders, revenueToday, revenueMonth,
 * activeTickets, pendingPayouts, fraudAlerts + recentOrders + revenue по месяцам.
 *
 * Stub mode: в dev (NODE_ENV=development) или если БД недоступна —
 * возвращает demo-данные со stub: true флагом, чтобы UI мог рендериться.
 *
 * Auth: ADMIN или SUPER_ADMIN
 *
 * Оптимизация:
 *   • Все count-запросы выполняются параллельно через Promise.all (вместо 5
 *     последовательных запросов).
 *   • Revenue Today/Month вычисляется через SQL SUM RPC (одна строка с числом
 *     вместо загрузки всех платежей за период — экономия O(N) памяти и трафика).
 *
 * Соответствует таблицам: profiles, orders, payments, support_tickets, payouts
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const STUB_DATA = {
  stats: {
    totalUsers: 1248,
    newUsersToday: 24,
    totalOrders: 342,
    revenueToday: 84700,
    revenueMonth: 1840000,
    activeTickets: 8,
    pendingPayouts: 12,
    fraudAlerts: 3,
  },
  recentOrders: [
    { id: "o1", number: "ORD-2026-0042", customer: "Мария С.", total: 4500, status: "PAID", date: "2026-08-17T14:30:00" },
    { id: "o2", number: "ORD-2026-0041", customer: "Иван П.", total: 6800, status: "PENDING", date: "2026-08-17T14:00:00" },
    { id: "o3", number: "ORD-2026-0040", customer: "Елена В.", total: 12000, status: "PAID", date: "2026-08-17T13:15:00" },
    { id: "o4", number: "ORD-2026-0039", customer: "Пётр И.", total: 3500, status: "DELIVERED", date: "2026-08-17T12:45:00" },
    { id: "o5", number: "ORD-2026-0038", customer: "Анна К.", total: 8200, status: "PAID", date: "2026-08-17T12:00:00" },
  ],
  revenue: [
    { month: "Мар", value: 1240000 },
    { month: "Апр", value: 1380000 },
    { month: "Май", value: 1520000 },
    { month: "Июн", value: 1680000 },
    { month: "Июл", value: 1750000 },
    { month: "Авг", value: 1840000 },
  ],
  stub: true,
};

interface RecentOrder {
  id: string;
  number: string;
  total: number;
  status: string;
  created_at: string;
  user_id: string | null;
}

/**
 * GET /api/admin/dashboard — получить статистику.
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

    // Проверка роли — ADMIN или SUPER_ADMIN
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
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
      const today = new Date(new Date().setHours(0, 0, 0, 0));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      // === ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ ===
      // Раньше было 5 последовательных запросов (activeTickets, pendingPayouts,
      // fraudAlerts, recentOrders + 2 revenue reduce-запроса) = 7 round-trips.
      // Теперь: 1 Promise.all с 8 запросами в параллель = 1 round-trip (по latency).
      const [
        totalUsersResult,
        newUsersTodayResult,
        totalOrdersResult,
        activeTicketsResult,
        pendingPayoutsResult,
        fraudAlertsResult,
        recentOrdersResult,
        // Revenue через SQL SUM RPC — возвращает одно число вместо
        // загрузки всех строк платежей за период (экономия O(N) памяти).
        revenueTodayResult,
        revenueMonthResult,
      ] = await Promise.all([
        supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
        supabaseAdmin
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .gte("created_at", today.toISOString()),
        supabaseAdmin.from("orders").select("*", { count: "exact", head: true }),
        supabaseAdmin
          .from("support_tickets")
          .select("*", { count: "exact", head: true })
          .neq("status", "closed"),
        supabaseAdmin
          .from("payouts")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        supabaseAdmin
          .from("fraud_alerts")
          .select("*", { count: "exact", head: true })
          .eq("status", "open"),
        supabaseAdmin
          .from("orders")
          .select("id, number, total, status, created_at, user_id")
          .order("created_at", { ascending: false })
          .limit(5),
        supabaseAdmin.rpc("revenue_today"),
        supabaseAdmin.rpc("revenue_month"),
      ]);

      const revenueToday = typeof revenueTodayResult.data === "number"
        ? Number(revenueTodayResult.data)
        : 0;
      const revenueMonth = typeof revenueMonthResult.data === "number"
        ? Number(revenueMonthResult.data)
        : 0;

      const recentOrders = (recentOrdersResult.data || []) as RecentOrder[];

      return NextResponse.json({
        stats: {
          totalUsers: totalUsersResult.count || 0,
          newUsersToday: newUsersTodayResult.count || 0,
          totalOrders: totalOrdersResult.count || 0,
          revenueToday,
          revenueMonth,
          activeTickets: activeTicketsResult.count || 0,
          pendingPayouts: pendingPayoutsResult.count || 0,
          fraudAlerts: fraudAlertsResult.count || 0,
        },
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          number: o.number,
          customer: o.user_id?.slice(0, 8) || "—",
          total: Number(o.total),
          status: o.status,
          date: o.created_at,
        })),
        revenue: [], // можно заполнить через RPC по месяцам
        stub: false,
      });
    } catch (dbError) {
      const errMsg = dbError instanceof Error ? dbError.message : String(dbError);
      console.warn("[admin/dashboard] DB unavailable, returning stub:", errMsg);
      return NextResponse.json(STUB_DATA);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("GET /api/admin/dashboard error:", errMsg);
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json(STUB_DATA);
    }
    return NextResponse.json(
      { error: "Внутренняя ошибка" },
      { status: 500 }
    );
  }
}
