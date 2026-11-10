/**
 * event-store.ts — централизованная надёжная запись диагностических
 * событий и агрегация инцидентов (DEPLOY-01 §3.3, §4).
 *
 * Надёжность (§3.3):
 *   • fire-and-forget: сбой диагностики НИКОГДА не роняет вызвавший код;
 *   • неблокирующая ограниченная очередь (drop-oldest при переполнении —
 *     защита от бесконечного накопления);
 *   • защита от рекурсивной регистрации ошибок логирования (recursion
 *     guard: внутренняя ошибка записи не генерирует новое событие);
 *   • per-fingerprint rate limit: всплеск одной ошибки НЕ засоряет
 *     таблицу (ограничение числа записей в окне; агрегация в инцидент
 *     продолжается через occurrence_count);
 *   • контроль доступности канала: таймаут записи, circuit-breaker
 *     (после N подряд сбоев канал временно отключается и события
 *     консоль-логируются локально).
 *
 * Персональные данные: вход маскируется masking.scrub ДО записи; stack
 * — только маскированный серверный стек.
 */

import { computeFingerprint } from "./fingerprint";
import { maskStackTrace, maskString, safeJsonStringify, scrub } from "./masking";

/**
 * getPoolAsync — динамический импорт pg-пула (однократно, с кэшем).
 *
 * ВАЖНО (debundle): event-store импортируется capture.ts, который тянется
 * в КЛИЕНТСКИЙ бандл (error.tsx/global-error.tsx). Статический import pg
 * ломает браузерную сборку (node:dns). Очередь синхронна, реальная запись
 * — только в flush()/upsertIncident, которые выполняются в nodejs-рантайме.
 */
type PgPool = ReturnType<typeof import("@/lib/postgrest/pool").getPool>;
type PgPoolModule = { getPool: () => PgPool };

let poolModulePromise: Promise<PgPoolModule> | null = null;

async function getPoolAsync(): Promise<PgPool> {
  if (!poolModulePromise) {
    poolModulePromise = import("@/lib/postgrest/pool") as Promise<PgPoolModule>;
  }
  const mod = await poolModulePromise;
  return mod.getPool();
}

/** Тест-хук: сброс кэша динамического импорта (только vitest). */
export function __resetPoolCacheForTests(): void {
  poolModulePromise = null;
}

export type Severity = "debug" | "info" | "warning" | "error" | "critical";
export type DiagnosticSource = "server" | "client" | "cron" | "chat" | "n8n";

export const DIAGNOSTIC_COMPONENTS = [
  "frontend",
  "api",
  "database",
  "auth",
  "orders",
  "payments",
  "chat",
  "inventory",
  "recipes",
  "infrastructure",
  "diagnostics-selftest",
] as const;
export type DiagnosticComponent = (typeof DIAGNOSTIC_COMPONENTS)[number] | string;

export interface DiagnosticEventInput {
  component: DiagnosticComponent;
  severity?: Severity;
  errorCode?: string | null;
  message: string;
  route?: string | null;
  httpStatus?: number | null;
  stackTrace?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  /** Источник события; по умолчанию server. */
  source?: DiagnosticSource;
  /** auth.users.id, если идентифицирован (только id, не PII). */
  actorId?: string | null;
  /** Технические метаданные (будут маскированы). */
  metadata?: Record<string, unknown>;
  /** Переопределить environment (staging/production/development). */
  environment?: string;
  appVersion?: string;
}

export interface StoredEvent {
  eventId: string;
  fingerprint: string;
}

// ===== Ограниченная неблокирующая очередь (§3.3) =====

const QUEUE_MAX = 500;
const FLUSH_INTERVAL_MS = 300;
const WRITE_TIMEOUT_MS = 3000;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;
/** Максимум записей одного fingerprint за окно (всплеск не засоряет БД). */
const PER_FINGERPRINT_LIMIT = 20;
const PER_FINGERPRINT_WINDOW_MS = 60_000;
/**
 * Анти-шторм уведомлений (§4.1): повторная телеграмма по тому же инциденту
 * не чаще одного раза за окно (occurrence_count при этом продолжит расти).
 */
const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

interface QueuedEvent {
  row: EventRow;
  fingerprint: string;
  enqueuedAt: number;
}

