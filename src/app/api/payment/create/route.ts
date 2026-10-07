/**
 * POST /api/payment/create — создание платежа через YooKassa.
 *
 * Тело: { orderId, installmentPlanId? }
 * Возвращает: { paymentUrl, paymentId }
 *
 * Auth: AUTHENTICATED
 * Rate limit: 5 запросов/мин с IP
 *
 * P0 (pay0-2):
 *  - запись в payments только в СУЩЕСТВУЮЩИЕ колонки (миграция 0002:
 *    order_id, yookassa_payment_id, amount, currency, status, method,
 *    metadata) — раньше писались несуществующие user_id/gateway_txn_id/
 *    gateway_response, а ошибка insert не проверялась → платежи молча
 *    не сохранялись и webhook не мог их найти;
 *  - дедупликация по yookassa_payment_id (детерминированный
 *    Idempotence-Key в lib возвращает тот же платёж при ретрае);
 *  - блокировка повторной оплаты по валидным статусам (статуса "paid"
 *    не существует в enum payment_status);
 *  - суммы в рублях (orders.total — рубли).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { createPayment, isYookassaConfigured } from "@/lib/yookassa";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Статусы, означающие «деньги уже получены» (enum payment_status:
// pending | waiting_for_capture | succeeded | escrow | released | cancelled | refunded)
const PAID_ORDER_STATUSES = new Set(["escrow", "succeeded", "released"]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(
      request,
      `payment-create:${ip}`,
      RATE_LIMITS.payment.limit,
      RATE_LIMITS.payment.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      orderId?: unknown;
      installmentPlanId?: unknown;
    } | null;

    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    const installmentPlanId =
      typeof body?.installmentPlanId === "string" ? body.installmentPlanId : undefined;

    if (!orderId) {
      return NextResponse.json({ error: "orderId обязателен" }, { status: 400 });
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id, number, total, user_id, payment_status")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    if (order.user_id !== user.id) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
    if (PAID_ORDER_STATUSES.has(order.payment_status)) {
      return NextResponse.json({ error: "Заказ уже оплачен" }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    if (!isYookassaConfigured()) {
      // P1: повторная оплата из кабинета/success. Вне production, как и
      // /api/checkout (STUB_PAYMENT_URL), отдаём stub-редирект на success,
      // а не 503 — иначе «оплатить позже» из кабинета в dev невозможна.
      // В production жёсткий 503: без шлюза деньги не имитируем.
      if (process.env.NODE_ENV !== "production") {
        return NextResponse.json({
          paymentUrl: `/checkout/success?orderId=${orderId}&demo=true`,
          paymentId: `stub_${Date.now()}`,
          isStub: true,
        });
      }
      return NextResponse.json({ error: "Платёжный шлюз не настроен" }, { status: 503 });
    }

    const paymentResult = await createPayment({
      amount: Number(order.total), // рубли
      description: `Заказ ${order.number || orderId}`,
      returnUrl: `${appUrl}/checkout?order=${orderId}`,
      orderId,
      metadata: installmentPlanId ? { installmentPlanId } : undefined,
    });

    if (!paymentResult?.success || !paymentResult.payment?.confirmation?.confirmation_url) {
      return NextResponse.json({ error: "Не удалось создать платёж" }, { status: 502 });
    }

    const yookassaPaymentId = paymentResult.payment.id;

    // Идемпотентная запись в БД: ретрай с тем же Idempotence-Key вернёт
    // тот же платёж провайдера — не создаём дубликат строки.
    const { data: existingPayment } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("yookassa_payment_id", yookassaPaymentId)
      .maybeSingle();

    if (!existingPayment) {
      // Только колонки, существующие в миграции 0002; ошибка ОБЯЗАТЕЛЬНО
      // проверяется (раньше insert падал молча).
      // PAY-1: upsert по yookassa_payment_id (UNIQUE, 0002) — гонка двух
      // параллельных запросов даёт одну строку без unique-violation шума.
      const { error: insertErr } = await supabaseAdmin
        .from("payments")
        .upsert(
          {
            order_id: orderId,
            yookassa_payment_id: yookassaPaymentId,
            amount: Number(order.total), // рубли
            currency: "RUB",
            status: "pending",
            method: "yookassa",
            metadata: {
              confirmation_url: paymentResult.payment.confirmation.confirmation_url,
              installment_plan_id: installmentPlanId ?? null,
            },
          },
          { onConflict: "yookassa_payment_id", ignoreDuplicates: true }
        );

      if (insertErr) {
        // Платёж у провайдера уже создан; webhook найдёт заказ по
        // metadata.orderId (fallback) — не отдаём 500, но фиксируем.
        console.error("[payment/create] payments insert failed:", insertErr.message);
      }
    }

    // Update order payment status
    const { error: orderUpdErr } = await supabaseAdmin
      .from("orders")
      .update({ payment_status: "pending" })
      .eq("id", orderId);
    if (orderUpdErr) {
      console.error("[payment/create] orders payment_status update failed:", orderUpdErr.message);
    }

    return NextResponse.json({
      paymentUrl: paymentResult.payment.confirmation.confirmation_url,
      paymentId: yookassaPaymentId,
    });
  } catch (error: unknown) {
    // detail наружу не отдаём (утечка внутренностей)
    console.error("[payment/create] error:", (error as Error)?.message);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
