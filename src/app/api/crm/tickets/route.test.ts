/**
 * Регрессионные тесты /api/crm/tickets — U-08 fix (DEV-19, HEAD bbe286b).
 *
 * Формат: герметичный end-to-end — РЕАЛЬНЫЙ supabase-js клиент (кастомный
 * fetch) → РЕАЛЬНЫЙ PostgREST-шим /rest/v1 (translate.ts) → фейковый pg-пул
 * (фикстуры support_tickets/ticket_messages + эмуляция information_schema
 * для интроспекции). Только getUserFromRequest и ответы auth-хелперов
 * замоканы по конвенции репозитория (см. orders/[id]/route.test.ts).
 *
 * Лочит контракт:
 *   a) список тикетов несёт `id` каждой строки (базовый PK выживает при
 *      select=*,rel(...) — фикс шима; до фикса translate.ts:433-441/519-523
 *      удалял join-колонку из вывода);
 *   b) GET /api/crm/tickets/[id] по id из списка → 200, корректная запись;
 *   c) повторная отправка байт-в-байт создаёт ДУБЛЬ (текущий контракт,
 *      finding #3 для владельца — создание НЕ идемпотентно; семантику
 *      создания здесь НЕ меняем);
 *   d) повторный GET списка → те же id (консистентность);
 *   e) изоляция ролей: owner видит только свои; чужой тикет — 403;
 *      filter=all — только staff; SUPPORT/ADMIN-полномочия не сужены
 *      (SUPPORT/ADMIN: filter=all + PATCH статуса; owner: закрыть свой,
 *      назначать не может).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { invalidateIntrospection } from "@/lib/postgrest/introspect";

// ============================================================================
// Фейковый pg-пул: транзакции + information_schema (интроспекция) + данные
// ============================================================================

type Row = Record<string, unknown>;

const OWNER = { id: "user-1111", email: "owner@test.local", roles: ["CUSTOMER"] };
const OTHER = { id: "user-2222", email: "other@test.local", roles: ["CUSTOMER"] };
const SUPPORT = { id: "user-3333", email: "support@test.local", roles: ["SUPPORT", "CUSTOMER"] };
const ADMIN = { id: "user-4444", email: "admin@test.local", roles: ["ADMIN", "CUSTOMER"] };

const TK_A: Row = {
  id: "tk-aaaa-1",
  number: "TKT-2026-0001",
  user_id: OWNER.id,
  assigned_to: null,
  subject: "Тикет A (владелец)",
  category: "order_issue",
  priority: "medium",
  status: "open",
  order_id: "ord-0001",
  messages_count: 2,
  first_response_at: null,
  resolved_at: null,
  closed_at: null,
  metadata: null,
  created_at: "2026-01-01T10:00:00Z",
  updated_at: "2026-01-01T10:00:00Z",
};
const TK_B: Row = {
  ...TK_A,
  id: "tk-bbbb-2",
  number: "TKT-2026-0002",
  user_id: OTHER.id,
  assigned_to: SUPPORT.id,
  subject: "Тикет B (другого пользователя)",
  status: "in_progress",
  messages_count: 1,
  created_at: "2026-01-02T10:00:00Z",
  updated_at: "2026-01-02T10:00:00Z",
};

const MSG_A1: Row = {
  id: "msg-1",
  ticket_id: "tk-aaaa-1",
  sender_id: OWNER.id,
  text: "Сообщение владельца",
  attachments: null,
  is_internal: false,
  is_system: false,
  created_at: "2026-01-01T10:01:00Z",
  read_at: null,
};
const MSG_A2: Row = { ...MSG_A1, id: "msg-2", text: "Внутренняя заметка support", is_internal: true };
const MSG_B1: Row = { ...MSG_A1, id: "msg-3", ticket_id: "tk-bbbb-2", sender_id: OTHER.id, text: "Сообщение чужого тикета" };

// --- изменяемое состояние «БД» (сбрасывается в beforeEach) ---
let tickets: Row[];
let messages: Row[];
let ticketSeq: number;

const INTRO_TABLES = [{ table_name: "support_tickets" }, { table_name: "ticket_messages" }];

const INTRO_COLUMNS: Row[] = [
  ["id", "uuid", "uuid", "NO"],
  ["number", "text", "text", "NO"],
  ["user_id", "uuid", "uuid", "NO"],
  ["assigned_to", "uuid", "uuid", "YES"],
  ["subject", "text", "text", "NO"],
  ["category", "text", "text", "NO"],
  ["priority", "text", "text", "NO"],
  ["status", "text", "text", "NO"],
  ["order_id", "uuid", "uuid", "YES"],
  ["messages_count", "integer", "int4", "YES"],
  ["first_response_at", "timestamp with time zone", "timestamptz", "YES"],
  ["resolved_at", "timestamp with time zone", "timestamptz", "YES"],
  ["closed_at", "timestamp with time zone", "timestamptz", "YES"],
  ["metadata", "jsonb", "jsonb", "YES"],
  ["created_at", "timestamp with time zone", "timestamptz", "YES"],
  ["updated_at", "timestamp with time zone", "timestamptz", "YES"],
].map(([column_name, data_type, udt_name, is_nullable]) => ({
  table_name: "support_tickets",
  column_name,
  data_type,
  udt_name,
  is_nullable,
}));

for (const [column_name, data_type, udt_name, is_nullable] of [
  ["id", "uuid", "uuid", "NO"],
  ["ticket_id", "uuid", "uuid", "NO"],
  ["sender_id", "uuid", "uuid", "NO"],
  ["text", "text", "text", "NO"],
  ["attachments", "jsonb", "jsonb", "YES"],
  ["is_internal", "boolean", "bool", "YES"],
  ["is_system", "boolean", "bool", "YES"],
  ["created_at", "timestamp with time zone", "timestamptz", "YES"],
  ["read_at", "timestamp with time zone", "timestamptz", "YES"],
] as [string, string, string, string][]) {
  INTRO_COLUMNS.push({ table_name: "ticket_messages", column_name, data_type, udt_name, is_nullable });
}

const INTRO_PKS = [
  { table_name: "support_tickets", column_name: "id" },
  { table_name: "ticket_messages", column_name: "id" },
];
const INTRO_FKS = [
  { table_name: "ticket_messages", column_name: "ticket_id", ref_table: "support_tickets", ref_column: "id" },
];

/** Список колонок из "SELECT … FROM <t>" → имена | "*" (как вернул бы PG). */
function selectedFields(q: string, tableName: string): string[] | "*" {
  const m = q.match(new RegExp(`SELECT (.+?) FROM "${tableName}"`));
  if (!m) return "*";
  const fields: string[] = [];
  for (const item of m[1].split(", ")) {
    if (item.endsWith(` AS "__link__"`)) continue;
    if (item.trim() === "*" || item.trim() === `"${tableName}".*`) return "*";
    const prefixed = item.match(new RegExp(`^"${tableName}"\\."(\\w+)"$`));
    const plain = item.match(/^"(\w+)"$/);
    const f = prefixed?.[1] ?? plain?.[1];
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

  // --- транзакционное управление (execute.ts withClaims) ---
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/.test(q) || q.includes("set_config(") || /SET LOCAL ROLE/i.test(q)) {
    return { rows: [] };
  }

  // --- интроспекция (introspect.ts load) ---
  if (q.includes("information_schema.columns")) return { rows: INTRO_COLUMNS };
  if (q.includes("table_constraints") && q.includes("PRIMARY KEY")) return { rows: INTRO_PKS };
  if (q.includes("table_constraints") && q.includes("FOREIGN KEY")) return { rows: INTRO_FKS };
  if (q.includes("information_schema.tables")) return { rows: INTRO_TABLES };
  if (q.includes("pg_proc")) return { rows: [] };

  // --- INSERT support_tickets (number генерирует триггер — эмулируем) ---
  if (q.startsWith(`INSERT INTO "support_tickets"`)) {
    const colsM = q.match(/^INSERT INTO "support_tickets" \((.+?)\) VALUES/);
    const cols = colsM ? colsM[1].split(",").map((c) => c.replace(/"/g, "").trim()) : [];
    ticketSeq += 1;
    const row: Row = {
      ...TK_A,
      id: `tk-gen-${ticketSeq}`,
      number: `TKT-2026-${String(ticketSeq).padStart(4, "0")}`,
      subject: "synthetic",
      user_id: OWNER.id,
      assigned_to: null,
      order_id: null,
      status: "open",
      messages_count: 0,
      created_at: `2026-01-03T0${ticketSeq}:00:00Z`,
      updated_at: `2026-01-03T0${ticketSeq}:00:00Z`,
    };
    cols.forEach((c, i) => {
      row[c] = params[i];
    });
    tickets.push(row);
    return { rows: [{ ...row }] };
  }

  // --- INSERT ticket_messages ---
  if (q.startsWith(`INSERT INTO "ticket_messages"`)) {
    const colsM = q.match(/^INSERT INTO "ticket_messages" \((.+?)\) VALUES/);
    const cols = colsM ? colsM[1].split(",").map((c) => c.replace(/"/g, "").trim()) : [];
    const row: Row = { ...MSG_A1, id: `msg-gen-${ticketSeq}-${messages.length + 1}`, ticket_id: null, sender_id: null, text: null, is_internal: false, is_system: false };
    cols.forEach((c, i) => {
      row[c] = params[i];
    });
    messages.push(row);
    return { rows: [{ ...row }] };
  }

  // --- UPDATE support_tickets (PATCH) ---
  if (q.startsWith(`UPDATE "support_tickets"`)) {
    const [setPart, restPart] = q.split(" WHERE ");
    const setRe = /"(\w+)" = \$(\d+)/g;
    const updates: [string, unknown][] = [];
    let m: RegExpExecArray | null;
    while ((m = setRe.exec(setPart))) updates.push([m[1], params[Number(m[2]) - 1]]);
    let target: Row | undefined;
    if (restPart) {
      const whereRe = /"(\w+)" = \$(\d+)/g;
      const filters: [string, unknown][] = [];
      while ((m = whereRe.exec(restPart))) filters.push([m[1], params[Number(m[2]) - 1]]);
      target = tickets.find((t) => filters.every(([c, v]) => t[c] === v));
    }
    if (!target) return { rows: [] };
    for (const [c, v] of updates) target[c] = v;
    target.updated_at = "2026-01-05T00:00:00Z";
    return { rows: [{ ...target }] };
  }

  // --- embed-подзапрос ticket_messages (... AS "__link__") ---
  if (q.includes(`FROM "ticket_messages"`) && q.includes("__link__")) {
    const linkVals = (params[0] as unknown[]) ?? [];
    const fields = selectedFields(q, "ticket_messages");
    return {
      rows: messages
        .filter((msg) => linkVals.includes(msg.ticket_id))
        .map((msg) => ({ ...project(msg, fields), __link__: msg.ticket_id })),
    };
  }

  // --- обычный SELECT (базовая таблица; eq-фильтры через "col" = $n) ---
  if (q.startsWith("SELECT") && q.includes(`FROM "support_tickets"`)) {
    let out = tickets;
    const whereIdx = q.indexOf(" WHERE ");
    if (whereIdx >= 0) {
      const whereRe = /"(\w+)" = \$(\d+)/g;
      let m: RegExpExecArray | null;
      while ((m = whereRe.exec(q.slice(whereIdx)))) {
        const col = m[1];
        const val = params[Number(m[2]) - 1];
        out = out.filter((t) => t[col] === val);
      }
    }
    if (/ORDER BY "created_at" DESC/i.test(q)) {
      out = [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    return { rows: out.map((t) => project(t, selectedFields(q, "support_tickets"))) };
  }

  throw new Error(`fake pgrst pool: unexpected SQL: ${sql}`);
}

const poolRef: { current: { connect: () => Promise<{ query: typeof fakeQuery; release: () => void }> } | null } = { current: null };

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => poolRef.current,
}));

// ============================================================================
// supabaseAdmin → РЕАЛЬНЫЙ supabase-js клиент, чей fetch заведён на РЕАЛЬНЫЙ
// PostgREST-шим (/rest/v1/[...path]) с замоканным пулом
// ============================================================================

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

// --- конвенция репозитория: мок аутентификации роута ---
const getUserFromRequestMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequestMock(...args),
}));