interface EventRow {
  eventId: string;
  occurredAt: Date;
  environment: string;
  appVersion: string;
  service: string;
  component: string;
  severity: Severity;
  errorCode: string | null;
  message: string;
  correlationId: string | null;
  requestId: string | null;
  route: string | null;
  httpStatus: number | null;
  stackTrace: string | null;
  fingerprint: string;
  source: DiagnosticSource;
  actorId: string | null;
  metadataJson: string;
}

const queue: QueuedEvent[] = [];
/** fingerprint → timestamps записей в текущем окне. */
const fingerprintWindow = new Map<string, number[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
// Circuit-breaker
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
/** Рекурсия-гвард: true, пока идёт обработка внутреннего сбоя записи. */
let inInternalErrorHandling = false;

export interface StoreStats {
  queueLength: number;
  circuitOpen: boolean;
  consecutiveFailures: number;
  totalDropped: number;
}

/** Метрики канала (для /api/admin/diagnostics и тестов). */
const stats = { totalDropped: 0 };

export function getStoreStats(): StoreStats {
  return {
    queueLength: queue.length,
    circuitOpen: Date.now() < circuitOpenUntil,
    consecutiveFailures,
    totalDropped: stats.totalDropped,
  };
}

/** Тест-хук: сброс внутреннего состояния (используется ТОЛЬКО в vitest). */
export function __resetStoreForTests(): void {
  queue.length = 0;
  fingerprintWindow.clear();
  flushTimer = null;
  writing = false;
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  stats.totalDropped = 0;
  inInternalErrorHandling = false;
}

function resolveEnvironment(): string {
  if (process.env.DIAGNOSTICS_ENV) return process.env.DIAGNOSTICS_ENV;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function resolveAppVersion(): string {
  return process.env.APP_VERSION || "2.0.0-dev";
}

/**
 * Rate-limit per fingerprint: возвращает true, если запись разрешена.
 * Агрегация повыше окна в инцидент идёт отдельным upsert (occurrence_count),
 * поэтому дроп_raw-события не теряет факт ошибки.
 */
function allowPerFingerprint(fingerprint: string): boolean {
  const now = Date.now();
  const arr = (fingerprintWindow.get(fingerprint) || []).filter(
    (t) => now - t < PER_FINGERPRINT_WINDOW_MS
  );
  if (arr.length >= PER_FINGERPRINT_LIMIT) {
    fingerprintWindow.set(fingerprint, arr);
    return false;
  }
  arr.push(now);
  fingerprintWindow.set(fingerprint, arr);
  return true;
}

/** Публичная точка входа: зарегистрировать ошибку (fire-and-forget). */
export function storeErrorEvent(input: DiagnosticEventInput): StoredEvent {
  try {
    const severity = (input.severity || "error") as Severity;
    const message = maskString(input.message || "unknown error");
    const fingerprint = computeFingerprint({
      component: input.component || "api",
      errorCode: input.errorCode,
      message: input.message || "",
      route: input.route,
    });

    const row: EventRow = {
      eventId: crypto.randomUUID(),
      occurredAt: new Date(),
      environment: input.environment || resolveEnvironment(),
      appVersion: input.appVersion || resolveAppVersion(),
      service: "conditera-web",
      component: input.component || "api",
      severity,
      errorCode: input.errorCode ? maskString(input.errorCode, 128) : null,
      message,
      correlationId: input.correlationId ? maskString(input.correlationId, 128) : null,
      requestId: input.requestId ? maskString(input.requestId, 128) : null,
      route: input.route ? maskString(input.route, 256) : null,
      httpStatus: input.httpStatus ?? null,
      // stack — ТОЛЬКО серверные (source!=="client") и только маскированный
      stackTrace:
        input.source === "client" ? null : maskStackTrace(input.stackTrace),
      fingerprint,
      source: input.source || "server",
      actorId: input.actorId || null,
      metadataJson: safeJsonStringify(input.metadata),
    };

    // Raw-запись ограничена per-fingerprint; инцидент-агрегация — на КАЖДОЕ
    // событие (occurrence_count учитывает и rate-limited повторы).
    if (allowPerFingerprint(fingerprint)) {
      // Ограниченная очередь: drop-oldest
      if (queue.length >= QUEUE_MAX) {
        queue.shift();
        stats.totalDropped += 1;
      }
      queue.push({ row, fingerprint, enqueuedAt: Date.now() });
      scheduleFlush();
    }
    // Инцидент-агрегация — сразу (не через очередь), но тоже fire-and-forget
    void upsertIncident(row);
    return { eventId: row.eventId, fingerprint };
  } catch {
    // Рекурсия-гвард: сбой в самом storeErrorEvent наружу не бросается
    return { eventId: "(store-failed)", fingerprint: "" };
  }
}

function scheduleFlush(): void {
  if (flushTimer || writing) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Не держать процесс из-за таймера
  if (typeof flushTimer === "object" && "unref" in flushTimer) {
    (flushTimer as { unref: () => void }).unref();
  }
}

async function flush(): Promise<void> {
  if (writing || queue.length === 0) return;
  if (Date.now() < circuitOpenUntil) return; // канал временно закрыт
  writing = true;
  const batch = queue.splice(0, queue.length);
  try {
    const pool = await getPoolAsync();
    await withTimeout(insertRows(pool, batch), WRITE_TIMEOUT_MS);
    consecutiveFailures = 0;
  } catch (err) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      consecutiveFailures = 0;
    }
    handleInternalFailure(batch, err);
  } finally {
    writing = false;
    // Если в очередь успело прийти новое — продолжим
    if (queue.length > 0 && Date.now() >= circuitOpenUntil) scheduleFlush();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("diagnostics write timeout")), ms)
    ),
  ]);
}

