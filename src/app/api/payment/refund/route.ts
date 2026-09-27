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
        // refund остаётся 'approved' — можно повторить после разбора
        console.error("[payment/refund] YooKassa refund failed:", result.error);
        return NextResponse.json(
          { error: result.error || "Ошибка возврата у провайдера", refundId: refund.id },
          { status: 502 }
        );
      }

      await supabaseAdmin
        .from("refunds")
        .update({
          yookassa_refund_id: result.refund?.id ?? null,
          status: "processed",
          processed_at: new Date().toISOString(),
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

    // Обновляем суммы/статусы
    const newRefunded = alreadyRefunded + amount;
    const fullyRefunded = newRefunded >= Number(payment.amount);

    if (fullyRefunded) {
      await supabaseAdmin
        .from("payments")
        .update({ refund_amount: newRefunded, status: "refunded" })
        .eq("id", paymentId);
      await supabaseAdmin
        .from("orders")
        .update({ payment_status: "refunded" })
        .eq("id", payment.order_id);
    } else {
      await supabaseAdmin
        .from("payments")
        .update({ refund_amount: newRefunded })
        .eq("id", paymentId);
    }

    return NextResponse.json(
      { refund: { ...refund, status: "processed" } },
      { status: 201 }
    );
  } catch (error) {
    // детали ошибки наружу не отдаём
    console.error("[payment/refund] error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
