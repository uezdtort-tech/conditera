/**
 * risk-engine.ts — DB-слой Risk Engine P0.5 (ТЗ §12, §13, §25).
 *
 * • computeRiskSnapshotsBulk() — снимки риска для активных заказов ОДНИМ SQL
 *   (ТЗ §52: без N+1 на «Orders today»);
 * • recalculateOrderRisk(orderId) — одиночный пересчёт (после переходов);
 * • persistRiskLevels() — запись risk_level/risk_reasons в order_production
 *   (INSERT ON CONFLICT — строка создаётся лениво);
 * • события order.at_risk — при первом входе в ORANGE/RED (dedup уровнем).
 *
 * Приближение скана (документировано): LOW_STOCK на уровне заказа считается
 * по позициям кондитера ниже минимума (rule LOW_STOCK уже покрывает детали),
 * не полным breakdown каждого заказа.
 */

import { getPool } from "@/lib/postgrest/pool";
import { computeOrderRisk, type RiskInput } from "./risk";
import { recordEvent } from "./events";
import { parseDeadlineMinuteOfDay } from "./deadline";
import {
  computeLatestSafeStart,
} from "./deadline";
import { dateAtMinute } from "./deadline";
import type { RiskLevel, RiskReasonCode } from "./lifecycle-config";

export interface OrderRiskSnapshot {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  confectionerId: string | null;
  confectionerName: string | null;
  deliveryDate: string | null;
  deliveryType: string | null;
  hasReservation: boolean;
  startedAt: Date | null;
  checklistComplete: boolean | null;
  photoAttached: boolean;
  lowStockCount: number;
  production: {
    estimatedMinutes: number | null;
    estimateApproximate: boolean;
    latestSafeStartAt: Date | null;
    deadlineAt: Date | null;
    readyPhotoRequired: boolean;
    storedRiskLevel: RiskLevel | null;
  };
  risk: {
    level: RiskLevel;
    reasons: RiskReasonCode[];
    details: string[];
  };
}

const ACTIVE_STATUSES = "('PENDING','NEGOTIATING','CONFIRMED','PREPARING','READY','IN_DELIVERY','DELIVERED')";

/**
 * Снимки риска для активных заказов в окне [сегодня .. today+daysWindow],
 * ОДНИМ SQL. Опционально — только один заказ.
 * Просроченные (delivery_date < today) НЕ включаются — их зона ORDER_OVERDUE;
 * без даты — тоже (дедлайн неизвестен). Это ограничивает шум очереди.
 */
export async function computeRiskSnapshotsBulk(
  daysWindow = 3,
  orderId?: string
): Promise<OrderRiskSnapshot[]> {
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    number: string;
    status: string;
    payment_status: string;
    confectioner_id: string | null;
    confectioner_name: string | null;
    delivery_date: string | null;
    delivery_time_window: string | null;
    delivery_time: string | null;
    delivery_type: string | null;
    active_reservation: number;
    started_at: Date | null;
    todo_count: number | null;
    total_count: number | null;
    photo_count: number | null;
    low_stock_count: number | null;
    estimated_minutes: number | null;
    estimate_is_approximate: boolean | null;
    latest_safe_start_at: Date | null;
    ready_photo_required: boolean | null;
    stored_risk_level: string | null;
  }>(
    `SELECT o.id::text, o.number, o.status::text, o.payment_status::text,
            o.confectioner_id::text, cf."businessName" AS confectioner_name,
            to_char(o.delivery_date, 'YYYY-MM-DD') AS delivery_date,
            o.delivery_time_window, o.delivery_time, o.delivery_type,
            rsv.active_reservation,
            p.started_at, p.estimated_minutes, p.estimate_is_approximate,
            p.latest_safe_start_at, p.ready_photo_required,
            p.risk_level AS stored_risk_level,
            cl.todo_count, cl.total_count,
            pm.photo_count, low.low_stock_count
     FROM public.orders o
     LEFT JOIN public.order_production p ON p.order_id = o.id
     LEFT JOIN public.confectioners cf ON cf."userId" = o.confectioner_id::text
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS active_reservation
       FROM public.capacity_reservations cr
       WHERE cr.order_id = o.id AND cr.status IN ('reserved','confirmed')
     ) rsv ON true
     LEFT JOIN LATERAL (
       SELECT
         count(*) FILTER (WHERE NOT c.is_done AND c.stage_key <> 'handoff')::int AS todo_count,
         count(*)::int AS total_count
       FROM public.order_production_checklist c
       WHERE c.order_id = o.id
     ) cl ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS photo_count
       FROM public.order_media m
       WHERE m.order_id = o.id AND m.kind = 'ready_photo' AND m.status = 'approved'
     ) pm ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS low_stock_count
       FROM public.inventory_items i
       WHERE i.owner_id = o.confectioner_id AND i.is_active
         AND i.quantity <= i.min_quantity
     ) low ON true
     WHERE o.status::text IN ${ACTIVE_STATUSES}
       AND o.delivery_date >= CURRENT_DATE
       AND o.delivery_date <= CURRENT_DATE + $1::int
       AND ($2::uuid IS NULL OR o.id = $2::uuid)
     ORDER BY o.delivery_date NULLS LAST, o.created_at`,
    [daysWindow, orderId ?? null]
  );

  const now = new Date();
  return res.rows.map((r) => {
    const deadlineAt = r.delivery_date
      ? dateAtMinute(
          r.delivery_date,
          parseDeadlineMinuteOfDay(r.delivery_time_window, r.delivery_time) ?? 18 * 60
        )
      : null;
    const estimatedMinutes = r.estimated_minutes ?? null;
    const latestSafeStartAt =
      r.latest_safe_start_at
        ? new Date(r.latest_safe_start_at)
        : deadlineAt && estimatedMinutes
          ? computeLatestSafeStart({ deadlineAt, productionMinutes: estimatedMinutes }).latestSafeStartAt
          : null;

    const input: RiskInput = {
      order: {
        status: r.status,
        paymentStatus: r.payment_status,
        confectionerId: r.confectioner_id,
        deliveryDate: r.delivery_date,
        deliveryType: r.delivery_type,
      },
      production: {
        estimatedMinutes,
        estimateApproximate: r.estimate_is_approximate ?? true,
        latestSafeStartAt,
        deadlineAt,
        startedAt: r.started_at ? new Date(r.started_at) : null,
        readyPhotoRequired: r.ready_photo_required ?? false,
        photoAttached: (r.photo_count ?? 0) > 0,
        checklistComplete:
          r.total_count !== null && r.total_count > 0
            ? (r.todo_count ?? 0) === 0
            : null,
      },
      capacity: {
        fits: null, // скан: факт резервации уже в hasReservation
        utilizationPercent: null,
      },
      inventory: { shortageCount: r.low_stock_count ?? 0 },
      hasReservation: (r.active_reservation ?? 0) > 0,
      now,
    };
    const risk = computeOrderRisk(input);
    return {
      orderId: r.id,
      orderNumber: r.number,
      status: r.status,
      paymentStatus: r.payment_status,
      confectionerId: r.confectioner_id,
      confectionerName: r.confectioner_name,
      deliveryDate: r.delivery_date,
      deliveryType: r.delivery_type,
      hasReservation: (r.active_reservation ?? 0) > 0,
      startedAt: r.started_at ? new Date(r.started_at) : null,
      checklistComplete:
        r.total_count !== null && r.total_count > 0 ? (r.todo_count ?? 0) === 0 : null,
      photoAttached: (r.photo_count ?? 0) > 0,
      lowStockCount: r.low_stock_count ?? 0,
      production: {
        estimatedMinutes,
        estimateApproximate: r.estimate_is_approximate ?? true,
        latestSafeStartAt,
        deadlineAt,
        readyPhotoRequired: r.ready_photo_required ?? false,
        storedRiskLevel: (r.stored_risk_level as RiskLevel | null) ?? null,
      },
      risk,
    };
  });
}

