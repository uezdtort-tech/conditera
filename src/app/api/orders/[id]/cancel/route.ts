/**
 * POST /api/orders/:id/cancel — отмена заказа.
 *
 * Проверяет: авторство (customer или admin), статус (не COMPLETED).
 * Если оплачен — возврат через refundPayment.
 *
 * Auth: AUTHENTICATED (customer = свой заказ, admin = любой)
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

    const { reason } = await req.json();

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, number, status, user_id, payment_status, total")
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

    // Update order status
    await supabaseAdmin
      .from("orders")
      .update({
        status: "CANCELLED",
        payment_status: order.payment_status === "paid" ? "refunded" : order.payment_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    // Status history
    await supabaseAdmin.from("order_status_history").insert({
      order_id: orderId,
      status: "CANCELLED",
      changed_by: user.id,
      comment: reason || null,
      created_at: new Date().toISOString(),
    });

    // Refund if paid (non-blocking)
    if (order.payment_status === "paid" || order.payment_status === "escrow") {
      try {
        const { refundPayment } = await import("@/lib/yookassa");
        await refundPayment(orderId, Number(order.total));
      } catch (e: any) {
        console.warn("[orders/:id/cancel] refund failed:", e?.message);
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
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
