/**
 * POST /api/cron/user-reenagement — ре-вовлечение неактивных пользователей
 *
 * Header: X-Cron-Secret — для авторизации cron-запросов
 * Запускается через n8n (workflow 14-user-reenagement.json)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const cronSecret = req.headers.get("X-Cron-Secret");
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Найти пользователей, не делавших заказы > 30 дней.
    // PostgREST не принимает вложенный query-builder в "not in" — два шага:
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentOrders, error: ordErr } = await supabaseAdmin
      .from("orders")
      .select("user_id")
      .gte("created_at", thirtyDaysAgo);
    if (ordErr) {
      console.warn("[cron/user-reenagement] orders query error:", ordErr.message);
      return NextResponse.json({ processed: 0, error: ordErr.message });
    }
    const recentIds = [
      ...new Set(
        ((recentOrders || []) as Array<{ user_id: string | null }>)
          .map((r) => r.user_id)
          .filter((v): v is string => Boolean(v))
      ),
    ];

    let profilesQuery = supabaseAdmin
      .from("profiles")
      .select("id, email, name, city")
      .eq("is_blocked", false)
      .limit(100);
    if (recentIds.length > 0) {
      profilesQuery = profilesQuery.not("id", "in", `(${recentIds.join(",")})`);
    }
    const { data: inactiveUsers, error } = await profilesQuery;

    if (error) {
      console.warn("[cron/user-reenagement] query error:", error.message);
      return NextResponse.json({ processed: 0, error: error.message });
    }

    let notified = 0;
    for (const user of inactiveUsers || []) {
      // Отправить re-engagement уведомление (таблица notifications: metadata, не data)
      const { error: insErr } = await supabaseAdmin.from("notifications").insert({
        user_id: (user as { id: string }).id,
        type: "reengagement",
        title: "Мы скучаем по вам!",
        body: "Давно не видели вас. Загляните — у нас новинки и скидки!",
        metadata: { campaign: "user_reengagement", city: (user as { city: string | null }).city },
        channel: "in_app",
        status: "sent",
        created_at: new Date().toISOString(),
      });
      if (insErr) {
        console.warn("[cron/user-reenagement] insert error:", insErr.message);
        continue;
      }
      notified++;
    }

    return NextResponse.json({
      processed: notified,
      message: `Sent re-engagement to ${notified} inactive users`,
    });
  } catch (error) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * GET — обёртка над POST для Vercel Cron / локального планировщика,
 * которые шлют GET (то же тело, тот же X-Cron-Secret).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
