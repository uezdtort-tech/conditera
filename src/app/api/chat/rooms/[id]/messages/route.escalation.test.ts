/**
 * Герметичные тесты POST /api/chat/rooms/[id]/messages — триггер эскалации
 * поддержки (Z-v16, SUPPORT-1).
 *
 * РЕАЛЬНЫЙ supabase-js → РЕАЛЬНЫЙ PostgREST-шим (/rest/v1) → фейковый pg-пул
 * (конвенция репозитория, см. crm/tickets/route.test.ts). Замоканы только
 * getUserFromRequest, n8n и notifications.
 *
 * Лочит контракт:
 *   a) support-канал + явный запрос оператора (кириллица) → создана ровно
 *      одна эскалация в chat_escalations (0019-колонки), сообщение сохранено;
 *   b) повторный запрос в ту же комнату → дедуп, дубля нет;
 *   c) не-support канал → эскалации нет;
 *   d) staff-отправитель → эскалации нет;
 *   e) текст без запроса оператора → эскалации нет;
 *   f) сбой эскалации не роняет отправку сообщения (fail-safe).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { invalidateIntrospection } from "@/lib/postgrest/introspect";

type Row = Record<string, unknown>;

const CUSTOMER = { userId: "u-cust-1", id: "u-cust-1", name: "Покупатель", email: "c@test.local", roles: ["CUSTOMER"], accountType: "customer" };
const STAFF = { userId: "u-sup-1", id: "u-sup-1", name: "Оператор", email: "s@test.local", roles: ["SUPPORT", "CUSTOMER"], accountType: "support" };

const CH_SUP = "ch-sup-0001";
const CH_DIR = "ch-dir-0001";

const CHANNELS: Row[] = [
  { id: CH_SUP, type: "support", name: "Поддержка", support_ticket_id: null, order_id: null, last_message_at: null, last_message_text: null, messages_count: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", deleted_at: null },
  { id: CH_DIR, type: "direct", name: null, support_ticket_id: null, order_id: null, last_message_at: null, last_message_text: null, messages_count: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", deleted_at: null },
];

let members: Row[];
let messages: Row[];
let escalations: Row[];
let messageSeq = 0;
let escalationSeq = 0;

beforeEach(() => {
  members = [
    { id: "m-1", channel_id: CH_SUP, user_id: CUSTOMER.id, role: "member", joined_at: "2026-01-01T00:00:00Z", left_at: null },
    { id: "m-2", channel_id: CH_DIR, user_id: CUSTOMER.id, role: "member", joined_at: "2026-01-01T00:00:00Z", left_at: null },
  ];
  messages = [];
  escalations = [];
  messageSeq = 0;
  escalationSeq = 0;
});

const TABLES = ["chat_channels", "chat_channel_members", "chat_messages", "chat_escalations"];

function colsFor(table: string): Row[] {
  const defs: Record<string, [string, string][]> = {
    chat_channels: [
      ["id", "uuid"], ["type", "text"], ["name", "text"], ["support_ticket_id", "uuid"],
      ["order_id", "uuid"], ["last_message_at", "timestamptz"], ["last_message_text", "text"],
      ["messages_count", "int4"], ["created_at", "timestamptz"], ["updated_at", "timestamptz"], ["deleted_at", "timestamptz"],
    ],
    chat_channel_members: [
      ["id", "uuid"], ["channel_id", "uuid"], ["user_id", "uuid"], ["role", "text"],
      ["joined_at", "timestamptz"], ["left_at", "timestamptz"],
    ],
    chat_messages: [
      ["id", "uuid"], ["channel_id", "uuid"], ["room_id", "text"], ["sender_id", "uuid"],
      ["text", "text"], ["attachments", "jsonb"], ["reply_to_id", "uuid"], ["is_edited", "bool"],
      ["edited_at", "timestamptz"], ["is_deleted", "bool"], ["deleted_at", "timestamptz"],
      ["is_system", "bool"], ["system_event", "text"], ["is_bot", "bool"], ["bot_kind", "text"],
      ["quick_replies", "jsonb"], ["metadata", "jsonb"], ["idempotency_key", "text"],
      ["created_at", "timestamptz"],
    ],
    chat_escalations: [
      ["id", "uuid"], ["chat_room_id", "uuid"], ["user_id", "uuid"], ["reason", "text"],
      ["priority", "text"], ["status", "text"], ["assigned_to", "uuid"], ["assigned_at", "timestamptz"],
      ["resolved_by", "uuid"], ["resolved_at", "timestamptz"], ["resolution", "text"],
      ["messages_count", "int4"], ["wait_time_sec", "int4"], ["metadata", "jsonb"],
      ["created_at", "timestamptz"], ["updated_at", "timestamptz"],
    ],
  };
  return (defs[table] || []).map(([column_name, udt_name]) => ({
    table_name: table,
    column_name,
    data_type: udt_name === "uuid" ? "uuid" : udt_name === "int4" ? "integer" : udt_name === "bool" ? "boolean" : udt_name === "jsonb" ? "jsonb" : "text",
    udt_name,
    is_nullable: "YES",
  }));
}

const INTRO_COLUMNS = TABLES.flatMap(colsFor);
const INTRO_PKS = TABLES.map((t) => ({ table_name: t, column_name: "id" }));

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

function parseWhere(sql: string): [string, unknown, string][] {
  const idx = sql.indexOf(" WHERE ");
  if (idx < 0) return [];
  const wherePart = sql.slice(idx + 7);
  const conds: [string, unknown, string][] = [];
  const re = /"(\w+)" (=|<>|!=) \$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wherePart))) {
    conds.push([m[1], m[2], String(m[3])]);
  }
  return conds;
}

function param(params: unknown[], n: string): unknown {
  return params[Number(n) - 1];
}

function maybeJson(value: unknown, udt: string | undefined): unknown {
  if (udt === "jsonb" && typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function fakeQuery(sql: string, params: unknown[] = []): { rows: Row[] } {
  const q = sql.replace(/\s+/g, " ").trim();

  if (/^(BEGIN|COMMIT|ROLLBACK)\b/.test(q) || q.includes("set_config(") || /SET LOCAL ROLE/i.test(q)) {
    return { rows: [] };
  }
  if (q.includes("information_schema.columns")) return { rows: INTRO_COLUMNS };
  if (q.includes("table_constraints") && q.includes("PRIMARY KEY")) return { rows: INTRO_PKS };
  if (q.includes("table_constraints") && q.includes("FOREIGN KEY")) return { rows: [] };
  if (q.includes("information_schema.tables")) return { rows: TABLES.map((t) => ({ table_name: t })) };
  if (q.includes("pg_proc")) return { rows: [] };

  // --- INSERT chat_messages ---
  if (q.startsWith(`INSERT INTO "chat_messages"`)) {
    const colsM = q.match(/^INSERT INTO "chat_messages" \((.+?)\) VALUES/);
    const cols = colsM ? colsM[1].split(",").map((c) => c.replace(/"/g, "").trim()) : [];
    messageSeq += 1;
    const row: Row = {
      id: `msg-gen-${messageSeq}`,
      channel_id: null, room_id: null, sender_id: null, text: null, attachments: null,
      reply_to_id: null, is_edited: false, edited_at: null, is_deleted: false, deleted_at: null,
      is_system: false, system_event: null, is_bot: false, bot_kind: null, quick_replies: null,
      metadata: null, idempotency_key: null, created_at: `2026-01-02T00:0${messageSeq % 10}:00Z`,
    };
    const colUdts = new Map(colsFor("chat_messages").map((c) => [c.column_name, c.udt_name as string | undefined]));
    cols.forEach((c, i) => { row[c] = maybeJson(params[i], colUdts.get(c)); });
    messages.push(row);
    return { rows: [{ ...row }] };
  }

  // --- INSERT chat_escalations ---
  if (q.startsWith(`INSERT INTO "chat_escalations"`)) {
    const colsM = q.match(/^INSERT INTO "chat_escalations" \((.+?)\) VALUES/);
    const cols = colsM ? colsM[1].split(",").map((c) => c.replace(/"/g, "").trim()) : [];
    escalationSeq += 1;
    const row: Row = {
      id: `esc-gen-${escalationSeq}`,
      chat_room_id: null, user_id: null, reason: null, priority: "normal", status: "pending",
      assigned_to: null, assigned_at: null, resolved_by: null, resolved_at: null, resolution: null,
      messages_count: 0, wait_time_sec: null, metadata: null,
      created_at: `2026-01-02T00:0${escalationSeq % 10}:00Z`, updated_at: `2026-01-02T00:0${escalationSeq % 10}:00Z`,
    };
    const colUdts = new Map(colsFor("chat_escalations").map((c) => [c.column_name, c.udt_name as string | undefined]));
    cols.forEach((c, i) => { row[c] = maybeJson(params[i], colUdts.get(c)); });
    escalations.push(row);
    return { rows: [{ ...row }] };
  }

  // --- UPDATE chat_channels / chat_escalations ---
  if (q.startsWith(`UPDATE "chat_channels"`)) {
    const [setPart, restPart] = q.split(" WHERE ");
    const setRe = /"(\w+)" = \$(\d+)/g;
    const updates: [string, unknown][] = [];
    let m: RegExpExecArray | null;
    while ((m = setRe.exec(setPart))) updates.push([m[1], params[Number(m[2]) - 1]]);
    const conds = parseWhere(restPart ? ` WHERE ${restPart}` : "");
    const target = CHANNELS.find((c) => conds.every(([col, , n]) => c[col] === param(params, n)));
    if (!target) return { rows: [] };
    for (const [c, v] of updates) target[c] = v;
    return { rows: [{ ...target }] };
  }

  // --- SELECT chat_channels ---
  if (q.startsWith("SELECT") && q.includes(`FROM "chat_channels"`)) {
    const conds = parseWhere(q);
    const out = CHANNELS.filter((c) => conds.every(([col, , n]) => c[col] === param(params, n)));
    return { rows: out.map((r) => project(r, q, "chat_channels")) };
  }

  // --- SELECT chat_channel_members ---
  if (q.startsWith("SELECT") && q.includes(`FROM "chat_channel_members"`)) {
    const conds = parseWhere(q);
    const out = members.filter((r) => conds.every(([col, , n]) => r[col] === param(params, n)));
    return { rows: out.map((r) => project(r, q, "chat_channel_members")) };
  }

  // --- SELECT chat_escalations (дедуп) ---
  if (q.startsWith("SELECT") && q.includes(`FROM "chat_escalations"`)) {
    const conds = parseWhere(q);
    const out = escalations.filter((r) => conds.every(([col, , n]) => r[col] === param(params, n)));
    return { rows: out.map((r) => project(r, q, "chat_escalations")) };
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

vi.mock("@/lib/n8n", () => ({
  emitEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/notifications", () => ({
  sendNotification: vi.fn(async () => ({})),
}));

import { POST } from "./route";

const BASE = "http://localhost:3000";

async function callPost(
  user: typeof CUSTOMER | typeof STAFF | null,
  channelId: string,
  content: string
): Promise<NextResponse> {
  getUserFromRequestMock.mockResolvedValue(user);
  const req = new NextRequest(`${BASE}/api/chat/rooms/${channelId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return POST(req, { params: Promise.resolve({ id: channelId }) });
}

beforeEach(() => {
  invalidateIntrospection();
  getUserFromRequestMock.mockReset();
  poolRef.current = { connect: async () => ({ query: fakeQuery, release: () => {} }) };
  process.env.JWT_SECRET = "test-jwt-secret-for-pgrst-shim";
  // восстановить изменяемое состояние каналов
  for (const c of CHANNELS) {
    c.last_message_at = null;
    c.last_message_text = null;
  }
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

describe("POST /api/chat/rooms/[id]/messages — триггер эскалации поддержки", () => {
  it("support-канал + «Оператор, помогите!» → эскалация в chat_escalations + сообщение сохранено", async () => {
    const res = await callPost(CUSTOMER, CH_SUP, "Оператор, помогите!");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.message.text).toBe("Оператор, помогите!");
    expect(messages).toHaveLength(1);
    expect(messages[0].channel_id).toBe(CH_SUP);

    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      chat_room_id: CH_SUP,
      user_id: CUSTOMER.id,
      reason: "manual_request",
      priority: "high",
      status: "pending",
    });
    expect(escalations[0].metadata).toMatchObject({
      source: "chat_messages_post",
      user_name: "Покупатель",
      message_preview: "Оператор, помогите!",
    });
  });

  it("повторный запрос оператора → дедуп, дубля эскалации нет", async () => {
    await callPost(CUSTOMER, CH_SUP, "Оператор!");
    const res2 = await callPost(CUSTOMER, CH_SUP, "Оператор, ну пожалуйста!");
    expect(res2.status).toBe(200);
    expect(escalations).toHaveLength(1);
    // сообщения — два (отправка не блокируется дедупом)
    expect(messages).toHaveLength(2);
  });

  it("не-support канал → эскалации нет (даже с запросом оператора)", async () => {
    const res = await callPost(CUSTOMER, CH_DIR, "Оператор!");
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(1);
    expect(escalations).toHaveLength(0);
  });

  it("staff-отправитель в support-канале → эскалации нет", async () => {
    // staff имеет доступ к support-комнате без membership (canAccessRoom)
    const res = await callPost(STAFF, CH_SUP, "Оператор нужен клиенту?");
    expect(res.status).toBe(200);
    expect(escalations).toHaveLength(0);
  });

  it("текст без запроса оператора → эскалации нет", async () => {
    await callPost(CUSTOMER, CH_SUP, "Здравствуйте, хочу заказать торт");
    expect(escalations).toHaveLength(0);
  });

  it("fail-safe: сбой создания эскалации не ломает отправку сообщения", async () => {
    // ломаем только дедуп-SELECT эскалаций: отдаём ошибку на таблицу эскалаций
    const orig = fakeQuery;
    poolRef.current = {
      connect: async () => ({
        query: (sql: string, params: unknown[] = []) => {
          if (sql.includes(`FROM "chat_escalations"`)) {
            throw new Error("escalations table unavailable");
          }
          return orig(sql, params);
        },
        release: () => {},
      }),
    };
    const res = await callPost(CUSTOMER, CH_SUP, "Оператор!");
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(1);
  });
});