async function insertRows(
  pool: Awaited<ReturnType<typeof getPoolAsync>>,
  batch: QueuedEvent[]
): Promise<void> {
  for (const { row } of batch) {
    await pool.query(
      `INSERT INTO public.app_error_events
         (event_id, occurred_at, environment, app_version, service, component,
          severity, error_code, message, correlation_id, request_id, route,
          http_status, stack_trace, fingerprint, source, actor_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
      [
        row.eventId,
        row.occurredAt,
        row.environment,
        row.appVersion,
        row.service,
        row.component,
        row.severity,
        row.errorCode,
        row.message,
        row.correlationId,
        row.requestId,
        row.route,
        row.httpStatus,
        row.stackTrace,
        row.fingerprint,
        row.source,
        row.actorId,
        row.metadataJson,
      ]
    );
  }
}

/**
 * Внутренний сбой регистрации: локальный console-fallback (§3.3).
 * Рекурсия-гвард не даёт обработчику сбоев создать новое событие.
 */
function handleInternalFailure(batch: QueuedEvent[], err: unknown): void {
  if (inInternalErrorHandling) return;
  inInternalErrorHandling = true;
  try {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[diagnostics] flush failed (${batch.length} events dropped, kept in incidents aggregation): ${msg}`
    );
  } finally {
    inInternalErrorHandling = false;
  }
}

// ===== Инцидентная агрегация (§4) =====

/** Приоритеты §4.1: автоматическая классификация — подсказка, не истина. */
export function classifyPriority(component: string, severity: Severity): "P0" | "P1" | "P2" | "P3" {
  if (severity === "critical") {
    // Деньги/платежи/изоляция/доступность — P0
    if (component === "payments" || component === "database" || component === "infrastructure")
      return "P0";
    return "P1";
  }
  if (severity === "error") {
    if (component === "payments" || component === "auth" || component === "orders") return "P1";
    return "P2";
  }
  if (severity === "warning") return "P2";
  return "P3";
}

/**
 * Upsert инцидента по fingerprint: occurrence_count++, last_seen/last_version.
 * Вызывается на КАЖДОЕ событие (вкл. rate-limited дропы — важнее агрегация).
 * Рецидив после CLOSED/VERIFIED → статус REOPENED (§4).
 * Полностью fire-and-forget.
 */
export async function upsertIncident(row: EventRow): Promise<void> {
  try {
    const pool = await getPoolAsync();
    const priority = classifyPriority(row.component, row.severity);
    const title = row.errorCode
      ? `${row.errorCode}: ${row.message.slice(0, 120)}`
      : row.message.slice(0, 160);

    await pool.query(
      `INSERT INTO public.app_incidents
         (fingerprint, title, component, priority, severity, error_code,
          last_route, occurrence_count, first_seen_at, last_seen_at,
          first_version, last_version, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,$9,'NEW')
       ON CONFLICT (fingerprint) DO UPDATE SET
         occurrence_count = app_incidents.occurrence_count + 1,
         last_seen_at = EXCLUDED.last_seen_at,
         last_version = EXCLUDED.last_version,
         last_route = EXCLUDED.last_route,
         -- рецидив после закрытия/верификации → REOPENED
         status = CASE
           WHEN app_incidents.status IN ('CLOSED','VERIFIED') THEN 'REOPENED'
           ELSE app_incidents.status END,
         updated_at = now()`,
      [
        row.fingerprint,
        title,
        row.component,
        priority,
        row.severity,
        row.errorCode,
        row.route,
        row.occurredAt,
        row.appVersion,
      ]
    );

    if (priority === "P0" || priority === "P1") {
      void notifyCriticalIncidentDeduped(row, priority);
    }
  } catch {
    // даже агрегация не должна ронять основной поток;
    // handleInternalFailure здесь не вызываем — консоль-троттлинг не нужен
  }
}

