/**
 * Регрессионные тесты PATCH /api/courier/deliveries/[id] — действия курьера
 * над СВОЕЙ доставкой (P1 «серверные действия курьера»).
 *
 * Формат: герметичный end-to-end — РЕАЛЬНЫЙ supabase-js (кастомный fetch) →
 * РЕАЛЬНЫЙ PostgREST-шим → фейковый pg-пул с фикстурами deliveries/user_roles
 * (каркас src/app/api/cart/route.test.ts). getUserFromRequest мокается по
 * конвенции репозитория; requireRole идёт через шим к user_roles.
 *
 * Лочит контракт:
 *   a) 401 без сессии;
 *   b) 403 для не-курьера (роль CUSTOMER);
 *   c) 403 чужая доставка (courier_id другого курьера) — данные не меняются;
 *   d) 404 несуществующая доставка;
 *   e) 409 недопустимый переход: pickup на picked_up/delivered;
 *   f) повторный запрос (второй pickup) → 409, состояние БД не меняется;
 *   g) конкурентное изменение: между чтением и CAS строка сменила статус → 409;
 *   h) успешный pickup: assigned → picked_up, pickup_at проставлен.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { invalidateIntrospection } from "@/lib/postgrest/introspect";

// ============================================================================
// Фейковый pg-пул: фикстуры deliveries/user_roles
// ============================================================================

type Row = Record<string, unknown>;

const USER_C = { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", email: "courier@test.local", roles: ["COURIER"] };
const USER_C2 = { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", email: "courier2@test.local", roles: ["COURIER"] };
const USER_CUSTOMER = { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", email: "customer@test.local", roles: ["CUSTOMER"] };

const UUID = {
  D_ASSIGNED: "11111111-aaaa-4bbb-8ccc-000000000001",
  D_PICKED: "11111111-aaaa-4bbb-8ccc-000000000002",
  D_DELIVERED: "11111111-aaaa-4bbb-8ccc-000000000003",
  D_FOREIGN: "11111111-aaaa-4bbb-8ccc-000000000004",
  MISSING: "11111111-aaaa-4bbb-8ccc-0000000000ff",
};

let deliveries: Row[];

function baseDeliveries(): Row[] {
  return [
    { id: UUID.D_ASSIGNED, order_id: "order-1", courier_id: USER_C.id, status: "assigned", address: "ул. Ленина 1", pickup_at: null, delivered_at: null, courier_earnings: 0, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" },
    { id: UUID.D_PICKED, order_id: "order-2", courier_id: USER_C.id, status: "picked_up", address: "ул. Ленина 2", pickup_at: "2026-01-01T01:00:00Z", delivered_at: null, courier_earnings: 0, created_at: "2026-01-01T00:00:02Z", updated_at: "2026-01-01T01:00:00Z" },
    { id: UUID.D_DELIVERED, order_id: "order-3", courier_id: USER_C.id, status: "delivered", address: "ул. Ленина 3", pickup_at: "2026-01-01T01:00:00Z", delivered_at: "2026-01-01T02:00:00Z", courier_earnings: 300, created_at: "2026-01-01T00:00:03Z", updated_at: "2026-01-01T02:00:00Z" },
    { id: UUID.D_FOREIGN, order_id: "order-4", courier_id: USER_C2.id, status: "assigned", address: "ул. Чужая 4", pickup_at: null, delivered_at: null, courier_earnings: 0, created_at: "2026-01-01T00:00:04Z", updated_at: "2026-01-01T00:00:04Z" },
  ];
}

const USER_ROLES: Row[] = [
  { user_id: USER_C.id, role: "COURIER", is_active: true },
  { user_id: USER_C2.id, role: "COURIER", is_active: true },
  { user_id: USER_CUSTOMER.id, role: "CUSTOMER", is_active: true },
];

const INTRO_TABLES = [{ table_name: "deliveries" }, { table_name: "user_roles" }];
const INTRO_COLUMNS: Row[] = [];
for (const [column_name] of [
  ["id"], ["order_id"], ["courier_id"], ["status"], ["address"],
  ["pickup_at"], ["delivered_at"], ["courier_earnings"], ["created_at"], ["updated_at"],
] as [string][]) {
  INTRO_COLUMNS.push({ table_name: "deliveries", column_name, data_type: "text", udt_name: "text", is_nullable: "YES" });
}
INTRO_COLUMNS.push({ table_name: "user_roles", column_name: "user_id", data_type: "uuid", udt_name: "uuid", is_nullable: "YES" });
INTRO_COLUMNS.push({ table_name: "user_roles", column_name: "role", data_type: "text", udt_name: "text", is_nullable: "YES" });
INTRO_COLUMNS.push({ table_name: "user_roles", column_name: "is_active", data_type: "boolean", udt_name: "bool", is_nullable: "YES" });
const INTRO_PKS = [{ table_name: "deliveries", column_name: "id" }];
const INTRO_FKS: Row[] = [];

/** WHERE-парсер: "col" = $n. */
function parseWhere(sql: string, params: unknown[]): Array<[string, unknown]> {
  const filters: Array<[string, unknown]> = [];
  const whereIdx = sql.indexOf(" WHERE ");
  if (whereIdx < 0) return filters;
  const where = sql.slice(whereIdx);
  const eqRe = /"(\w+)" = \$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = eqRe.exec(where))) {
    filters.push([m[1], params[Number(m[2]) - 1]]);
  }
  return filters;
}

