/**
 * Тесты /api/admin/diagnostics/incidents — доступ исключительно через
 * серверную авторизацию (DEPLOY-01 §4.2): 401 без токена, 403 без роли,
 * PATCH с валидацией переходов; клиентские проверки не являются
 * механизмом безопасности.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const requireAnyRoleMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (req: unknown) => getUserMock(req),
}));

vi.mock("@/lib/role-guards", () => ({
  requireAnyRole: (...args: unknown[]) => requireAnyRoleMock(...args),
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

const queryMock = vi.fn();

import { GET, PATCH } from "./route";

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${url}`, init);
}

const ADMIN_ID = "00000000-0000-0000-0000-00000000000a";
const NON_ADMIN_ID = "00000000-0000-0000-0000-00000000000b";

beforeEach(() => {
  getUserMock.mockReset();
  requireAnyRoleMock.mockReset();
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
});

describe("GET /api/admin/diagnostics/incidents — серверный доступ", () => {
  it("без токена → 401", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await GET(makeRequest("/api/admin/diagnostics/incidents") as never);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("не-админ (роль CONFECTIONER) → 403, без обращения к БД", async () => {
    getUserMock.mockResolvedValue({ userId: NON_ADMIN_ID });
    requireAnyRoleMock.mockImplementation(async (_uid: string, roles: string[]) => {
      const req = new Request("http://x");
      void req;
      // имитируем Response-гейт из role-guards
      return new Response(JSON.stringify({ error: `Требуется одна из ролей: ${roles.join(", ")}` }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    });
    const res = await GET(makeRequest("/api/admin/diagnostics/incidents") as never);
    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("админ → 200 и список", async () => {
    getUserMock.mockResolvedValue({ userId: ADMIN_ID });
    requireAnyRoleMock.mockResolvedValue(null); // гейт пройден
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes("count(*)")) return Promise.resolve({ rows: [{ total: 1 }] });
      return Promise.resolve({
        rows: [
          {
            id: "inc-1",
            fingerprint: "f".repeat(40),
            title: "t",
            component: "api",
            priority: "P2",
            status: "NEW",
            severity: "error",
            error_code: null,
            last_route: null,
            occurrence_count: 1,
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            first_version: null,
            last_version: null,
            resolved_at: null,
            resolved_version: null,
            fix_commit: null,
            ignore_reason: null,
            notified_at: null,
          },
        ],
      });
    });
    const res = await GET(makeRequest("/api/admin/diagnostics/incidents") as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: unknown[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items).toHaveLength(1);
  });

  it("недопустимый статус-фильтр → 400", async () => {
    getUserMock.mockResolvedValue({ userId: ADMIN_ID });
    requireAnyRoleMock.mockResolvedValue(null);
    const res = await GET(makeRequest("/api/admin/diagnostics/incidents?status=HACKED") as never);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/diagnostics/incidents — смена статуса", () => {
  it("не-админ → 403", async () => {
    getUserMock.mockResolvedValue({ userId: NON_ADMIN_ID });
    requireAnyRoleMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "denied" }), { status: 403 })
    );
    const res = await PATCH(
      makeRequest("/api/admin/diagnostics/incidents", {
        method: "PATCH",
        body: JSON.stringify({ incidentId: "x", toStatus: "TRIAGED" }),
      }) as never
    );
    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("IGNORED без причины → 400 (обязательная причина)", async () => {
    getUserMock.mockResolvedValue({ userId: ADMIN_ID });
    requireAnyRoleMock.mockResolvedValue(null);
    const res = await PATCH(
      makeRequest("/api/admin/diagnostics/incidents", {
        method: "PATCH",
        body: JSON.stringify({ incidentId: "x", toStatus: "IGNORED" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("недопустимый toStatus → 400", async () => {
    getUserMock.mockResolvedValue({ userId: ADMIN_ID });
    requireAnyRoleMock.mockResolvedValue(null);
    const res = await PATCH(
      makeRequest("/api/admin/diagnostics/incidents", {
        method: "PATCH",
        body: JSON.stringify({ incidentId: "x", toStatus: "SUPER_CLOSED" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("невалидный JSON → 400", async () => {
    getUserMock.mockResolvedValue({ userId: ADMIN_ID });
    requireAnyRoleMock.mockResolvedValue(null);
    const res = await PATCH(
      makeRequest("/api/admin/diagnostics/incidents", {
        method: "PATCH",
        body: "no-json{",
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("конфликт переходов (IncidentStateError) → 409", async () => {
    getUserMock.mockResolvedValue({ userId: ADMIN_ID });
    requireAnyRoleMock.mockResolvedValue(null);
    // Внутри route transitionIncident импортируется статически; мокаем модуль
    const { IncidentStateError } = await import("@/lib/diagnostics/incidents");
    const mod = await import("@/lib/diagnostics/incidents");
    vi.spyOn(mod, "transitionIncident").mockRejectedValueOnce(
      new IncidentStateError("Недопустимый переход CLOSED → IN_PROGRESS")
    );
    const res = await PATCH(
      makeRequest("/api/admin/diagnostics/incidents", {
        method: "PATCH",
        body: JSON.stringify({ incidentId: "x", toStatus: "TRIAGED" }),
      }) as never
    );
    expect(res.status).toBe(409);
  });
});
