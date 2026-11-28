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
import type { payment_status } from "@/lib/supabase/types";
import { handleRouteError } from "@/lib/http-helpers";
import { shouldSkipFinalPaymentWebhook } from "@/lib/payment-webhook-idempotency";
import {
  verifyWebhook,
  getPaymentStatus,
  isYookassaConfigured,
  isLocalE2EPaymentStubEnabled,
  getRefund,
  refundPayment,
} from "@/lib/yookassa";

// Только реальные значения enum 0001; тип запрещает добавлять legacy-алиасы вроде "paid".
export const ESCROW_ELIGIBLE_PAYMENT_STATUSES = [
  "pending",
  "waiting_for_capture",
  "succeeded",
] satisfies payment_status[];
export const CANCEL_RECONCILE_PAYMENT_STATUSES = [
  "pending",
  "waiting_for_capture",
  "succeeded",
  "cancelled",
] satisfies payment_status[];

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
  // RELEASE-02 §5: безусловный dev-guard «!configured → ok:true» (бывш. :83)
  // удалён — он перехватывал отсутствие кредов раньше fail-closed-блока ниже
  // и мёртвил PAY-1a skip-ветку. Обработка «шлюз не настроен» консолидирована
  // в единственной ветке после expectedStatus; mock_* идентификаторы
  // по-прежнему исключены из сверки отдельной проверкой ниже.
  const providerPaymentId = object.payment_id || object.id;
  if (providerPaymentId.startsWith("mock_") || object.id.startsWith("mock_")) {
    // pay4: mock_* в production — подделка (defense-in-depth поверх IP-allowlist):
    // фальшивый refund.succeeded с metadata.orderId мог уйти в legacy-fallback
    // и уменьшить/обнулить реальный платёж. Dev/mock — пропускаем как прежде.
    if (process.env.NODE_ENV === "production" && !isLocalE2EPaymentStubEnabled()) {
      console.error(`[webhook] mock_* id в production — fail-closed (object=${object.id})`);
      return { ok: false };
    }
    // A mock payment can be accepted only by the explicitly enabled loopback
    // E2E runtime; normal production traffic remains fail-closed.
    return { ok: true };
  }

  if (event === "refund.succeeded") {
    // A missing amount/currency is not a harmless mismatch: it removes the
    // evidence needed to prove the refund. Fail closed so the provider retries.
    if (!object.amount || object.amount.currency !== "RUB") return { ok: false };
    const res = await getRefund(object.id);
    if (!res.success || !res.refund) return { ok: false };
    if (!res.refund.amount || res.refund.amount.currency !== "RUB") return { ok: false };
    if (res.refund.status !== "succeeded") return { ok: true, skip: "provider_mismatch" };

    // Для возврата обязательна подтверждённая связь с исходным платежом.
    // Отсутствующие поля не считаются доказательством корректного возврата.
    if (!object.payment_id || !res.refund.payment_id) return { ok: false };
    if (res.refund.payment_id !== object.payment_id) {
      return { ok: true, skip: "provider_mismatch" };
    }
    const providerRefundKop = wireAmountToKop(res.refund.amount);
    if (wireKop === null || providerRefundKop === null || providerRefundKop <= 0) {
      return { ok: false };
    }
    if (providerRefundKop !== wireKop) return { ok: true, skip: "provider_mismatch" };
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

  // RELEASE-02 §5: в production отсутствие кредов шлюза — fail-closed:
  // вебхук валиден только с re-fetch-сверкой; без кредов сверка невозможна
  // → {ok:false} → 500 (YooKassa повторит доставку после настройки).
  if (!isYookassaConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.error("[webhook] YooKassa not configured in production — fail-closed 500");
      return { ok: false };
    }
    console.warn(
      `[webhook] YooKassa not configured — provider verification skipped (event=${event})`
    );
    return { ok: true, skip: "provider_not_configured" };
  }

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

    // Reject malformed payment metadata before any provider or database call.
    // This avoids unnecessary external calls and keeps invalid UUIDs out of SQL.
    const metaOrderId = object.metadata?.orderId;
    // A payment event cannot be correlated safely without an order id.
    // Validate this before provider/network or database access.
    if (event.startsWith("payment.") && !metaOrderId) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }
    if (metaOrderId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metaOrderId)) {
      console.warn(`[webhook] orderId is not a UUID: ${metaOrderId} — 404`);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
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

    // === 1. Матчинг платежа по provider id (точный) ===
    // Для refund.* объект — возврат, платёж ищем по object.payment_id.
    const providerPaymentId = object.payment_id || object.id;
    const { data: byProvider, error: byProviderError } = await supabaseAdmin
      .from("payments")
      .select("id, order_id, amount, status, refund_amount")
      .eq("yookassa_payment_id", providerPaymentId)
      .maybeSingle();
    if (byProviderError) {
      console.error("[webhook] exact provider payment lookup failed:", byProviderError.message);
      return NextResponse.json({ error: "DB error", code: "WEBHOOK_PAYMENT_LOOKUP" }, { status: 500 });
    }
    let payment = (byProvider as PaymentRow | null) ?? null;

    // Never attach an event to an arbitrary latest payment by metadata.orderId.
    // Only an exact provider ID match or the verified recovery path below is trusted.

    const orderId = payment?.order_id ?? metaOrderId;
    // Non-UUID orderId (мусор в metadata.orderId) не может существовать в БД:
    // .eq("id", …) по uuid-колонке бросил бы 22P02 и отдал бы 500. Валидный
    // контракт для «заказа не существует» — 404 (см. E2E payment-webhook).
    if (!orderId) {
      if (event === "refund.succeeded") {
        console.error(`[webhook] refund event without local payment row: provider=${providerPaymentId}, refund=${object.id}`);
        return NextResponse.json({ error: "Payment ledger row missing for refund" }, { status: 500 });
      }
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }
    // order_id в схеме — UUID. Некорректный metadata.orderId является
    // ошибкой входного webhook, а не внутренней ошибкой БД (500).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return NextResponse.json({ error: "Invalid orderId in webhook metadata" }, { status: 400 });
    }

    // === IDEMPOTENCY CHECK ===
    // payment.succeeded и refund.succeeded всегда проходят повторную проверку:
    // конкурентная отмена/компенсация не должна быть скрыта ранним ack.
    if (payment && shouldSkipFinalPaymentWebhook(event, payment.status, dbStatus)) {
      console.info(
        `[webhook] Payment ${payment.id} (order ${orderId}) already final "${payment.status}", skipping.`
      );
      return NextResponse.json({ success: true, idempotent: true });
    }

    // Загружаем заказ (без embed — таблицы customers не существует; email/name
    // покупателя дозагружаются ниже отдельным запросом в profiles)
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
        user_id,
        confectioner_id,
        type,
        metadata
      `
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) {
      console.error("[webhook] Failed to fetch order:", orderErr.message);
      return NextResponse.json({ error: "DB error", code: "WEBHOOK_ORDER_LOOKUP" }, { status: 500 });
    }

    if (!order) {
      console.warn(`[webhook] Order ${orderId} not found in DB`);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    } 
    // Восстанавливаем точную локальную payment-запись только после PAY-1
    // provider re-fetch, и только если сумма/валюта совпадают с текущим заказом.
    // Это закрывает редкий сбой, когда YooKassa создала платёж, а checkout не
    // смог записать ledger; неподтверждённые и неоднозначные попытки не связываем.
    if (
      event.startsWith("payment.") &&
      !payment &&
      ["payment.succeeded", "payment.waiting_for_capture", "payment.canceled"].includes(event)
    ) {
      if (
        wireKop === null ||
        wireKop !== Math.round(Number(order.total) * 100) ||
        object.amount?.currency !== "RUB"
      ) {
        console.error(`[webhook] cannot recover payment row: amount/currency mismatch order=${orderId}`);
        return NextResponse.json({ error: "Payment ledger recovery mismatch" }, { status: 500 });
      }
      const { error: recoverError } = await supabaseAdmin
        .from("payments")
        .upsert(
          {
            order_id: orderId,
            yookassa_payment_id: providerPaymentId,
            amount: Number(order.total),
            currency: "RUB",
            status: "pending",
            method: "yookassa",
            metadata: { recovered_from_webhook: true },
          },
          { onConflict: "yookassa_payment_id", ignoreDuplicates: true }
        );
      if (recoverError) {
        console.error("[webhook] payment ledger recovery failed:", recoverError.message);
        return NextResponse.json({ error: "DB error", code: "WEBHOOK_LEDGER_RECOVERY" }, { status: 500 });
      }
      const { data: recovered, error: recoveredLookupError } = await supabaseAdmin
        .from("payments")
        .select("id, order_id, amount, status, refund_amount")
        .eq("yookassa_payment_id", providerPaymentId)
        .maybeSingle();
      if (recoveredLookupError || !recovered) {
        console.error("[webhook] recovered payment row not visible:", recoveredLookupError?.message);
        return NextResponse.json({ error: "DB error", code: "WEBHOOK_LEDGER_RECOVERY_LOOKUP" }, { status: 500 });
      }
      payment = recovered as PaymentRow;
    }


    // Обрабатываем события YooKassa
    switch (event) {
      case "payment.waiting_for_capture": {
        if (!payment) {
          return NextResponse.json({ error: "Payment ledger row missing" }, { status: 500 });
        }
        if (payment.status !== "waiting_for_capture") {
          const { data: waitingUpdated, error: waitingUpdateError } = await supabaseAdmin
            .from("payments")
            .update({ status: "waiting_for_capture", updated_at: new Date().toISOString() })
            .eq("id", payment.id)
            .in("status", ["pending", "waiting_for_capture"])
            .select("id");
          if (waitingUpdateError) {
            console.error("[webhook] waiting_for_capture payment update failed:", waitingUpdateError.message);
            return NextResponse.json({ error: "DB error", code: "WEBHOOK_WAITING_PAYMENT_UPDATE" }, { status: 500 });
          }
          if (!waitingUpdated?.length) {
            return NextResponse.json({ success: true, skipped: "payment_terminal" });
          }
        }
        // Авторизация карты ещё не означает подтверждённое списание.
        // Заказ остаётся pending до payment.succeeded.
        return NextResponse.json({ success: true, waitingForCapture: true });
      }

      case "payment.succeeded": {
        if (!payment) {
          console.error(`[webhook] succeeded event without local payment row: provider=${providerPaymentId}, order=${orderId}`);
          return NextResponse.json({ error: "Payment ledger row missing" }, { status: 500 });
        }

        // Сумма provider должна совпасть с конкретной попыткой оплаты.
        const expectedKop = Math.round(Number(payment.amount) * 100);
        const orderKop = Math.round(Number(order.total) * 100);
        const terminalOrder =
          ["CANCELLED", "REFUNDED", "COMPLETED"].includes(order.status) ||
          ["cancelled", "refunded"].includes(payment.status) ||
          ["cancelled", "refunded", "released"].includes(order.payment_status);
        const amountMismatch =
          (wireKop !== null && wireKop !== expectedKop) ||
          (!terminalOrder && orderKop !== expectedKop);
        if (amountMismatch) {
          console.error(
            `[webhook] AMOUNT_MISMATCH order=${orderId} expected_kop=${expectedKop} order_kop=${orderKop} got_kop=${wireKop}`
          );
          return NextResponse.json({ error: "Payment amount mismatch" }, { status: 500 });
        }

        // Уже завершённый/возвращённый заказ не должен получать повторный возврат.
        if (order.status === "REFUNDED" || payment.status === "refunded" || order.payment_status === "refunded") {
          return NextResponse.json({ success: true, skipped: "already_refunded" });
        }
        if (order.status === "COMPLETED") {
          if (payment.status === "cancelled" || order.payment_status === "cancelled") {
            console.error("[webhook] completed order has a cancelled payment; manual reconciliation required");
            return NextResponse.json({ error: "Completed order payment state conflict" }, { status: 500 });
          }
          return NextResponse.json({ success: true, skipped: "order_completed" });
        }

        // Поздний succeeded после отмены требует возврата, а не escrow.
        if (order.status === "CANCELLED" || order.payment_status === "cancelled" || payment.status === "cancelled") {
          if (order.status !== "CANCELLED") {
            const { data: cancelledOrder, error: cancelOrderError } = await supabaseAdmin
              .from("orders")
              .update({ status: "CANCELLED", payment_status: "cancelled" })
              .eq("id", orderId)
              .eq("status", order.status)
              .eq("payment_status", order.payment_status)
              .in("payment_status", CANCEL_RECONCILE_PAYMENT_STATUSES)
              .select("id");
            if (cancelOrderError) {
              console.error("[webhook] cancelled payment order reconciliation failed:", cancelOrderError.message);
              return NextResponse.json({ error: "DB error", code: "WEBHOOK_CANCELLED_ORDER_RECONCILE" }, { status: 500 });
            }
            if (!cancelledOrder?.length) {
              return NextResponse.json({ error: "Order cancellation reconciliation required" }, { status: 500 });
            }
          }
          const refundAmount = Math.max(
            0,
            Number(payment.amount) - Number(payment.refund_amount ?? 0)
          );
          if (refundAmount > 0) {
            const lateRefund = await refundPayment(
              providerPaymentId,
              refundAmount,
              `Автоматический возврат по отменённому заказу ${order.number || orderId}`,
              `uezd_konditer:refund:late:${orderId}`
            );
            if (!lateRefund.success) {
              console.error("[webhook] late-cancel refund failed; YooKassa retry required:", lateRefund.error);
              return NextResponse.json({ error: "Late cancellation refund failed" }, { status: 500 });
            }
          }
          const { error: latePaymentUpdateError } = await supabaseAdmin
            .from("payments")
            .update({ status: "succeeded", updated_at: new Date().toISOString() })
            .eq("id", payment.id)
            .in("status", ["pending", "waiting_for_capture", "succeeded", "cancelled"]);
          if (latePaymentUpdateError) {
            console.error("[webhook] late-cancel payment update failed:", latePaymentUpdateError.message);
            return NextResponse.json({ error: "DB error", code: "WEBHOOK_LATE_CANCEL_PAYMENT_UPDATE" }, { status: 500 });
          }
          const confirmedPaymentId = payment.id;
          const confirmedPaymentAmount = Number(payment.amount);
          void import("@/lib/financial-ledger").then(({ recordFinancialEntrySafe }) =>
            recordFinancialEntrySafe({
              entryType: "payment_succeeded",
              amount: confirmedPaymentAmount,
              paymentId: confirmedPaymentId,
              orderId,
              idempotencyKey: `pay-succeeded:${confirmedPaymentId}`,
              metadata: { provider: "yookassa", provider_payment_id: providerPaymentId, late_cancel: true },
            })
          );
          return NextResponse.json({ success: true, refundInitiated: refundAmount > 0 });
        }

        if (order.status === "REFUNDED" || payment.status === "refunded") {
          return NextResponse.json({ success: true, skipped: "already_refunded" });
        }
        if (order.status === "COMPLETED") {
          return NextResponse.json({ success: true, skipped: "order_completed" });
        }

        // Статус платежа меняется CAS-ом: поздний canceled не перезапишет succeeded.
        if (payment.status !== "succeeded") {
          const { data: paymentUpdated, error: paymentUpdateError } = await supabaseAdmin
            .from("payments")
            .update({ status: "succeeded", updated_at: new Date().toISOString() })
            .eq("id", payment.id)
            .in("status", ["pending", "waiting_for_capture", "succeeded"])
            .select("id");
          if (paymentUpdateError) {
            console.error("[webhook] succeeded payment update failed:", paymentUpdateError.message);
            return NextResponse.json({ error: "DB error", code: "WEBHOOK_PAYMENT_UPDATE" }, { status: 500 });
          }
          if (!paymentUpdated?.length) {
            return NextResponse.json({ success: true, skipped: "payment_terminal" });
          }
        }

        // PAY-1 CAS: атомарный переход заказа в escrow. Два одинаковых
        // webhook'а не могут оба выиграть — побочные эффекты (бонусы,
        // уведомления, письма) выполняет только победитель CAS.
        const { data: escrowWinner, error: casErr } = await supabaseAdmin
          .from("orders")
          .update({ payment_status: "escrow" })
          .eq("id", orderId)
          .in("payment_status", ESCROW_ELIGIBLE_PAYMENT_STATUSES)
          .neq("status", "CANCELLED")
          .neq("status", "REFUNDED")
          .neq("status", "COMPLETED")
          .select("id");
        if (casErr) {
          console.error("[webhook] escrow CAS failed:", casErr.message);
          return NextResponse.json({ error: "DB error", code: "WEBHOOK_ESCROW_CAS" }, { status: 500 });
        }
        if (!escrowWinner || escrowWinner.length === 0) {
          const { data: latestOrder, error: latestOrderError } = await supabaseAdmin
            .from("orders")
            .select("id, number, status, payment_status")
            .eq("id", orderId)
            .maybeSingle();
          if (latestOrderError) {
            console.error("[webhook] order re-read after escrow CAS failed:", latestOrderError.message);
            return NextResponse.json({ error: "DB error", code: "WEBHOOK_ESCROW_REREAD" }, { status: 500 });
          }
          if (!latestOrder) {
            return NextResponse.json({ error: "Order not found after escrow CAS" }, { status: 500 });
          }
          if (latestOrder.status === "REFUNDED" || latestOrder.payment_status === "refunded") {
            return NextResponse.json({ success: true, skipped: "already_refunded" });
          }
          if (latestOrder.status === "COMPLETED") {
            return NextResponse.json({ success: true, skipped: "order_completed" });
          }
          if (latestOrder.status === "CANCELLED" || latestOrder.payment_status === "cancelled") {
            const refundAmount = Math.max(
              0,
              Number(payment.amount) - Number(payment.refund_amount ?? 0)
            );
            if (refundAmount > 0) {
              const lateRefund = await refundPayment(
                providerPaymentId,
                refundAmount,
                `Автоматический возврат по отменённому заказу ${latestOrder.number || orderId}`,
                `uezd_konditer:refund:late:${orderId}`
              );
              if (!lateRefund.success) {
                console.error("[webhook] concurrent-cancel refund failed; YooKassa retry required:", lateRefund.error);
                return NextResponse.json({ error: "Late cancellation refund failed" }, { status: 500 });
              }
            }
            void import("@/lib/financial-ledger").then(({ recordFinancialEntrySafe }) =>
              recordFinancialEntrySafe({
                entryType: "payment_succeeded",
                amount: Number(payment.amount),
                paymentId: payment.id,
                orderId,
                idempotencyKey: `pay-succeeded:${payment.id}`,
                metadata: { provider: "yookassa", provider_payment_id: providerPaymentId, late_cancel: true },
              })
            );
            return NextResponse.json({ success: true, refundInitiated: refundAmount > 0 });
          }
          if (latestOrder.status === "REFUNDED") {
            return NextResponse.json({ success: true, skipped: "already_refunded" });
          }
          if (latestOrder.status === "COMPLETED") {
            return NextResponse.json({ success: true, skipped: "order_completed" });
          }
          console.info(`[webhook] Order ${orderId} already transitioned (CAS), skipping side-effects.`);
          return NextResponse.json({ success: true, idempotent: true });
        }

        // P1: Эскроу релизуется через cron /api/cron/escrow-release (каждые 30 минут)
        console.info(`[webhook] Order ${orderId} → escrow. Will be released by cron in 24h.`);

        // RECIPE-03 (RA.10.3): выдача entitlement для заказов type='recipe' —
        // ТОЛЬКО у победителя CAS (идемпотентность двойной защиты: CAS +
        // UNIQUE(recipe_id,buyer_id)); цена/роялти — с серверного оффера,
        // НИКОГДА из metadata клиента. Частичный/отложенный pay не выдаёт право:
        // метод вызывается только при dbStatus='succeeded' (waiting_for_capture →
        // отдельная доставка выдаст при succeeded).
        if (dbStatus === "succeeded" && order.type === "recipe") {
          try {
            const offerId = order.metadata?.recipe_offer_id;
            const recipeId = order.metadata?.recipe_id;
            if (offerId && recipeId) {
              const { data: offer } = await supabaseAdmin
                .from("recipe_marketplace")
                .select("id, recipe_id, royalty_rate, base_price")
                .eq("id", offerId)
                .maybeSingle();
              if (offer && offer.recipe_id === recipeId) {
                // PAY-1b: платёжная строка может отсутствовать (dev-stub без
                // шлюза / legacy-платежи без yookassa_payment_id). Раньше
                // передавался paymentId="" → FK recipe_purchases.payment_id
                // падал «invalid input syntax for type uuid: ""» и покупатель
                // НИКОГДА не получал доступ. Создаём строку по каноническим
                // данным события (сумма — order.total, уже сверена выше),
                // идемпотентно по UNIQUE yookassa_payment_id (0002).
                let paymentIdForEntitlement = payment?.id ?? null;
                if (!payment) {
                  const { data: byProvider } = await supabaseAdmin
                    .from("payments")
                    .select("id")
                    .eq("yookassa_payment_id", object.id)
                    .maybeSingle();
                  if (byProvider) {
                    paymentIdForEntitlement = String((byProvider as { id: string }).id);
                  } else {
                    const { data: created, error: payCreateErr } = await supabaseAdmin
                      .from("payments")
                      .insert({
                        order_id: orderId,
                        yookassa_payment_id: object.id,
                        amount: Number(order.total),
                        currency: "RUB",
                        status: dbStatus,
                        method: "yookassa",
                        metadata: { order_id: orderId },
                      })
                      .select("id")
                      .single();
                    if (!payCreateErr && created) {
                      paymentIdForEntitlement = String((created as { id: string }).id);
                      console.info(`[webhook] fallback payments row created for order ${orderId}`);
                    } else {
                      console.error(
                        "[webhook] fallback payments insert failed:",
                        payCreateErr?.message
                      );
                    }
                  }
                }
                const { data: latestVersion } = await supabaseAdmin
                  .from("recipe_versions")
                  .select("id")
                  .eq("recipe_id", recipeId)
                  .order("version_no", { ascending: false })
                  .limit(1);
                const { grantEntitlement } = await import("@/lib/recipes/entitlement");
                const grant = await grantEntitlement({
                  recipeId,
                  buyerId: order.user_id || order.customer_id,
                  paymentId: paymentIdForEntitlement,
                  pricePaid: Number(offer.base_price),
                  royaltyRate: Number(offer.royalty_rate),
                  recipeVersionId: latestVersion?.[0]?.id ?? null,
                });
                console.info(
                  `[webhook] recipe entitlement ${grant.granted ? "granted" : "FAILED"} recipe=${recipeId} buyer=${order.user_id ?? order.customer_id}`
                );
              } else {
                console.error(`[webhook] recipe order ${orderId}: offer mismatch, entitlement NOT granted`);
              }
            }
          } catch (e) {
            // Не 500: заказ уже в escrow, повторная доставка webhook даст
            // idempotent-ветку CAS… но entitlement не будет выдан — поэтому
            // логируем как CRITICAL для монитора; резервирование — reconciliation.
            console.error("[webhook] recipe entitlement grant failed (CRITICAL):", e);
          }
        }

        // PAY-2: журнал — деньги ПРИШЛИ (+amount, только у победителя CAS —
        // идемпотентно по payment id: повторная доставка дедупится и CAS'ом выше,
        // и уникальным idempotency_key журнала)
        if (dbStatus === "succeeded") {
          void import("@/lib/financial-ledger").then(({ recordFinancialEntrySafe }) =>
            recordFinancialEntrySafe({
              entryType: "payment_succeeded",
              amount: Number(payment ? payment.amount : order.total),
              paymentId: payment?.id ?? null,
              orderId,
              idempotencyKey: `pay-succeeded:${payment?.id ?? orderId}`,
              metadata: {
                provider: "yookassa",
                provider_payment_id: providerPaymentId,
                mode: process.env.NODE_ENV,
              },
            })
          );
        }

        // n8n: order.paid (fail-safe, после CAS-победы — только у победителя)
        try {
          const { emitEvent } = await import("@/lib/n8n");
          void emitEvent("order.paid", {
            orderId,
            paymentId: payment?.id ?? null,
            amount: order.total,
          }).catch(() => {});
        } catch (e) {
          console.warn("[webhook] n8n emitEvent failed (non-blocking):", e);
        }

        // ops: event log (append-only, fail-safe)
        try {
          const { recordEvent } = await import("@/lib/ops/events");
          void recordEvent("order.paid", {
            entityType: "order",
            entityId: orderId,
            payload: { provider: "yookassa" },
          });
        } catch (e) {
          console.warn("[webhook] ops recordEvent failed (non-blocking):", e);
        }

        // Покупатель: profiles по user_id (fallback — customer_id). Таблицы
        // customers в схеме нет — embed заменён отдельным запросом.
        let customer: { name?: string | null; email?: string | null } | null = null;
        const customerProfileId = order.user_id || order.customer_id;
        if (customerProfileId) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("email, name")
            .eq("id", customerProfileId)
            .maybeSingle();
          customer = (profile as { name?: string | null; email?: string | null } | null) ?? null;
        }
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
              userId: customerProfileId,
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
            // user_id — владелец заказа (checkout не заполняет customer_id);
            // раньше передавался customer_id (null) → bonus award всегда падал.
            const bonusUserId = order.user_id || order.customer_id;
            if (!bonusUserId) throw new Error("Заказ без владельца — бонусы не начисляются");
            const result = await awardOrderPoints(bonusUserId, orderId, order.total);
            await sendNotification({
              userId: customerProfileId,
              template: "BONUS_EARNED",
              vars: {
                points: result.points,
                orderNumber: order.number,
                balance: result.points,
              },
              metadata: { orderId },
            });
            console.info(`[webhook] Awarded ${result.points} points to ${bonusUserId}`);
          } else {
            console.info(`[webhook] Bonus for order ${orderId} already awarded, skipping.`);
          }
        } catch (e) {
          console.warn("[webhook] Bonus award failed (non-blocking):", e);
        }

        // P1: Уведомление об успешной оплате (P1.1: dedupKey — retry
        // webhook'а не задвоит PAYMENT_SUCCEEDED — CAS выше + ключ в metadata)
        try {
          const { sendNotification } = await import("@/lib/notifications");
          await sendNotification({
            userId: customerProfileId,
            template: "PAYMENT_SUCCEEDED",
            vars: {
              amount: order.total,
              orderNumber: order.number,
            },
            metadata: { orderId },
            dedupKey: `order-paid:${orderId}`,
          });
          // Кондитеру: заказ оплачен — можно приступать (ТЗ §10; metadata.orderId).
          // orders.confectioner_id — UUID пользователя кондитера (см. accept-route),
          // шлём напрямую без lookup в confectioners.
          if (order.confectioner_id) {
            await sendNotification({
              userId: order.confectioner_id,
              template: "PAYMENT_SUCCEEDED",
              vars: {
                amount: order.total,
                orderNumber: order.number,
              },
              metadata: { orderId },
              dedupKey: `order-paid-cf:${orderId}`,
            });
          }
        } catch (e) {
          console.warn("[webhook] Notification failed:", e);
        }
        break;
      }

      case "payment.canceled": {
        // Устаревший canceled не должен перезаписывать succeeded/escrow/released.
        let cancellationApplied = !payment;
        if (payment) {
          const { data: cancelledPayment, error: cancelPaymentError } = await supabaseAdmin
            .from("payments")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", payment.id)
            .in("status", ["pending", "waiting_for_capture", "cancelled"])
            .select("id");
          if (cancelPaymentError) {
            console.error("[webhook] payment.canceled payment CAS failed:", cancelPaymentError.message);
            return NextResponse.json({ error: "DB error" }, { status: 500 });
          }
          cancellationApplied = (cancelledPayment?.length ?? 0) > 0 || payment.status === "cancelled";
          if (cancellationApplied) {
            const cancelledPaymentId = payment.id;
            void import("@/lib/financial-ledger").then(({ recordFinancialEntrySafe }) =>
              recordFinancialEntrySafe({
                entryType: "payment_canceled",
                amount: 0,
                paymentId: cancelledPaymentId,
                orderId,
                idempotencyKey: `pay-canceled:${cancelledPaymentId}`,
                metadata: { provider: "yookassa", provider_payment_id: providerPaymentId },
              })
            );
          }
        }

        if (!cancellationApplied) {
          console.warn("[webhook] stale payment.canceled ignored for non-pending payment:", payment?.id);
          break;
        }

        const orderWasPending =
          ["pending", "waiting_for_capture", "cancelled"].includes(order.payment_status) &&
          !["CANCELLED", "REFUNDED", "COMPLETED"].includes(order.status);
        if (orderWasPending) {
          const { data: cancelledOrder, error: cancelOrderError } = await supabaseAdmin
            .from("orders")
            .update({ payment_status: "cancelled", status: "CANCELLED" })
            .eq("id", orderId)
            .eq("payment_status", order.payment_status)
            .eq("status", order.status)
            .select("id");
          if (cancelOrderError) {
            console.error("[webhook] payment.canceled order CAS failed:", cancelOrderError.message);
            return NextResponse.json({ error: "DB error" }, { status: 500 });
          }

          if (cancelledOrder?.length) {
            const { error: historyError } = await supabaseAdmin
              .from("order_status_history")
              .insert({
                order_id: orderId,
                status_from: order.status,
                status_to: "CANCELLED",
                comment: "Отменён автоматически: платёж отменён (webhook)",
              });
            if (historyError) {
              console.error("[webhook] order history insert failed:", historyError.message);
            }

            try {
              const canceledUserId = order.user_id || order.customer_id;
              if (canceledUserId) {
                const { sendNotification } = await import("@/lib/notifications");
                await sendNotification({
                  userId: canceledUserId,
                  template: "PAYMENT_FAILED",
                  vars: { orderNumber: order.number },
                  metadata: { orderId },
                  dedupKey: `payment-failed:${orderId}`,
                });
              }
            } catch (e) {
              console.warn("[webhook] cancel notification failed (non-blocking):", e);
            }
          }
        }
        break;
      }

      case "refund.succeeded": {
        if (!payment) {
          console.error(`[webhook] refund event without local payment row: provider=${providerPaymentId}, refund=${object.id}`);
          return NextResponse.json({ error: "Payment ledger row missing for refund" }, { status: 500 });
        }
        // Сумма возврата не может превышать сумму платежа
        // (P1.1: Math.round — дробные рубли ломали сравнение копеек)
        const paymentKop = payment ? Math.round(Number(payment.amount) * 100) : null;
        if (payment && wireKop !== null && paymentKop !== null && wireKop > paymentKop) {
          console.error(
            `[webhook] REFUND_AMOUNT_MISMATCH payment=${payment.id} payment_kop=${paymentKop} refund_kop=${wireKop}`
          );
          return NextResponse.json({ error: "Refund amount mismatch" }, { status: 500 });
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
            if (ordUpdErr) {
              console.error("[webhook] refund order update failed; provider retry required:", ordUpdErr.message);
              return NextResponse.json({ error: "Refund order status update failed" }, { status: 500 });
            }
          }

          // RECIPE-03 (RA.10): хук отзыва entitlement при ПОЛНОМ возврате
          // заказа type='recipe' (Q-3.1 default: частичный возврат доступ
          // сохраняет — revoke только при fully_refunded).
          if (refundRes.fully_refunded && order.type === "recipe") {
            try {
              const recipeId = order.metadata?.recipe_id;
              const buyerId = order.user_id || order.customer_id;
              if (recipeId && buyerId) {
                const { revokeEntitlement } = await import("@/lib/recipes/entitlement");
                const revoked = await revokeEntitlement(recipeId, buyerId);
                console.info(`[webhook] recipe entitlement ${revoked ? "revoked" : "revoke-failed"} (full refund) recipe=${recipeId} buyer=${buyerId}`);
              }
            } catch (e) {
              console.error("[webhook] recipe entitlement revoke failed (CRITICAL):", e);
            }
          }
        }

        // Наш refund-рекорд (если возврат создан через /api/payment/refund)
        let ourRefundId: string | null = null;
        try {
          const { data: refundRows } = await supabaseAdmin
            .from("refunds")
            .update({ status: "processed", processed_at: new Date().toISOString() })
            .eq("yookassa_refund_id", object.id)
            .select("id");
          ourRefundId = (refundRows as Array<{ id: string }> | null)?.[0]?.id ?? null;
        } catch (e) {
          console.warn("[webhook] refunds row update failed:", e);
        }

        // PAY-2: журнал — возврат ПОДТВЕРЖДЁН провайдером (−amount, авторитетная
        // запись денег). Дедуп по PROVIDER refund id — повторная доставка
        // вебхука не задвоит ни RPC 0039, ни запись журнала.
        void import("@/lib/financial-ledger").then(({ recordFinancialEntrySafe }) =>
          recordFinancialEntrySafe({
            entryType: "refund_confirmed",
            amount: -(wireKop ?? 0) / 100,
            paymentId: payment?.id ?? null,
            orderId,
            refundId: ourRefundId,
            idempotencyKey: `refund-confirmed:${object.id}`,
            metadata: { provider: "yookassa", provider_refund_id: object.id },
          })
        );

        // P1: клиенту — возврат обработан (ТЗ §10; metadata.orderId, fail-safe)
        try {
          const refundUserId = order.user_id || order.customer_id;
          if (refundUserId) {
            const { sendNotification } = await import("@/lib/notifications");
            await sendNotification({
              userId: refundUserId,
              template: "REFUND_PROCESSED",
              vars: {
                orderNumber: order.number,
                amount: wireKop != null ? Math.round(wireKop) / 100 : Number(payment?.amount ?? order.total),
              },
              metadata: { orderId },
              // P1.1: dedup — повторный refund webhook не задвоит рассылку
              dedupKey: `refund-processed:${object.id}`,
            });
          }
        } catch (e) {
          console.warn("[webhook] refund notification failed (non-blocking):", e);
        }
        break;
      }

      default:
        console.log(`Webhook event: ${event} for order ${orderId}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // DEPLOY-01 §3: незапланированная ошибка webhook — в централизованный
    // журнал (payments → P0/P1 инцидент) с тем же fail-closed 500.
    return handleRouteError(error, {
      route: "/api/payment/webhook",
      component: "payments",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
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
