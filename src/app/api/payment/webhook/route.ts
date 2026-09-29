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
import {
  verifyWebhook,
  getPaymentStatus,
  getRefund,
  isYookassaConfigured,
} from "@/lib/yookassa";

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
  refund_amount: number | null; // рубли — уже возвращённое (сумма частичных возвратов)
}

/** PAY-1: сверка события с данными провайдера — IP allowlist НЕ криптографическая
 *  подпись, тело webhook/metadata сами по себе не доказательство оплаты.
 *  payment.* → GET /payments/{provider_id}: статус и сумма должны соответствовать событию.
 *  refund.succeeded → GET /refunds/{object.id}: статус succeeded, payment_id и сумма совпадают.
 *  Ошибка API → fail-closed ({ok:false} → 500: YooKassa повторит доставку).
 *  Расхождение данных → событие НЕ применяется (skip:provider_mismatch). */
async function verifyEventWithProvider(
  event: string,
  object: YooKassaPaymentObject,
  wireKop: number | null
): Promise<{ ok: boolean; skip?: string }> {
  if (!isYookassaConfigured()) return { ok: true }; // dev/mock — сверки нет
  const providerPaymentId = object.payment_id || object.id;
  if (providerPaymentId.startsWith("mock_") || object.id.startsWith("mock_")) {
    // pay4: mock_* в production — подделка (defense-in-depth поверх IP-allowlist):
    // фальшивый refund.succeeded с metadata.orderId мог уйти в legacy-fallback
    // и уменьшить/обнулить реальный платёж. Dev/mock — пропускаем как прежде.
    if (process.env.NODE_ENV === "production") {
      console.error(`[webhook] mock_* id в production — fail-closed (object=${object.id})`);
      return { ok: false };
    }
    return { ok: true };
  }

  if (event === "refund.succeeded") {
    const res = await getRefund(object.id);
    if (!res.success || !res.refund) return { ok: false };
    if (res.refund.status !== "succeeded") return { ok: true, skip: "provider_mismatch" };
    if (object.payment_id && res.refund.payment_id && res.refund.payment_id !== object.payment_id) {
      return { ok: true, skip: "provider_mismatch" };
    }
    if (wireKop !== null) {
      const refundKop = res.refund.amount?.value
        ? Math.round(Number(res.refund.amount.value) * 100)
        : null;
      if (refundKop !== null && refundKop !== wireKop) return { ok: true, skip: "provider_mismatch" };
    }
    return { ok: true };
  }

  const expectedStatus =
    event === "payment.succeeded"
      ? "succeeded"
      : event === "payment.waiting_for_capture"
        ? "waiting_for_capture"
        : event === "payment.canceled"
          ? "canceled"
          : null;
  if (!expectedStatus) return { ok: true }; // прочие события не сверяем

  const res = await getPaymentStatus(providerPaymentId);
  if (!res.success || !res.payment) return { ok: false };
  if (res.payment.status !== expectedStatus) return { ok: true, skip: "provider_mismatch" };
  if (wireKop !== null) {
    const providerKop = res.payment.amount?.value
      ? Math.round(Number(res.payment.amount.value) * 100)
      : null;
    if (providerKop !== null && providerKop !== wireKop) return { ok: true, skip: "provider_mismatch" };
  }
  return { ok: true };
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
      .select("id, order_id, amount, status, refund_amount")
      .eq("yookassa_payment_id", providerPaymentId)
      .maybeSingle();
    let payment = (byProvider as PaymentRow | null) ?? null;

    // === 2. Legacy fallback: metadata.orderId → последний платёж заказа ===
    // (для платежей, записанных до pay0-2 без yookassa_payment_id)
    const metaOrderId = object.metadata?.orderId;
    if (!payment && metaOrderId) {
      const { data: latest } = await supabaseAdmin
        .from("payments")
        .select("id, order_id, amount, status, refund_amount")
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

    // === PAY-1: СВЕРКА СОБЫТИЯ С ПРОВАЙДЕРОМ ===
    const pv = await verifyEventWithProvider(event, object, wireKop);
    if (!pv.ok) {
      console.error(
        `[webhook] provider verification failed (event=${event}, object=${object.id}) — fail-closed 500`
      );
      return NextResponse.json({ error: "Provider verification failed" }, { status: 500 });
    }
    if (pv.skip) {
      console.warn(`[webhook] provider mismatch (event=${event}, object=${object.id}) — skipped`);
      return NextResponse.json({ success: true, skipped: pv.skip });
    }

    // === IDEMPOTENCY CHECK ===
    // Платёж уже в финальном статусе — не обрабатываем повторно
    // (защита от двойных бонусов/писем при retry со стороны YooKassa).
    // pay4: refund.succeeded НЕ гейтится этим чеком — gейт с dbStatus="succeeded"
    // проглатывал ВСЕ refund-события по оплаченному платежу (payment.status
    // "succeeded" === dbStatus). Дедуп возвратов — по refund id в RPC 0039.
    if (event !== "refund.succeeded" && payment && FINAL_PAYMENT_STATUSES.has(payment.status)) {
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

        // Статус платежа — только после проверки суммы
        if (payment && payment.status !== dbStatus) {
          await supabaseAdmin
            .from("payments")
            .update({ status: dbStatus, updated_at: new Date().toISOString() })
            .eq("id", payment.id);
        }

        // PAY-1 CAS: атомарный переход заказа в escrow. Два одинаковых
        // webhook'а не могут оба выиграть — побочные эффекты (бонусы,
        // уведомления, письма) выполняет только победитель CAS.
        const { data: escrowWinner, error: casErr } = await supabaseAdmin
          .from("orders")
          .update({ payment_status: "escrow" })
          .eq("id", orderId)
          .neq("payment_status", "escrow")
          .select("id");
        if (casErr) {
          console.error("[webhook] escrow CAS failed:", casErr.message);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
        if (!escrowWinner || escrowWinner.length === 0) {
          console.info(`[webhook] Order ${orderId} already in escrow (CAS), skipping side-effects.`);
          return NextResponse.json({ success: true, idempotent: true });
        }

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
          if (wireKop === null || wireKop <= 0) {
            // Не применяем возврат с неизвестной суммой — YooKassa повторит доставку
            console.error(`[webhook] refund без суммы — skip (payment=${payment.id}, refund=${object.id})`);
            return NextResponse.json({ success: true, skipped: "refund_amount_missing" });
          }

          // pay4: идемпотентное применение через RPC 0039 — дедуп по refund id
          // + атомарное суммирование refund_amount. Прежний read-add-write
          // задваивал сумму частичного возврата при повторной доставке.
          const { data: refundRes, error: refundRpcErr } = await supabaseAdmin
            .rpc("apply_yookassa_refund", {
              p_payment_id: payment.id,
              p_refund_id: object.id,
              p_amount_kopecks: wireKop,
            })
            .single() as {
              data: { already_processed: boolean; total_refunded_kopecks: number; fully_refunded: boolean } | null;
              error: (Error & { code?: string }) | null;
            };

          if (refundRpcErr && refundRpcErr.code === "PGRST202") {
            // 0039 не применена — НЕ применяем возврат частично/небезопасно:
            // fail-closed 500 → YooKassa повторит доставку после применения миграции
            console.error(
              "[webhook] apply_yookassa_refund RPC отсутствует — fail-closed 500 (примените миграцию 0039)"
            );
            return NextResponse.json({ error: "Refund processing unavailable" }, { status: 500 });
          }
          if (refundRpcErr || !refundRes) {
            console.error("[webhook] refund RPC failed:", refundRpcErr?.message);
            return NextResponse.json({ error: "Refund processing failed" }, { status: 500 });
          }

          if (refundRes.fully_refunded && order.payment_status !== "refunded") {
            const { error: ordUpdErr } = await supabaseAdmin
              .from("orders")
              .update({ payment_status: "refunded" })
              .eq("id", orderId);
            if (ordUpdErr) console.error("[webhook] refund order update failed:", ordUpdErr.message);
          }
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
