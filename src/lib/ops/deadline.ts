/**
 * deadline.ts — Deadline Engine P0.5 (ТЗ §10, §11).
 *
 * Чистые функции (без БД) — покрываются unit-тестами.
 *
 * Формула ТЗ §11:
 *   customer deadline
 *   − delivery buffer − handoff buffer − packaging − quality check
 *   − production time
 *   = latest safe production start
 */

import {
  DEFAULT_DELIVERY_DEADLINE_MINUTE,
  DEFAULT_DEADLINE_BUFFERS,
  type DeadlineBuffers,
} from "./lifecycle-config";

// ---------------------------------------------------------------------------
// Парсинг дедлайна из заказа
// ---------------------------------------------------------------------------

/**
 * Разобрать дедлайн клиента из полей заказа.
 *
 * Приоритет времени:
 *   1. delivery_time_window формата 'HH:MM-HH:MM' → конец окна;
 *   2. delivery_time (свободный текст) → первое вхождение 'HH:MM';
 *   3. default (конфиг, 18:00).
 *
 * Возвращает null, если дата доставки отсутствует.
 * minutesOfDay может выходить за 1440 для '24:00' — нормализуется вызывающим.
 */
export function parseDeadlineMinuteOfDay(
  deliveryTimeWindow: string | null | undefined,
  deliveryTime: string | null | undefined
): number | null {
  const windowEnd = parseWindowEnd(deliveryTimeWindow);
  if (windowEnd !== null) return windowEnd;

  const freeText = parseFirstTime(deliveryTime);
  if (freeText !== null) return freeText;

  return DEFAULT_DELIVERY_DEADLINE_MINUTE;
}

/** '10:00-14:00' → 840. Принимает разделители '-' или '–' или '—'. */
export function parseWindowEnd(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parts = raw.split(/[-–—]/);
  if (parts.length < 2) return null;
  const end = parseTimeToMinute(parts[parts.length - 1].trim());
  return end;
}

/** Первое вхождение 'HH:MM' в свободном тексте → минуты дня. */
export function parseFirstTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** '14:00' → 840; '9:30' → 570; мусор → null. */
export function parseTimeToMinute(raw: string): number | null {
  const m = raw.match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Минуты дня → 'HH:MM' (нормализует 1440+ / отрицательные по модулю суток). */
export function minuteToHHMM(minute: number): string {
  const norm = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Deadline заказа как Date.
 * deliveryDate — 'YYYY-MM-DD'; если null → null (дедлайн неизвестен).
 * Если окно/время дают 24:00 (1440) — это конец суток этого дня.
 */
export function computeDeadlineAt(
  deliveryDate: string | null | undefined,
  deliveryTimeWindow: string | null | undefined,
  deliveryTime: string | null | undefined
): Date | null {
  if (!deliveryDate) return null;
  const minute = parseDeadlineMinuteOfDay(deliveryTimeWindow, deliveryTime);
  if (minute === null) return null;
  return dateAtMinute(deliveryDate, Math.min(minute, 1440));
}

/** Date в указанную минуту локального дня (дата 'YYYY-MM-DD'). */
export function dateAtMinute(dateStr: string, minuteOfDay: number): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, 0, 0, 0, 0 + minuteOfDay * 60_000);
}

// ---------------------------------------------------------------------------
// Latest safe production start (ТЗ §11)
// ---------------------------------------------------------------------------

export interface LatestSafeStartInput {
  /** Дедлайн клиента (готово к передаче клиенту/доставке). */
  deadlineAt: Date;
  /** Оценка времени производства (минуты). */
  productionMinutes: number;
  /** Буферы; по умолчанию — глобальный конфиг. */
  buffers?: Partial<DeadlineBuffers>;
}

export interface LatestSafeStartResult {
  latestSafeStartAt: Date;
  /** Суммарный backoff от дедлайна (буферы + производство), минуты. */
  totalBackoffMinutes: number;
  buffers: DeadlineBuffers;
}

/**
 * 18:00 − 30m − 15m − 20m − 15m − 3h = 13:55 (пример ТЗ §11).
 */
export function computeLatestSafeStart(
  input: LatestSafeStartInput
): LatestSafeStartResult {
  const buffers: DeadlineBuffers = {
    ...DEFAULT_DEADLINE_BUFFERS,
    ...(input.buffers ?? {}),
  };
  const totalBackoff =
    buffers.deliveryBufferMinutes +
    buffers.handoffBufferMinutes +
    buffers.packagingMinutes +
    buffers.qualityCheckMinutes +
    Math.max(0, input.productionMinutes);

  const latestSafeStartAt = new Date(
    input.deadlineAt.getTime() - totalBackoff * 60_000
  );

  return { latestSafeStartAt, totalBackoffMinutes: totalBackoff, buffers };
}

// ---------------------------------------------------------------------------
// Запас времени (для Risk Engine)
// ---------------------------------------------------------------------------

/**
 * Запас (минуты) между «сейчас» и latest safe start.
 * Положительный — есть запас; отрицательный — план уже нарушен.
 */
export function marginMinutes(
  latestSafeStartAt: Date,
  now: Date = new Date()
): number {
  return Math.round((latestSafeStartAt.getTime() - now.getTime()) / 60_000);
}

/** Человекочитаемая длительность: 150 → '2ч 30м'. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}м`;
  if (m === 0) return `${sign}${h}ч`;
  return `${sign}${h}ч ${m}м`;
}
