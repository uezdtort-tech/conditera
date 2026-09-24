/**
 * GET /api/cron/weekly-digest — compile digest data and return list of users to notify
 *
 * Called by n8n every Monday at 10:00. Returns:
 *   - users: array of { userId, newProducts, activePromos, newConfectioners, newUsers }
 *   - stats: aggregated stats for the past week
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблицам:
 *  - products (count новых за неделю)
 *  - promotions (count активных)
 *  - confectioners (count новых)
 *  - profiles (count новых пользователей)
 *  - notification_preferences (фильтр по digest=true)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const MAX_USERS_PER_RUN = 5000;

interface DigestUser {
  userId: string;
  userName: string | null;
  userEmail: string;
  userCity: string | null;
  newProducts: number;
  activePromos: number;
  newConfectioners: number;
  newUsers: number;
}

/**
 * GET /api/cron/weekly-digest — собрать данные для еженедельной рассылки.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoIso = weekAgo.toISOString();
    const nowIso = new Date().toISOString();

    // Параллельно получить все агрегаты
    const [
      productsCountResult,
      promosCountResult,
      confectionersCountResult,
      usersCountResult,
    ] = await Promise.all([
      // 1. Новые товары за неделю
      supabaseAdmin
        .from("products")
        .select("*", { count: "exact", head: true })
        .gte("created_at", weekAgoIso),

      // 2. Активные промо-акции
      supabaseAdmin
        .from("promotions")
        .select("*", { count: "exact", head: true })
        .eq("status", "active")
        .gte("end_date", nowIso),

      // 3. Новые кондитеры за неделю
      supabaseAdmin
        .from("confectioners")
        .select("*", { count: "exact", head: true })
        .gte("created_at", weekAgoIso),

      // 4. Новые пользователи за неделю
      supabaseAdmin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .gte("created_at", weekAgoIso),
    ]);

    const newProducts = productsCountResult.count || 0;
    const activePromos = promosCountResult.count || 0;
    const newConfectioners = confectionersCountResult.count || 0;
    const newUsers = usersCountResult.count || 0;

    // Найти пользователей, подписанных на weekly digest (через notification_preferences)
    const { data: prefsData, error: prefsErr } = await supabaseAdmin
      .from("notification_preferences")
      .select("user_id")
      .eq("weekly_digest", true)
      .eq("email_enabled", true)
      .limit(MAX_USERS_PER_RUN);

    if (prefsErr) {
      console.error("[cron/weekly-digest] prefs query error:", prefsErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: prefsErr.message },
        { status: 500 }
      );
    }

    if (!prefsData || prefsData.length === 0) {
      return NextResponse.json({
        users: [],
        total: 0,
        stats: {
          newProducts,
          activePromos,
          newConfectioners,
          newUsers,
          weekStart: weekAgoIso,
          weekEnd: nowIso,
        },
      });
    }

    // Получить профили этих пользователей
    const userIds = prefsData.map((p) => p.user_id);
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, city, is_blocked")
      .in("id", userIds);

    if (profilesErr || !profiles) {
      console.error("[cron/weekly-digest] profiles query error:", profilesErr?.message);
      return NextResponse.json(
        { error: "Profiles query failed", details: profilesErr?.message },
        { status: 500 }
      );
    }

    const users: DigestUser[] = (profiles || [])
      .filter((p) => !p.is_blocked)
      .map((p) => ({
        userId: p.id,
        userName: p.name,
        userEmail: p.email,
        userCity: p.city,
        newProducts,
        activePromos,
        newConfectioners,
        newUsers,
      }));

    return NextResponse.json({
      users,
      total: users.length,
      stats: {
        newProducts,
        activePromos,
        newConfectioners,
        newUsers,
        weekStart: weekAgoIso,
        weekEnd: nowIso,
      },
    });
  } catch (error: any) {
    console.error("GET /api/cron/weekly-digest error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
