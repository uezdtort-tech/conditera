/**
 * POST /api/orders/:id/accept — кондитер принимает заказ.
 *
 * Проверки: CONFECTIONER, verified, заказ принадлежит кондитеру, статус PENDING.
 * После: status → CONFIRMED, уведомление покупателю.
 *
 * Auth: CONFECTIONER
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    // Check confectioner is verified
    const { data: conf } = await supabaseAdmin
      .from("confectioners")
      .select("id, verification_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!conf) return NextResponse.json({ error: "Профиль кондитера не найден" }, { status: 404 });
    if (conf.verification_status !== "approved") {
      return NextResponse.json({ error: "Профиль не подтверждён админом" }, { status: 403 });
    }

    // Get order
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, number, status, confectioner_id, user_id")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    if (order.confectioner_id !== conf.id) {
      return NextResponse.json({ error: "Заказ назначен другому кондитеру" }, { status: 403 });
    }
    if (order.status !== "PENDING") {
      return NextResponse.json({ error: `Заказ уже ${order.status}` }, { status: 400 });
    }

    // Update status
    await supabaseAdmin
      .from("orders")
      .update({ status: "CONFIRMED", updated_at: new Date().toISOString() })
      .eq("id", orderId);

    // Status history
    await supabaseAdmin.from("order_status_history").insert({
      order_id: orderId,
      status: "CONFIRMED",
      changed_by: user.id,
      created_at: new Date().toISOString(),
    });

    // Notify customer (non-blocking)
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: order.user_id,
        template: "ORDER_CONFIRMED",
        vars: { orderNumber: order.number || orderId },
        data: { type: "order_confirmed", orderId },
      });
    } catch {}

    return NextResponse.json({ success: true, orderId, status: "CONFIRMED" });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
