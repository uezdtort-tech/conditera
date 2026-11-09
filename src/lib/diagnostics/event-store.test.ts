/**
 * Тесты event-store.ts — надёжность регистрации (DEPLOY-01 §3.3):
 * fire-and-forget, ограниченная очередь, per-fingerprint rate limit,
 * circuit-breaker, инцидент-агрегация (occurrence_count, REOPENED).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  storeErrorEvent,
  flushQueueForTests,
  __resetStoreForTests,
  getStoreStats,
  classifyPriority,
} from "./event-store";

beforeEach(() => {
  __resetStoreForTests();
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
});

describe("storeErrorEvent — базовая запись", () => {
  it("возвращает eventId и fingerprint, не бросает", async () => {
    const stored = storeErrorEvent({
      component: "api",
      message: "boom",
      route: "/api/test",
    });
    expect(stored.eventId).toBeTruthy();
    expect(stored.fingerprint).toHaveLength(40);
    await flushQueueForTests();
    expect(queryMock).toHaveBeenCalled();
    // Первый вызов — INSERT события, второй — upsert инцидента
    const insertCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("app_error_events")
    );
    expect(insertCall).toBeTruthy();
  });

  it("маскирует секреты ДО записи (не сохраняет токен в message)", async () => {
    storeErrorEvent({
      component: "auth",
      message: "login failed with Bearer supersecrettokenvalue123456",
    });
    await flushQueueForTests();
    const insertCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("app_error_events")
    );
    const messageParam = insertCall?.[1]?.[8];
    expect(String(messageParam)).not.toContain("supersecrettokenvalue123456");
  });

  it("клиентский стек НЕ сохраняется (source=client)", async () => {
    storeErrorEvent({
      component: "frontend",
      source: "client",
      message: "render error",
      stackTrace: "Error: render error\n at Component (x.tsx:1)",
    });
    await flushQueueForTests();
    const insertCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("app_error_events")
    );
    const stackParam = insertCall?.[1]?.[13];
    expect(stackParam).toBeNull();
  });

  it("серверный стек сохраняется маскированным", async () => {
    storeErrorEvent({
      component: "api",
      message: "db failure",
      stackTrace: "Error: db failure\n  at pg query: postgresql://user:pass123@host/db",
    });
    await flushQueueForTests();
    const insertCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("app_error_events")
    );
    const stackParam = String(insertCall?.[1]?.[13] ?? "");
    expect(stackParam).toContain("at pg query");
    expect(stackParam).not.toContain("pass123");
  });
});

describe("per-fingerprint rate limit — всплеск одной ошибки", () => {
  it("одна и та же ошибка повторно — raw-записи ограничены, fingerprint одинаков", async () => {
    const fps: string[] = [];
    for (let i = 0; i < 30; i++) {
      const s = storeErrorEvent({
        component: "payments",
        // Номер платежа ≥4 цифр → нормализуется в <num> → один fingerprint
        message: `webhook timeout for payment ${900000 + i}`,
        route: "/api/payment/webhook",
      });
      fps.push(s.fingerprint);
    }
    // Один fingerprint
    expect(new Set(fps).size).toBe(1);
    await flushQueueForTests();
    // raw-INSERT'ов ≤ 20 (PER_FINGERPRINT_LIMIT)
    const inserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes("app_error_events")
    );
    expect(inserts.length).toBeLessThanOrEqual(20);
    // инцидент-upsert идёт на КАЖДОЕ событие (агрегация occurrence_count)
    const incidentUpserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes("app_incidents")
    );
    expect(incidentUpserts.length).toBe(30);
  });

  it("разные ошибки — независимые rate-limits", async () => {
    for (let i = 0; i < 5; i++) {
      storeErrorEvent({ component: "api", message: `unique error variant ${i}` });
    }
    await flushQueueForTests();
    const inserts = queryMock.mock.calls.filter((c) =>
      String(c[0]).includes("app_error_events")
    );
    expect(inserts.length).toBe(5);
  });
});

describe("надёжность канала (§3.3)", () => {
  it("сбой записи НЕ роняет storeErrorEvent и помечается circuit-breaker'ом", async () => {
    queryMock.mockRejectedValue(new Error("db down"));
    const stored = storeErrorEvent({ component: "api", message: "test failure" });
    expect(stored.eventId).toBeTruthy();
    // flush не бросает
    await expect(flushQueueForTests()).resolves.toBeUndefined();
    const stats = getStoreStats();
    expect(stats.consecutiveFailures).toBeGreaterThan(0);
  });

  it("ограниченная очередь: переполнение не накапливает бесконечно", () => {
    for (let i = 0; i < 600; i++) {
      storeErrorEvent({ component: "api", message: `unique burst error number ${i} seq ${Math.random()}` });
    }
    const stats = getStoreStats();
    expect(stats.queueLength).toBeLessThanOrEqual(500);
    expect(stats.totalDropped).toBeGreaterThan(0);
  });

  it("internal failure не генерирует рекурсивных событий", async () => {
    queryMock.mockRejectedValue(new Error("boom"));
    storeErrorEvent({ component: "api", message: "outer" });
    await flushQueueForTests();
    // Все вызовы — только исходные INSERT/upsert, без повторных попыток логирования
    expect(queryMock.mock.calls.length).toBeLessThan(10);
  });
});

describe("classifyPriority — автоматическая классификация (§4.1)", () => {
  it("critical payments → P0", () => {
    expect(classifyPriority("payments", "critical")).toBe("P0");
  });
  it("critical database → P0", () => {
    expect(classifyPriority("database", "critical")).toBe("P0");
  });
  it("critical frontend → P1", () => {
    expect(classifyPriority("frontend", "critical")).toBe("P1");
  });
  it("error payments/auth/orders → P1", () => {
    expect(classifyPriority("payments", "error")).toBe("P1");
    expect(classifyPriority("auth", "error")).toBe("P1");
    expect(classifyPriority("orders", "error")).toBe("P1");
  });
  it("error прочих → P2, warning → P2, info/debug → P3", () => {
    expect(classifyPriority("api", "error")).toBe("P2");
    expect(classifyPriority("api", "warning")).toBe("P2");
    expect(classifyPriority("api", "info")).toBe("P3");
    expect(classifyPriority("api", "debug")).toBe("P3");
  });
});

describe("инцидент-агрегация (§4)", () => {
  it("upsert инкрементирует occurrence_count и REOPEN'ит закрытый инцидент", async () => {
    storeErrorEvent({ component: "orders", message: "order create failed" });
    await flushQueueForTests();
    const upsert = queryMock.mock.calls.find((c) => String(c[0]).includes("app_incidents"));
    expect(upsert).toBeTruthy();
    expect(String(upsert?.[0])).toContain("occurrence_count = app_incidents.occurrence_count + 1");
    expect(String(upsert?.[0])).toContain("'REOPENED'");
  });

  it("сбой агрегации не влияет на запись события", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes("app_incidents")) {
        throw new Error("incident upsert failed");
      }
      return Promise.resolve({ rows: [] });
    });
    const stored = storeErrorEvent({ component: "api", message: "isolated failure" });
    expect(stored.eventId).toBeTruthy();
    await flushQueueForTests();
    const insert = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("app_error_events")
    );
    expect(insert).toBeTruthy();
  });
});
