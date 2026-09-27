// POST /api/payment/webhook — приём уведомлений от YooKassa
// Настроить в личном кабинете YooKassa: https://yookassa.ru/my/merchant/integration
// URL: https://conditera.ru/api/payment/webhook
//
// ВАЖНО: YooKassa может присылать webhook повторно (retry-on-failure).
// Поэтому все обработчики должны быть идемпотентны — повторная обработка
// того же платежа не должна начислять бонусы дважды или отправлять
// письма повторно. Идемпотентность достигается проверкой статуса платежа
// в БД перед обработкой.
//
// P0 (pay0-4):
//  1. Платёж матчится СТРОГО по provider id (yookassa_payment_id =
//     object.id; для refund.* — object.payment_id), а не «последний
//     платёж заказа» — раньше статус писался чужой попытке оплаты.
//  2. Сумма из webhook сверяется с payments.amount — при расхождении
//     (amount_mismatch) платёж НЕ зачисляется, пишется фрод-лог.
//  3. Статус "canceled" (YooKassa, одна l) маппится в "cancelled" (enum БД) —
//     раньше прямая запись "canceled" ломалась о enum и payment.canceled
//     ошибочно помечал заказ payment_status="refunded".
//  4. refund.succeeded обрабатывается: объект возврата не содержит
//     metadata.orderId и раньше отклонялся с 400 — возвраты никогда
//     не подтверждались.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyWebhook } from "@/lib/yookassa";

export const runtime = "nodejs";

export interface YooKassaPaymentObject {
  id: string;
  status: string;
  /** Сумма провайдера: { value: "2400.00", currency: "RUB" } */
  amount?: { value?: string; currency?: string };
  /** Для refund.* событий: объект — возврат, payment_id указывает на платёж */
  payment_id?: string;
  metadata?: { orderId?: string };
}

export interface YooKassaWebhookBody {
  event?: string;
  object?: YooKassaPaymentObject;
}

// Финальные статусы в терминах БД (enum payment_status: 'cancelled' — две l)
const FINAL_PAYMENT_STATUSES = new Set(["succeeded", "cancelled", "refunded"]);

/** YooKassa шлёт "canceled" (одна l), в БД enum — "cancelled" */
function yookassaStatusToDb(status: string): string {
  return status === "canceled" ? "cancelled" : status;
}

