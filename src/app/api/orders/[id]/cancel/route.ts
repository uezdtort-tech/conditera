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
import { emitEvent } from "@/lib/n8n";
import { handleRouteError } from "@/lib/http-helpers";

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
        // ZV33-8b FIX 2: timestamp отмены — POST /cancel не ставил cancelled_at
        // (NULL после UI-отмены), хотя PATCH-путь статусов его пишет
        // (route.ts: newStatus === "CANCELLED" → cancelled_at).
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", order.status)
      // payment_status меняется независимо от order.status (escrow/release/refund).
      // CAS по обоим полям не позволяет отмене перезаписать выплату.
      .eq("payment_status", order.payment_status)
      .select("id");

    if (updateErr || !updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        { error: "Статус заказа изменился, обновите страницу и повторите" },
        { status: 409 }
      );
    }

    // n8n: order.cancelled (fail-safe, после успешной CAS-отмены)
    void emitEvent("order.cancelled", { orderId }).catch(() => {});

    // Status history.
    // FIX-TL: раньше вставка использовала несуществующую колонку `status`
    // (в схеме 0006 — status_from/status_to) и молча падала — строку писал
    // триггер orders_log_status с changed_by=NULL. Триггер удалён (0061) —
    // пишем сами, с атрибуцией актёра (отмена своим заказом / админом).
    const { error: historyError } = await supabaseAdmin
      .from("order_status_history")
      .insert({
        order_id: orderId,
        status_from: order.status,
        status_to: "CANCELLED",
        changed_by: user.id,
        comment: reason || null,
      });
    if (historyError) {
      // История не роняет отмену (статус = источник истины), но фиксируем.
      console.error("[orders/:id/cancel] history insert failed:", historyError.message);
    }

    // Refund if paid — подтверждённый статус пишет только refund.succeeded webhook.
    let refundPending = false;
    {
      // Webhook мог подтвердить платёж, но ещё не успеть обновить orders.payment_status.
      const { data: payment, error: paymentLookupError } = await supabaseAdmin
        .from("payments")
        .select("id, yookassa_payment_id, amount, status")
        .eq("order_id", orderId)
        .in("status", ["pending", "waiting_for_capture", "succeeded"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const orderWasPaid = ["escrow", "succeeded", "released"].includes(order.payment_status);
      if (paymentLookupError) {
        refundPending = true;
        console.error(
          "[orders/:id/cancel] payment lookup failed; manual refund reconciliation required:",
          paymentLookupError.message
        );
      } else if (
        payment &&
        (orderWasPaid || payment.status === "succeeded") &&
        payment.yookassa_payment_id
      ) {
        try {
          const { refundPayment } = await import("@/lib/yookassa");
          const result = await refundPayment(payment.yookassa_payment_id, Number(payment.amount));
          if (result.success) {
            // 200 означает принятие запроса; финальный статус ждём от webhook.
            refundPending = result.refund?.status !== "succeeded";
            if (refundPending) {
              console.info(
                "[orders/:id/cancel] refund accepted; waiting for refund.succeeded webhook:",
                result.refund?.id
              );
            }
          } else {
            refundPending = true;
            console.error("[orders/:id/cancel] YooKassa refund failed:", result.error);
          }
        } catch (e: unknown) {
          refundPending = true;
          console.warn("[orders/:id/cancel] refund failed:", (e as Error)?.message);
        }
      } else if (orderWasPaid || payment?.status === "succeeded") {
        refundPending = true;
        console.warn(
          `[orders/:id/cancel] order ${orderId}: confirmed payment without provider payment ID; manual reconciliation required`
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

    return NextResponse.json({ success: true, orderId, status: "CANCELLED", refundPending });
  } catch (error: unknown) {
    return handleRouteError(error, {
      route: "/api/orders/[id]/cancel",
      component: "orders",
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
  }
}
