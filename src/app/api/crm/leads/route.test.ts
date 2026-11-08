/**
 * Герметичные тесты /api/crm/leads — изоляция доступа к лидам (Z-v16).
 *
 * Первопричина (безопасность): GET отдавал CONFECTIONER весь платформенный
 * список лидов — таблица `leads` (0005) не имеет колонки владельца
 * (assigned_to — только назначение), скоупить по кондитеру невозможно.
 * Доступ к лидам теперь только у staff-CRM ролей.
 *
 * Лочит контракт:
 *   a) CONFECTIONER → 403 (утечка закрыта);
 *   b) CUSTOMER → 403; неавторизованный → 401;
 *   c) SUPPORT/ADMIN → 200 со списком;
 *   d) POST по-прежнему staff-only (CONFECTIONER → 403).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { invalidateIntrospection } from "@/lib/postgrest/introspect";

type Row = Record<string, unknown>;

const USERS: Record<string, { userId: string; id: string; name: string; email: string; roles: string[]; accountType: string } | null> = {
  customer: { userId: "u-cust", id: "u-cust", name: "Покупатель", email: "c@t.local", roles: ["CUSTOMER"], accountType: "customer" },
  confectioner: { userId: "u-conf", id: "u-conf", name: "Кондитер", email: "conf@t.local", roles: ["CONFECTIONER"], accountType: "confectioner" },
  support: { userId: "u-sup", id: "u-sup", name: "Support", email: "s@t.local", roles: ["SUPPORT"], accountType: "support" },
  admin: { userId: "u-adm", id: "u-adm", name: "Admin", email: "a@t.local", roles: ["ADMIN"], accountType: "admin" },
  none: null,
};

const LEADS: Row[] = [
  { id: "lead-1", source: "website", name: "Лид А", email: "a@x.local", phone: null, company: null, inquiry: "Торт на юбилей", budget: 500000, event_date: null, city: "Москва", status: "new", stage: "awareness", assigned_to: null, metadata: null, contacted_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "lead-2", source: "b2b_inquiry", name: "Лид Б", email: "b@x.local", phone: "+7 900 000-00-00", company: "ООО Кофейня", inquiry: "Оптовая закупка", budget: 1200000, event_date: null, city: "Казань", status: "contacted", stage: "interest", assigned_to: "u-sup", metadata: null, contacted_at: "2026-01-02T00:00:00Z", created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" },
];

const TABLES = ["leads"];
const INTRO_COLUMNS: Row[] = [
  ["id", "uuid"], ["source", "text"], ["name", "text"], ["email", "text"], ["phone", "text"],
  ["company", "text"], ["inquiry", "text"], ["budget", "int4"], ["event_date", "date"],
  ["city", "text"], ["status", "text"], ["stage", "text"], ["assigned_to", "uuid"],
  ["metadata", "jsonb"], ["contacted_at", "timestamptz"], ["created_at", "timestamptz"],
  ["updated_at", "timestamptz"],
].map(([column_name, udt_name]) => ({
  table_name: "leads",
  column_name,
  data_type: udt_name === "uuid" ? "uuid" : udt_name === "int4" ? "integer" : udt_name === "jsonb" ? "jsonb" : "text",
  udt_name,
  is_nullable: "YES",
}));

let leads: Row[];

beforeEach(() => {
  leads = JSON.parse(JSON.stringify(LEADS));
});

function project(row: Row, sql: string, table: string): Row {
  const m = sql.match(new RegExp(`SELECT (.+?) FROM "${table}"`));
  if (!m) return { ...row };
  const fields = m[1].split(",").map((s) => s.trim());
  if (fields.includes("*") || fields.includes(`"${table}".*`)) return { ...row };
  const out: Row = {};
  for (const f of fields) {
    const name = f.match(/^"(\w+)"$/)?.[1];
    if (name && name in row) out[name] = row[name];
  }
  return out;
}

function parseWhere(sql: string): [string, number][] {
  const idx = sql.indexOf(" WHERE ");
  if (idx < 0) return [];
  const conds: [string, number][] = [];
  const re = /"(\w+)" (=|<>|!=) \$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql.slice(idx + 7)))) conds.push([m[1], Number(m[3])]);
  return conds;
}

function fakeQuery(sql: string, params: unknown[] = []): { rows: Row[] } {
  const q = sql.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/.test(q) || q.includes("set_config(") || /SET LOCAL ROLE/i.test(q)) {
    return { rows: [] };
  }
  if (q.includes("information_schema.columns")) return { rows: INTRO_COLUMNS };
  if (q.includes("table_constraints") && q.includes("PRIMARY KEY")) return { rows: [{ table_name: "leads", column_name: "id" }] };
  if (q.includes("table_constraints") && q.includes("FOREIGN KEY")) return { rows: [] };
  if (q.includes("information_schema.tables")) return { rows: TABLES.map((t) => ({ table_name: t })) };
  if (q.includes("pg_proc")) return { rows: [] };

  if (q.startsWith("SELECT") && q.includes(`FROM "leads"`)) {
    const conds = parseWhere(q);
    let out = leads.filter((r) => conds.every(([col, n]) => r[col] === params[n - 1]));
    if (/ORDER BY "updated_at" DESC/i.test(q)) {
      out = [...out].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }
    return { rows: out.map((r) => project(r, q, "leads")) };
  }
  if (q.startsWith(`INSERT INTO "leads"`)) {
    const colsM = q.match(/^INSERT INTO "leads" \((.+?)\) VALUES/);
    const cols = colsM ? colsM[1].split(",").map((c) => c.replace(/"/g, "").trim()) : [];
    const row: Row = { id: "lead-gen-1", created_at: "2026-01-04T00:00:00Z", updated_at: "2026-01-04T00:00:00Z" };
    cols.forEach((c, i) => { row[c] = params[i]; });
    leads.push(row);
    return { rows: [{ ...row }] };
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

vi.mock("@/lib/supabase/auth", () => ({
  forbiddenResponse: (message?: string) =>
    NextResponse.json({ error: message ?? "Forbidden" }, { status: 403 }),
  unauthorizedResponse: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));

import { GET as listLeads, POST as createLead } from "./route";

const BASE = "http://localhost:3000";

beforeEach(() => {
  invalidateIntrospection();
  getUserFromRequestMock.mockReset();
  poolRef.current = { connect: async () => ({ query: fakeQuery, release: () => {} }) };
  process.env.JWT_SECRET = "test-jwt-secret-for-pgrst-shim";
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

describe("GET /api/crm/leads — изоляция лидов", () => {
  it("CONFECTIONER → 403 (утечка платформенных лидов закрыта)", async () => {
    getUserFromRequestMock.mockResolvedValue(USERS.confectioner);
    const res = await listLeads(new NextRequest(`${BASE}/api/crm/leads`));
    expect(res.status).toBe(403);
  });

  it("CUSTOMER → 403; неавторизованный → 401", async () => {
    getUserFromRequestMock.mockResolvedValue(USERS.customer);
    expect((await listLeads(new NextRequest(`${BASE}/api/crm/leads`))).status).toBe(403);

    getUserFromRequestMock.mockResolvedValue(USERS.none);
    expect((await listLeads(new NextRequest(`${BASE}/api/crm/leads`))).status).toBe(401);
  });

  it("SUPPORT → 200 со списком лидов", async () => {
    getUserFromRequestMock.mockResolvedValue(USERS.support);
    const res = await listLeads(new NextRequest(`${BASE}/api/crm/leads`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads).toHaveLength(2);
    expect(body.leads[0]).toMatchObject({ id: "lead-2", status: "contacted" });
  });

  it("ADMIN → 200; фильтр status работает", async () => {
    getUserFromRequestMock.mockResolvedValue(USERS.admin);
    const res = await listLeads(new NextRequest(`${BASE}/api/crm/leads?status=new`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0].id).toBe("lead-1");
  });
});

describe("POST /api/crm/leads — создание (staff-only, неизменно)", () => {
  it("CONFECTIONER → 403", async () => {
    getUserFromRequestMock.mockResolvedValue(USERS.confectioner);
    const res = await createLead(
      new NextRequest(`${BASE}/api/crm/leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("SUPPORT → 201, лид создан", async () => {
    getUserFromRequestMock.mockResolvedValue(USERS.support);
    const res = await createLead(
      new NextRequest(`${BASE}/api/crm/leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Новый лид", source: "phone" }),
      })
    );
    expect(res.status).toBe(201);
    expect(leads).toHaveLength(3);
  });
});
