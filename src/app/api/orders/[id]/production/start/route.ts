/**
 * POST /api/orders/[id]/production/start — начало производства (ТЗ §7, §40).
 *
 * Переход CONFIRMED → PREPARING через lifecycle engine (assignment_required),
 * отметка фактического старта (order_production.started_at),
 * авто-resolve задач риска (ТЗ §25).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { applyOrderTransition, LifecycleError } from "@/lib/ops/lifecycle";
import { ensureChecklist } from "@/lib/ops/production";
import { loadOrderItemsData } from "@/lib/ops/acceptance";
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

    // Чеклист может отсутствовать (заказ создан до P0.5) — создаём
    const data = await loadOrderItemsData(id);
    const categorySlug = data?.items.find((i) => i.categorySlug)?.categorySlug ?? null;
    await ensureChecklist(id, categorySlug);

    // Переход (условие: заказ назначен кондитеру)
    try {
      await applyOrderTransition({
        orderId: id,
        to: "PREPARING",
        actorId: user.id,
        actorRoles: user.roles,
        skipRoleCheck: true, // canOperateOrder уже проверил
      });
    } catch (err) {
      if (err instanceof LifecycleError) {
        const status = err.code === "ORDER_NOT_FOUND" ? 404 : err.code === "FORBIDDEN_ROLE" ? 403 : 409;
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.detail },
          { status }
        );
      }
      throw err;
    }

    // Фактический старт
    const pool = getPool();
    await pool.query(
      `UPDATE public.order_production SET started_at = now(), updated_at = now()
       WHERE order_id = $1::uuid AND started_at IS NULL`,
      [id]
    );

    // Авто-resolve: ORDER_AT_RISK/ORDER_PRODUCTION_DELAYED пересчитываются (ТЗ §25)
    void materializeOpsTasks(true).catch(() => {});
    void recalculateOrderRisk(id).catch(() => {});

    return NextResponse.json({ ok: true, status: "PREPARING", startedAt: new Date().toISOString() });
  } catch (err) {
    console.error(
      "[orders/production/start] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