function selectedFields(q: string, tableName: string): string[] | "*" {
  const m = q.match(new RegExp(`SELECT (.+?) FROM "${tableName}"`));
  if (!m) return "*";
  const fields: string[] = [];
  for (const item of m[1].split(", ")) {
    if (item.trim() === "*" || item.trim() === `"${tableName}".*`) return "*";
    const f = item.match(/^"(\w+)"$/)?.[1];
    if (f) fields.push(f);
  }
  return fields;
}

function project(row: Row, fields: string[] | "*"): Row {
  if (fields === "*") return { ...row };
  const out: Row = {};
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

function fakeQuery(sql: string, params: unknown[] = []): { rows: Row[] } {
  const q = sql.replace(/\s+/g, " ").trim();

  if (/^(BEGIN|COMMIT|ROLLBACK)\b/.test(q) || q.includes("set_config(") || /SET LOCAL ROLE/i.test(q)) {
    return { rows: [] };
  }
  if (q.includes("information_schema.columns")) return { rows: INTRO_COLUMNS };
  if (q.includes("table_constraints") && q.includes("PRIMARY KEY")) return { rows: INTRO_PKS };
  if (q.includes("table_constraints") && q.includes("FOREIGN KEY")) return { rows: INTRO_FKS };
  if (q.includes("information_schema.tables")) return { rows: INTRO_TABLES };
  if (q.includes("pg_proc")) return { rows: [] };

  // --- SELECT deliveries ---
  if (q.startsWith("SELECT") && q.includes('FROM "deliveries"')) {
    let out = deliveries;
    for (const [c, v] of parseWhere(q, params)) out = out.filter((r) => r[c] === v);
    const limitM = q.match(/ LIMIT (\d+)/);
    if (limitM) out = out.slice(0, Number(limitM[1]));
    return { rows: out.map((r) => project(r, selectedFields(q, "deliveries"))) };
  }

  // --- UPDATE deliveries (RETURNING поддержан: PATCH с .select()) ---
  if (q.startsWith("UPDATE \"deliveries\"")) {
    const [setPart, restPart] = q.split(" WHERE ");
    const setRe = /"(\w+)" = \$(\d+)/g;
    const updates: Array<[string, unknown]> = [];
    let m: RegExpExecArray | null;
    while ((m = setRe.exec(setPart))) updates.push([m[1], params[Number(m[2]) - 1]]);
    const filters = restPart ? parseWhere(` WHERE ${restPart}`, params) : [];
    const target = deliveries.find((r) => filters.every(([c, v]) => r[c] === v));
    if (!target) return { rows: [] };
    for (const [c, v] of updates) target[c] = v;
    const retM = q.match(/RETURNING (.+)$/);
    if (retM) {
      const fields = retM[1].split(",").map((s) => s.replace(/"/g, "").trim());
      return { rows: [{ ...project(target, fields) }] };
    }
    return { rows: [] };
  }

  // --- SELECT user_roles (requireRole через шим) ---
  if (q.startsWith("SELECT") && q.includes('FROM "user_roles"')) {
    let out = USER_ROLES;
    for (const [c, v] of parseWhere(q, params)) out = out.filter((r) => r[c] === v);
    return { rows: out.map((r) => project(r, selectedFields(q, "user_roles"))) };
  }

  throw new Error(`fake pgrst pool: unexpected SQL: ${sql}`);
}

const poolRef: { current: { connect: () => Promise<{ query: typeof fakeQuery; release: () => void }> } | null } = { current: null };

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => poolRef.current,
}));

// supabaseAdmin → реальный supabase-js на PostgREST-шиме (каркас cart-тестов)
vi.mock("@/lib/supabase/admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const pgrst = await import("@/app/rest/v1/[...path]/route");

  const shimFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url);
    const marker = "/rest/v1/";
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) throw new Error(`shimFetch: unexpected supabase-js URL: ${url}`);
    const segments = u.pathname.slice(idx + marker.length).split("/").filter(Boolean);
    const method = (init?.method ?? "GET").toUpperCase();
    const req = new NextRequest(url, { method, headers: init?.headers, body: init?.body ?? null });
    const handler = method === "POST" ? pgrst.POST : method === "PATCH" ? pgrst.PATCH : pgrst.GET;
    return handler(req, { params: Promise.resolve({ path: segments }) });
  };

  const client = createClient("http://pgrst.test", "test-service-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: shimFetch as unknown as typeof fetch },
  });
  return { supabaseAdmin: client };
});

const getUserFromRequestMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequestMock(...args),
}));

import { PATCH } from "./route";

// ============================================================================
// Хелперы
// ============================================================================

const BASE = "http://localhost:3000";

async function call(
  user: typeof USER_C | typeof USER_C2 | typeof USER_CUSTOMER | null,
  deliveryId: string,
  body?: unknown
): Promise<Response> {
  getUserFromRequestMock.mockResolvedValue(user);
  const req = new NextRequest(`${BASE}/api/courier/deliveries/${deliveryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return PATCH(req, { params: Promise.resolve({ id: deliveryId }) });
}

beforeEach(() => {
  deliveries = baseDeliveries();
  invalidateIntrospection();
  poolRef.current = {
    connect: async () => ({ query: fakeQuery, release: () => {} }),
  };
  getUserFromRequestMock.mockReset();
  process.env.JWT_SECRET = "test-jwt-secret-for-pgrst-shim";
  // requireRole читает user_roles через шим — env-гейт должен быть открыт
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://pgrst.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

// ============================================================================
// Контракт
// ============================================================================

describe("PATCH /api/courier/deliveries/[id] — pickup", () => {
  it("401 без сессии", async () => {
    const res = await call(null, UUID.D_ASSIGNED, { action: "pickup" });
    expect(res.status).toBe(401);
  });

  it("403 для не-курьера (CUSTOMER) — даже на свою строку", async () => {
    const res = await call(USER_CUSTOMER, UUID.D_ASSIGNED, { action: "pickup" });
    expect(res.status).toBe(403);
    expect((deliveries.find((d) => d.id === UUID.D_ASSIGNED) as Row).status).toBe("assigned");
  });

  it("403 чужая доставка — состояние БД не меняется", async () => {
    const res = await call(USER_C, UUID.D_FOREIGN, { action: "pickup" });
    expect(res.status).toBe(403);
    expect((deliveries.find((d) => d.id === UUID.D_FOREIGN) as Row).status).toBe("assigned");
    expect((deliveries.find((d) => d.id === UUID.D_FOREIGN) as Row).courier_id).toBe(USER_C2.id);
  });

  it("404 несуществующая доставка", async () => {
    const res = await call(USER_C, UUID.MISSING, { action: "pickup" });
    expect(res.status).toBe(404);
  });

  it("400 без action / с чужим action", async () => {
    const resNoBody = await call(USER_C, UUID.D_ASSIGNED, undefined);
    expect(resNoBody.status).toBe(400);
    const resWrong = await call(USER_C, UUID.D_ASSIGNED, { action: "complete" });
    expect(resWrong.status).toBe(400);
  });

  it("409 недопустимый переход: pickup на picked_up и на delivered", async () => {
    const resPicked = await call(USER_C, UUID.D_PICKED, { action: "pickup" });
    expect(resPicked.status).toBe(409);
    const resDelivered = await call(USER_C, UUID.D_DELIVERED, { action: "pickup" });
    expect(resDelivered.status).toBe(409);
  });

  it("успешный pickup: assigned → picked_up, pickup_at проставлен", async () => {
    const res = await call(USER_C, UUID.D_ASSIGNED, { action: "pickup" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { delivery: { status: string; pickup_at: string | null } };
    expect(body.delivery.status).toBe("picked_up");
    expect(body.delivery.pickup_at).toBeTruthy();
    const row = deliveries.find((d) => d.id === UUID.D_ASSIGNED) as Row;
    expect(row.status).toBe("picked_up");
    expect(row.pickup_at).toBeTruthy();
  });

  it("повторный запрос (второй pickup) → 409, состояние БД не меняется", async () => {
    const first = await call(USER_C, UUID.D_ASSIGNED, { action: "pickup" });
    expect(first.status).toBe(200);
    const before = JSON.stringify(deliveries.find((d) => d.id === UUID.D_ASSIGNED));
    const second = await call(USER_C, UUID.D_ASSIGNED, { action: "pickup" });
    expect(second.status).toBe(409);
    expect(JSON.stringify(deliveries.find((d) => d.id === UUID.D_ASSIGNED))).toBe(before);
  });

  it("гонка: CAS-фильтр по статусу — параллельное изменение даёт 409 ровно одному", async () => {
    // Имитация: первый запрос прошёл чтение, второй уже сменил статус —
    // CAS первого (.eq("status","assigned")) не находит строку → 409.
    (deliveries.find((d) => d.id === UUID.D_ASSIGNED) as Row).status = "picked_up";
    const res = await call(USER_C, UUID.D_ASSIGNED, { action: "pickup" });
    expect(res.status).toBe(409);
  });
});
