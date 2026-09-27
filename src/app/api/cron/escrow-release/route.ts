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
 *
 * P0 (pay0-7): баланс кондитера обновляется атомарно (CAS-цикл
 * «прочитал → обновил только если не изменился» с 3 ретраями) вместо
 * read-then-write (потерянные апдейты при параллельных релизах).
 * Порядок шагов: сначала начисление, потом маркировка заказа; если
 * конкурентный воркер релизнул заказ первым — своё начисление
 * компенсируем назад. Payout клампится в ≥0.
 *
 * P0 (db1-1, split-brain identity): orders.confectioner_id — auth-UUID
 * (FK → auth.users, миграция 0002), а у confectioners (миграция 0017)
 * он лежит в TEXT-колонке «userId», НЕ в PK «id» (там conf_*-cuid).
 * Прежний lookup .eq("id", order.confectioner_id) не находил кондитера
 * → баланс не рос, а payout падал с «недостаточно средств». Колонки
 * 0017 camelCase: «userId», «totalEarnings» (не user_id/total_earnings).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const ESCROW_HOLD_HOURS = 24;
const YOOKASSA_RATE = 0.025; // 2.5%
const DEFAULT_COMMISSION_RATE = 0.15; // 15%
const BATCH_SIZE = 100;

/** Строка confectioners (0017, camelCase). */
interface ConfectionerBalanceRow {
  id: string;
  userId: string;
  balance: number | null;
  totalEarnings: number | null;
}

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

        // Считаем выплату по снапшоту тарифа (суммы в рублях)
        const commissionRate = order.commission_rate_snapshot ?? DEFAULT_COMMISSION_RATE;
        const itemsTotal = Number(order.total) - Number(order.delivery_cost || 0);
        const commission = Math.round(itemsTotal * commissionRate);
        const yookassaFee = Math.round(Number(order.total) * YOOKASSA_RATE);
        // Clamp: payout не может быть отрицательным (fee+комиссия > total —
        // аномалия ценообразования; раньше уводил баланс в минус)
        const payout = Math.max(
          0,
          Number(order.total) - commission - yookassaFee
        );
        if (Number(order.total) - commission - yookassaFee < 0) {
          console.warn(`[cron:escrow] order ${order.id}: payout clamped to 0 (total ${order.total}, commission ${commission}, fee ${yookassaFee})`);
        }

        // P0: Шаг 1 — атомарное начисление баланса (CAS-цикл).
        // Прежний read-then-write терял апдейты при параллельных релизах
        // одному кондитеру (два cron-запуска → credited один, второй затёрт).
        let credited = false;
        let confUserId: string | null = null;
        // db1-1: ищем по «userId» (auth-UUID = orders.confectioner_id),
        // а не по PK «id»; колонки 0017 camelCase.
        for (let attempt = 0; attempt < 3 && !credited; attempt++) {
          const { data: conf, error: confErr } = await supabaseAdmin
            .from("confectioners")
            .select("id, userId, balance, totalEarnings")
            .eq("userId", order.confectioner_id)
            .maybeSingle() as { data: ConfectionerBalanceRow | null; error: { message: string } | null };

          if (confErr || !conf) {
            console.error(`[cron:escrow] confectioner not found (userId=${order.confectioner_id}) for order ${order.id}${confErr ? ": " + confErr.message : ""}`);
            break;
          }
          confUserId = conf.userId ?? null;

          const newBalance = (Number(conf.balance) || 0) + payout;
          const newTotalEarnings = (Number(conf.totalEarnings) || 0) + payout;

          // CAS: обновляем только если баланс не изменился с момента чтения
          // (обновляем по реальному PK conf.id из прочитанной строки)
          const { data: updRows, error: confUpdateErr } = await supabaseAdmin
            .from("confectioners")
            .update({
              balance: newBalance,
              totalEarnings: newTotalEarnings,
            })
            .eq("id", conf.id)
            .eq("balance", conf.balance ?? 0)
            .select("id");

          credited = !confUpdateErr && Array.isArray(updRows) && updRows.length > 0;
        }

        if (!credited) {
          console.error(`[cron:escrow] balance CAS failed after retries for order ${order.id}`);
          results.errors++;
          continue;
        }

        // P0: Шаг 2 — маркируем заказ как релизнутый.
        // Баланс начисляем ДО маркировки (обратный порядок терял деньги
        // при падении между шагами). Если конкурентный воркер релизнул
        // заказ раньше нас — компенсируем своё начисление назад.
        const { data: orderUpd, error: orderUpdateErr } = await supabaseAdmin
          .from("orders")
          .update({
            escrow_released_at: new Date().toISOString(),
            payment_status: "released",
          })
          .eq("id", order.id)
          .eq("payment_status", "escrow")
          .is("escrow_released_at", null)
          .select("id");

        if (orderUpdateErr) {
          console.error(`[cron:escrow] order update error for ${order.id}:`, orderUpdateErr.message);
          results.errors++;
          continue;
        }

        if (!orderUpd || orderUpd.length === 0) {
          // Уже релизнуто конкурентным запуском — откатываем свой инкремент
          console.warn(`[cron:escrow] order ${order.id} already released concurrently — compensating balance`);
          // db1-1: та же identity-логика, что и в основном CAS-цикле
          for (let attempt = 0; attempt < 3; attempt++) {
            const { data: conf } = await supabaseAdmin
              .from("confectioners")
              .select("id, balance, totalEarnings")
              .eq("userId", order.confectioner_id)
              .maybeSingle() as { data: ConfectionerBalanceRow | null };
            if (!conf) break;
            const { data: updRows, error: compErr } = await supabaseAdmin
              .from("confectioners")
              .update({
                balance: (Number(conf.balance) || 0) - payout,
                totalEarnings: Math.max(0, (Number(conf.totalEarnings) || 0) - payout),
              })
              .eq("id", conf.id)
              .eq("balance", conf.balance ?? 0)
              .select("id");
            if (!compErr && Array.isArray(updRows) && updRows.length > 0) break;
          }
          results.skipped++;
          continue;
        }

        results.released++;
        results.totalReleased += payout;

        // Уведомляем кондитера (non-blocking)
        try {
          if (confUserId) {
            const { sendNotification } = await import("@/lib/notifications");
            await sendNotification({
              userId: confUserId,
              template: "PAYOUT_PROCESSED",
              vars: {
                amount: payout,
                cardLast4: "баланс",
              },
            });
          }
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
