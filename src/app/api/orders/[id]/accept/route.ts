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
import { applyOrderTransition, LifecycleError } from "@/lib/ops/lifecycle";
import { handleRouteError } from "@/lib/http-helpers";

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
      .select("id, verificationStatus")
      .eq("userId", user.id)
      .maybeSingle();

    if (!conf) return NextResponse.json({ error: "Профиль кондитера не найден" }, { status: 404 });
    if (conf.verificationStatus !== "approved") {
      return NextResponse.json({ error: "Профиль не подтверждён админом" }, { status: 403 });
    }

    // Get order
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, number, status, confectioner_id, user_id")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    // orders.confectioner_id — UUID пользователя (products.confectioner_id →
    // auth.users), а НЕ confectioners.id (cuid). Сравнение с conf.id было
    // ошибкой — ни один кондитер не мог принять заказ (всегда 403).
    if (order.confectioner_id !== user.id) {
      return NextResponse.json({ error: "Заказ назначен другому кондитеру" }, { status: 403 });
    }
    if (order.status !== "PENDING") {
      return NextResponse.json({ error: `Заказ уже ${order.status}` }, { status: 400 });
    }

    // Единый lifecycle engine атомарно проверяет оплату/наличные,
    // принадлежность заказа кондитеру, статус и конкурентные переходы.
    // Прямой UPDATE здесь запрещён: он позволял принимать неоплаченные заказы.
    try {
      const transition = await applyOrderTransition({
        orderId,
        to: "CONFIRMED",
        actorId: user.id,
        actorRoles: user.roles,
      });
      return NextResponse.json({
        success: true,
        orderId,
        status: transition.to,
      });
    } catch (err) {
      if (err instanceof LifecycleError) {
        const status =
          err.code === "ORDER_NOT_FOUND" ? 404 :
          err.code === "FORBIDDEN_ROLE" ? 403 :
          err.code === "PAYMENT_NOT_CONFIRMED" ? 422 : 409;
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.detail },
          { status }
        );
      }
      throw err;
    }
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/orders/[id]/accept",
      component: "orders",
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
  }
}
