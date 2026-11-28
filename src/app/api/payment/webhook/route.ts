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
import { handleRouteError } from "@/lib/http-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  verifyWebhook,
  getPaymentStatus,
  getRefund,
  isYookassaConfigured,
  refundPayment,
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
    if (object.amount?.currency !== "RUB") return { ok: true, skip: "currency_mismatch" };
    const res = await getRefund(object.id);
    if (!res.success || !res.refund) return { ok: false };
    if (res.refund.amount?.currency !== "RUB") return { ok: true, skip: "currency_mismatch" };
    if (res.refund.status !== "succeeded") return { ok: true, skip: "provider_mismatch" };

    // Refunds have no order metadata: the provider's refund object must bind
    // the refund to the exact payment, and both copies of the amount must exist.
    // Missing provider fields are not evidence of a valid refund; fail closed
    // so YooKassa retries instead of allowing an unverifiable ledger mutation.
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

  if (object.amount?.currency !== "RUB") return { ok: true, skip: "currency_mismatch" };
  const res = await getPaymentStatus(providerPaymentId);
  if (!res.success || !res.payment) return { ok: false };
  if (res.payment.status !== expectedStatus) return { ok: true, skip: "provider_mismatch" };
  if (res.payment.amount?.currency !== "RUB") return { ok: true, skip: "currency_mismatch" };
  if (!object.metadata?.orderId || res.payment.metadata?.orderId !== object.metadata.orderId) {
    return { ok: true, skip: "metadata_mismatch" };
  }
  if (wireKop === null) return { ok: true, skip: "amount_missing" };
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

    // PAY-1 MUST run before any write to the financial ledger.
    // A forged/mismatched webhook must not claim an unbound pending payment.
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
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    let payment = (byProvider as PaymentRow | null) ?? null;

    // === 2. Legacy fallback ===
    // Привязываем webhook только к единственной незаполненной pending-попытке.
    // Никогда не выбираем «последний платёж» с другим provider ID: это могло
    // записать статус новой оплаты в чужую попытку после повторного checkout.
    const metaOrderId = object.metadata?.orderId;
    // Validate the only value used by legacy linking before touching payments.
    if (metaOrderId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metaOrderId)) {
      return NextResponse.json({ error: "Invalid orderId in webhook metadata" }, { status: 400 });
    }
    if (!payment && metaOrderId && event.startsWith("payment.")) {
      const { data: legacyRows, error: legacyLookupError } = await supabaseAdmin
        .from("payments")
        .select("id, order_id, amount, status, refund_amount")
        .eq("order_id", metaOrderId)
        .is("yookassa_payment_id", null)
        .in("status", ["pending", "waiting_for_capture"])
        .limit(2);
      if (legacyLookupError) {
        console.error("[webhook] legacy payment lookup failed:", legacyLookupError.message);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      if (legacyRows?.length === 1) {
        const candidate = legacyRows[0] as PaymentRow;
        const { data: linked, error: linkError } = await supabaseAdmin
          .from("payments")
          .update({ yookassa_payment_id: providerPaymentId, updated_at: new Date().toISOString() })
          .eq("id", candidate.id)
          .is("yookassa_payment_id", null)
          .select("id, order_id, amount, status, refund_amount")
          .maybeSingle();
        if (linkError) {
          console.error("[webhook] legacy payment link failed:", linkError.message);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
        payment = (linked as PaymentRow | null) ?? null;
      }
    }

    const orderId = payment?.order_id ?? metaOrderId;
    if (!orderId) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }
    // order_id в схеме — UUID. Некорректный metadata.orderId является
    // ошибкой входного webhook, а не внутренней ошибкой БД (500).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return NextResponse.json({ error: "Invalid orderId in webhook metadata" }, { status: 400 });
    }

    // === IDEMPOTENCY CHECK ===
    // Платёж уже в финальном статусе — не обрабатываем повторно
    // (защита от двойных бонусов/писем при retry со стороны YooKassa).
    // pay4: refund.succeeded НЕ гейтится этим чеком — gейт с dbStatus="succeeded"
    // проглатывал ВСЕ refund-события по оплаченному платежу (payment.status
    // "succeeded" === dbStatus). Дедуп возвратов — по refund id в RPC 0039.
    // payment.succeeded нельзя завершать ранним idempotency-skip:
    // после предыдущей попытки order CAS мог проиграть гонку отмене, и
    // повторный webhook обязан повторно проверить заказ/инициировать возврат.
    if (event !== "refund.succeeded" && event !== "payment.succeeded" && payment && FINAL_PAYMENT_STATUSES.has(payment.status)) {
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
        confectioner_id
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

    // Если платёж создан в YooKassa, но checkout не успел сохранить payments,
    // восстанавливаем точную запись по provider ID после проверки провайдера,
    // суммы, валюты и metadata.orderId. Это исключает зачисление без финансового
    // ledger и позволяет webhook восстановить редкий сбой записи checkout.
    if (event.startsWith("payment.") && !payment &&
        ["payment.succeeded", "payment.waiting_for_capture", "payment.canceled"].includes(event)) {
      if (wireKop === null || wireKop !== Math.round(Number(order.total) * 100) ||
          object.amount?.currency !== "RUB") {
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
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      const { data: recovered, error: recoveredLookupError } = await supabaseAdmin
        .from("payments")
        .select("id, order_id, amount, status, refund_amount")
        .eq("yookassa_payment_id", providerPaymentId)
        .maybeSingle();
      if (recoveredLookupError || !recovered) {
        console.error("[webhook] recovered payment row not visible:", recoveredLookupError?.message);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      payment = recovered as PaymentRow;
    }

    // Обрабатываем события YooKassa
    switch (event) {
      case "payment.waiting_for_capture": {
        // Авторизация карты ещё не означает подтверждённое списание.
        // Не переводим заказ в escrow до payment.succeeded.
        if (payment && payment.status !== "waiting_for_capture") {
          const { data: waitingUpdated, error: waitingUpdateError } = await supabaseAdmin
            .from("payments")
            .update({ status: "waiting_for_capture", updated_at: new Date().toISOString() })
            .eq("id", payment.id)
            .in("status", ["pending", "waiting_for_capture"])
            .select("id");
          if (waitingUpdateError) {
            console.error("[webhook] waiting_for_capture payment update failed:", waitingUpdateError.message);
            return NextResponse.json({ error: "DB error" }, { status: 500 });
          }
          if (!waitingUpdated || waitingUpdated.length === 0) {
            return NextResponse.json({ success: true, skipped: "payment_terminal" });
          }
        }
        return NextResponse.json({ success: true, waitingForCapture: true });
      }

      case "payment.succeeded": {
        // Успешная оплата без локальной payment-записи не может попасть в escrow:
        // нет надёжной суммы/связи с попыткой оплаты и механизма возврата.
        if (!payment) {
          console.error(`[webhook] succeeded event without local payment row: provider=${providerPaymentId}, order=${orderId}`);
          return NextResponse.json({ error: "Payment ledger row missing" }, { status: 500 });
        }

        // === СВЕРКА СУММЫ (P0) ===
        // payments.amount и orders.total — в рублях; провайдер присылает
        // строку в рублях. Не совпало → платёж НЕ зачисляем.
        // P1.1: Math.round обязателен — дробные рубли (builder-прайсинг с
        // множителями) без округления давали 2899.99…*100 ≠ 289999 и
        // легальный платёж отклонялся с amount_mismatch при списанных
        // деньгах. Инвариант создания платежа: payment.amount === order.total,
        // расхождение = заказ изменён после создания платежа → оплата по
        // старой сумме не зачисляется (P1.1 §2).
        const expectedKop = Math.round(
          Number(payment ? payment.amount : order.total) * 100
        );
        const orderKop = Math.round(Number(order.total) * 100);
        const terminalOrder =
          ["CANCELLED", "REFUNDED", "COMPLETED"].includes(order.status) ||
          payment.status === "cancelled";
        const amountMismatch =
          (wireKop !== null && wireKop !== expectedKop) ||
          (!terminalOrder && orderKop !== expectedKop);
        if (amountMismatch) {
          console.error(
            `[webhook] AMOUNT_MISMATCH order=${orderId} expected_kop=${expectedKop} order_kop=${orderKop} got_kop=${wireKop} — платёж НЕ зачислен`
          );
          // Не подтверждаем webhook: оператор должен сверить списание и
          // сделать корректировку/возврат, а провайдер повторит уведомление.
          return NextResponse.json({ error: "Payment amount mismatch" }, { status: 500 });
        }

        // Если подтверждение оплаты пришло ПОСЛЕ отмены заказа, деньги
        // нельзя помещать в escrow или оставлять без возврата. Отправляем
        // полный остаток назад провайдеру. Учитываем и случай, когда payment.canceled
        // уже пометил payment row, но не успел отменить order (race/DB failure).
        // Детерминированный отдельный ключ делает повторный webhook безопасным.
        const orderTerminal = ["CANCELLED", "REFUNDED", "COMPLETED"].includes(order.status);
        if (orderTerminal || payment?.status === "cancelled") {
          if (!orderTerminal && payment?.status === "cancelled") {
            const { data: cancelledOrder, error: cancelOrderError } = await supabaseAdmin
              .from("orders")
              .update({ status: "CANCELLED", payment_status: "cancelled" })
              .eq("id", orderId)
              .eq("status", order.status)
              .eq("payment_status", order.payment_status)
              .in("payment_status", ["pending", "waiting_for_capture", "cancelled"])
              .select("id");
            if (cancelOrderError) {
              console.error("[webhook] cancelled payment order reconciliation failed:", cancelOrderError.message);
              return NextResponse.json({ error: "DB error" }, { status: 500 });
            }
            if (!cancelledOrder?.length) {
              console.error("[webhook] cancelled payment could not atomically cancel current order state");
              return NextResponse.json({ error: "Order cancellation reconciliation required" }, { status: 500 });
            }
          }
          if (payment?.status === "refunded") {
            return NextResponse.json({ success: true, skipped: "already_refunded" });
          }
          const refundAmount = Math.max(
            0,
            Number(payment?.amount ?? order.total) - Number(payment?.refund_amount ?? 0)
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
          if (payment) {
            const { error: latePaymentUpdateError } = await supabaseAdmin
              .from("payments")
              .update({ status: "succeeded", updated_at: new Date().toISOString() })
              .eq("id", payment.id)
              .in("status", ["pending", "waiting_for_capture", "succeeded", "cancelled"]);
            if (latePaymentUpdateError) {
              console.error("[webhook] late-cancel payment update failed:", latePaymentUpdateError.message);
              return NextResponse.json({ error: "DB error" }, { status: 500 });
            }
          }
          return NextResponse.json({ success: true, refundInitiated: refundAmount > 0 });
        }

        // Статус платежа — только после проверки суммы
        if (payment && payment.status !== "succeeded") {
          const { data: paymentUpdated, error: paymentUpdateError } = await supabaseAdmin
            .from("payments")
            .update({ status: "succeeded", updated_at: new Date().toISOString() })
            .eq("id", payment.id)
            .in("status", ["pending", "waiting_for_capture", "succeeded"])
            .select("id");
          if (paymentUpdateError) {
            console.error("[webhook] succeeded payment update failed:", paymentUpdateError.message);
            return NextResponse.json({ error: "DB error" }, { status: 500 });
          }
          if (!paymentUpdated || paymentUpdated.length === 0) {
            console.warn("[webhook] payment is already terminal; escrow transition skipped:", payment.id);
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
          .neq("payment_status", "escrow")
          .neq("status", "CANCELLED")
          .neq("status", "REFUNDED")
          .neq("status", "COMPLETED")
          .select("id");
        if (casErr) {
          console.error("[webhook] escrow CAS failed:", casErr.message);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
        if (!escrowWinner || escrowWinner.length === 0) {
          // CAS мог проиграть не повторному webhook, а конкурентной отмене.
          // Не считать это безопасной идемпотентностью: перечитываем заказ и,
          // если он стал terminal, компенсируем уже подтверждённое списание.
          const { data: latestOrder, error: latestOrderError } = await supabaseAdmin
            .from("orders")
            .select("id, number, status")
            .eq("id", orderId)
            .maybeSingle();
          if (latestOrderError) {
            console.error("[webhook] order re-read after escrow CAS failed:", latestOrderError.message);
            return NextResponse.json({ error: "DB error" }, { status: 500 });
          }
          if (!latestOrder) {
            return NextResponse.json({ error: "Order not found after escrow CAS" }, { status: 500 });
          }
          if (["CANCELLED", "REFUNDED", "COMPLETED"].includes(latestOrder.status)) {
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
            return NextResponse.json({ success: true, refundInitiated: refundAmount > 0 });
          }
          console.info(`[webhook] Order ${orderId} already transitioned (CAS), skipping side-effects.`);
          return NextResponse.json({ success: true, idempotent: true });
        }

        // P1: Эскроу релизуется через cron /api/cron/escrow-release (каждые 30 минут)
        console.info(`[webhook] Order ${orderId} → escrow. Will be released by cron in 24h.`);

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
        // Отмена платежа допустима только пока он не succeeded/escrow/released.
        // Иначе запоздалый webhook canceled не должен перезаписать успешную оплату.
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
          cancellationApplied =
            (cancelledPayment?.length ?? 0) > 0 || payment.status === "cancelled";
        }

        if (!cancellationApplied) {
          console.warn("[webhook] stale payment.canceled ignored for non-pending payment:", payment?.id);
          break;
        }

        // CAS по обоим статусам заказа: поздняя отмена не перезаписывает
        // escrow/released/refunded или завершённый заказ.
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
            return NextResponse.json({ error: "Refund amount missing" }, { status: 500 });
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
    return handleRouteError(error, { route: "/api/payment/webhook", component: "payments" });
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