/** Записать уровни риска в order_production (bulk, идемпотентно). */
export async function persistRiskLevels(
  items: Array<{ orderId: string; level: RiskLevel; reasons: RiskReasonCode[] }>
): Promise<void> {
  if (items.length === 0) return;
  const pool = getPool();
  for (const it of items) {
    await pool.query(
      `INSERT INTO public.order_production (order_id, risk_level, risk_reasons, risk_calculated_at)
       VALUES ($1::uuid, $2, $3::jsonb, now())
       ON CONFLICT (order_id) DO UPDATE SET
         risk_level = EXCLUDED.risk_level,
         risk_reasons = EXCLUDED.risk_reasons,
         risk_calculated_at = now(),
         updated_at = now()`,
      [it.orderId, it.level, JSON.stringify(it.reasons)]
    );
  }
}

/** События смены уровня риска (fail-safe, только реальные смены). */
export async function emitRiskChanges(
  items: OrderRiskSnapshot[]
): Promise<void> {
  for (const s of items) {
    const stored = s.production.storedRiskLevel ?? null;
    const nowLevel = s.risk.level;
    if (stored === nowLevel) continue;
    const becameRisky = nowLevel === "ORANGE" || nowLevel === "RED";
    const cleared = stored !== null && stored !== "GREEN" && nowLevel === "GREEN";
    if (becameRisky) {
      await recordEvent("order.at_risk", {
        entityType: "order",
        entityId: s.orderId,
        payload: {
          orderNumber: s.orderNumber,
          level: nowLevel,
          reasons: s.risk.reasons,
          previousLevel: stored,
        },
        source: "engine",
      });
    } else if (cleared) {
      await recordEvent("order.risk_cleared", {
        entityType: "order",
        entityId: s.orderId,
        payload: { orderNumber: s.orderNumber, previousLevel: stored },
        source: "engine",
      });
    }
  }
}

/**
 * Одиночный пересчёт риска (после переходов: assign/start/ready/…).
 * Возвращает снимок или null (заказ не найден / терминальный).
 */
export async function recalculateOrderRisk(orderId: string): Promise<OrderRiskSnapshot | null> {
  const all = await computeRiskSnapshotsForOrder(orderId);
  if (!all) return null;
  await persistRiskLevels([
    { orderId: all.orderId, level: all.risk.level, reasons: all.risk.reasons },
  ]);
  await emitRiskChanges([all]);
  return all;
}

/** Снимок для одного заказа (тот же SQL с фильтром). */
async function computeRiskSnapshotsForOrder(
  orderId: string
): Promise<OrderRiskSnapshot | null> {
  const snapshots = await computeRiskSnapshotsBulk(3650, orderId);
  return snapshots[0] ?? null;
}
