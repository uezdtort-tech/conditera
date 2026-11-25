/**
 * PATCH /api/orders/[id] — обновление статуса заказа.
 *
 * Доступ:
 *   - CUSTOMER: только CANCELLED (отмена своего заказа)
 *   - CONFECTIONER: CONFIRMED, PREPARING, READY (статусы приготовления)
 *   - COURIER: IN_DELIVERY, DELIVERED
 *   - ADMIN: любой статус
 *
 * Body: { status: 'PENDING'|'CONFIRMED'|..., comment?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
// Единый auth-контракт: getUserFromRequest читает Bearer И cookie cd_session —
// раньше getCurrentUser (GoTrue getSession) не работал в локальном runtime
// (auth/v1 — 501-стаб) и отдавал 401 всем Bearer-клиентам.
import { getUserFromRequest } from "@/lib/auth";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/supabase/auth";
import { isCourierAssignedToOrder } from "@/lib/courier-assignments";
import { handleRouteError } from "@/lib/http-helpers";
import { applyOrderTransition, LifecycleError } from "@/lib/ops/lifecycle";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => null) as { status?: unknown; comment?: unknown } | null;
    if (!body || typeof body.status !== "string" || !body.status.trim()) {
      return NextResponse.json({ error: "Status is required" }, { status: 400 });
    }
    const newStatus = body.status.trim();
    const comment = typeof body.comment === "string" ? body.comment.slice(0, 2000) : null;

    // Финансовая отмена проходит только через специализированный endpoint:
    // он координирует платёж, возврат и резерв, не обходится PATCH-ом.
    if (newStatus === "CANCELLED") {
      return NextResponse.json(
        { error: "Используйте POST /api/orders/[id]/cancel для безопасной отмены и возврата" },
        { status: 409 }
      );
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, confectioner_id, status, number")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) {
      console.error("[orders/[id]] Load error:", orderError.message);
      return NextResponse.json({ error: "Не удалось загрузить заказ" }, { status: 500 });
    }
    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

    const roles = user.roles ?? [];
    const isAdmin = roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
    const isOwner = order.user_id === user.id;
    const isAssignedConfectioner =
      roles.includes("CONFECTIONER") && order.confectioner_id === user.id;
    const isCourierTransition =
      roles.includes("COURIER") && ["IN_DELIVERY", "DELIVERED"].includes(newStatus);

    // Субъектный доступ проверяется до движка; сам движок отдельно проверяет
    // матрицу ролей и актуальное состояние под SELECT FOR UPDATE.
    if (!isAdmin && !isOwner && !isAssignedConfectioner && !isCourierTransition) {
      return forbiddenResponse("Нет доступа к этому заказу");
    }

    // Наличие роли COURIER не заменяет назначение конкретной доставки.
    if (!isAdmin && isCourierTransition) {
      const { data: assignments, error: assignmentError } = await supabaseAdmin
        .from("deliveries")
        .select("id")
        .eq("order_id", orderId)
        .eq("courier_id", user.id)
        .in("status", ["assigned", "picked_up", "on_the_way"])
        .limit(1);
      if (assignmentError) {
        console.error("[orders/[id]] assignment check failed:", assignmentError.message);
        return NextResponse.json(
          { error: "Не удалось проверить назначение доставки" },
          { status: 503 }
        );
      }
      if (!assignments?.length) {
        return forbiddenResponse("Можно менять только назначенные вам доставки");
      }
    }

    try {
      const result = await applyOrderTransition({
        orderId,
        to: newStatus,
        actorId: user.id,
        actorRoles: roles,
        comment,
      });
      return NextResponse.json({
        order: { id: result.orderId, number: result.orderNumber, status: result.to },
        transition: { from: result.from, to: result.to },
        ...(newStatus === "DELIVERED"
          ? { deliverySync: result.deliverySync ?? "skipped_no_delivery" }
          : {}),
      });
    } catch (err) {
      if (err instanceof LifecycleError) {
        const status =
          err.code === "ORDER_NOT_FOUND" ? 404 :
          err.code === "FORBIDDEN_ROLE" ? 403 :
          err.code === "DELIVERY_ASSIGNMENT_REQUIRED" ? 403 :
          err.code === "PAYMENT_NOT_CONFIRMED" ||
          err.code === "QC_GATE_FAILED" ||
          err.code === "READY_PHOTO_REQUIRED" ? 422 : 409;
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.detail },
          { status }
        );
      }
      throw err;
    }
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/orders/[id]",
      component: "orders",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

/** GET /api/orders/[id] — детали заказа */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return unauthorizedResponse();
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(`
        *,
        items:order_items(*),
        payment:payments(*),
        delivery:deliveries(*)
      `)
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    // Проверяем права доступа
    const isOwner = order.user_id === user.id;
    const isConfectioner = order.confectioner_id === user.id;
    // P1 (courier-scope): COURIER удалён из привилегированного списка — сама
    // по себе роль курьера не даёт права читать чужие заказы (раньше любой
    // курьер мог получить полные детали любого заказа: items, payment,
    // delivery). Курьер допускается только к заказу, на который назначен.
    // Канонический маркер назначения — deliveries.courier_id (orders.courier_id
    // в реальной схеме БД не существует; deliveries приходят встроенными как
    // order.delivery[]). Сравнение — по серверным данным, не по payload.
    const isPrivileged = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(r)
    );
    const isCourierAssigned =
      user.roles.includes("COURIER") && isCourierAssignedToOrder(order, user.id);

    if (!isOwner && !isConfectioner && !isPrivileged && !isCourierAssigned) {
      return forbiddenResponse(
        user.roles.includes("COURIER")
          ? "Курьер не назначен на этот заказ"
          : "Нет доступа к этому заказу"
      );
    }

    return NextResponse.json({ order });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/orders/[id]",
      component: "orders",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
