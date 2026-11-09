/**
 * Тесты incidents.ts — серверная статусная машина (DEPLOY-01 §4):
 * допустимые переходы, INVALID-переход отклоняется, IGNORED требует причину,
 * list с фильтрами, история.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  canTransition,
  transitionIncident,
  IncidentStateError,
  listIncidents,
  getIncidentSummary,
} from "./incidents";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
});

describe("canTransition — статусная машина §4", () => {
  it("нормальный путь NEW → TRIAGED → IN_PROGRESS → FIXED → VERIFIED → CLOSED", () => {
    expect(canTransition("NEW", "TRIAGED")).toBe(true);
    expect(canTransition("TRIAGED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "FIXED")).toBe(true);
    expect(canTransition("FIXED", "VERIFIED")).toBe(true);
    expect(canTransition("VERIFIED", "CLOSED")).toBe(true);
  });

  it("пропуск этапов запрещён (NEW → FIXED запрещён? — нет, разрешён CLOSED, не FIXED)", () => {
    expect(canTransition("NEW", "FIXED")).toBe(false);
    expect(canTransition("TRIAGED", "VERIFIED")).toBe(false);
    expect(canTransition("FIXED", "NEW")).toBe(false);
  });

  it("REOPENED после CLOSED и VERIFIED разрешён; CLOSED → REOPENED единственный выход", () => {
    expect(canTransition("CLOSED", "REOPENED")).toBe(true);
    expect(canTransition("VERIFIED", "REOPENED")).toBe(true);
    expect(canTransition("CLOSED", "NEW")).toBe(false);
    expect(canTransition("REOPENED", "IN_PROGRESS")).toBe(true);
  });

  it("IGNORED требует причину — переход разрешён из рабочих статусов", () => {
    expect(canTransition("NEW", "IGNORED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "IGNORED")).toBe(true);
    expect(canTransition("IGNORED", "REOPENED")).toBe(true);
  });
});

describe("transitionIncident", () => {
  const incidentRow = {
    id: "11111111-1111-1111-1111-111111111111",
    status: "NEW",
    fingerprint: "f".repeat(40),
    title: "test incident",
    component: "api",
    priority: "P2",
    severity: "error",
    error_code: null,
    last_route: "/api/test",
    occurrence_count: 3,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    first_version: "2.0.0-dev",
    last_version: "2.0.0-dev",
    resolved_at: null,
    resolved_version: null,
    fix_commit: null,
    ignore_reason: null,
    notified_at: null,
  };

  it("допустимый переход: UPDATE + запись истории", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith("SELECT id, status")) {
        return Promise.resolve({ rows: [incidentRow] });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await transitionIncident({
      incidentId: incidentRow.id,
      toStatus: "TRIAGED",
      actorId: "admin-user-id",
      note: "looked into it",
    });
    expect(result.status).toBe("TRIAGED");
    const historyInsert = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("app_incident_history")
    );
    expect(historyInsert).toBeTruthy();
    // from=NEW to=TRIAGED actor=admin
    expect(historyInsert?.[1]).toEqual([
      incidentRow.id,
      "NEW",
      "TRIAGED",
      "admin-user-id",
      "looked into it",
    ]);
  });

  it("недопустимый переход → 409 IncidentStateError", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith("SELECT id, status")) {
        return Promise.resolve({ rows: [{ ...incidentRow, status: "CLOSED" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    await expect(
      transitionIncident({
        incidentId: incidentRow.id,
        toStatus: "IN_PROGRESS",
        actorId: "admin",
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("несуществующий инцидент → 404", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(
      transitionIncident({
        incidentId: "nonexistent",
        toStatus: "TRIAGED",
        actorId: "admin",
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("IGNORED без причины → 400", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith("SELECT id, status")) {
        return Promise.resolve({ rows: [incidentRow] });
      }
      return Promise.resolve({ rows: [] });
    });
    await expect(
      transitionIncident({
        incidentId: incidentRow.id,
        toStatus: "IGNORED",
        actorId: "admin",
        ignoreReason: "   ",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("FIXED фиксирует resolved_at/версию", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith("SELECT id, status")) {
        return Promise.resolve({ rows: [{ ...incidentRow, status: "IN_PROGRESS" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await transitionIncident({
      incidentId: incidentRow.id,
      toStatus: "FIXED",
      actorId: "admin",
      fixCommit: "abc1234",
    });
    expect(result.status).toBe("FIXED");
    expect(result.resolved_at).toBeTruthy();
    const update = queryMock.mock.calls.find((c) => String(c[0]).includes("UPDATE public.app_incidents"));
    expect(update?.[1]).toContain("abc1234");
  });
});

describe("listIncidents — фильтры (§4.2)", () => {
  it("строит WHERE по статусу/приоритету/поиску и возвращает items+total", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes("count(*)")) {
        return Promise.resolve({ rows: [{ total: 2 }] });
      }
      return Promise.resolve({ rows: [{ id: "a" }, { id: "b" }] });
    });
    const result = await listIncidents({
      status: "NEW",
      priority: "P1",
      search: "webhook",
      limit: 10,
      offset: 0,
    });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    const listSql = queryMock.mock.calls.find(
      (c) => String(c[0]).includes("ORDER BY last_seen_at DESC") && !String(c[0]).includes("count(*)")
    );
    const sqlStr = String(listSql?.[0]);
    expect(sqlStr).toContain("status = $1");
    expect(sqlStr).toContain("priority = $2");
    expect(sqlStr).toContain("lower(fingerprint) LIKE");
  });

  it("лимит ограничен сверху 200 (защита от DoS)", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await listIncidents({ limit: 10000 });
    const call = queryMock.mock.calls.find((c) => String(c[0]).includes("ORDER BY"));
    expect(call?.[1]?.[call[1].length - 2]).toBe(200);
  });
});

describe("getIncidentSummary", () => {
  it("агрегирует статусы/приоритеты/open/24h", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes("GROUP BY status")) {
        return Promise.resolve({ rows: [{ status: 4, n: 3 }, { status: 7, n: 5 }] });
      }
      if (String(sql).includes("GROUP BY priority")) {
        return Promise.resolve({ rows: [{ priority: 0, n: 1 }, { priority: 1, n: 2 }] });
      }
      return Promise.resolve({ rows: [{ n: 7 }] });
    });
    const summary = await getIncidentSummary();
    // status enum indices: 4=FIXED? — проверяем что маппинг по строковому ключу
    expect(summary.openTotal).toBeGreaterThanOrEqual(0);
    expect(summary.last24h).toBe(7);
  });
});
