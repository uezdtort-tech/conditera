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
 *
 * P2 (pay3b): атомарный release_escrow_order (0037) — claim заказа и
 * начисление в ОДНОЙ транзакции. Окно «начислили, но не пометили»
 * (повторный cron давал ВТОРОЕ начисление того же заказа) и ручная
 * компенсация исчезают. Формула — единая computeOrderPayout (payout-math),
 * та же, что в payouts/request (P1-E: прежде формулы дублировались,
 * в заявке был без clamp — расхождение начисления и выплаты).
 * Fallback: если 0037 не применена (PGRST202) — прежний CAS-цикл с
 * компенсацией (сохранён ниже как releaseEscrowLegacy).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
import { computeOrderPayout } from "@/lib/payout-math";

export const runtime = "nodejs";

const ESCROW_HOLD_HOURS = 24;
const BATCH_SIZE = 100;

interface SupabaseError {
  message: string;
  code?: string;
}

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
 * Fallback (0037 не применена): прежний двухшаговый CAS-цикл с компенсацией.
 * Возвращает 1 — релизнуто; 0 — заказ уже релизнут конкурентным запуском.
 * Бросает при неустранимой ошибке (баланс не начислен/не возвращён).
 */
async function releaseEscrowLegacy(
  order: EscrowOrder,
  confId: string,
  payout: number
): Promise<number> {
  // Шаг 1 — атомарное начисление баланса (CAS-цикл, 3 ретрая)
  let credited = false;
  for (let attempt = 0; attempt < 3 && !credited; attempt++) {
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id, balance, totalEarnings")
      .eq("id", confId)
      .maybeSingle() as { data: ConfectionerBalanceRow | null; error: SupabaseError | null };

    if (confErr || !conf) {
      console.error(`[cron:escrow] confectioner ${confId} lookup failed for order ${order.id}${confErr ? ": " + confErr.message : ""}`);
      throw new Error("confectioner lookup failed");
    }

    const newBalance = (Number(conf.balance) || 0) + payout;
    const newTotalEarnings = (Number(conf.totalEarnings) || 0) + payout;

    const { data: updRows, error: confUpdateErr } = await supabaseAdmin
      .from("confectioners")
      .update({ balance: newBalance, totalEarnings: newTotalEarnings })
      .eq("id", conf.id)
      .eq("balance", conf.balance ?? 0)
      .select("id");

    credited = !confUpdateErr && Array.isArray(updRows) && updRows.length > 0;
  }

  if (!credited) {
    throw new Error("balance CAS failed after retries");
  }

  // Шаг 2 — CAS-клейм заказа; проигрыш → компенсация начисления
  const { data: orderUpd, error: orderUpdateErr } = await supabaseAdmin
    .from("orders")
    .update({ escrow_released_at: new Date().toISOString(), payment_status: "released" })
    .eq("id", order.id)
    .eq("payment_status", "escrow")
    .is("escrow_released_at", null)
    .select("id");

  if (orderUpdateErr) {
    throw new Error(`order update failed: ${orderUpdateErr.message}`);
  }

  if (!orderUpd || orderUpd.length === 0) {
    // Уже релизнуто конкурентным запуском — откатываем свой инкремент
    console.warn(`[cron:escrow] order ${order.id} already released concurrently — compensating balance (legacy)`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: conf } = await supabaseAdmin
        .from("confectioners")
        .select("id, balance, totalEarnings")
        .eq("id", confId)
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
    return 0;
  }

  return 1;
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

        // pay3b P1-E: единая формула (та же, что в payouts/request), clamp >= 0
        const breakdown = computeOrderPayout({
          total: Number(order.total),
          deliveryCost: Number(order.delivery_cost || 0),
          commissionRateSnapshot:
            order.commission_rate_snapshot === null ? null : Number(order.commission_rate_snapshot),
        });
        if (breakdown.clamped) {
          console.warn(`[cron:escrow] order ${order.id}: payout clamped to 0 (total ${order.total}, commission ${breakdown.commission}, fee ${breakdown.yookassaFee})`);
        }
        const payout = breakdown.payout;

        // Кондитер по «userId» (db1-1: orders.confectioner_id — auth-UUID)
        const { data: conf, error: confErr } = await supabaseAdmin
          .from("confectioners")
          .select("id, userId")
          .eq("userId", order.confectioner_id)
          .maybeSingle() as { data: { id: string; userId: string } | null; error: SupabaseError | null };

        if (confErr || !conf) {
          console.error(`[cron:escrow] confectioner not found (userId=${order.confectioner_id}) for order ${order.id}${confErr ? ": " + confErr.message : ""}`);
          results.errors++;
          continue;
        }
        const confUserId = conf.userId ?? null;

        // Быстрый путь (pay3b): атомарный RPC release_escrow_order (0037) —
        // claim заказа и начисление в одной транзакции. RAISE откатывает
        // ВСЁ (клейменный заказ не останется без начисления).
        let outcome: number;
        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc(
          "release_escrow_order",
          { p_order_id: order.id, p_conf_id: conf.id, p_payout: payout }
        ) as { data: number | null; error: SupabaseError | null };

        if (!rpcErr) {
          outcome = Number(rpcRes ?? 0);
        } else if ((rpcErr as SupabaseError & { code?: string }).code === "PGRST202") {
          // 0037 не применена — прежняя семантика (CAS-цикл + компенсация)
          console.warn("[cron/escrow] release_escrow_order RPC отсутствует — fallback на CAS-цикл (примените 0037)");
          outcome = await releaseEscrowLegacy(order, conf.id, payout);
        } else {
          console.error(`[cron:escrow] release_escrow_order failed for ${order.id}:`, rpcErr.message);
          results.errors++;
          continue;
        }

        if (outcome === 0) {
          // Уже релизнуто конкурентным запуском — начисление не трогали
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
        } catch (notifErr: unknown) {
          const msg = notifErr instanceof Error ? notifErr.message : String(notifErr);
          console.warn(`[cron:escrow] notification failed (non-fatal):`, msg);
        }

        console.info(`[cron:escrow] ✓ released ${order.number}: ${payout}₽ → confectioner ${order.confectioner_id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[cron:escrow] failed for ${order.id}:`, msg);
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
