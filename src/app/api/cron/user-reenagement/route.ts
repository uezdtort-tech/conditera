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

    // Найти пользователей, не делавших заказы > 30 дней
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: inactiveUsers, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, city")
      .not("id", "in", `(${supabaseAdmin.from("orders").select("customer_id").gte("created_at", thirtyDaysAgo)})`)
      .limit(100);

    if (error) {
      console.warn("[cron/user-reenagement] query error:", error.message);
      return NextResponse.json({ processed: 0, error: error.message });
    }

    let notified = 0;
    for (const user of inactiveUsers || []) {
      // Отправить re-engagement уведомление
      await supabaseAdmin.from("notifications").insert({
        user_id: (user as { id: string }).id,
        type: "reengagement",
        title: "Мы скучаем по вам!",
        body: "Давно не видели вас. Загляните — у нас новинки и скидки!",
        data: { campaign: "user_reengagement", city: (user as { city: string | null }).city },
        channel: "in_app",
        status: "sent",
        created_at: new Date().toISOString(),
      });
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
