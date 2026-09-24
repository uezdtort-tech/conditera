/**
 * POST /api/cron/subscriptions
 * Обработка подписок на торты — создание заказов по расписанию.
 *
 * Запускается по cron (n8n или внешний scheduler) ежедневно в 09:00.
 *
 * Логика:
 *   1. Найти активные подписки с просроченной next_delivery_at (≤ сейчас)
 *   2. Для каждой подписки — создать заказ со статусом PENDING
 *   3. Рассчитать следующую дату доставки (+7/+14/+30 дней)
 *   4. Обновить подписку: lastDeliveryAt, nextDeliveryAt, deliveriesCount+1
 *   5. Отправить уведомление клиенту
 *   6. При ошибке — пометить подписку как "failed"
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблицам:
 *  - cake_subscriptions (или subscriptions — зависит от миграции)
 *  - orders (создание нового заказа)
 *  - notifications (ORDER_CREATED клиенту)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

interface CakeSubscription {
  id: string;
  customer_id: string;
  confectioner_id: string;
  product_id: string;
  schedule: "weekly" | "biweekly" | "monthly";
  price_per_delivery: number;
  servings?: number;
  status: "active" | "paused" | "cancelled" | "failed";
  next_delivery_at: string;
  last_delivery_at: string | null;
  deliveries_count: number;
  total_spent: number;
}

/**
 * Рассчитать следующую дату доставки на основе schedule.
 */
function computeNextDelivery(schedule: string, from: Date): Date {
  const next = new Date(from);
  switch (schedule) {
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "biweekly":
      next.setDate(next.getDate() + 14);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      next.setDate(next.getDate() + 30); // default ~ monthly
  }
  return next;
}

/**
 * POST /api/cron/subscriptions — обработка просроченных подписок.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const now = new Date();
    let processed = 0;
    let failed = 0;

    // Найти активные подписки с просроченной next_delivery_at
    // Используем supabase-js напрямую (вместо db.findMany Prisma-shim)
    const { data: subs, error: subsErr } = await supabaseAdmin
      .from("cake_subscriptions")
      .select("*")
      .eq("status", "active")
      .lte("next_delivery_at", now.toISOString())
      .limit(100);

    if (subsErr) {
      console.error("[cron/subscriptions] query error:", subsErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: subsErr.message },
        { status: 500 }
      );
    }

    const subscriptions = (subs || []) as unknown as CakeSubscription[];

    for (const sub of subscriptions) {
      try {
        // Создаём заказ из подписки
        const { data: order, error: orderErr } = await supabaseAdmin
          .from("orders")
          .insert({
            customer_id: sub.customer_id,
            confectioner_id: sub.confectioner_id,
            status: "PENDING",
            total: sub.price_per_delivery,
            metadata: {
              subscriptionId: sub.id,
              productId: sub.product_id,
              servings: sub.servings,
              isSubscription: true,
            },
            created_at: now.toISOString(),
          })
          .select("id")
          .single();

        if (orderErr || !order) {
          throw new Error(orderErr?.message || "Failed to create order");
        }

        // Рассчитываем следующую доставку
        const nextDelivery = computeNextDelivery(sub.schedule, now);

        // Обновляем подписку
        const { error: updateErr } = await supabaseAdmin
          .from("cake_subscriptions")
          .update({
            last_delivery_at: now.toISOString(),
            next_delivery_at: nextDelivery.toISOString(),
            deliveries_count: (sub.deliveries_count || 0) + 1,
            total_spent: (sub.total_spent || 0) + sub.price_per_delivery,
          })
          .eq("id", sub.id);

        if (updateErr) {
          console.warn(`[cron/subscriptions] sub ${sub.id} update error:`, updateErr.message);
        }

        // Отправляем уведомление (non-blocking)
        try {
          const { sendNotification } = await import("@/lib/notifications");
          await sendNotification({
            userId: sub.customer_id,
            template: "ORDER_CREATED",
            vars: {
              orderNumber: order.id.slice(-6),
              total: sub.price_per_delivery,
            },
            data: { type: "subscription_order", orderId: order.id },
          });
        } catch (notifErr: any) {
          console.warn(`[cron/subscriptions] notification failed (non-fatal):`, notifErr?.message);
        }

        processed++;
      } catch (e: any) {
        console.error(`[cron/subscriptions] failed for sub ${sub.id}:`, e?.message);
        // Помечаем подписку как failed
        await supabaseAdmin
          .from("cake_subscriptions")
          .update({ status: "failed" })
          .eq("id", sub.id);
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      failed,
      total: subscriptions.length,
    });
  } catch (error: any) {
    console.error("POST /api/cron/subscriptions unexpected:", error?.message);
    return NextResponse.json(
      { error: "Internal error", details: error?.message },
      { status: 500 }
    );
  }
}
