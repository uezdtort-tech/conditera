/**
 * Тесты metrics.ts — процессные/системные метрики (DEPLOY-01 §5):
 * форма снапшота, fail-open при недоступной БД, честные limitations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock("./incidents", () => ({
  getIncidentSummary: () => incidentSummaryMock(),
}));

const incidentSummaryMock = vi.fn();

import {
  collectProcessAndSystemMetrics,
  collectMetricsSnapshot,
  collectEventsWindow,
} from "./metrics";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ total: 0, critical: 0, error: 0, warning: 0, http_5xx: 0 }] });
  incidentSummaryMock.mockReset();
  incidentSummaryMock.mockResolvedValue({
    byStatus: { NEW: 1 },
    byPriority: { P2: 1 },
    openTotal: 1,
    last24h: 0,
  });
});

describe("collectProcessAndSystemMetrics", () => {
  it("возвращает процессные метрики без обращения к БД", () => {
    const m = collectProcessAndSystemMetrics();
    expect(m.process.pid).toBe(process.pid);
    expect(m.process.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(m.process.memory.rssBytes).toBeGreaterThan(0);
    expect(m.process.cpu.load1).toBeGreaterThanOrEqual(0);
    expect(m.system.totalMemBytes).toBeGreaterThan(0);
    expect(m.system.cpuCount).toBeGreaterThan(0);
    expect(m.disk.path.length).toBeGreaterThan(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("disk может быть null-метрикой (statfs недоступен) — форма стабильна", () => {
    const m = collectProcessAndSystemMetrics();
    // В CI/локально statfs обычно доступен; важно что поля определены
    expect(m.disk).toHaveProperty("totalBytes");
    expect(m.disk).toHaveProperty("freeBytes");
  });
});

describe("collectEventsWindow", () => {
  it("агрегирует severity/5xx из app_error_events", async () => {
    queryMock.mockResolvedValue({
      rows: [{ total: 10, critical: 2, error: 5, warning: 3, http_5xx: 7 }],
    });
    const w = await collectEventsWindow(1, { query: queryMock } as never);
    expect(w.total).toBe(10);
    expect(w.critical).toBe(2);
    expect(w.http5xx).toBe(7);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("app_error_events");
    expect(sql).toContain("http_status >= 500");
  });

  it("fail-open: при ошибке БД возвращает нулевое окно (не бросает)", async () => {
    queryMock.mockRejectedValue(new Error("db down"));
    const w = await collectEventsWindow(24, { query: queryMock } as never);
    expect(w.total).toBe(0);
    expect(w.http5xx).toBe(0);
  });
});

describe("collectMetricsSnapshot", () => {
  it("полный снапшот с limitations (честность §18)", async () => {
    const snap = await collectMetricsSnapshot();
    expect(snap.process.pid).toBe(process.pid);
    expect(snap.eventStore).toHaveProperty("queueLength");
    expect(snap.events.last24h).toHaveProperty("http5xx");
    expect(snap.incidents.byStatus).toEqual({ NEW: 1 });
    expect(snap.limitations.requestRate).toContain("not collected");
    expect(snap.limitations.latencyPercentiles).toContain("not collected");
    expect(snap.generatedAt).toBeTruthy();
  });

  it("fail-open: сбой БД не ломает процессные метрики", async () => {
    queryMock.mockRejectedValue(new Error("db down"));
    incidentSummaryMock.mockRejectedValue(new Error("db down"));
    const snap = await collectMetricsSnapshot();
    expect(snap.process.memory.rssBytes).toBeGreaterThan(0);
    expect(snap.events.last1h.total).toBe(0);
  });
});
