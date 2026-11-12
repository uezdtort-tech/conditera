/**
 * Герметичные тесты /api/operator/messages — тред эскалации оператора
 * (Z-v16, SUPPORT-1).
 *
 * Первопричина: маршрут читал `operator_escalations` (0010, NOT NULL
 * ticket_id/operator_id — вставки из auto-reply всегда падали), тогда как
 * список (operator/escalations), assign и resolve работают с
 * `chat_escalations` (0019). Сведено на chat_escalations; сообщения — по
 * `chat_messages.channel_id` (0004) для каналов chat_channels.
 *
 * Лочит контракт:
 *   a) GET по id эскалации из списка (chat_escalations) → 200: room_id
 *      замаплен из chat_room_id, user_name из profiles, message из metadata;
 *   b) GET неизвестного id → 404; GET не-staff → 403;
 *   c) POST: pending-эскалация автоматически берётся в работу
 *      (status=assigned, assigned_to), сообщение пишется в channel_id,
 *      метрики канала обновляются, уведомление пользователю — 1 шт;
 *   d) POST по уже назначенной эскалации → autoAssigned=false;
 *   e) POST не-staff → 403; превышение длины text → 422.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { invalidateIntrospection } from "@/lib/postgrest/introspect";

type Row = Record<string, unknown>;

const CUSTOMER = { userId: "u-cust-1", id: "u-cust-1", name: "Покупатель", email: "c@test.local", roles: ["CUSTOMER"], accountType: "customer" };
const SUPPORT = { userId: "u-sup-1", id: "u-sup-1", name: "Оператор Анна", email: "s@test.local", roles: ["SUPPORT"], accountType: "support" };
const CONFECTIONER = { userId: "u-conf-1", id: "u-conf-1", name: "Кондитер", email: "conf@test.local", roles: ["CONFECTIONER"], accountType: "confectioner" };

const CH_SUP = "ch-sup-0001";
const CUST_ID = CUSTOMER.id;

const ESC_PENDING: Row = {
  id: "esc-pend-0001",
  chat_room_id: CH_SUP,
  user_id: CUST_ID,
  reason: "manual_request",
  priority: "high",
  status: "pending",
  assigned_to: null,
  assigned_at: null,
  resolved_by: null,
  resolved_at: null,
  resolution: null,
  messages_count: 0,
  wait_time_sec: null,
  metadata: { source: "chat_messages_post", user_name: "Покупатель", message_preview: "Оператор, помогите!" },
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};
const ESC_ASSIGNED: Row = {
  ...ESC_PENDING,
  id: "esc-assg-0002",
  status: "assigned",
  assigned_to: SUPPORT.id,
  assigned_at: "2026-01-02T01:00:00Z",
};

let escalations: Row[];
let messages: Row[];
const channels: Row[] = [
  { id: CH_SUP, type: "support", name: "Поддержка", support_ticket_id: null, order_id: null, last_message_at: null, last_message_text: null, messages_count: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", deleted_at: null },
];
const profiles: Row[] = [
  { id: CUST_ID, name: "Покупатель", avatar_url: null },
  { id: SUPPORT.id, name: "Оператор Анна", avatar_url: null },
];
let messageSeq = 0;
const sendNotificationMock = vi.fn(async (..._args: unknown[]) => ({}));

beforeEach(() => {
  escalations = [JSON.parse(JSON.stringify(ESC_PENDING)), JSON.parse(JSON.stringify(ESC_ASSIGNED))];
  messages = [
    { id: "msg-1", channel_id: CH_SUP, room_id: null, sender_id: CUST_ID, text: "Оператор, помогите!", attachments: null, reply_to_id: null, is_edited: false, edited_at: null, is_deleted: false, deleted_at: null, is_system: false, system_event: null, is_bot: false, bot_kind: null, quick_replies: null, metadata: null, idempotency_key: null, created_at: "2026-01-02T00:01:00Z" },
  ];
  messageSeq = 0;
  for (const c of channels) { c.last_message_at = null; c.last_message_text = null; }
  sendNotificationMock.mockClear();
});

const TABLES = ["chat_channels", "chat_messages", "chat_escalations", "profiles"];

function colsFor(table: string): Row[] {
  const defs: Record<string, [string, string][]> = {
    chat_channels: [
      ["id", "uuid"], ["type", "text"], ["name", "text"], ["support_ticket_id", "uuid"],
      ["order_id", "uuid"], ["last_message_at", "timestamptz"], ["last_message_text", "text"],
      ["messages_count", "int4"], ["created_at", "timestamptz"], ["updated_at", "timestamptz"], ["deleted_at", "timestamptz"],
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
    profiles: [["id", "uuid"], ["name", "text"], ["avatar_url", "text"]],
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

function param(params: unknown[], n: number): unknown {
  return params[n - 1];
}

function parseWhere(sql: string): [string, number][] {
  const idx = sql.indexOf(" WHERE ");
  if (idx < 0) return [];
  const conds: [string, number][] = [];
  const re = /"(\w+)" (=|<>|!=) \$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql.slice(idx + 7)))) {
    conds.push([m[1], Number(m[3])]);
  }
  return conds;
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

  // --- UPDATE chat_escalations (assign) ---
  if (q.startsWith(`UPDATE "chat_escalations"`)) {
    const [setPart, restPart] = q.split(" WHERE ");
    const setRe = /"(\w+)" = \$(\d+)/g;
    const updates: [string, unknown][] = [];
    let m: RegExpExecArray | null;
    while ((m = setRe.exec(setPart))) updates.push([m[1], param(params, Number(m[2]))]);
    const conds = parseWhere(restPart ? ` WHERE ${restPart}` : "");
    const target = escalations.find((e) => conds.every(([col, n]) => e[col] === param(params, n)));
    if (!target) return { rows: [] };
    for (const [c, v] of updates) target[c] = v;
    target.updated_at = "2026-01-03T00:00:00Z";
    return { rows: [{ ...target }] };
  }

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
      metadata: null, idempotency_key: null, created_at: `2026-01-02T02:0${messageSeq % 10}:00Z`,
    };
    const colUdts = new Map(colsFor("chat_messages").map((c) => [c.column_name, c.udt_name as string | undefined]));
    cols.forEach((c, i) => { row[c] = maybeJson(params[i], colUdts.get(c)); });
    messages.push(row);
    return { rows: [{ ...row }] };
  }

  // --- UPDATE chat_channels (метрики) ---
  if (q.startsWith(`UPDATE "chat_channels"`)) {
    const [setPart, restPart] = q.split(" WHERE ");
    const setRe = /"(\w+)" = \$(\d+)/g;
    const updates: [string, unknown][] = [];
    let m: RegExpExecArray | null;
    while ((m = setRe.exec(setPart))) updates.push([m[1], param(params, Number(m[2]))]);
    const conds = parseWhere(restPart ? ` WHERE ${restPart}` : "");
    const target = channels.find((c) => conds.every(([col, n]) => c[col] === param(params, n)));
    if (!target) return { rows: [] };
    for (const [c, v] of updates) target[c] = v;
    return { rows: [{ ...target }] };
  }

  // --- SELECT chat_escalations ---
  if (q.startsWith("SELECT") && q.includes(`FROM "chat_escalations"`)) {
    const conds = parseWhere(q);
    const out = escalations.filter((r) => conds.every(([col, n]) => r[col] === param(params, n)));
    return { rows: out.map((r) => project(r, q, "chat_escalations")) };
  }

  // --- SELECT chat_channels ---
  if (q.startsWith("SELECT") && q.includes(`FROM "chat_channels"`)) {
    const conds = parseWhere(q);
    const out = channels.filter((r) => conds.every(([col, n]) => r[col] === param(params, n)));
    return { rows: out.map((r) => project(r, q, "chat_channels")) };
  }

  // --- SELECT chat_messages (тред) ---
  if (q.startsWith("SELECT") && q.includes(`FROM "chat_messages"`)) {
    const conds = parseWhere(q);
    let out = messages.filter((r) => conds.every(([col, n]) => r[col] === param(params, n)));
    out = [...out].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return { rows: out.map((r) => project(r, q, "chat_messages")) };
  }

  // --- SELECT profiles ---
  if (q.startsWith("SELECT") && q.includes(`FROM "profiles"`)) {
    const conds = parseWhere(q);
    const out = profiles.filter((r) => conds.every(([col, n]) => r[col] === param(params, n)));
    return { rows: out.map((r) => project(r, q, "profiles")) };
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

// ZV31-007: маршрут сверяет роль с user_roles через requireAnyRole.
// Фейковая семантика реального guard'а: роль берём из "сессии" текущего
// пользователя (тот же источник, что раньше читал инлайн-чек), 401 без
// пользователя, 403 если нужной роли нет.
const requireAnyRoleMock = vi.fn(async (...args: unknown[]) => {
  const wanted = (args[1] ?? []) as readonly string[];
  const user = (await getUserFromRequestMock.mock.results.at(-1)?.value) as
    | { roles?: string[] }
    | undefined;
  if (!user) {
    return new Response(JSON.stringify({ error: "Необходима аутентификация" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const roles = user.roles ?? [];
  if (wanted.length > 0 && !wanted.some((r) => roles.includes(r))) {
    return new Response(
      JSON.stringify({ error: `Требуется одна из ролей: ${wanted.join(", ")}` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
});
vi.mock("@/lib/role-guards", () => ({
  requireAnyRole: (...args: unknown[]) => requireAnyRoleMock(...args),
}));

vi.mock("@/lib/notifications", () => ({
  sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
}));

import { GET as getMessages, POST as postMessage } from "./route";

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

describe("GET /api/operator/messages — тред эскалации", () => {
  it("эскалация из chat_escalations маппится в UI-форму (room_id, user_name, message)", async () => {
    getUserFromRequestMock.mockResolvedValue(SUPPORT);
    const res = await getMessages(
      new NextRequest(`${BASE}/api/operator/messages?escalationId=esc-pend-0001`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.escalation).toMatchObject({
      id: "esc-pend-0001",
      room_id: CH_SUP,
      user_id: CUST_ID,
      user_name: "Покупатель",
      status: "pending",
      reason: "manual_request",
      priority: "high",
      message: "Оператор, помогите!",
    });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text).toBe("Оператор, помогите!");
  });

  it("неизвестный escalationId → 404", async () => {
    getUserFromRequestMock.mockResolvedValue(SUPPORT);
    const res = await getMessages(
      new NextRequest(`${BASE}/api/operator/messages?escalationId=nope`)
    );
    expect(res.status).toBe(404);
  });

  it("не-staff → 403", async () => {
    getUserFromRequestMock.mockResolvedValue(CUSTOMER);
    const res = await getMessages(
      new NextRequest(`${BASE}/api/operator/messages?escalationId=esc-pend-0001`)
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/operator/messages — ответ оператора", () => {
  it("pending → авто-назначение + сообщение в channel_id + метрики канала + уведомление", async () => {
    getUserFromRequestMock.mockResolvedValue(SUPPORT);
    const res = await postMessage(
      new NextRequest(`${BASE}/api/operator/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ escalationId: "esc-pend-0001", text: "Здравствуйте! Чем помочь?" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoAssigned).toBe(true);

    const esc = escalations.find((e) => e.id === "esc-pend-0001");
    expect(esc).toMatchObject({ status: "assigned", assigned_to: SUPPORT.id });

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      channel_id: CH_SUP,
      sender_id: SUPPORT.id,
      text: "Здравствуйте! Чем помочь?",
      is_bot: false,
      is_system: false,
    });

    const ch = channels[0];
    expect(ch.last_message_text).toContain("Оператор");

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock.mock.calls[0][0]).toMatchObject({
      userId: CUST_ID,
      template: "NEW_MESSAGE",
    });
  });

  it("повторный ответ по назначенной эскалации → autoAssigned=false", async () => {
    getUserFromRequestMock.mockResolvedValue(SUPPORT);
    const res = await postMessage(
      new NextRequest(`${BASE}/api/operator/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ escalationId: "esc-assg-0002", text: "Уточните, пожалуйста" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoAssigned).toBe(false);
    expect(messages).toHaveLength(2);
  });

  it("не-staff → 403", async () => {
    getUserFromRequestMock.mockResolvedValue(CONFECTIONER);
    const res = await postMessage(
      new NextRequest(`${BASE}/api/operator/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ escalationId: "esc-pend-0001", text: "спам" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("text > 5000 символов → 422", async () => {
    getUserFromRequestMock.mockResolvedValue(SUPPORT);
    const res = await postMessage(
      new NextRequest(`${BASE}/api/operator/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ escalationId: "esc-pend-0001", text: "а".repeat(5001) }),
      })
    );
    expect(res.status).toBe(422);
  });
});
