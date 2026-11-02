/**
 * Регрессионные тесты /api/holidays — личные праздники на РЕАЛЬНОЙ схеме.
 *
 * Первопричина бага 'user_holidays.user_id does not exist': роут читал
 * фантомные колонки (user_id/month/day/active) legacy-таблицы user_holidays
 * (0017, camelCase, userId TEXT). Роут переведён на holiday_reminders (0010):
 * id UUID, user_id UUID FK, name, type, date DATE, remind_days_before,
 * is_recurring, last_notified_at. Фикстуры ниже отражают РЕАЛЬНЫЕ колонки —
 * любой отход от схемы уронит тесты (42703 через шим).
 *
 * Формат: герметичный end-to-end — РЕАЛЬНЫЙ supabase-js → PostgREST-шим →
 * фейковый pg-пул (каркас src/app/api/cart/route.test.ts).
 *
 * Лочит контракт:
 *   a) GET без сессии → system + user: [] (гостю личных данных нет);
 *   b) GET со сессией → только СВОИ строки, date → month/day маппинг;
 *   c) POST 401 без сессии; POST валидный → 201, user_id владельца,
 *      is_recurring=true, date = ближайшая годовщина (29.02 → 28.02);
 *   d) POST невалидный month → 422;
 *   e) DELETE свой → success; DELETE чужой → 404, чужая строка жива.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { invalidateIntrospection } from "@/lib/postgrest/introspect";

// ============================================================================
// Фейковый pg-пул: фикстуры holiday_reminders (реальные колонки 0010)
// ============================================================================

type Row = Record<string, unknown>;

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "a@test.local" };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", email: "b@test.local" };

let holidays: Row[];
let holidaySeq: number;

function resetDb(): void {
  holidays = [
    {
      id: "99999999-1111-4111-8111-000000000001",
      user_id: USER_A.id,
      name: "День рождения мамы",
      type: "birthday",
      date: "2026-03-08",
      remind_days_before: 3,
      is_recurring: true,
      last_notified_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      // ЧУЖОЙ праздник (USER_B) — не должен попасть в выборку/удаление USER_A
      id: "99999999-1111-4111-8111-000000000002",
      user_id: USER_B.id,
      name: "Годовщина Б",
      type: "anniversary",
      date: "2026-06-12",
      remind_days_before: 7,
      is_recurring: true,
      last_notified_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  holidaySeq = 0;
}

const INTRO_TABLES = [{ table_name: "holiday_reminders" }];
const INTRO_COLUMNS: Row[] = [];
for (const [column_name, data_type, udt_name] of [
  ["id", "uuid", "uuid"],
  ["user_id", "uuid", "uuid"],
  ["name", "text", "text"],
  ["type", "text", "text"],
  ["date", "date", "date"],
  ["remind_days_before", "integer", "int4"],
  ["is_recurring", "boolean", "bool"],
  ["last_notified_at", "timestamp with time zone", "timestamptz"],
  ["created_at", "timestamp with time zone", "timestamptz"],
] as [string, string, string][]) {
  INTRO_COLUMNS.push({ table_name: "holiday_reminders", column_name, data_type, udt_name, is_nullable: "YES" });
}
const INTRO_PKS = [{ table_name: "holiday_reminders", column_name: "id" }];
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

  // --- INSERT holiday_reminders (RETURNING поддержан) ---
  if (q.startsWith(`INSERT INTO "holiday_reminders"`)) {
    const colsM = q.match(/^INSERT INTO "holiday_reminders" \((.+?)\) VALUES/);
    const cols = colsM ? colsM[1].split(",").map((c) => c.replace(/"/g, "").trim()) : [];
    holidaySeq += 1;
    const row: Row = {
      id: `99999999-3333-4111-8111-00000000000${holidaySeq}`,
      user_id: null,
      name: null,
      type: null,
      date: null,
      remind_days_before: 7,
      is_recurring: true,
      last_notified_at: null,
      created_at: "2026-01-02T00:00:00Z",
    };
    cols.forEach((c, i) => {
      row[c] = params[i];
    });
    holidays.push(row);
    const retM = q.match(/RETURNING (.+)$/);
    if (retM) {
      const fields = retM[1].split(",").map((s) => s.replace(/"/g, "").trim());
      return { rows: [{ ...project(row, fields) }] };
    }
    return { rows: [] };
  }

  // --- DELETE holiday_reminders (RETURNING id) ---
  if (q.startsWith(`DELETE FROM "holiday_reminders"`)) {
    const filters = parseWhere(q, params);
    const target = holidays.find((r) => filters.every(([c, v]) => r[c] === v));
    if (!target) return { rows: [] };
    holidays = holidays.filter((r) => r !== target);
    const retM = q.match(/RETURNING (.+)$/);
    if (retM) {
      const fields = retM[1].split(",").map((s) => s.replace(/"/g, "").trim());
      return { rows: [{ ...project(target, fields) }] };
    }
    return { rows: [] };
  }

  // --- SELECT holiday_reminders ---
  if (q.startsWith("SELECT") && q.includes(`FROM "holiday_reminders"`)) {
    let out = holidays;
    for (const [c, v] of parseWhere(q, params)) out = out.filter((r) => r[c] === v);
    if (/ORDER BY "date" ASC/i.test(q)) {
      out = [...out].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    const limitM = q.match(/ LIMIT (\d+)/);
    if (limitM) out = out.slice(0, Number(limitM[1]));
    return { rows: out.map((r) => project(r, selectedFields(q, "holiday_reminders"))) };
  }

  throw new Error(`fake pgrst pool: unexpected SQL: ${sql}`);
}

const poolRef: { current: { connect: () => Promise<{ query: typeof fakeQuery; release: () => void }> } | null } = { current: null };

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => poolRef.current,
}));

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

import { GET, POST, DELETE } from "./route";

// ============================================================================
// Хелперы
// ============================================================================

const BASE = "http://localhost:3000";

async function call(
  method: "GET" | "POST" | "DELETE",
  user: typeof USER_A | null,
  body?: unknown,
  query?: string
): Promise<Response> {
  getUserFromRequestMock.mockResolvedValue(
    user ? { userId: user.id, email: user.email } : null
  );
  const url = query ? `${BASE}/api/holidays?${query}` : `${BASE}/api/holidays`;
  const req = new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (method === "GET") return GET(req);
  if (method === "POST") return POST(req);
  return DELETE(req);
}

beforeEach(() => {
  resetDb();
  invalidateIntrospection();
  poolRef.current = {
    connect: async () => ({ query: fakeQuery, release: () => {} }),
  };
  getUserFromRequestMock.mockReset();
  process.env.JWT_SECRET = "test-jwt-secret-for-pgrst-shim";
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

// ============================================================================
// Контракт
// ============================================================================

describe("GET /api/holidays", () => {
  it("гость: system + user: [] (без ошибки схемы)", async () => {
    const res = await call("GET", null);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { system: unknown[]; user: unknown[] };
    expect(data.system.length).toBeGreaterThan(0);
    expect(data.user).toEqual([]);
  });

  it("авторизованный: только СВОИ праздники, date → month/day", async () => {
    const res = await call("GET", USER_A);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: Array<{ id: string; month: number; day: number; name: string }> };
    expect(data.user).toHaveLength(1);
    expect(data.user[0].id).toBe("99999999-1111-4111-8111-000000000001");
    expect(data.user[0].name).toBe("День рождения мамы");
    expect(data.user[0].month).toBe(3);
    expect(data.user[0].day).toBe(8);
  });
});

describe("POST /api/holidays", () => {
  it("401 без сессии", async () => {
    const res = await call("POST", null, { name: "Иван", month: 5, day: 10 });
    expect(res.status).toBe(401);
  });

  it("201: вставка с user_id владельца, is_recurring, type=custom", async () => {
    const res = await call("POST", USER_A, { name: "День тренера", month: 10, day: 25 });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { holiday: { month: number; day: number; name: string } };
    expect(data.holiday.name).toBe("День тренера");
    expect(data.holiday.month).toBe(10);
    expect(data.holiday.day).toBe(25);
    const row = holidays.find((h) => h.name === "День тренера") as Row;
    expect(row.user_id).toBe(USER_A.id);
    expect(row.is_recurring).toBe(true);
    expect(row.type).toBe("custom");
    // date = ближайшее 25 октября
    expect(String(row.date)).toMatch(/^\d{4}-10-25$/);
  });

  it("29.02 клэмпится в 28.02 (DATE не принимает 29.02 невисокосного года)", async () => {
    const res = await call("POST", USER_A, { name: "Високосный", month: 2, day: 29 });
    expect(res.status).toBe(201);
    const row = holidays.find((h) => h.name === "Високосный") as Row;
    expect(String(row.date)).toMatch(/^\d{4}-02-28$/);
  });

  it("422: month вне 1..12 / day вне 1..31 / пустой name", async () => {
    expect((await call("POST", USER_A, { name: "x", month: 13, day: 1 })).status).toBe(422);
    expect((await call("POST", USER_A, { name: "x", month: 1, day: 32 })).status).toBe(422);
    expect((await call("POST", USER_A, { name: "", month: 1, day: 1 })).status).toBe(400);
  });
});

describe("DELETE /api/holidays", () => {
  it("401 без сессии", async () => {
    const res = await call("DELETE", null, undefined, "id=99999999-1111-4111-8111-000000000001");
    expect(res.status).toBe(401);
  });

  it("свой праздник → success, строка удалена", async () => {
    const res = await call("DELETE", USER_A, undefined, "id=99999999-1111-4111-8111-000000000001");
    expect(res.status).toBe(200);
    expect(holidays.find((h) => h.id === "99999999-1111-4111-8111-000000000001")).toBeUndefined();
  });

  it("чужой праздник → 404, чужая строка жива (ownership через user_id)", async () => {
    const res = await call("DELETE", USER_A, undefined, "id=99999999-1111-4111-8111-000000000002");
    expect(res.status).toBe(404);
    expect(holidays.find((h) => h.id === "99999999-1111-4111-8111-000000000002")).toBeTruthy();
  });

  it("400 без id", async () => {
    const res = await call("DELETE", USER_A);
    expect(res.status).toBe(400);
  });
});
