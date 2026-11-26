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
import { handleRouteError } from "@/lib/http-helpers";
import { shouldSkipFinalPaymentWebhook } from "@/lib/payment-webhook-idempotency";
import {
  verifyWebhook,
  getPaymentStatus,
  isYookassaConfigured,
  getRefund,
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

    // === 2. Legacy fallback: metadata.orderId → последний платёж заказа ===
    // (для платежей, записанных до pay0-2 без yookassa_payment_id)
    const metaOrderId = object.metadata?.orderId;
    // RELEASE-02 §5: legacy-фолбэк по metadata.orderId отключён в production —
    // матчинг строго по yookassa_payment_id; фолбэк только для dev/legacy-данных.
    // Если фолбэк отключён и metadata.orderId нет — orderId останется null и
    // существующая ветка «if (!orderId) return 400» отклонит событие (NPE нет:
    // все использования payment ниже null-guarded).
    if (!payment && metaOrderId && process.env.NODE_ENV !== "production") {
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
    // Non-UUID orderId (мусор в metadata.orderId) не может существовать в БД:
    // .eq("id", …) по uuid-колонке бросил бы 22P02 и отдал бы 500. Валидный
    // контракт для «заказа не существует» — 404 (см. E2E payment-webhook).
    if (orderId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      console.warn(`[webhook] orderId is not a UUID: ${orderId} — 404`);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
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
    // payment.succeeded и refund.succeeded всегда проходят повторную проверку:
    // конкурентная отмена/компенсация не должна быть скрыта ранним ack.
    if (payment && shouldSkipFinalPaymentWebhook(event, payment.status, dbStatus)) {
      console.info(
        `[webhook] Payment ${payment.id} (order ${orderId}) already final "${payment.status}", skipping.`
      );
      return NextResponse.json({ success: true, idempotent: true });
    }

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
