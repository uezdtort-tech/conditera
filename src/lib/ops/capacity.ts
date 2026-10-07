/**
 * capacity.ts — Capacity Engine P0.5 (ТЗ §9, §27, §28).
 *
 * Чистая математика окон (unit-testable) + функции резерва через getPool().
 *
 * Конкурентность (ТЗ §27): пересечение активных окон одного кондитера
 * запрещено EXCLUDE-констрейнтом 0054 (btree_gist) на уровне БД — два
 * параллельных резерва не могут занять пересекающиеся интервалы.
 */

import { getPool } from "@/lib/postgrest/pool";
import {
  DEFAULT_WORKDAY_START_MINUTE,
  DEFAULT_WORKDAY_END_MINUTE,
  DEFAULT_DAILY_CAPACITY_MINUTES,
} from "./lifecycle-config";

// ---------------------------------------------------------------------------
// Чистая математика интервалов
// ---------------------------------------------------------------------------

export interface BusyInterval {
  start: number; // минута дня, включительно
  end: number; // минута дня, исключительно
  orderId?: string;
}

export interface FreeWindow {
  start: number;
  end: number;
  minutes: number;
}

/** Слить пересекающиеся/смежные занятые интервалы, отсортировать. */
export function mergeBusy(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: BusyInterval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/**
 * Свободные окна внутри рабочего дня [workStart, workEnd)
 * при известных занятых интервалах.
 */
export function computeFreeWindows(
  busy: BusyInterval[],
  workStart: number = DEFAULT_WORKDAY_START_MINUTE,
  workEnd: number = DEFAULT_WORKDAY_END_MINUTE
): FreeWindow[] {
  const merged = mergeBusy(busy);
  const windows: FreeWindow[] = [];
  let cursor = Math.max(0, Math.min(workStart, workEnd));
  const dayEnd = Math.max(cursor, workEnd);

  for (const iv of merged) {
    const s = Math.max(iv.start, cursor);
    if (s > cursor) {
      windows.push({ start: cursor, end: s, minutes: s - cursor });
    }
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < dayEnd) {
    windows.push({ start: cursor, end: dayEnd, minutes: dayEnd - cursor });
  }
  return windows.filter((w) => w.minutes > 0);
}

/** Суммарно свободных минут в окнах (доступная ёмкость дня). */
export function totalFreeMinutes(windows: FreeWindow[]): number {
  return windows.reduce((s, w) => s + w.minutes, 0);
}

/**
 * Найти окно, влезающее `requiredMinutes`, начиная не раньше earliestMinute.
 * Возвращает БЛИЖАЙШЕЕ (раньше по времени) подходящее окно или null.
 */
export function findFreeWindow(
  windows: FreeWindow[],
  requiredMinutes: number,
  earliestMinute: number = 0
): FreeWindow | null {
  const need = Math.max(1, Math.round(requiredMinutes));
  const candidates = windows
    .filter(
      (w) =>
        w.minutes >= need &&
        Math.max(w.start, earliestMinute) + need <= w.end
    )
    .sort((a, b) => Math.max(a.start, earliestMinute) - Math.max(b.start, earliestMinute));
  return candidates[0] ?? null;
}

/** Загрузка дня в процентах: занято / ёмкость (окно рабочего дня). */
export function utilizationPercent(
  busyMinutes: number,
  workStart: number,
  workEnd: number
): number {
  const capacity = Math.max(1, workEnd - workStart);
  const pct = Math.round((Math.max(0, busyMinutes) / capacity) * 100);
  return Math.min(pct, 999);
}

// ---------------------------------------------------------------------------
// Конфигурация кондитера (с дефолтами)
// ---------------------------------------------------------------------------

export interface ConfectionerCapacityConfig {
  userId: string;
  workdayStartMinute: number;
  workdayEndMinute: number;
  dailyCapacityMinutes: number;
  packagingMinutes: number | null;
  qualityCheckMinutes: number | null;
  handoffBufferMinutes: number | null;
  deliveryBufferMinutes: number | null;
  isActive: boolean;
  /** true — всё из глобальных дефолтов (строки в БД нет). */
  isDefault: boolean;
}

export async function getConfectionerCapacity(
  userId: string
): Promise<ConfectionerCapacityConfig> {
  const pool = getPool();
  const res = await pool.query<{
    user_id: string;
    workday_start_minute: number | null;
    workday_end_minute: number | null;
    daily_capacity_minutes: number | null;
    packaging_minutes: number | null;
    quality_check_minutes: number | null;
    handoff_buffer_minutes: number | null;
    delivery_buffer_minutes: number | null;
    is_active: boolean;
  }>(
    `SELECT user_id::text, workday_start_minute, workday_end_minute,
            daily_capacity_minutes, packaging_minutes, quality_check_minutes,
            handoff_buffer_minutes, delivery_buffer_minutes, is_active
     FROM public.confectioner_capacity WHERE user_id = $1::uuid`,
    [userId]
  );
  const row = res.rows[0];
  if (!row) {
    return {
      userId,
      workdayStartMinute: DEFAULT_WORKDAY_START_MINUTE,
      workdayEndMinute: DEFAULT_WORKDAY_END_MINUTE,
      dailyCapacityMinutes: DEFAULT_DAILY_CAPACITY_MINUTES,
      packagingMinutes: null,
      qualityCheckMinutes: null,
      handoffBufferMinutes: null,
      deliveryBufferMinutes: null,
      isActive: true,
      isDefault: true,
    };
  }
  return {
    userId: row.user_id,
    workdayStartMinute: row.workday_start_minute ?? DEFAULT_WORKDAY_START_MINUTE,
    workdayEndMinute: row.workday_end_minute ?? DEFAULT_WORKDAY_END_MINUTE,
    dailyCapacityMinutes: row.daily_capacity_minutes ?? DEFAULT_DAILY_CAPACITY_MINUTES,
    packagingMinutes: row.packaging_minutes,
    qualityCheckMinutes: row.quality_check_minutes,
    handoffBufferMinutes: row.handoff_buffer_minutes,
    deliveryBufferMinutes: row.delivery_buffer_minutes,
    isActive: row.is_active,
    isDefault: false,
  };
}

// ---------------------------------------------------------------------------
// Чтение занятости и свободных окон
// ---------------------------------------------------------------------------

export interface CapacityDayView {
  date: string; // YYYY-MM-DD
  config: ConfectionerCapacityConfig;
  busy: BusyInterval[];
  freeWindows: FreeWindow[];
  freeMinutes: number;
  busyMinutes: number;
  utilizationPercent: number;
}

/**
 * Ёмкость кондитера на дату: активные резервы + окно рабочего дня.
 * Все данные одним SQL (ТЗ §52 — без N+1).
 */
export async function getCapacityDay(
  userId: string,
  date: string
): Promise<CapacityDayView> {
  const config = await getConfectionerCapacity(userId);
  const pool = getPool();
  const res = await pool.query<{
    order_id: string;
    start_minute: number;
    end_minute: number;
  }>(
    `SELECT order_id::text, start_minute, end_minute
     FROM public.capacity_reservations
     WHERE confectioner_id = $1::uuid
       AND reserved_date = $2::date
       AND status IN ('reserved','confirmed')
     ORDER BY start_minute`,
    [userId, date]
  );
  const busy: BusyInterval[] = res.rows.map((r) => ({
    start: r.start_minute,
    end: r.end_minute,
    orderId: r.order_id,
  }));
  const freeWindows = computeFreeWindows(busy, config.workdayStartMinute, config.workdayEndMinute);
  const busyMinutes = mergeBusy(busy).reduce((s, iv) => s + (iv.end - iv.start), 0);
  return {
    date,
    config,
    busy,
    freeWindows,
    freeMinutes: totalFreeMinutes(freeWindows),
    busyMinutes,
    utilizationPercent: utilizationPercent(busyMinutes, config.workdayStartMinute, config.workdayEndMinute),
  };
}

/**
 * Поиск свободного окна под требуемые минуты (с учётом earliest).
 * Возвращает окно или null, если не влезает.
 */
export async function findAvailableWindow(
  userId: string,
  date: string,
  requiredMinutes: number,
  earliestMinute: number = 0
): Promise<{ window: FreeWindow | null; view: CapacityDayView }> {
  const view = await getCapacityDay(userId, date);
  const window = findFreeWindow(view.freeWindows, requiredMinutes, earliestMinute);
  return { window, view };
}

// ---------------------------------------------------------------------------
// Резервирование (ТЗ §28): reserved → confirmed → released/cancelled
// ---------------------------------------------------------------------------

export type ReservationErrorCode =
  | "OVERLAP"
  | "ORDER_ALREADY_RESERVED"
  | "ORDER_NOT_FOUND"
  | "DB_ERROR";

export interface CapacityReservation {
  id: string;
  orderId: string;
  confectionerId: string;
  reservedDate: string;
  startMinute: number;
  endMinute: number;
  estimatedMinutes: number;
  status: string;
}

export class CapacityReservationError extends Error {
  code: ReservationErrorCode;
  detail?: string;
  constructor(code: ReservationErrorCode, detail?: string) {
    super(detail ?? code);
    this.code = code;
    this.detail = detail;
  }
}

function mapPgError(err: unknown): CapacityReservationError {
  const e = err as { code?: string; constraint?: string; detail?: string; message?: string };
  if (e?.code === "23P01") {
    // exclusion_violation — пересечение окон (ТЗ §27: БД защищает)
    return new CapacityReservationError(
      "OVERLAP",
      "Окно пересекается с существующим резервом (защита на уровне БД)"
    );
  }
  if (e?.code === "23505" && e?.constraint === "uq_capacity_reservations_order_active") {
    return new CapacityReservationError("ORDER_ALREADY_RESERVED");
  }
  return new CapacityReservationError("DB_ERROR", e?.message ?? String(err));
}

/**
 * Зарезервировать окно производства.
 * Атомарно: INSERT с EXCLUDE-констрейнтом — гонки решает БД.
 */
export async function reserveCapacityWindow(input: {
  orderId: string;
  confectionerId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  estimatedMinutes: number;
  createdBy: string | null;
}): Promise<CapacityReservation> {
  const pool = getPool();
  try {
    const res = await pool.query<{
      id: string;
      order_id: string;
      confectioner_id: string;
      reserved_date: string;
      start_minute: number;
      end_minute: number;
      estimated_minutes: number;
      status: string;
    }>(
      `INSERT INTO public.capacity_reservations
         (order_id, confectioner_id, reserved_date, start_minute, end_minute,
          estimated_minutes, status, created_by)
       VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, 'reserved', $7::uuid)
       RETURNING id::text, order_id::text, confectioner_id::text,
                 to_char(reserved_date,'YYYY-MM-DD') AS reserved_date,
                 start_minute, end_minute, estimated_minutes, status`,
      [
        input.orderId,
        input.confectionerId,
        input.date,
        input.startMinute,
        input.endMinute,
        input.estimatedMinutes,
        input.createdBy,
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      orderId: r.order_id,
      confectionerId: r.confectioner_id,
      reservedDate: r.reserved_date,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
      estimatedMinutes: r.estimated_minutes,
      status: r.status,
    };
  } catch (err) {
    throw mapPgError(err);
  }
}

/** Освободить активный резерв заказа (idempotent). */
export async function releaseOrderReservation(
  orderId: string,
  releasedBy: string | null,
  status: "released" | "cancelled" = "released"
): Promise<number> {
  const pool = getPool();
  const res = await pool.query(
    `UPDATE public.capacity_reservations
     SET status = $3, released_at = now(), released_by = $2::uuid
     WHERE order_id = $1::uuid AND status IN ('reserved','confirmed')`,
    [orderId, releasedBy, status]
  );
  return res.rowCount ?? 0;
}

/** Получить активный резерв заказа. */
export async function getActiveReservation(
  orderId: string
): Promise<CapacityReservation | null> {
  const pool = getPool();
  const res = await pool.query<{
    id: string;
    order_id: string;
    confectioner_id: string;
    reserved_date: string;
    start_minute: number;
    end_minute: number;
    estimated_minutes: number;
    status: string;
  }>(
    `SELECT id::text, order_id::text, confectioner_id::text,
            to_char(reserved_date,'YYYY-MM-DD') AS reserved_date,
            start_minute, end_minute, estimated_minutes, status
     FROM public.capacity_reservations
     WHERE order_id = $1::uuid AND status IN ('reserved','confirmed')
     LIMIT 1`,
    [orderId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    orderId: r.order_id,
    confectionerId: r.confectioner_id,
    reservedDate: r.reserved_date,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    estimatedMinutes: r.estimated_minutes,
    status: r.status,
  };
}
