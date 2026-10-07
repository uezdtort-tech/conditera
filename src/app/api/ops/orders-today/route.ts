/**
 * GET /api/ops/orders-today — Control Tower «ORDERS TODAY» (ТЗ §21, §32).
 *
 * Группы: ALL / ON TRACK / ATTENTION / AT RISK / OVERDUE / UNASSIGNED.
 * Производительность (ТЗ §52): заказы + производственные метаданные +
 * резервы + дефициты склада + риск — ОДНИМ SQL (через computeRiskSnapshotsBulk),
 * риск считается в JS без N+1. До 500 заказов — один prepared query.
 *
 * Права: ADMIN | SUPER_ADMIN.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { computeRiskSnapshotsBulk } from "@/lib/ops/risk-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest
): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return guard;

    const snapshots = await computeRiskSnapshotsBulk(7);

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    interface TowerCard {
      id: string;
      number: string;
      status: string;
      confectionerId: string | null;
      confectionerName: string | null;
      deliveryDate: string | null;
      deliveryType: string | null;
      isToday: boolean;
      productionStarted: boolean;
      capacityOk: boolean | null; // null — не применимо
      inventoryOk: boolean;
      risk: {
        level: string;
        reasons: string[];
        details: string[];
        marginMinutes: number | null;
      };
      latestSafeStartAt: string | null;
      deadlineAt: string | null;
    }

    const cards: TowerCard[] = snapshots.map((s) => ({
      id: s.orderId,
      number: s.orderNumber,
      status: s.status,
      confectionerId: s.confectionerId,
      confectionerName: s.confectionerName,
      deliveryDate: s.deliveryDate,
      deliveryType: s.deliveryType,
      isToday: s.deliveryDate === todayStr,
      productionStarted: Boolean(s.startedAt) || ["PREPARING", "READY", "IN_DELIVERY"].includes(s.status),
      capacityOk: s.hasReservation ? true : s.confectionerId ? false : null,
      inventoryOk: s.lowStockCount === 0,
      risk: {
        level: s.risk.level,
        reasons: s.risk.reasons,
        details: s.risk.details,
        marginMinutes:
          s.production.latestSafeStartAt
            ? Math.round((s.production.latestSafeStartAt.getTime() - Date.now()) / 60_000)
            : null,
      },
      latestSafeStartAt: s.production.latestSafeStartAt
        ? s.production.latestSafeStartAt.toISOString()
        : null,
      deadlineAt: s.production.deadlineAt ? s.production.deadlineAt.toISOString() : null,
    }));

    // --- Группировка (ТЗ §21) ---
    // atRisk: RED всегда + ORANGE только «срочные» (безопасный старт в пределах
    // 60 мин, как в очереди ORDER_AT_RISK) — клик по чипу показывает именно
    // проблемные заказы, а не все legacy-заказы без плана (ТЗ §32).
    const URGENT_MS = 60 * 60_000;
    const isUrgent = (c: TowerCard) =>
      c.risk.level === "RED" ||
      (c.risk.level === "ORANGE" &&
        c.latestSafeStartAt !== null &&
        new Date(c.latestSafeStartAt).getTime() - Date.now() <= URGENT_MS);
    const groups = {
      all: cards,
      onTrack: cards.filter((c) => c.risk.level === "GREEN"),
      attention: cards.filter(
        (c) =>
          c.risk.level === "YELLOW" ||
          (c.risk.level === "ORANGE" && !isUrgent(c))
      ),
      atRisk: cards.filter(isUrgent),
      overdue: cards.filter((c) => {
        // Доставка в прошлом и не завершён — перекрытие с ORDER_OVERDUE правилом
        if (!c.deliveryDate) return false;
        return c.deliveryDate < todayStr && !["DELIVERED", "COMPLETED"].includes(c.status);
      }),
      unassigned: cards.filter((c) => !c.confectionerId),
    };

    const counts = {
      ordersToday: cards.filter((c) => c.isToday).length,
      all: cards.length,
      onTrack: groups.onTrack.length,
      attention: groups.attention.length,
      atRisk: groups.atRisk.length,
      overdue: groups.overdue.length,
      unassigned: groups.unassigned.length,
    };
    void cards; // cards используются группами выше

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      today: todayStr,
      counts,
      groups: {
        onTrack: groups.onTrack,
        attention: groups.attention,
        atRisk: groups.atRisk,
        overdue: groups.overdue,
        unassigned: groups.unassigned,
      },
      cards,
    });
  } catch (err) {
    console.error(
      "[ops/orders-today] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
