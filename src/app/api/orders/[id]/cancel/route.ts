/**
 * POST /api/orders/:id/cancel — отмена заказа.
 *
 * Проверяет: авторство (customer или admin), статус (не COMPLETED).
 * Если оплачен — возврат через refundPayment.
 *
 * Auth: AUTHENTICATED (customer = свой заказ, admin = любой)
 *
 * P0 (pay0-4→5):
 *  - возврат вызывается по РЕАЛЬНОМУ yookassa_payment_id из payments
 *    (раньше первым аргументом передавался orderId → реальный refund
 *    у провайдера был невозможен, а mock-режим «успешно» маскировал это);
 *  - payment_status='refunded' ставится ТОЛЬКО после успешного возврата
 *    (раньше — до факта, при падении возврата заказ оставался
 *    «возвращённым» без денег);
 *  - optimistic lock на статус: конкурентный переход не перетирается,
 *    а возвращает 409.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === "string" ? body.reason : undefined;

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, number, status, user_id, payment_status, total, payout_reserved_at, payout_request_id")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

    const adminCheck = await isAdmin(user.id);
    if (order.user_id !== user.id && !adminCheck) {
      return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
    }

    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      return NextResponse.json({ error: `Нельзя отменить заказ со статусом ${order.status}` }, { status: 400 });
    }

    // pay4: заказ зарезервирован под заявку на выплату — отмена создала бы
    // рассинхрон «выплачено кондитеру ↔ отменено у клиента»
    if (order.payout_reserved_at || order.payout_request_id) {
      return NextResponse.json(
        { error: "Заказ включён в заявку на выплату. Отмена невозможна — обратитесь в поддержку." },
        { status: 409 }
      );
    }

    // pay4: эскроу уже релизнут кондитеру — деньги вне эскроу; отмена/возврат —
    // только ручная процедура через поддержку (прежде заказ отменялся,
    // оставаясь payment_status='released', и попадал в состав выплаты)
    if (order.payment_status === "released") {
      return NextResponse.json(
        { error: "Эскроу уже выплачен кондитеру. Отмена возможна только через поддержку." },
        { status: 409 }
      );
    }

    // Optimistic lock: обновляем только если статус не изменился конкурентно
    const { data: updatedRows, error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({
        status: "CANCELLED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", order.status)
      .select("id");

    if (updateErr || !updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        { error: "Статус заказа изменился, обновите страницу и повторите" },
        { status: 409 }
      );
    }

    // Status history
    await supabaseAdmin.from("order_status_history").insert({
      order_id: orderId,
      status: "CANCELLED",
      changed_by: user.id,
      comment: reason || null,
      created_at: new Date().toISOString(),
    });

    // Refund if paid (non-blocking) — только по реальному платежу провайдера
    // (статуса "paid" не существует; деньги получены = escrow | succeeded)
    if (order.payment_status === "paid" || order.payment_status === "escrow" || order.payment_status === "succeeded") {
      const { data: payment } = await supabaseAdmin
        .from("payments")
        .select("id, yookassa_payment_id, amount, status")
        .eq("order_id", orderId)
        .in("status", ["pending", "waiting_for_capture", "succeeded"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (payment?.yookassa_payment_id) {
        try {
          const { refundPayment } = await import("@/lib/yookassa");
          // amount в рублях — как хранится payments.amount
          const result = await refundPayment(payment.yookassa_payment_id, Number(payment.amount));
          if (result.success) {
            await supabaseAdmin
              .from("payments")
              .update({
                status: "refunded",
                refund_amount: payment.amount,
              })
              .eq("id", payment.id);
            // refunded — только после фактического успеха возврата
            await supabaseAdmin
              .from("orders")
              .update({ payment_status: "refunded" })
              .eq("id", orderId);
          } else {
            // Возврат не прошёл — заказ отменён, но payment_status не трогаем:
            // админ доразберётся (ручной возврат через /api/payment/refund)
            console.error("[orders/:id/cancel] YooKassa refund failed:", result.error);
          }
        } catch (e: unknown) {
          console.warn("[orders/:id/cancel] refund failed:", (e as Error)?.message);
        }
      } else {
        console.warn(
          `[orders/:id/cancel] order ${orderId}: нет платежа с yookassa_payment_id — возврат у провайдера невозможен`
        );
      }
    }

    // Notify (non-blocking)
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: order.user_id,
        template: "ORDER_CANCELLED",
        vars: { orderNumber: order.number || orderId, reason: reason || "Отменён пользователем" },
        data: { type: "order_cancelled", orderId },
      });
    } catch {}

    return NextResponse.json({ success: true, orderId, status: "CANCELLED" });
  } catch (error: unknown) {
    return NextResponse.json({ error: "Ошибка", detail: (error as Error)?.message }, { status: 500 });
  }
}
