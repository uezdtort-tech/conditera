/**
 * api-auth-matrix.test.ts — ZV31-007: серверная матрица авторизации API.
 *
 * Проверяет СЕРВЕРНЫЕ guard'ы route handlers (не UI): покупатель не получает
 * доступ к административным функциям; роль сверяется до обращения к БД.
 *
 * Мокается граница auth/DB — в стиле route-тестов этой кодовой базы
 * (см. src/app/api/admin/diagnostics/incidents/route.test.ts):
 *   • @/lib/auth.getUserFromRequest — кто стучится;
 *   • @/lib/role-guards.requireRole / requireAnyRole — фейковая таблица
 *     user_roles (dbRoles) с точной семантикой реальной: null-userId → 401,
 *     роль отсутствует в user_roles → 403, есть → null (доступ разрешён);
 *   • @/lib/postgrest/pool и @/lib/supabase/admin — данные.
 *
 * Зафиксированное поведение (фактическое, не декларативное):
 *   • admin-роуты: 401 без токена, 403 CUSTOMER, 200 ADMIN;
 *   • supplier/courier/operator: 401/403 (dev-фолбэки на stub-данные удалены
 *     в ZV31-007 — раньше в development возвращали 200 без роли);
 *   • ownership: кондитер A на заказе кондитера B → 403 (PATCH /api/orders/[id]).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const requireRoleMock = vi.fn();
const requireAnyRoleMock = vi.fn();
const queryMock = vi.fn();
const supabaseFromMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (req: unknown) => getUserMock(req),
}));

// Фейковая user_roles (dbRoles) с семантикой реальных guard'ов role-guards.ts
let dbRoles: string[] = [];

function deny401(): Response {
  return new Response(JSON.stringify({ error: "Необходима аутентификация" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
function deny403(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/role-guards", () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...a),
  requireAnyRole: (...a: unknown[]) => requireAnyRoleMock(...a),
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => supabaseFromMock(table) },
}));

vi.mock("@/lib/n8n", () => ({ emitEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/ops/events", () => ({ recordEvent: vi.fn(async () => {}) }));

import { GET as eventsGET } from "@/app/api/admin/diagnostics/events/route";
import { GET as incidentsGET } from "@/app/api/admin/diagnostics/incidents/route";
import { GET as supplierDashboardGET } from "@/app/api/supplier/dashboard/route";
import { GET as escalationsGET } from "@/app/api/operator/escalations/route";
import { GET as messagesGET } from "@/app/api/operator/messages/route";
import { PATCH as orderPATCH } from "@/app/api/orders/[id]/route";
import { PUT as capabilitiesPUT } from "@/app/api/confectioner/capabilities/route";

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${url}`, init);
}

const CUSTOMER_ID = "00000000-0000-0000-0000-00000000c001";
const ADMIN_ID = "00000000-0000-0000-0000-00000000a001";
const CONF_A = "00000000-0000-0000-0000-00000000f001";
const CONF_B = "00000000-0000-0000-0000-00000000f002";

/** Сконфигурировать «сессию» и фейковую user_roles-таблицу. */
function setUser(userId: string | null, tokenRoles: string[] = []) {
  getUserMock.mockResolvedValue(
    userId
      ? { userId, id: userId, email: "u@test", roles: tokenRoles, accountType: "" }
      : null
  );
  requireRoleMock.mockImplementation(async (uid: unknown, role: string) => {
    if (!uid) return deny401();
    return dbRoles.includes(role)
      ? null
      : deny403({ error: `Требуется роль: ${role}`, required_role: role });
  });
  requireAnyRoleMock.mockImplementation(async (uid: unknown, wanted: string[]) => {
    if (!uid) return deny401();
    if (!wanted.length) return null;
    return wanted.some((r) => dbRoles.includes(r))
      ? null
      : deny403({ error: `Требуется одна из ролей: ${wanted.join(", ")}`, required_roles: wanted });
  });
}

/** Chainable-заглушка Postgrest-билдера (select/eq/... → single/maybeSingle). */
function supabaseRow(data: unknown) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = vi.fn(chain);
  b.eq = vi.fn(chain);
  b.in = vi.fn(chain);
  b.limit = vi.fn(chain);
  b.single = vi.fn(() => Promise.resolve({ data, error: null }));
  b.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  return b;
}

beforeEach(() => {
  dbRoles = [];
  getUserMock.mockReset();
  requireRoleMock.mockReset();
  requireAnyRoleMock.mockReset();
  queryMock.mockReset();
  supabaseFromMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
});

