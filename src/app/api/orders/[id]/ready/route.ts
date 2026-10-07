/**
 * POST /api/orders/[id]/ready — отметка готовности (ТЗ §7, §35).
 *
 * Расширяет существующий PATCH-переход PREPARING→READY гейтами:
 *   • чеклист производства завершён (все этапы, кроме handoff);
 *   • фото готовности приложено, если категория его требует (§35).
 *
 * После READY: резерв производства освобождается (side effect движка),
 * авто-resolve задач риска.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { applyOrderTransition, LifecycleError } from "@/lib/ops/lifecycle";
import { materializeOpsTasks } from "@/lib/ops/rules";
import { recalculateOrderRisk } from "@/lib/ops/risk-engine";

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

    try {
      await applyOrderTransition({
        orderId: id,
        to: "READY",
        actorId: user.id,
        actorRoles: user.roles,
        skipRoleCheck: true,
      });
    } catch (err) {
      if (err instanceof LifecycleError) {
        const status =
          err.code === "ORDER_NOT_FOUND"
            ? 404
            : err.code === "QC_GATE_FAILED" || err.code === "READY_PHOTO_REQUIRED"
              ? 422
              : 409;
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.detail },
          { status }
        );
      }
      throw err;
    }

    void materializeOpsTasks(true).catch(() => {});
    void recalculateOrderRisk(id).catch(() => {});

    return NextResponse.json({ ok: true, status: "READY" });
  } catch (err) {
    console.error(
      "[orders/ready] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
