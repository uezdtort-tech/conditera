/** PATCH /api/orders/[id] — совместимый API, делегирующий переходы lifecycle engine. */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
// Единый auth-контракт: getUserFromRequest читает Bearer И cookie cd_session —
// раньше getCurrentUser (GoTrue getSession) не работал в локальном runtime
// (auth/v1 — 501-стаб) и отдавал 401 всем Bearer-клиентам.
import { getUserFromRequest } from "@/lib/auth";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/supabase/auth";
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
    if (!body || typeof body.status !== "string") {
      return NextResponse.json({ error: "Status is required" }, { status: 400 });
    }
    const newStatus = body.status;
    const comment = typeof body.comment === "string" ? body.comment.slice(0, 2000) : null;

    // CANCELLED имеет отдельный финансовый сценарий: возврат, проверка эскроу
    // и резерва выплаты. Не позволяем обходить его старым PATCH.
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
    const isAssignedConfectioner = order.confectioner_id === user.id && roles.includes("CONFECTIONER");

    // Проверка субъектного доступа до вызова движка.
    if (!isAdmin && !isOwner && !isAssignedConfectioner &&
        !(roles.includes("COURIER") && (newStatus === "IN_DELIVERY" || newStatus === "DELIVERED"))) {
      return forbiddenResponse("Нет доступа к этому заказу");
    }

    // Роль COURIER требует назначения независимо от дополнительных ролей.
    if (!isAdmin && roles.includes("COURIER") &&
        (newStatus === "IN_DELIVERY" || newStatus === "DELIVERED")) {
      const { data: assignment, error: assignmentError } = await supabaseAdmin
        .from("deliveries")
        .select("id")
        .eq("order_id", orderId)
        .eq("courier_id", user.id)
        .in("status", ["assigned", "picked_up", "on_the_way", "delivered"])
        .maybeSingle();
      if (assignmentError) {
        console.error("[orders/[id]] Courier assignment check failed:", assignmentError.message);
        return NextResponse.json({ error: "Не удалось проверить назначение доставки" }, { status: 503 });
      }
      if (!assignment) return forbiddenResponse("Можно менять только назначенные вам доставки");
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
      });
    } catch (err) {
      if (err instanceof LifecycleError) {
        const status =
          err.code === "ORDER_NOT_FOUND" ? 404 :
          err.code === "FORBIDDEN_ROLE" ? 403 :
          err.code === "PAYMENT_NOT_CONFIRMED" || err.code === "QC_GATE_FAILED" || err.code === "READY_PHOTO_REQUIRED" ? 422 : 409;
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.detail },
          { status }
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("[orders/[id]] PATCH failed:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
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
    const isAdmin = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN"].includes(r)
    );

    // SUPPORT и COURIER не получают глобальный доступ ко всем заказам.
    // Поддержка видит заказ только при назначенном тикете по этому заказу;
    // курьер — только при существующем назначении доставки.
    let isAssignedSupport = false;
    if (!isAdmin && !isOwner && !isConfectioner && user.roles.includes("SUPPORT")) {
      const { data: ticket, error: ticketError } = await supabaseAdmin
        .from("support_tickets")
        .select("id")
        .eq("order_id", orderId)
        .eq("assigned_to", user.id)
        .limit(1)
        .maybeSingle();
      if (ticketError) {
        console.error("[orders/[id]] Support scope check failed:", ticketError.message);
      }
      isAssignedSupport = Boolean(ticket);
    }

    let isAssignedCourier = false;
    if (!isAdmin && !isOwner && !isConfectioner && !isAssignedSupport && user.roles.includes("COURIER")) {
      const { data: assignment, error: assignmentError } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("id", orderId)
        .eq("courier_id", user.id)
        .limit(1)
        .maybeSingle();
      if (assignmentError) {
        console.error("[orders/[id]] Courier scope check failed:", assignmentError.message);
      }
      isAssignedCourier = Boolean(assignment);
    }

    if (!isOwner && !isConfectioner && !isAdmin && !isAssignedSupport && !isAssignedCourier) {
      return forbiddenResponse("Нет доступа к этому заказу");
    }

    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
