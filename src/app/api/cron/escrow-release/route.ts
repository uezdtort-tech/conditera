/**
 * GET /api/cron/escrow-release — релиз эскроу для заказов старше 24 часов
 *
 * Заменяет ненадёжный setTimeout в webhook.
 * Запускается через cron (n8n или внешний scheduler) каждые 30 минут.
 *
 * Для каждого заказа:
 * 1. payment_status = "escrow" AND escrow_released_at IS NULL
 * 2. Создан > 24 часов назад
 * 3. Статус не CANCELLED
 * → Релизует эскроу, инкрементирует balance кондитера
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблицам:
 *  - orders (для поиска escrow-заказов)
 *  - confectioners (для обновления баланса)
 *  - notifications (для уведомления кондитера)
 *
 * Важно: используется supabase-js напрямую (v2.0). Транзакция через
 * PostgreSQL RPC функцией release_escrow (опционально, если есть).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const ESCROW_HOLD_HOURS = 24;
const YOOKASSA_RATE = 0.025; // 2.5%
const DEFAULT_COMMISSION_RATE = 0.15; // 15%
const BATCH_SIZE = 100;

interface EscrowOrder {
  id: string;
  number: string | null;
  total: number;
  confectioner_id: string | null;
  tariff_snapshot: any;
  commission_rate_snapshot: number | null;
  delivery_cost: number;
}

interface EscrowReleaseResults {
  released: number;
  skipped: number;
  errors: number;
  totalReleased: number;
  total: number;
}

/**
 * GET /api/cron/escrow-release — найти и релизовать escrow-заказы старше 24 часов.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - ESCROW_HOLD_HOURS);

    // Найти заказы с эскроу старше 24 часов
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id, number, total, confectioner_id, tariff_snapshot,
        commission_rate_snapshot, delivery_cost
      `
      )
      .eq("payment_status", "escrow")
      .is("escrow_released_at", null)
      .neq("status", "CANCELLED")
      .lt("created_at", cutoff.toISOString())
      .limit(BATCH_SIZE);

    if (error) {
      console.error("[cron/escrow-release] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    const orderList = (orders || []) as unknown as EscrowOrder[];
    console.info(`[cron:escrow] Found ${orderList.length} orders to release`);

    const results: EscrowReleaseResults = {
      released: 0,
      skipped: 0,
      errors: 0,
      totalReleased: 0,
      total: orderList.length,
    };

    for (const order of orderList) {
      try {
        if (!order.confectioner_id) {
          results.skipped++;
          continue;
        }

        // Считаем выплату по снапшоту тарифа
        const commissionRate = order.commission_rate_snapshot ?? DEFAULT_COMMISSION_RATE;
        const itemsTotal = Number(order.total) - Number(order.delivery_cost || 0);
        const commission = Math.round(itemsTotal * commissionRate);
        const yookassaFee = Math.round(Number(order.total) * YOOKASSA_RATE);
        const payout = Number(order.total) - commission - yookassaFee;

        // Шаг 1: Обновить заказ — релиз эскроу
        const { error: orderUpdateErr } = await supabaseAdmin
          .from("orders")
          .update({
            escrow_released_at: new Date().toISOString(),
            payment_status: "released",
          })
          .eq("id", order.id)
          .is("escrow_released_at", null); // optimistic lock — пропустить если уже released

        if (orderUpdateErr) {
          console.error(`[cron:escrow] order update error for ${order.id}:`, orderUpdateErr.message);
          results.errors++;
          continue;
        }

        // Шаг 2: Инкрементировать баланс кондитера
        // Сначала читаем текущий баланс
        const { data: conf, error: confErr } = await supabaseAdmin
          .from("confectioners")
          .select("id, user_id, balance, total_earnings")
          .eq("id", order.confectioner_id)
          .maybeSingle();

        if (confErr || !conf) {
          console.error(`[cron:escrow] confectioner not found for order ${order.id}`);
          results.errors++;
          continue;
        }

        const newBalance = (Number(conf.balance) || 0) + payout;
        const newTotalEarnings = (Number(conf.total_earnings) || 0) + payout;

        const { error: confUpdateErr } = await supabaseAdmin
          .from("confectioners")
          .update({
            balance: newBalance,
            total_earnings: newTotalEarnings,
          })
          .eq("id", conf.id);

        if (confUpdateErr) {
          console.error(`[cron:escrow] confectioner balance update error:`, confUpdateErr.message);
          results.errors++;
          continue;
        }

        results.released++;
        results.totalReleased += payout;

        // Уведомляем кондитера (non-blocking)
        try {
          const { sendNotification } = await import("@/lib/notifications");
          await sendNotification({
            userId: conf.user_id,
            template: "PAYOUT_PROCESSED",
            vars: {
              amount: payout,
              cardLast4: "баланс",
            },
          });
        } catch (notifErr: any) {
          console.warn(`[cron:escrow] notification failed (non-fatal):`, notifErr?.message);
        }

        console.info(`[cron:escrow] ✓ released ${order.number}: ${payout}₽ → confectioner ${order.confectioner_id}`);
      } catch (e: any) {
        console.error(`[cron:escrow] failed for ${order.id}:`, e?.message);
        results.errors++;
      }
    }

    // Записываем статус в /api/cron/status (non-blocking)
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/cron/status`, {
        method: "POST",
        headers: {
          "X-Cron-Secret": process.env.CRON_SECRET || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow: "escrow-release",
          status: "success",
          duration: 0,
          sent: results.released,
        }),
      });
    } catch {
      // cron-status недоступен — не критично
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error("GET /api/cron/escrow-release error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