vi.mock("@/lib/supabase/auth", () => ({
  forbiddenResponse: (message?: string) =>
    NextResponse.json({ error: message ?? "Forbidden" }, { status: 403 }),
  unauthorizedResponse: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));

import { GET as listTickets, POST as createTicket } from "./route";
import { GET as getTicketById, PATCH as patchTicket } from "./[id]/route";

// ============================================================================
// Хелперы вызова роутов
// ============================================================================

const BASE = "http://localhost:3000";

async function callList(user: { id: string; roles: string[] } | null, filter: string): Promise<NextResponse> {
  getUserFromRequestMock.mockResolvedValue(user);
  return listTickets(new NextRequest(`${BASE}/api/crm/tickets?filter=${filter}`));
}

async function callGetById(user: { id: string; roles: string[] } | null, id: string): Promise<NextResponse> {
  getUserFromRequestMock.mockResolvedValue(user);
  return getTicketById(new NextRequest(`${BASE}/api/crm/tickets/${id}`), {
    params: Promise.resolve({ id }),
  });
}

async function callPost(user: { id: string; roles: string[] } | null, body: unknown): Promise<NextResponse> {
  getUserFromRequestMock.mockResolvedValue(user);
  return createTicket(
    new NextRequest(`${BASE}/api/crm/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function callPatch(user: { id: string; roles: string[] } | null, id: string, body: unknown): Promise<NextResponse> {
  getUserFromRequestMock.mockResolvedValue(user);
  return patchTicket(
    new NextRequest(`${BASE}/api/crm/tickets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

const TICKET_BODY = {
  subject: "Не пришёл заказ",
  category: "order_issue",
  priority: "medium",
  orderId: "ord-0001",
  message: "Заказ оплачен, но статуса нет",
};

// ============================================================================
// Тесты
// ============================================================================

beforeEach(() => {
  tickets = [structuredClone(TK_A), structuredClone(TK_B)];
  messages = [structuredClone(MSG_A1), structuredClone(MSG_A2), structuredClone(MSG_B1)];
  ticketSeq = 0;
  poolRef.current = { connect: async () => ({ query: fakeQuery, release: () => {} }) };
  getUserFromRequestMock.mockReset();
  invalidateIntrospection();
  process.env.JWT_SECRET = "test-jwt-secret-for-pgrst-shim";
  // глобальный fetch — только для edge-notification в POST (не для шима:
  // supabase-js использует собственный кастомный fetch)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.JWT_SECRET;
});

describe("GET /api/crm/tickets — список несёт id строк (DEV-19, U-08 fix)", () => {
  it("a) owner filter=own → 200, каждая строка имеет id + embed messages цел", async () => {
    const res = await callList(OWNER, "own");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.tickets)).toBe(true);
    expect(json.tickets).toHaveLength(1);

    for (const t of json.tickets) {
      expect(typeof t.id).toBe("string");
      expect(t.id).toBe("tk-aaaa-1");
      expect(t.number).toBe("TKT-2026-0001");
      // embed-поля целы
      expect(Array.isArray(t.messages)).toBe(true);
      expect(t.messages.map((m: Row) => m.id).sort()).toEqual(["msg-1", "msg-2"]);
      for (const m of t.messages) {
        for (const k of ["id", "sender_id", "text", "is_internal", "created_at"]) {
          expect(k in m).toBe(true);
        }
      }
    }
  });

  it("d) повторный GET списка → те же id (консистентность между вызовами)", async () => {
    const res1 = await callList(OWNER, "own");
    const json1 = await res1.json();
    const res2 = await callList(OWNER, "own");
    const json2 = await res2.json();
    expect(json2.tickets.map((t: Row) => t.id)).toEqual(json1.tickets.map((t: Row) => t.id));

    const s1 = await callList(SUPPORT, "all");
    const s2 = await callList(SUPPORT, "all");
    const ids1 = (await s1.json()).tickets.map((t: Row) => t.id).sort();
    const ids2 = (await s2.json()).tickets.map((t: Row) => t.id).sort();
    expect(ids2).toEqual(ids1);
  });
});

describe("GET /api/crm/tickets/[id] — открытие тикета по id из списка", () => {
  it("b) owner открывает свой тикет по id из списка → 200, корректная запись", async () => {
    const listJson = await (await callList(OWNER, "own")).json();
    const id = listJson.tickets[0].id as string;
    expect(id).toBeTruthy();

    const res = await callGetById(OWNER, id);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ticket.id).toBe("tk-aaaa-1");
    expect(json.ticket.number).toBe("TKT-2026-0001");
    expect(json.ticket.subject).toBe("Тикет A (владелец)");
    // базовый PK побеждает: id тикета ≠ id сообщения
    expect(json.ticket.messages[0].id).not.toBe(json.ticket.id);
    // non-staff owner: внутренние заметки скрыты, маппинг UI-контракта
    expect(json.ticket.messages).toHaveLength(1);
    expect(json.ticket.messages[0]).toMatchObject({
      id: "msg-1",
      ticketId: "tk-aaaa-1",
      authorId: OWNER.id,
      authorRole: "customer",
      isInternal: false,
    });
  });

  it("SUPPORT открывает тикет по id → 200, внутренние заметки видны", async () => {
    const res = await callGetById(SUPPORT, "tk-aaaa-1");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ticket.id).toBe("tk-aaaa-1");
    expect(json.ticket.messages).toHaveLength(2);
  });
});

