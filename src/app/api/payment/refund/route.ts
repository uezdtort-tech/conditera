/**
 * POST /api/payment/refund — возврат (Модуль 10).
 *
 * Тело: { paymentId, amount (рубли), reason }
 * Возвращает: { refund }
 *
 * P0 (pay0-5→6):
 *  - ПОКУПАТЕЛЬ (owner заказа) создаёт ТОЛЬКО заявку:
 *    refunds.status='requested', деньги не двигаются, провайдер не
 *    вызывается. Раньше владелец заказа мог сам себе вернуть деньги
 *    сразу после получения торта.
 *  - Исполнение возврата — только ADMIN/SUPER_ADMIN (INSPECTOR — нет).
 *  - Лимит суммы: amount ≤ payments.amount − уже возвращённое
 *    (refund_amount) + проверка статуса платежа.
 *  - Суммы в РУБЛЯХ (как payments.amount): убран ошибочный amount/100,
 *    который для рублёвых платежей возвращал 1/100 суммы.
 *  - Провайдер вызывается через lib с детерминированным ключом от
 *    refund-записи (`uezd_konditer:refund:{refundId}`) — повторный
 *    вызов не задвоит деньги, частичные возвраты не конфликтуют.
 *
 * PAY-1 (аудит платёжного контура @ 688afc9):
 *  - атомарное резервирование остатка через RPC reserve_refund (миграция 0035) —
 *    параллельные возвраты не превышают сумму платежа (fallback на read-check,
 *    если 0035 ещё не применена на живой БД);
 *  - двухступенчатость: после 2xx провайдера refunds.status='processing',
 *    финальный 'processed' и payments/orders 'refunded' выставляет только
 *    подтверждённый webhook refund.succeeded.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import { refundPayment } from "@/lib/yookassa";

export const runtime = "nodejs";

const REFUND_EXECUTOR_ROLES = ["ADMIN", "SUPER_ADMIN"];
// Возврат возможен только по захваченному платежу (YooKassa: refund только для succeeded)
const REFUNDABLE_PAYMENT_STATUSES = ["succeeded"];

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const body = (await request.json().catch(() => null)) as {
      paymentId?: unknown;
      amount?: unknown;
      reason?: unknown;
    } | null;

    const paymentId = typeof body?.paymentId === "string" ? body.paymentId : "";
    const amount = typeof body?.amount === "number" && Number.isFinite(body.amount) ? body.amount : 0;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!paymentId || amount <= 0 || !reason) {
      return NextResponse.json(
        { error: "paymentId, amount (рубли) и reason обязательны" },
        { status: 400 }
      );
    }
    if (reason.length > 1000) {
      return NextResponse.json({ error: "reason слишком длинный (макс 1000)" }, { status: 422 });
    }

    // Загрузить платёж
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("id, order_id, amount, status, yookassa_payment_id, refund_amount")
      .eq("id", paymentId)
      .single();
    if (payErr || !payment) {
      return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
    }

    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("id, user_id")
      .eq("id", payment.order_id)
      .single();
    if (orderErr || !order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    const isAdmin = user.roles.some((r: string) => REFUND_EXECUTOR_ROLES.includes(r));
    const isOwner = order.user_id === user.id;
    if (!isAdmin && !isOwner) {
      return forbiddenResponse("Только владелец или админ");
    }

    // Статус платежа должен позволять возврат
    if (!REFUNDABLE_PAYMENT_STATUSES.includes(payment.status)) {
      return NextResponse.json(
        { error: `Возврат невозможен: платёж в статусе ${payment.status}` },
        { status: 400 }
      );
    }

    // Лимит: не больше остатка к возврату
    const alreadyRefunded = Number(payment.refund_amount) || 0;
    const remaining = Number(payment.amount) - alreadyRefunded;
    if (amount > remaining) {
      return NextResponse.json(
        { error: `Сумма возврата превышает доступную (макс ${remaining} ₽)` },
        { status: 400 }
      );
    }

    // === Покупатель: только заявка, деньги не двигаются ===
    if (!isAdmin) {
      const { data: refund, error: refundErr } = await supabaseAdmin
        .from("refunds")
        .insert({
          payment_id: paymentId,
          order_id: payment.order_id,
          amount,
          reason,
          initiated_by: user.id,
          status: "requested",
        })
        .select()
        .single();

      if (refundErr) {
        console.error("[payment/refund] insert failed:", refundErr.message);
        return NextResponse.json({ error: "Не удалось создать заявку на возврат" }, { status: 500 });
      }

      return NextResponse.json(
        {
          refund,
          message: "Заявка на возврат принята — решение примет администратор",
        },
        { status: 201 }
      );
    }

    // === Админ: исполняем возврат ===
    // PAY-1: атомарное резервирование остатка ДО обращения к провайдеру —
    // два параллельных возврата не могут совместно превысить сумму платежа.
    let newRefunded: number;
    const { data: reserved, error: reserveErr } = await supabaseAdmin
      .rpc("reserve_refund", { p_payment_id: paymentId, p_amount: amount });

    if (!reserveErr && typeof reserved === "number") {
      newRefunded = reserved;
    } else if (
      reserveErr &&
      (reserveErr as { code?: string }).code === "PGRST202" // функции нет — 0035 не применена
    ) {
      // Fallback: прежняя read-check семантика (remaining проверен выше)
      console.warn("[payment/refund] reserve_refund RPC отсутствует — fallback на read-check");
      newRefunded = alreadyRefunded + amount;
    } else {
      // REFUND_LIMIT / платёж не succeeded / прочая ошибка БД — отказ
      console.error("[payment/refund] reserve_refund отказ:", reserveErr?.message);
      return NextResponse.json(
        { error: "Не удалось зарезервировать остаток возврата (недостаточно средств или платёж не в статусе succeeded)" },
        { status: 409 }
      );
    }

    const { data: refund, error: refundErr } = await supabaseAdmin
      .from("refunds")
      .insert({
        payment_id: paymentId,
        order_id: payment.order_id,
        amount,
        reason,
        initiated_by: user.id,
        status: "approved",
        processed_by: user.id,
      })
      .select()
      .single();

    if (refundErr) {
      console.error("[payment/refund] insert failed:", refundErr.message);
      // Компенсация: снимаем резерв при невозможности создать запись
      if (!reserveErr && typeof reserved === "number") {
        await supabaseAdmin
          .from("payments")
          .update({ refund_amount: alreadyRefunded })
          .eq("id", paymentId);
      }
      return NextResponse.json({ error: "Не удалось создать возврат" }, { status: 500 });
    }

    if (payment.yookassa_payment_id) {
      // Детерминированный ключ от refund-записи: ретрай безопасен,
      // частичные возвраты не конфликтуют между собой
      const result = await refundPayment(
        payment.yookassa_payment_id,
        amount,
        `Возврат по заказу ${payment.order_id}`,
        `uezd_konditer:refund:${refund.id}`
      );

      if (!result.success) {
        // refund остаётся 'approved', резерв снимаем — можно повторить
        console.error("[payment/refund] YooKassa refund failed:", result.error);
        await supabaseAdmin
          .from("payments")
          .update({ refund_amount: alreadyRefunded })
          .eq("id", paymentId);
        return NextResponse.json(
          { error: result.error || "Ошибка возврата у провайдера", refundId: refund.id },
          { status: 502 }
        );
      }

      // Финальную сумму refund_amount пишет ОДИН писатель — webhook
      // refund.succeeded через атомарный RPC apply_yookassa_refund (0039,
      // дедуп по refund id). Резерв reserve_refund (0035) — ВРЕМЕННЫЙ, только
      // на время обращения к провайдеру: снимаем его сразу после принятия
      // возврата, иначе webhook добавит ту же сумму ПОВЕРХ резерва и
      // refund_amount удвоится (аудит 18651d4: возврат 400₽ учитывался
      // как 800₽; fully_refunded наступал вдвое раньше, следующие частичные
      // возвраты блокировались завышенным остатком).
      // Окно до доставки webhook'а, когда резерв не виден guard'у
      // «remaining» — осознанный компромисс до ledger-учёта (PAY-2).
      const { error: unreserveErr } = await supabaseAdmin
        .from("payments")
        .update({ refund_amount: alreadyRefunded })
        .eq("id", paymentId);
      if (unreserveErr) {
        // Если снять резерв не удалось — webhook задвоит сумму (прежнее
        // поведение). Кричим в лог: нужна ручная сверка refund_amount.
        console.error(
          "[payment/refund] FAILED to release temporary refund reservation — refund_amount будет удвоен webhook'ом, нужна ручная сверка:",
          unreserveErr.message,
          { paymentId, alreadyRefunded }
        );
      }

      // PAY-1: провайдер ПРИНЯЛ возврат (pending) — финальный 'processed'
      // выставит webhook refund.succeeded после подтверждения провайдером
      // (сверка getRefund в webhook).
      await supabaseAdmin
        .from("refunds")
        .update({
          yookassa_refund_id: result.refund?.id ?? null,
          status: "processing",
        })
        .eq("id", refund.id);
    } else {
      // Mock/legacy платёж без provider id — фиксируем только в БД
      console.warn("[payment/refund] платёж без yookassa_payment_id — DB-only refund");
      await supabaseAdmin
        .from("refunds")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", refund.id);
    }

    // PAY-1: финальные статусы payments/orders ('refunded') выставляет
    // webhook refund.succeeded после подтверждения провайдера. Здесь —
    // только fallback-режим (RPC отсутствует, подтверждения ждать неоткуда).
    if (reserveErr) {
      const fullyRefunded = newRefunded >= Number(payment.amount);
      if (fullyRefunded) {
        await supabaseAdmin
          .from("payments")
          .update({ status: "refunded" })
          .eq("id", paymentId);
        await supabaseAdmin
          .from("orders")
          .update({ payment_status: "refunded" })
          .eq("id", payment.order_id);
      }
    }

    return NextResponse.json(
      {
        refund: {
          ...refund,
          status: payment.yookassa_payment_id ? "processing" : "processed",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    // детали ошибки наружу не отдаём
    console.error("[payment/refund] error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
