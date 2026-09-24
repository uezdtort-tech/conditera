// POST /api/payment/webhook — приём уведомлений от YooKassa
// Настроить в личном кабинете YooKassa: https://yookassa.ru/my/merchant/integration
// URL: https://conditera.ru/api/payment/webhook
//
// ВАЖНО: YooKassa может присылать webhook повторно (retry-on-failure).
// Поэтому все обработчики должны быть идемпотентны — повторная обработка
// того же платежа не должна начислять бонусы дважды или отправлять
// письма повторно. Идемпотентность достигается проверкой статуса платежа
// в БД перед обработкой.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyWebhook } from "@/lib/yookassa";

export const runtime = "nodejs";

export interface YooKassaPaymentObject {
  id: string;
  status: string;
  metadata?: { orderId?: string };
}

export interface YooKassaWebhookBody {
  event?: string;
  object?: YooKassaPaymentObject;
}

const FINAL_PAYMENT_STATUSES = new Set(["succeeded", "canceled", "refunded"]);

export async function POST(request: NextRequest) {
  try {
    // Верификация webhook
    if (!verifyWebhook(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as YooKassaWebhookBody | null;
    if (!body?.object?.metadata?.orderId) {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 }
      );
    }

    const orderId: string = body.object.metadata.orderId;
    const status: string = body.object.status;
    const event: string | undefined = body.event;

    // === IDEMPOTENCY CHECK ===
    // Если платёж уже в финальном статусе (succeeded / canceled / refunded),
    // не обрабатываем webhook повторно. Это защищает от двойных начислений
    // бонусов и повторной отправки уведомлений при retry со стороны YooKassa.
    const { data: existingPayment, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("id, status")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (payErr) {
      console.error("[webhook] Failed to fetch existing payment:", payErr.message);
    }

    if (existingPayment) {
      if (FINAL_PAYMENT_STATUSES.has(existingPayment.status) && existingPayment.status === status) {
        console.info(`[webhook] Order ${orderId} already processed with status "${status}", skipping.`);
        return NextResponse.json({ success: true, idempotent: true });
      }

      // Обновляем payment record.
      await supabaseAdmin
        .from("payments")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", existingPayment.id);
    }

    // Загружаем заказ один раз (вместо N+1 запросов ниже).
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select(`
        id,
        number,
        total,
        payment_method,
        payment_status,
        status,
        customer_id,
        customers:customer_id (email, name)
      `)
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
        // Если заказ уже в эскроу — не дублируем side-effects.
        if (order.payment_status === "escrow") {
          console.info(`[webhook] Order ${orderId} already in escrow, skipping side-effects.`);
          return NextResponse.json({ success: true, idempotent: true });
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

      case "payment.canceled":
        if (order.payment_status !== "refunded" && order.status !== "CANCELLED") {
          await supabaseAdmin
            .from("orders")
            .update({ payment_status: "refunded", status: "CANCELLED" })
            .eq("id", orderId);
        }
        break;

      case "refund.succeeded":
        if (order.payment_status !== "refunded") {
          await supabaseAdmin
            .from("orders")
            .update({ payment_status: "refunded" })
            .eq("id", orderId);
        }
        break;

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
