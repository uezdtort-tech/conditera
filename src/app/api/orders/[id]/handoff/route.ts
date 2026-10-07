/**
 * POST /api/orders/[id]/handoff — подтверждение передачи (ТЗ §36).
 *
 * Минимум: order + customer + timestamp + executor (QR НЕ обязателен).
 *   • delivery: READY → IN_DELIVERY (передача курьеру), событие
 *     order.handed_off с executor;
 *   • pickup:   READY → DELIVERED (передача клиенту, матрица P0.5 §36).
 *
 * Body: { executor?: string, code?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { applyOrderTransition, LifecycleError, isTransitionAllowed } from "@/lib/ops/lifecycle";
import { recordEvent } from "@/lib/ops/events";
import { materializeOpsTasks } from "@/lib/ops/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const order = await loadOrderLite(id);
    if (!order) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }
    if (!(await canOperateOrder(order, user.id))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Нет доступа к производственному контуру заказа" },
        { status: 403 }
      );
    }

    let body: { executor?: string; code?: string };
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const executor = (body.executor ?? user.name ?? "staff").slice(0, 200);

    if (order.status !== "READY") {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: `Передача возможна из статуса READY (сейчас ${order.status})` },
        { status: 409 }
      );
    }

    const isPickup = order.delivery_type === "pickup" || order.delivery_type === "self_pickup";
    const to = isPickup ? "DELIVERED" : "IN_DELIVERY";
    if (!isTransitionAllowed("READY", to)) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: "Переход не поддержан" },
        { status: 409 }
      );
    }

    try {
      await applyOrderTransition({
        orderId: id,
        to,
        actorId: user.id,
        actorRoles: user.roles,
        skipRoleCheck: true,
      });
    } catch (err) {
      if (err instanceof LifecycleError) {
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.detail },
          { status: 409 }
        );
      }
      throw err;
    }

    await recordEvent("order.handed_off", {
      entityType: "order",
      entityId: id,
      actorId: user.id,
      payload: {
        orderNumber: order.number,
        executor,
        handoffType: isPickup ? "pickup" : "courier",
        code: body.code ? "provided" : null,
      },
    });

    void materializeOpsTasks(true).catch(() => {});

    return NextResponse.json({
      ok: true,
      status: to,
      handoff: {
        at: new Date().toISOString(),
        executor,
        type: isPickup ? "pickup" : "courier",
      },
    });
  } catch (err) {
    console.error(
      "[orders/handoff] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