describe("POST /api/crm/tickets — повторная отправка (текущий контракт)", () => {
  it("c) байт-в-байт одинаковый POST → 2 тикета (НЕ идемпотентно — finding #3 для владельца, контракт залочен как есть; семантика создания в этой задаче НЕ меняется)", async () => {
    const res1 = await callPost(OWNER, TICKET_BODY);
    const res2 = await callPost(OWNER, TICKET_BODY);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const t1 = (await res1.json()).ticket;
    const t2 = (await res2.json()).ticket;
    // документируем поведение: дубликат создаётся, id/number разные
    expect(t1.id).not.toBe(t2.id);
    expect(t1.number).not.toBe(t2.number);
    // на «уровне БД» ровно два новых тикета этого пользователя с этим subject
    const dups = tickets.filter((t) => t.user_id === OWNER.id && t.subject === TICKET_BODY.subject);
    expect(dups).toHaveLength(2);
    // первое сообщение создано для каждого
    expect(messages.filter((m) => m.ticket_id === t1.id)).toHaveLength(1);
    expect(messages.filter((m) => m.ticket_id === t2.id)).toHaveLength(1);
  });
});

describe("Ролевая изоляция /api/crm/tickets (scope не сужен/не расширен)", () => {
  it("e) owner видит ТОЛЬКО свои тикеты (filter=own)", async () => {
    const json = await (await callList(OWNER, "own")).json();
    const ids = json.tickets.map((t: Row) => t.id);
    expect(ids).toContain("tk-aaaa-1");
    expect(ids).not.toContain("tk-bbbb-2");
  });

  it("e) второй пользователь: в своём списке тикет первого НЕВИДИМ (симметричная изоляция)", async () => {
    const json = await (await callList(OTHER, "own")).json();
    const ids = json.tickets.map((t: Row) => t.id);
    expect(ids).toEqual(["tk-bbbb-2"]); // только свой; tk-aaaa-1 невидим
  });

  it("e) owner: filter=all → 403 (список всех — только staff)", async () => {
    const res = await callList(OWNER, "all");
    expect(res.status).toBe(403);
  });

  it("e) чужой тикет: прямой GET другим пользователем → 403", async () => {
    const res = await callGetById(OTHER, "tk-aaaa-1");
    expect(res.status).toBe(403);
    const resOwner = await callGetById(OWNER, "tk-bbbb-2");
    expect(resOwner.status).toBe(403);
  });

  it("e) несуществующий id → 404", async () => {
    const res = await callGetById(OWNER, "tk-unknown-0");
    expect(res.status).toBe(404);
  });

  it("без аутентификации → 401 (list и by-id)", async () => {
    expect((await callList(null, "own")).status).toBe(401);
    expect((await callGetById(null, "tk-aaaa-1")).status).toBe(401);
  });

  it("SUPPORT: filter=all → 200, видит тикеты всех пользователей (scope не сужен)", async () => {
    const json = await (await callList(SUPPORT, "all")).json();
    const ids = json.tickets.map((t: Row) => t.id).sort();
    expect(ids).toEqual(["tk-aaaa-1", "tk-bbbb-2"]);
  });

  it("ADMIN: filter=all → 200, видит все тикеты (полномочия сохранены)", async () => {
    const json = await (await callList(ADMIN, "all")).json();
    const ids = json.tickets.map((t: Row) => t.id).sort();
    expect(ids).toEqual(["tk-aaaa-1", "tk-bbbb-2"]);
  });

  it("ADMIN/SUPPORT сохраняют статусные действия: PATCH resolved → 200 и статус меняется", async () => {
    const res = await callPatch(ADMIN, "tk-bbbb-2", { status: "resolved" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ticket.status).toBe("resolved");
    expect(json.ticket.id).toBe("tk-bbbb-2");
    // состояние «БД» обновлено
    const row = tickets.find((t) => t.id === "tk-bbbb-2");
    expect(row?.status).toBe("resolved");
    expect(row?.resolved_at).toBeTruthy();
  });

  it("owner может закрыть свой тикет (PATCH без assignedTo) → 200", async () => {
    const res = await callPatch(OWNER, "tk-aaaa-1", { status: "closed" });
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.status).toBe("closed");
  });

  it("owner НЕ может назначать (assignedTo) → 403 «Только support может назначать тикеты»", async () => {
    const res = await callPatch(OWNER, "tk-aaaa-1", { assignedTo: SUPPORT.id });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Только support может назначать");
  });

  it("чужой пользователь не может менять чужой тикет → 403", async () => {
    const res = await callPatch(OTHER, "tk-aaaa-1", { status: "closed" });
    expect(res.status).toBe(403);
    expect(tickets.find((t) => t.id === "tk-aaaa-1")?.status).toBe("open");
  });
});
