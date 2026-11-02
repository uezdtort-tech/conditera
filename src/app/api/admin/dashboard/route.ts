/**
 * GET /api/admin/dashboard — сводная статистика админ-панели.
 *
 * Возвращает: totalUsers, newUsersToday, totalOrders, revenueToday, revenueMonth,
 * activeTickets, pendingPayouts, fraudAlerts + recentOrders + рост платформы.
 *
 * Auth: ADMIN или SUPER_ADMIN.
 *
 * FIX (P2 dev-stub): раньше в dev роут возвращал фиктивные KPI (STUB_DATA)
 * анониму и не-администратору — фальшивые 1248 юзеров / 1.84M выручки
 * рендерились в кабинете с бейджем LIVE как настоящие. Теперь:
 *   • 401/403 — в ЛЮБОМ окружении (проверки доступа не обходятся);
 *   • недоступность БД → 503 (UI показывает ErrorState с повтором),
 *     фиктивные данные не маскируются под живые.
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

    // FIX (P2 dev-stub): 401 в любом окружении — фиктивные KPI больше не
    // отдаются анониму.
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — ADMIN или SUPER_ADMIN (403 в любом окружении)
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    try {
      const today = new Date(new Date().setHours(0, 0, 0, 0));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);

      // === ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ ===
      // Раньше было 5 последовательных запросов (activeTickets, pendingPayouts,
      // fraudAlerts, recentOrders + 2 revenue reduce-запроса) = 7 round-trips.
      // Теперь: 1 Promise.all с 10 запросами в параллель = 1 round-trip (по latency).
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
        growthUsersResult,
        growthOrdersResult,
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
          .select("id, number, total, status, created_at, user_id, profiles(email)")
          .order("created_at", { ascending: false })
          .limit(5),
        supabaseAdmin.rpc("revenue_today"),
        supabaseAdmin.rpc("revenue_month"),
        // Рост платформы за 6 месяцев: created_at профилей и заказов,
        // агрегация в JS — объёмы малы, лишний RPC не требуется.
        supabaseAdmin
          .from("profiles")
          .select("created_at")
          .gte("created_at", sixMonthsAgo.toISOString()),
        supabaseAdmin
          .from("orders")
          .select("created_at")
          .gte("created_at", sixMonthsAgo.toISOString()),
      ]);

      const revenueToday = typeof revenueTodayResult.data === "number"
        ? Number(revenueTodayResult.data)
        : 0;
      const revenueMonth = typeof revenueMonthResult.data === "number"
        ? Number(revenueMonthResult.data)
        : 0;

      const recentOrders = (recentOrdersResult.data || []) as RecentOrder[];

      // Рост платформы по месяцам (последние 6 месяцев)
      const monthNames = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
      const monthlyUsers = ((growthUsersResult.data || []) as Array<{ created_at: string }>);
      const monthlyOrders = ((growthOrdersResult.data || []) as Array<{ created_at: string }>);
      const platformGrowth: Array<{ month: string; users: number; orders: number }> = [];
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const nextDate = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
        platformGrowth.push({
          month: monthNames[date.getMonth()],
          users: monthlyUsers.filter((u) => {
            const d = new Date(u.created_at);
            return d >= date && d < nextDate;
          }).length,
          orders: monthlyOrders.filter((o) => {
            const d = new Date(o.created_at);
            return d >= date && d < nextDate;
          }).length,
        });
      }

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
          // Оба варианта ключей: совместимость со старым UI (customer/date)
          // и контрактом фронта (customer_email/created_at)
          customer: (o as unknown as { profiles?: { email?: string } }).profiles?.email || o.user_id?.slice(0, 8) || "—",
          customer_email: (o as unknown as { profiles?: { email?: string } }).profiles?.email || "—",
          total: Number(o.total),
          status: o.status,
          date: o.created_at,
          created_at: o.created_at,
        })),
        revenue: [], // можно заполнить через RPC по месяцам
        platformGrowth,
        stub: false,
      });
    } catch (dbError) {
      const errMsg = dbError instanceof Error ? dbError.message : String(dbError);
      console.warn("[admin/dashboard] DB unavailable:", errMsg);
      // FIX (P2 dev-stub): недоступность БД больше не маскируется демо-данными —
      // админ видит честную ошибку (UI: ErrorState + «Повторить»).
      return NextResponse.json(
        { error: "Статистика временно недоступна", details: errMsg },
        { status: 503 }
      );
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("GET /api/admin/dashboard error:", errMsg);
    return NextResponse.json(
      { error: "Внутренняя ошибка" },
      { status: 500 }
    );
  }
}