describe("/api/admin/diagnostics/events — серверный guard", () => {
  it("без токена → 401, БД не вызывается", async () => {
    setUser(null);
    const res = await eventsGET(makeRequest("/api/admin/diagnostics/events") as never);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("CUSTOMER → 403, БД не вызывается", async () => {
    setUser(CUSTOMER_ID, ["CUSTOMER"]);
    dbRoles = ["CUSTOMER"];
    const res = await eventsGET(makeRequest("/api/admin/diagnostics/events") as never);
    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("ADMIN → 200 (гребёнка пройдена, БД замокана)", async () => {
    setUser(ADMIN_ID, ["ADMIN"]);
    dbRoles = ["ADMIN"];
    const res = await eventsGET(makeRequest("/api/admin/diagnostics/events") as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(data.events)).toBe(true);
  });
});

describe("/api/admin/diagnostics/incidents — серверный guard", () => {
  it("без токена → 401", async () => {
    setUser(null);
    const res = await incidentsGET(makeRequest("/api/admin/diagnostics/incidents") as never);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("CUSTOMER → 403", async () => {
    setUser(CUSTOMER_ID, ["CUSTOMER"]);
    dbRoles = ["CUSTOMER"];
    const res = await incidentsGET(makeRequest("/api/admin/diagnostics/incidents") as never);
    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("ADMIN → 200", async () => {
    setUser(ADMIN_ID, ["ADMIN", "CUSTOMER"]);
    dbRoles = ["ADMIN", "CUSTOMER"];
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes("count(*)")) {
        return Promise.resolve({ rows: [{ total: 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await incidentsGET(makeRequest("/api/admin/diagnostics/incidents") as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
  });
});

describe("supplier/operator — роль проверяется до данных", () => {
  it("GET /api/supplier/dashboard без токена → 401 (dev-фолбэк stub удалён, ZV31-007)", async () => {
    setUser(null);
    const res = await supplierDashboardGET(makeRequest("/api/supplier/dashboard") as never);
    expect(res.status).toBe(401);
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });

  it("GET /api/supplier/dashboard CUSTOMER → 403 (раньше в dev — 200 stub)", async () => {
    setUser(CUSTOMER_ID, ["CUSTOMER"]);
    const res = await supplierDashboardGET(makeRequest("/api/supplier/dashboard") as never);
    expect(res.status).toBe(403);
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });

  it("GET /api/operator/escalations CUSTOMER → 403", async () => {
    setUser(CUSTOMER_ID, ["CUSTOMER"]);
    dbRoles = ["CUSTOMER"];
    const res = await escalationsGET(makeRequest("/api/operator/escalations") as never);
    expect(res.status).toBe(403);
  });

  it("GET /api/operator/messages CUSTOMER → 403 (роль из user_roles, не из JWT)", async () => {
    // JWT-клейм подделать нельзя, но он заморожен: проверка теперь по user_roles.
    setUser(CUSTOMER_ID, ["CUSTOMER", "ADMIN"]);
    dbRoles = ["CUSTOMER"]; // в БД админ-роли нет → отказ, даже при ADMIN в JWT
    const res = await messagesGET(makeRequest("/api/operator/messages?escalationId=x") as never);
    expect(res.status).toBe(403);
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });
});

describe("ownership — кондитер и чужой ресурс", () => {
  it("PATCH /api/orders/[id]: кондитер A на заказе кондитера B → 403", async () => {
    setUser(CONF_A, ["CUSTOMER", "CONFECTIONER"]);
    dbRoles = ["CUSTOMER", "CONFECTIONER"];
    supabaseFromMock.mockImplementation((table: string) =>
      supabaseRow(
        table === "orders"
          ? {
              id: "order-1",
              user_id: CUSTOMER_ID,
              confectioner_id: CONF_B, // чужой заказ
              status: "PENDING",
              number: "Z-1",
            }
          : null
      )
    );
    const res = await orderPATCH(
      makeRequest("/api/orders/order-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "CONFIRMED" }),
      }) as never,
      { params: Promise.resolve({ id: "order-1" }) }
    );
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Нет доступа к этому заказу");
  });

  it("PUT /api/confectioner/capabilities: покупатель без профиля кондитера → 403", async () => {
    setUser(CUSTOMER_ID, ["CUSTOMER"]);
    supabaseFromMock.mockImplementation(() => supabaseRow(null)); // confectioners → нет профиля
    const res = await capabilitiesPUT(
      makeRequest("/api/confectioner/capabilities", {
        method: "PUT",
        body: JSON.stringify({ max_tiers: 2 }),
      }) as never
    );
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("не кондитер");
  });
});