/** "2400.00" → копейки провайдера (240000); null если суммы нет/некорректна */
function wireAmountToKop(amount?: { value?: string }): number | null {
  if (!amount?.value) return null;
  const n = Number(amount.value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

interface PaymentRow {
  id: string;
  order_id: string;
  amount: number; // рубли
  status: string;
}

export async function POST(request: NextRequest) {
  try {
    // Верификация webhook
    if (!verifyWebhook(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as YooKassaWebhookBody | null;
    const event: string | undefined = body?.event;
    const object = body?.object;
    if (!event || !object?.id) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const wireKop = wireAmountToKop(object.amount);
    const dbStatus = yookassaStatusToDb(object.status ?? "");

    // === 1. Матчинг платежа по provider id (точный) ===
    // Для refund.* объект — возврат, платёж ищем по object.payment_id.
    const providerPaymentId = object.payment_id || object.id;
    const { data: byProvider } = await supabaseAdmin
      .from("payments")
      .select("id, order_id, amount, status")
      .eq("yookassa_payment_id", providerPaymentId)
      .maybeSingle();
    let payment = (byProvider as PaymentRow | null) ?? null;

    // === 2. Legacy fallback: metadata.orderId → последний платёж заказа ===
    // (для платежей, записанных до pay0-2 без yookassa_payment_id)
    const metaOrderId = object.metadata?.orderId;
    if (!payment && metaOrderId) {
      const { data: latest } = await supabaseAdmin
        .from("payments")
        .select("id, order_id, amount, status")
        .eq("order_id", metaOrderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      payment = (latest as PaymentRow | null) ?? null;
    }

    const orderId = payment?.order_id ?? metaOrderId;
    if (!orderId) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    // === IDEMPOTENCY CHECK ===
    // Платёж уже в финальном статусе — не обрабатываем повторно
    // (защита от двойных бонусов/писем при retry со стороны YooKassa).
    if (payment && FINAL_PAYMENT_STATUSES.has(payment.status)) {
      const alreadyDone =
        payment.status === dbStatus ||
        (event === "refund.succeeded" && payment.status === "refunded");
      if (alreadyDone) {
        console.info(
          `[webhook] Payment ${payment.id} (order ${orderId}) already final "${payment.status}", skipping.`
        );
        return NextResponse.json({ success: true, idempotent: true });
      }
    }

    // Загружаем заказ
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id,
        number,
        total,
        payment_method,
        payment_status,
        status,
        customer_id,
        customers:customer_id (email, name)
      `
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) {
      console.error("[webhook] Failed to fetch order:", orderErr.message);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (!order) {
      console.warn(`[webhook] Order ${orderId} not found in DB`);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Обрабатываем события YooKassa
    switch (event) {
      case "payment.succeeded":
      case "payment.waiting_for_capture": {
        // === СВЕРКА СУММЫ (P0) ===
        // payments.amount и orders.total — в рублях; провайдер присылает
        // строку в рублях. Не совпало → платёж НЕ зачисляем.
        const expectedKop = (payment ? Number(payment.amount) : Number(order.total)) * 100;
        if (wireKop !== null && wireKop !== expectedKop) {
          console.error(
            `[webhook] AMOUNT_MISMATCH order=${orderId} expected_kop=${expectedKop} got_kop=${wireKop} — платёж НЕ зачислен`
          );
          return NextResponse.json({ success: true, skipped: "amount_mismatch" });
        }

        // Если заказ уже в эскроу — не дублируем side-effects.
        if (order.payment_status === "escrow") {
          console.info(`[webhook] Order ${orderId} already in escrow, skipping side-effects.`);
          return NextResponse.json({ success: true, idempotent: true });
        }

        // Статус платежа — только после проверки суммы
        if (payment && payment.status !== dbStatus) {
          await supabaseAdmin
            .from("payments")
            .update({ status: dbStatus, updated_at: new Date().toISOString() })
            .eq("id", payment.id);
        }

        // Переводим заказ в эскроу
        await supabaseAdmin
          .from("orders")
          .update({ payment_status: "escrow" })
          .eq("id", orderId);

        // P1: Эскроу релизуется через cron /api/cron/escrow-release (каждые 30 минут)
        console.info(`[webhook] Order ${orderId} → escrow. Will be released by cron in 24h.`);

        const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
        const customerName = customer?.name || "Клиент";
        const customerEmail = customer?.email || null;

        // === Telegram уведомление об оплате ===
        try {
          const { notifyPaymentSucceeded } = await import("@/lib/telegram-bot");
          await notifyPaymentSucceeded({
            orderNumber: order.number,
            amount: order.total,
            customerName,
            paymentMethod: order.payment_method,
          });
        } catch (e) {
          console.warn("[webhook] Telegram payment notification failed:", e);
        }

        // === Яндекс Метрика: server-side трекинг оплаты ===
        try {
          const { trackEventServer } = await import("@/lib/yandex-metrika");
          await trackEventServer("payment_succeeded", {
            order_number: order.number,
            revenue: order.total,
          });
        } catch (e) {
          console.warn("[webhook] Yandex Metrika tracking failed:", e);
        }

        // === Email: уведомление клиенту об оплате ===
        if (customerEmail) {
          try {
            const { sendTemplateEmail } = await import("@/lib/email");
            await sendTemplateEmail("payment_succeeded", {
              to: customerEmail,
              toName: customerName,
              userId: order.customer_id,
              orderId,
              params: {
                orderNumber: order.number,
                customerName,
                amount: order.total,
                paymentMethod: order.payment_method,
              },
            });
          } catch (e) {
            console.warn("[webhook] Email notification failed:", e);
          }
        }

        // Авточат: уведомить об оплате
        try {
          const { notifyOrderStatusChange } = await import("@/lib/chat-automation");
          await notifyOrderStatusChange({
            orderId,
            fromStatus: "PENDING",
            toStatus: "CONFIRMED",
          });
        } catch (e) {
          console.warn("[webhook] Auto-chat status notification failed:", e);
        }

        // P1: Начисляем бонусы покупателю (только если ещё не начислены)
        try {
          const { data: existingBonus, error: bonusErr } = await supabaseAdmin
            .from("loyalty_transactions")
            .select("id")
            .eq("order_id", orderId)
            .eq("type", "EARN")
            .limit(1)
            .maybeSingle();

          if (bonusErr) {
            console.warn("[webhook] Bonus check failed:", bonusErr.message);
          }

          if (!existingBonus) {
            const { awardOrderPoints } = await import("@/lib/loyalty");
            const { sendNotification } = await import("@/lib/notifications");
            const result = await awardOrderPoints(order.customer_id, orderId, order.total);
            await sendNotification({
              userId: order.customer_id,
              template: "BONUS_EARNED",
              vars: {
                points: result.points,
                orderNumber: order.number,
                balance: result.points,
              },
            });
            console.info(`[webhook] Awarded ${result.points} points to ${order.customer_id}`);
          } else {
            console.info(`[webhook] Bonus for order ${orderId} already awarded, skipping.`);
          }
        } catch (e) {
          console.warn("[webhook] Bonus award failed (non-blocking):", e);
        }

        // P1: Уведомление об успешной оплате
        try {
          const { sendNotification } = await import("@/lib/notifications");
          await sendNotification({
            userId: order.customer_id,
            template: "PAYMENT_SUCCEEDED",
            vars: {
              amount: order.total,
              orderNumber: order.number,
            },
          });
        } catch (e) {
          console.warn("[webhook] Notification failed:", e);
        }
        break;
      }

      case "payment.canceled": {
        // Статус платежа: "canceled" → "cancelled" (enum БД)
        if (payment && payment.status !== "cancelled") {
          await supabaseAdmin
            .from("payments")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", payment.id);
        }
        // P0: отмена ≠ возврат — раньше писалось payment_status="refunded"
        if (order.payment_status !== "cancelled" && order.status !== "CANCELLED") {
          await supabaseAdmin
            .from("orders")
            .update({ payment_status: "cancelled", status: "CANCELLED" })
            .eq("id", orderId);
        }
        break;
      }

      case "refund.succeeded": {
        // Сумма возврата не может превышать сумму платежа
        if (payment && wireKop !== null && wireKop > Number(payment.amount) * 100) {
          console.error(
            `[webhook] REFUND_AMOUNT_MISMATCH payment=${payment.id} payment_kop=${Number(payment.amount) * 100} refund_kop=${wireKop}`
          );
          return NextResponse.json({ success: true, skipped: "refund_amount_mismatch" });
        }

        if (payment) {
          await supabaseAdmin
            .from("payments")
            .update({
              status: "refunded",
              refund_amount: wireKop !== null ? wireKop / 100 : Number(payment.amount),
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);
        }

        if (order.payment_status !== "refunded") {
          await supabaseAdmin
            .from("orders")
            .update({ payment_status: "refunded" })
            .eq("id", orderId);
        }

        // Наш refund-рекорд (если возврат создан через /api/payment/refund)
        try {
          await supabaseAdmin
            .from("refunds")
            .update({ status: "processed", processed_at: new Date().toISOString() })
            .eq("yookassa_refund_id", object.id);
        } catch (e) {
          console.warn("[webhook] refunds row update failed:", e);
        }
        break;
      }

      default:
        console.log(`Webhook event: ${event} for order ${orderId}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

// GET для проверки, что webhook endpoint работает
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "YooKassa webhook endpoint. Настройте URL в личном кабинете YooKassa.",
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/payment/webhook`,
  });
}
