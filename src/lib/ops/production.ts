/**
 * production.ts — Production Planning P0.5 (ТЗ §17, §18).
 *
 * После назначения создаётся производственный план: чеклист этапов,
 * зависящих от типа продукта (ТЗ §18). На P0.5 — checklist/task model
 * (ТЗ §17: «не обязательно превращать каждый этап в отдельную сущность»).
 *
 * Timeline-раскладка — детерминированные доли от estimated_minutes
 * (PLAN_STAGE_SHARES), без сложной сущности «этап».
 */

import { getPool } from "@/lib/postgrest/pool";
import {
  checklistTemplateForCategory,
  PLAN_STAGE_SHARES,
  readyPhotoRequiredForCategory,
} from "./lifecycle-config";
import { minuteToHHMM } from "./deadline";

export interface ChecklistStage {
  id: string;
  order_id: string;
  stage_key: string;
  label: string;
  sort_order: number;
  is_done: boolean;
  done_at: string | null;
  done_by: string | null;
}

/**
 * Создать/обновить чеклист заказа по типу продукта (идемпотентно).
 * Существующие этапы не трогаются (is_done сохраняется).
 */
export async function ensureChecklist(
  orderId: string,
  categorySlug: string | null
): Promise<ChecklistStage[]> {
  const pool = getPool();
  const stages = checklistTemplateForCategory(categorySlug);

  const values: unknown[] = [];
  const rows = stages.map((s, i) => {
    values.push(orderId, s.key, s.label, i);
    const b = i * 4;
    return `($${b + 1}::uuid, $${b + 2}, $${b + 3}, $${b + 4})`;
  });

  await pool.query(
    `INSERT INTO public.order_production_checklist (order_id, stage_key, label, sort_order)
     VALUES ${rows.join(", ")}
     ON CONFLICT (order_id, stage_key) DO NOTHING`,
    values
  );

  // Фото-этап включаем в чеклист только для категорий с фото-гейтом
  const photoRequired = readyPhotoRequiredForCategory(categorySlug);
  if (!photoRequired) {
    // Оставляем этап, но он не обязателен: гейт смотрит readyPhotoRequired,
    // здесь ничего не делаем (этап остаётся опциональным).
  }

  await pool.query(
    `INSERT INTO public.order_production (order_id, checklist_created_at, ready_photo_required)
     VALUES ($1::uuid, now(), $2)
     ON CONFLICT (order_id) DO UPDATE SET
       checklist_created_at = COALESCE(order_production.checklist_created_at, now()),
       ready_photo_required = $2,
       updated_at = now()`,
    [orderId, photoRequired]
  );

  return getOrderChecklist(orderId);
}

export async function getOrderChecklist(orderId: string): Promise<ChecklistStage[]> {
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    order_id: string;
    stage_key: string;
    label: string;
    sort_order: number;
    is_done: boolean;
    done_at: Date | null;
    done_by: string | null;
  }>(
    `SELECT id::text, order_id::text, stage_key, label, sort_order, is_done,
            done_at, done_by::text
     FROM public.order_production_checklist
     WHERE order_id = $1::uuid
     ORDER BY sort_order`,
    [orderId]
  );
  return res.rows.map((r) => ({
    ...r,
    done_at: r.done_at ? new Date(r.done_at).toISOString() : null,
  }));
}

/** Отметить/снять этап чеклиста (идемпотентно). */
export async function setStageDone(
  orderId: string,
  stageKey: string,
  done: boolean,
  doneBy: string | null
): Promise<ChecklistStage | null> {
  const pool = getPool();
  const res = await pool.query<{ id: string }>(
    `UPDATE public.order_production_checklist
     SET is_done = $3, done_at = CASE WHEN $3 THEN now() ELSE NULL END,
         done_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END
     WHERE order_id = $1::uuid AND stage_key = $2
     RETURNING id::text`,
    [orderId, stageKey, done, doneBy]
  );
  if (res.rowCount === 0) return null;
  const list = await getOrderChecklist(orderId);
  return list.find((s) => s.stage_key === stageKey) ?? null;
}

/** Все ли производственные этапы (кроме handoff) выполнены. */
export function checklistProductionComplete(stages: ChecklistStage[]): boolean {
  const relevant = stages.filter((s) => s.stage_key !== "handoff");
  return relevant.length > 0 && relevant.every((s) => s.is_done);
}

