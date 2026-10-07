/**
 * POST /api/orders/[id]/production/complete — завершение производственных
 * этапов (ТЗ §7, §17): все этапы, кроме handoff, помечаются выполненными
 * (идемпотентно). Фото готовности НЕ отмечается автоматически — оно
 * загружается через /api/orders/[id]/media (гейт §35).
 *
 * Статус заказа остаётся PREPARING — финальный переход в READY делает
 * POST /api/orders/[id]/ready (QC/фото-гейт).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { ensureChecklist, getOrderChecklist, setStageDone } from "@/lib/ops/production";
import { loadOrderItemsData } from "@/lib/ops/acceptance";
import { recordEvent } from "@/lib/ops/events";

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

    // Чеклист
    const data = await loadOrderItemsData(id);
    const categorySlug = data?.items.find((i) => i.categorySlug)?.categorySlug ?? null;
    await ensureChecklist(id, categorySlug);
    const checklist = await getOrderChecklist(id);

    // Отметить все производственные этапы, кроме handoff (он после READY)
    // и ready_photo (фото прикладывается только через /media — гейт §35)
    const doneNow: string[] = [];
    for (const stage of checklist) {
      if (stage.stage_key === "handoff" || stage.stage_key === "ready_photo") continue;
      if (!stage.is_done) {
        await setStageDone(id, stage.stage_key, true, user.id);
        doneNow.push(stage.stage_key);
      }
    }

    const pool = getPool();
    await pool.query(
      `UPDATE public.order_production SET completed_at = now(), updated_at = now()
       WHERE order_id = $1::uuid`,
      [id]
    );

    await recordEvent("order.production_completed", {
      entityType: "order",
      entityId: id,
      actorId: user.id,
      payload: { orderNumber: order.number, stagesDone: doneNow },
    });

    const updated = await getOrderChecklist(id);
    const remaining = updated.filter((s) => !s.is_done && s.stage_key !== "handoff");

    return NextResponse.json({
      ok: true,
      completedAt: new Date().toISOString(),
      stagesDoneNow: doneNow,
      remainingBeforeReady: remaining.map((s) => s.label),
      note:
        remaining.some((s) => s.stage_key === "ready_photo")
          ? "Требуется фото готовности перед отметкой «Готов»"
          : null,
    });
  } catch (err) {
    console.error(
      "[orders/production/complete] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
