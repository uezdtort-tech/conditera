/**
 * GET /api/cron/payment-reminders — отправить напоминания о неоплаченных заказах.
 *
 * Запускается каждые 30 минут.
 *
 * Находит заказы:
 *  - status = PENDING
 *  - payment_status = pending
 *  - created_at > 1 часа назад
 *  - created_at < 24 часов (после 24ч — автоотмена)
 *
 * Для каждого: отправляет сообщение бота в чат заказа.
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблицам:
 *  - orders (поиск неоплаченных)
 *  - через @/lib/chat-automation: sendPaymentReminder
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
import { sendPaymentReminder } from "@/lib/chat-automation";

export const runtime = "nodejs";

const MAX_ORDERS_PER_RUN = 100;

interface UnpaidOrder {
  id: string;
  number: string | null;
  total: number;
  customer_id: string;
  created_at: string;
}

/**
 * GET /api/cron/payment-reminders — найти и отправить напоминания.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 1-24 часа назад
    const hourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("id, number, total, customer_id, created_at")
      .eq("status", "PENDING")
      .eq("payment_status", "pending")
      .lt("created_at", hourAgoIso)
      .gt("created_at", dayAgoIso)
      .limit(MAX_ORDERS_PER_RUN);

    if (error) {
      console.error("[cron/payment-reminders] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    const unpaidOrders = (orders || []) as unknown as UnpaidOrder[];
    console.info(`[cron:payment-reminders] Found ${unpaidOrders.length} unpaid orders`);

    const results = {
      sent: 0,
      errors: 0,
      total: unpaidOrders.length,
    };

    for (const order of unpaidOrders) {
      try {
        await sendPaymentReminder(order.id);
        results.sent++;
        console.info(`[cron:payment-reminders] ✓ sent reminder for ${order.number}`);
      } catch (e: any) {
        console.error(`[cron:payment-reminders] failed for ${order.id}:`, e?.message);
        results.errors++;
      }
    }

    // Записать статус в cron-status (non-blocking)
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/cron/status`, {
        method: "POST",
        headers: {
          "X-Cron-Secret": process.env.CRON_SECRET || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow: "payment-reminders",
          status: "success",
          duration: 0,
          sent: results.sent,
        }),
      });
    } catch {
      // cron-status недоступен — не критично
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error("GET /api/cron/payment-reminders error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