// ---------------------------------------------------------------------------
// Timeline-раскладка плана (ТЗ §17)
// ---------------------------------------------------------------------------

export interface PlannedStage {
  stageKey: string;
  label: string;
  startMinute: number;
  endMinute: number;
  startTime: string; // HH:MM
  endTime: string;
  isDone: boolean;
}

/**
 * Разложить этапы по окну производства: доли estimated_minutes.
 * Используется в UI «Production today» и Order Workspace.
 */
export function layoutPlanTimeline(params: {
  stages: ChecklistStage[];
  estimatedMinutes: number;
  startMinute: number;
}): PlannedStage[] {
  const shares = params.stages.map((s) => ({
    stage: s,
    share: PLAN_STAGE_SHARES[s.stage_key] ?? 0.1,
  }));
  const totalShare = shares.reduce((sum, s) => sum + s.share, 0) || 1;

  let cursor = params.startMinute;
  return shares.map(({ stage, share }) => {
    const span = Math.max(
      5,
      Math.round((share / totalShare) * params.estimatedMinutes)
    );
    const item: PlannedStage = {
      stageKey: stage.stage_key,
      label: stage.label,
      startMinute: cursor,
      endMinute: cursor + span,
      startTime: minuteToHHMM(cursor),
      endTime: minuteToHHMM(cursor + span),
      isDone: stage.is_done,
    };
    cursor += span;
    return item;
  });
}

// ---------------------------------------------------------------------------
// Snapshot производства заказа (для lifecycle API / workspace)
// ---------------------------------------------------------------------------

export interface ProductionSnapshot {
  orderId: string;
  exists: boolean;
  estimatedMinutes: number | null;
  estimateSource: string | null;
  estimateApproximate: boolean;
  latestSafeStartAt: string | null;
  deadlineAt: string | null;
  plannedDate: string | null;
  plannedStartMinute: number | null;
  riskLevel: string;
  riskReasons: string[];
  startedAt: string | null;
  completedAt: string | null;
  readyPhotoRequired: boolean;
  checklist: ChecklistStage[];
  checklistComplete: boolean;
}

export async function getProductionSnapshot(orderId: string): Promise<ProductionSnapshot> {
  const pool = getPool();
  const res = await pool.query<{
    order_id: string;
    estimated_minutes: number | null;
    estimate_source: string | null;
    estimate_is_approximate: boolean | null;
    latest_safe_start_at: Date | null;
    deadline_at: Date | null;
    planned_date: string | null;
    planned_start_minute: number | null;
    risk_level: string | null;
    risk_reasons: unknown;
    started_at: Date | null;
    completed_at: Date | null;
    ready_photo_required: boolean | null;
  }>(
    `SELECT order_id::text, estimated_minutes, estimate_source, estimate_is_approximate,
            latest_safe_start_at, deadline_at,
            to_char(planned_date, 'YYYY-MM-DD') AS planned_date,
            planned_start_minute, risk_level, risk_reasons,
            started_at, completed_at, ready_photo_required
     FROM public.order_production WHERE order_id = $1::uuid`,
    [orderId]
  );
  const row = res.rows[0];
  const checklist = await getOrderChecklist(orderId);
  const base: ProductionSnapshot = {
    orderId,
    exists: Boolean(row),
    estimatedMinutes: row?.estimated_minutes ?? null,
    estimateSource: row?.estimate_source ?? null,
    estimateApproximate: row?.estimate_is_approximate ?? true,
    latestSafeStartAt: row?.latest_safe_start_at ? new Date(row.latest_safe_start_at).toISOString() : null,
    deadlineAt: row?.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    plannedDate: row?.planned_date ?? null,
    plannedStartMinute: row?.planned_start_minute ?? null,
    riskLevel: row?.risk_level ?? "GREEN",
    riskReasons: Array.isArray(row?.risk_reasons) ? (row.risk_reasons as string[]) : [],
    startedAt: row?.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row?.completed_at ? new Date(row.completed_at).toISOString() : null,
    readyPhotoRequired: row?.ready_photo_required ?? false,
    checklist,
    checklistComplete: checklistProductionComplete(checklist),
  };
  return base;
}
