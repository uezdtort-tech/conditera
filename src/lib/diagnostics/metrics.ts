/**
 * metrics.ts — сбор диагностических метрик для /api/admin/diagnostics/metrics
 * (DEPLOY-01 §5: наблюдаемость без тяжёлых систем).
 *
 * Состав:
 *   • процесс: RSS/heap, uptime, PID;
 *   • система: load average, total/free memory (os);
 *   • диск: free/total по cwd (fs.statfs, если доступен);
 *   • канал диагностики: длина очереди, circuit-breaker, дропы (getStoreStats);
 *   • события: агрегат app_error_events за 1ч/24ч (severity, http_5xx);
 *   • инциденты: сводка getIncidentSummary().
 *
 * ЧЕСТНОСТЬ (§18): это НЕ APM. Полный RPS и p95-латентность запросов
 * без перехвата всего трафика не собираются — в ответе поле
 * limitations фиксирует это явно, чтобы метрика не выдавалась за то,
 * чем не является.
 */

import os from "node:os";
import fs from "node:fs";
import { getPool } from "@/lib/postgrest/pool";
import { getStoreStats, type StoreStats } from "./event-store";
import { getIncidentSummary, type IncidentSummary } from "./incidents";

export interface ProcessMetrics {
  pid: number;
  uptimeSec: number;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  cpu: { load1: number; load5: number; load15: number };
}

export interface SystemMetrics {
  platform: string;
  totalMemBytes: number;
  freeMemBytes: number;
  cpuCount: number;
}

export interface DiskMetrics {
  path: string;
  totalBytes: number | null;
  freeBytes: number | null;
}

export interface EventsWindow {
  total: number;
  critical: number;
  error: number;
  warning: number;
  http5xx: number;
}

export interface MetricsSnapshot {
  process: ProcessMetrics;
  system: SystemMetrics;
  disk: DiskMetrics;
  eventStore: StoreStats;
  events: { last1h: EventsWindow; last24h: EventsWindow };
  incidents: IncidentSummary;
  generatedAt: string;
  limitations: {
    requestRate: string;
    latencyPercentiles: string;
  };
}

/** Системные/процессные метрики без обращения к БД (чистая, тестируемая). */
export function collectProcessAndSystemMetrics(): {
  process: ProcessMetrics;
  system: SystemMetrics;
  disk: DiskMetrics;
} {
  const mem = process.memoryUsage();
  const loads = os.loadavg();

  const proc: ProcessMetrics = {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      arrayBuffersBytes: mem.arrayBuffers ?? 0,
    },
    cpu: {
      load1: loads[0],
      load5: loads[1],
      load15: loads[2],
    },
  };

  const system: SystemMetrics = {
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    cpuCount: os.cpus().length,
  };

  // fs.statfs появился в Node 18.15+/20; в отдельных рантаймах может
  // отсутствовать — тогда disk доступен как null, это честный ответ.
  let disk: DiskMetrics = { path: process.cwd(), totalBytes: null, freeBytes: null };
  const statfs = (fs as unknown as { statfs?: (p: string, cb: (err: NodeJS.ErrnoException | null, stats: { blocks: number; bsize: number; bavail: number }) => void) => void }).statfs;
  if (typeof statfs === "function") {
    try {
      const s = fs.statfsSync(/* turbopackIgnore: true */ process.cwd());
      const bsize = s.bsize;
      disk = {
        path: process.cwd(),
        totalBytes: s.blocks * bsize,
        freeBytes: s.bavail * bsize,
      };
    } catch {
      // statfs недоступен/запрещён — оставляем null
    }
  }

  return { process: proc, system, disk };
}

/** Пустое окно (для стабильной формы ответа). */
function emptyWindow(): EventsWindow {
  return { total: 0, critical: 0, error: 0, warning: 0, http5xx: 0 };
}

/**
 * Агрегат событий за окно. Полностью fail-open: при недоступности БД
 * возвращается нулевое окно — метрики не должны ломать админ-панель.
 */
export async function collectEventsWindow(
  hoursBack: number,
  pool: ReturnType<typeof getPool>
): Promise<EventsWindow> {
  try {
    const res = await pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE severity = 'critical')::int AS critical,
         count(*) FILTER (WHERE severity = 'error')::int AS error,
         count(*) FILTER (WHERE severity = 'warning')::int AS warning,
         count(*) FILTER (WHERE http_status >= 500)::int AS http_5xx
       FROM public.app_error_events
       WHERE occurred_at >= now() - ($1 || ' hours')::interval`,
      [String(hoursBack)]
    );
    const r = res.rows[0] ?? {};
    return {
      total: Number(r.total ?? 0),
      critical: Number(r.critical ?? 0),
      error: Number(r.error ?? 0),
      warning: Number(r.warning ?? 0),
      http5xx: Number(r.http_5xx ?? 0),
    };
  } catch {
    return emptyWindow();
  }
}

/**
 * Полный снимок метрик. БД-часть изолирована: сбой агрегата не ломает
 * процессные метрики (§3.3 — наблюдаемость не влияет на приложение).
 */
export async function collectMetricsSnapshot(): Promise<MetricsSnapshot> {
  const base = collectProcessAndSystemMetrics();
  const eventStore = getStoreStats();

  let incidents: IncidentSummary = {
    byStatus: {},
    byPriority: {},
    openTotal: 0,
    last24h: 0,
  };
  let last1h = emptyWindow();
  let last24h = emptyWindow();

  try {
    const pool = getPool();
    [incidents, last1h, last24h] = await Promise.all([
      getIncidentSummary().catch(() => incidents),
      collectEventsWindow(1, pool),
      collectEventsWindow(24, pool),
    ]);
  } catch {
    // fail-open: БД-метрики недоступны, процессные остаются честными
  }

  return {
    ...base,
    eventStore,
    events: { last1h, last24h },
    incidents,
    generatedAt: new Date().toISOString(),
    limitations: {
      requestRate:
        "not collected — full-traffic counters require middleware/edge aggregation; events only capture errors",
      latencyPercentiles:
        "not collected — p95 requires per-request timing (APM); see docs/operations/MONITORING.md",
    },
  };
}
