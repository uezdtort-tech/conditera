/**
 * POST /api/orders/[id]/production/stage — отметить отдельный этап чеклиста.
 * Доступ: назначенный кондитер или ADMIN/SUPER_ADMIN, только в PREPARING.
 * Фото готовности фиксируется только фактической загрузкой файла через /media;
 * handoff фиксируется только отдельным маршрутом передачи.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { getOrderChecklist, ensureChecklist, setStageDone } from "@/lib/ops/production";
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
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const order = await loadOrderLite(id);
    if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (!(await canOperateOrder(order, user.id))) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    if (order.status !== "PREPARING") {
      return NextResponse.json(
        { error: "INVALID_PRODUCTION_STATE", message: "Этапы можно менять только во время производства" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => null) as { stageKey?: unknown; done?: unknown } | null;
    const stageKey = typeof body?.stageKey === "string" ? body.stageKey.trim() : "";
    if (!stageKey || stageKey.length > 80 || typeof body?.done !== "boolean") {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Нужны stageKey и булево значение done" },
        { status: 400 }
      );
    }
    if (stageKey === "ready_photo" || stageKey === "handoff") {
      return NextResponse.json(
        { error: "STAGE_REQUIRES_DEDICATED_ACTION", message: "Фото и передача фиксируются отдельными действиями" },
        { status: 409 }
      );
    }

    const data = await loadOrderItemsData(id);
    const categorySlug = data?.items.find((item) => item.categorySlug)?.categorySlug ?? null;
    await ensureChecklist(id, categorySlug);
    const stages = await getOrderChecklist(id);
    const stage = stages.find((item) => item.stage_key === stageKey);
    if (!stage) return NextResponse.json({ error: "STAGE_NOT_FOUND" }, { status: 404 });

    const updated = await setStageDone(id, stageKey, body.done, user.id);
    if (!updated) return NextResponse.json({ error: "STAGE_NOT_FOUND" }, { status: 404 });

    await recordEvent("order.production_stage_updated", {
      entityType: "order",
      entityId: id,
      actorId: user.id,
      payload: { stageKey, label: updated.label, done: updated.is_done },
    });

    const checklist = await getOrderChecklist(id);
    const workStages = checklist.filter((item) => item.stage_key !== "ready_photo" && item.stage_key !== "handoff");
    return NextResponse.json({
      ok: true,
      stage: updated,
      workComplete: workStages.length > 0 && workStages.every((item) => item.is_done),
      checklistComplete: checklist.filter((item) => item.stage_key !== "handoff").every((item) => item.is_done),
    });
  } catch (err) {
    console.error("[orders/production/stage] POST failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "INTERNAL", message: "Не удалось обновить этап производства" }, { status: 500 });
  }
}
