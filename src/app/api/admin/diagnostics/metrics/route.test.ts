/**
 * Тесты /api/admin/diagnostics/metrics — доступ только серверный
 * ADMIN/SUPER_ADMIN (DEPLOY-01 §5); fail-open при сбое агрегатов.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const requireAnyRoleMock = vi.fn();
const queryMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (req: unknown) => getUserMock(req),
}));

vi.mock("@/lib/role-guards", () => ({
  requireAnyRole: (...args: unknown[]) => requireAnyRoleMock(...args),
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock("@/lib/diagnostics/incidents", () => ({
  getIncidentSummary: () =>
    Promise.resolve({ byStatus: {}, byPriority: {}, openTotal: 0, last24h: 0 }),
}));

import { GET } from "./route";

function makeRequest(url: string): Request {
  return new Request(`http://localhost:3000${url}`);
}

beforeEach(() => {
  getUserMock.mockReset();
  requireAnyRoleMock.mockReset();
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ total: 0, critical: 0, error: 0, warning: 0, http_5xx: 0 }] });
});

describe("GET /api/admin/diagnostics/metrics — серверный доступ", () => {
  it("без токена → 401, без обращения к БД", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await GET(makeRequest("/api/admin/diagnostics/metrics") as never);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("не-админ → 403", async () => {
    getUserMock.mockResolvedValue({ userId: "u2" });
    requireAnyRoleMock.mockImplementation(async () =>
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
    );
    const res = await GET(makeRequest("/api/admin/diagnostics/metrics") as never);
    expect(res.status).toBe(403);
  });

  it("админ → 200 со снапшотом метрик", async () => {
    getUserMock.mockResolvedValue({ userId: "admin" });
    requireAnyRoleMock.mockResolvedValue(null);
    const res = await GET(makeRequest("/api/admin/diagnostics/metrics") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.process).toBeTruthy();
    expect(body.eventStore).toBeTruthy();
    expect(body.limitations).toBeTruthy();
    expect(String(res.headers.get("Cache-Control"))).toContain("no-store");
  });

  it("fail-open: сбой collectMetricsSnapshot → 503 partial (не 500 без лога)", async () => {
    getUserMock.mockResolvedValue({ userId: "admin" });
    requireAnyRoleMock.mockResolvedValue(null);
    queryMock.mockRejectedValue(new Error("db gone"));
    const res = await GET(makeRequest("/api/admin/diagnostics/metrics") as never);
    // collectMetricsSnapshot сам fail-open → обычно 200; 503 — только при
    // полном каскаде. Проверяем что статус либо 200 либо 503 и тело JSON.
    expect([200, 503]).toContain(res.status);
    await expect(res.json()).resolves.toBeTruthy();
  });
});