/** Троттлинг console.warn о ненастроенном канале (не чаще раза в минуту). */
let lastChannelWarnAt = 0;

/**
 * Уведомление P0/P1 с дедупликацией через app_incidents.notified_at
 * (0079). Сначала ОТПРАВКА, потом отметка notified_at — отказ канала
 * НЕ съедает уведомление (at-least-once важнее at-most-once: пропущенный
 * P0 дороже повторной телеграммы). Повторные события инцидента в окне
 * NOTIFICATION_COOLDOWN_MS молча агрегируются в occurrence_count.
 */
async function notifyCriticalIncidentDeduped(
  row: EventRow,
  priority: "P0" | "P1"
): Promise<void> {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHANNEL_ID) {
      // Честный warn (§4.1), но не чаще раза в минуту на процесс
      if (Date.now() - lastChannelWarnAt > 60_000) {
        lastChannelWarnAt = Date.now();
        console.warn(
          `[diagnostics] ${priority} incident (component=${row.component}, ` +
            `code=${row.errorCode ?? "n/a"}) — notification channel NOT configured ` +
            `(TELEGRAM_BOT_TOKEN/TELEGRAM_CHANNEL_ID missing). No notification sent.`
        );
      }
      return;
    }

    const pool = await getPoolAsync();
    // Claim: атомарно занимаем окно уведомления (защита от гонок воркеров)
    const claim = await pool.query(
      `UPDATE public.app_incidents SET notified_at = now()
       WHERE fingerprint = $1
         AND (notified_at IS NULL OR notified_at < now() - ($2 || ' milliseconds')::interval)
       RETURNING notified_at`,
      [row.fingerprint, String(NOTIFICATION_COOLDOWN_MS)]
    );
    if (!claim.rows.length) return; // недавно уже уведомляли

    try {
      await notifyCriticalIncident(row, priority);
    } catch (sendErr) {
      // at-least-once: сбой отправки ВОЗВРАЩАЕТ окно — следующий повтор
      // инцидента попробует снова (пропущенный P0 дороже повторной телеграммы)
      await pool
        .query(
          `UPDATE public.app_incidents SET notified_at = NULL WHERE fingerprint = $1`,
          [row.fingerprint]
        )
        .catch(() => undefined);
      console.warn(
        "[diagnostics] notification send failed (notification window reopened):",
        sendErr instanceof Error ? sendErr.message : sendErr
      );
    }
  } catch {
    // Даже дедупликация не должна ронять поток агрегации (§3.3)
  }
}

/**
 * Отправка через существующий Telegram-канал (notifyChannel).
 * БРОСАЕТ при сбое канала — окно notified_at возвращает вызвавший код
 * (at-least-once, см. notifyCriticalIncidentDeduped). Проверка
 * «канал не настроен» — в дедуп-обёртке, здесь только доставка.
 */
async function notifyCriticalIncident(row: EventRow, priority: "P0" | "P1"): Promise<void> {
  const { notifyChannel } = await import("@/lib/telegram-bot");
  await notifyChannel({
    type: "error",
    title: `🚨 [${priority}] ${row.component}`,
    body:
      `${row.message.slice(0, 160)}\n` +
      `route: ${row.route ?? "n/a"} | env: ${row.environment} | ver: ${row.appVersion}`,
  });
}

/**
 * Синхронно дождаться опустошения очереди (используется тестами и
 * graceful-финализацией; в рантайме НЕ вызывается на горячем пути).
 */
export async function flushQueueForTests(): Promise<void> {
  // Защита от race: пишем до трёх циклов
  for (let i = 0; i < 3; i++) {
    if (queue.length === 0 && !writing) return;
     
    await new Promise((r) => setTimeout(r, FLUSH_INTERVAL_MS + 50));
    if (Date.now() >= circuitOpenUntil) await flush();
  }
}

// Реэкспорт scrub для API-роутов (единая точка импорта)
export { scrub };
