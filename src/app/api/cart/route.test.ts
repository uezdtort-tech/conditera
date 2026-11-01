/**
 * Регрессионные тесты /api/cart — серверная корзина (P1 §2, миграция 0062).
 *
 * Формат: герметичный end-to-end — РЕАЛЬНЫЙ supabase-js клиент (кастомный fetch)
 * → РЕАЛЬНЫЙ PostgREST-шим (/rest/v1/[...path]) → фейковый pg-пул с фикстурами
 * cart_items/products (эмуляция information_schema). getUserFromRequest мокается
 * по конвенции репозитория (см. crm/tickets/route.test.ts).
 *
 * Лочит контракт:
 *   a) 401 без сессии (GET/POST/PUT/DELETE);
 *   b) владение: пользователь видит/меняет ТОЛЬКО свои строки
 *      (.eq("user_id", session) на каждом пути);
 *   c) POST — идемпотентный upsert по client_ref: повтор (ретрай) НЕ создаёт дубль;
 *   d) POST — контент-дедуп: тот же товар+атрибуты под другим client_ref →
 *      MAX(количества), client_ref перезаписывается;
 *   e) POST — валидация: несуществующий/draft товар 400; неизвестный атрибут 400;
 *      quantity 0 400; валидный custom-конфиг → product_id NULL + custom_config;
 *      невалидный конфиг 422;
 *   f) PUT — UNION-слияние: серверные строки другого устройства сохраняются,
 *      количество = MAX, ответ — ПОЛНОЕ merged-состояние;
 *   g) DELETE — очищает только свои строки (чужие остаются);
 *   h) custom-строки совместимы с abandoned-cart чтением (product_id NULL допустим).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { invalidateIntrospection } from "@/lib/postgrest/introspect";

// ============================================================================
// Фейковый pg-пул: фикстуры cart_items/products + эмуляция information_schema
// ============================================================================

type Row = Record<string, unknown>;

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "a@test.local", roles: ["CUSTOMER"] };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", email: "b@test.local", roles: ["CUSTOMER"] };

const PROD_1: Row = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Медовик",
  price: 1800,
  images: ["https://img.test/medovik.png"],
  status: "published",
};
const PROD_DRAFT: Row = { ...PROD_1, id: "22222222-2222-2222-2222-222222222222", title: "Draft", status: "draft" };

// --- fillings (0062/валидация custom-позиций по БД) ---
/** Начинка, существующая ТОЛЬКО в БД (APPROVED + is_active), multiplier 1.5 → price 500. */
const FILL_DB_ONLY = "f1000000-0000-0000-0000-000000000001";
/** APPROVED, но is_active=false — валидным считаться НЕ должен. */
const FILL_INACTIVE = "f2000000-0000-0000-0000-000000000002";
let fillingsFail: boolean;
const FILLINGS_ROWS: Row[] = [
  { id: FILL_DB_ONLY, name: "Фисташка-мусс (из БД)", price_multiplier: 1.5, status: "APPROVED", is_active: true },
  { id: FILL_INACTIVE, name: "Скрытая начинка", price_multiplier: 1.2, status: "APPROVED", is_active: false },
];

let cartItems: Row[];
let cartSeq: number;

const INTRO_TABLES = [{ table_name: "cart_items" }, { table_name: "products" }, { table_name: "fillings" }];

const INTRO_COLUMNS: Row[] = [];
for (const [column_name, data_type, udt_name, is_nullable] of [
  ["id", "uuid", "uuid", "NO"],
  ["user_id", "uuid", "uuid", "YES"],
  ["session_id", "text", "text", "YES"],
  ["product_id", "uuid", "uuid", "YES"], // 0062: NULLABLE
  ["quantity", "integer", "int4", "NO"],
  ["selected_attributes", "jsonb", "jsonb", "YES"],
  ["notes", "text", "text", "YES"],
  ["created_at", "timestamp with time zone", "timestamptz", "YES"],
  ["updated_at", "timestamp with time zone", "timestamptz", "YES"],
  ["custom_config", "jsonb", "jsonb", "YES"], // 0062
  ["client_ref", "text", "text", "YES"], // 0062
] as [string, string, string, string][]) {
  INTRO_COLUMNS.push({ table_name: "cart_items", column_name, data_type, udt_name, is_nullable });
}
for (const [column_name, data_type, udt_name, is_nullable] of [
  ["id", "uuid", "uuid", "NO"],
  ["title", "text", "text", "NO"],
  ["price", "numeric", "numeric", "YES"],
  ["images", "jsonb", "jsonb", "YES"],
  ["status", "text", "text", "NO"],
] as [string, string, string, string][]) {
  INTRO_COLUMNS.push({ table_name: "products", column_name, data_type, udt_name, is_nullable });
}
for (const [column_name, data_type, udt_name, is_nullable] of [
  ["id", "uuid", "uuid", "NO"],
  ["name", "text", "text", "NO"],
  ["price_multiplier", "numeric", "numeric", "YES"],
  ["status", "text", "text", "NO"],
  ["is_active", "boolean", "bool", "NO"],
] as [string, string, string, string][]) {
  INTRO_COLUMNS.push({ table_name: "fillings", column_name, data_type, udt_name, is_nullable });
}

const INTRO_PKS = [
  { table_name: "cart_items", column_name: "id" },
  { table_name: "products", column_name: "id" },
];
const INTRO_FKS = [
  { table_name: "cart_items", column_name: "product_id", ref_table: "products", ref_column: "id" },
];

/** SELECT-колонки → имена | "*". */
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

/** WHERE-парсер: "col" = $n (и = ANY($n) — для in-фильтров). */
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
  const anyRe = /"(\w+)" = ANY\(\$(\d+)\)/g;
  while ((m = anyRe.exec(where))) {
    filters.push([m[1], params[Number(m[2]) - 1]]);
  }
  return filters;
}

/** jsonb-колонки: PG возвращает их как JS-объекты — эмулируем (INSERT приходит со строкой). */
const JSONB_COLS = new Set(["selected_attributes", "custom_config", "images", "metadata"]);

function decodeJsonb(row: Row): Row {
  for (const c of JSONB_COLS) {
    if (typeof row[c] === "string") {
      try {
        row[c] = JSON.parse(row[c] as string);
      } catch {
        /* оставляем как есть */
      }
    }
  }
  return row;
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

  // --- INSERT cart_items ---
  if (q.startsWith(`INSERT INTO "cart_items"`)) {
    const colsM = q.match(/^INSERT INTO "cart_items" \((.+?)\) VALUES/);
    const cols = colsM ? colsM[1].split(",").map((c) => c.replace(/"/g, "").trim()) : [];
    cartSeq += 1;
    const row: Row = {
      id: `cart-${String(cartSeq).padStart(4, "0")}`,
      user_id: null,
      session_id: null,
      product_id: null,
      quantity: 1,
      selected_attributes: null,
      notes: null,
      created_at: `2026-01-01T00:00:${String(cartSeq).padStart(2, "0")}Z`,
      updated_at: `2026-01-01T00:00:${String(cartSeq).padStart(2, "0")}Z`,
      custom_config: null,
      client_ref: null,
    };
    cols.forEach((c, i) => {
      row[c] = params[i];
    });
    cartItems.push(decodeJsonb(row));
    return { rows: [] };
  }

  // --- UPDATE cart_items ---
  if (q.startsWith(`UPDATE "cart_items"`)) {
    const [setPart, restPart] = q.split(" WHERE ");
    const setRe = /"(\w+)" = \$(\d+)/g;
    const updates: Array<[string, unknown]> = [];
    let m: RegExpExecArray | null;
    while ((m = setRe.exec(setPart))) updates.push([m[1], params[Number(m[2]) - 1]]);
    const filters = restPart ? parseWhere(` WHERE ${restPart}`, params) : [];
    const target = cartItems.find((r) => filters.every(([c, v]) => r[c] === v));
    if (!target) return { rows: [] };
    for (const [c, v] of updates) target[c] = typeof v === "string" && JSONB_COLS.has(c) ? decodeJsonb({ [c]: v })[c] : v;
    // RETURNING-парсинг (UPDATE ... RETURNING "id" — PATCH с .select("id"))
    const retM = q.match(/RETURNING (.+)$/);
    if (retM) {
      const fields = retM[1].split(",").map((s) => s.replace(/"/g, "").trim());
      return { rows: [{ ...project(target, fields) }] };
    }
    return { rows: [] };
  }

  // --- DELETE cart_items ---
  if (q.startsWith(`DELETE FROM "cart_items"`)) {
    const filters = parseWhere(q, params);
    const before = cartItems.length;
    cartItems = cartItems.filter((r) => !filters.every(([c, v]) => r[c] === v));
    const deleted = before - cartItems.length;
    if (q.includes("RETURNING")) {
      // редкий путь: RETURNING id — вернём сколько удалили синтетических id
      return { rows: Array.from({ length: deleted }, (_, i) => ({ id: `del-${i}` })) };
    }
    return { rows: [] };
  }

  // --- SELECT cart_items ---
  if (q.startsWith("SELECT") && q.includes(`FROM "cart_items"`)) {
    let out = cartItems;
    for (const [c, v] of parseWhere(q, params)) {
      out = out.filter((r) => r[c] === v);
    }
    if (/ORDER BY "created_at" ASC/i.test(q)) {
      out = [...out].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    const limitM = q.match(/ LIMIT (\d+)/);
    if (limitM) out = out.slice(0, Number(limitM[1]));
    return { rows: out.map((r) => project(r, selectedFields(q, "cart_items"))) };
  }

  // --- SELECT products ---
  if (q.startsWith("SELECT") && q.includes(`FROM "products"`)) {
    let out: Row[] = [PROD_1, PROD_DRAFT];
    for (const [c, v] of parseWhere(q, params)) {
      out = out.filter((r) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
    }
    return { rows: out.map((r) => project(r, selectedFields(q, "products"))) };
  }

  // --- SELECT fillings (валидация custom-позиций по реальному каталогу БД) ---
  if (q.startsWith("SELECT") && q.includes(`FROM "fillings"`)) {
    if (fillingsFail) throw new Error("fillings catalog down (simulated)");
    let out: Row[] = FILLINGS_ROWS;
    for (const [c, v] of parseWhere(q, params)) {
      out = out.filter((r) => r[c] === v);
    }
    const limitM = q.match(/ LIMIT (\d+)/);
    if (limitM) out = out.slice(0, Number(limitM[1]));
    return { rows: out.map((r) => project(r, selectedFields(q, "fillings"))) };
  }

  throw new Error(`fake pgrst pool: unexpected SQL: ${sql}`);
}

const poolRef: { current: { connect: () => Promise<{ query: typeof fakeQuery; release: () => void }> } | null } = { current: null };

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => poolRef.current,
}));

// ============================================================================
// supabaseAdmin → РЕАЛЬНЫЙ supabase-js клиент на РЕАЛЬНОМ PostgREST-шиме
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

const getUserFromRequestMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequestMock(...args),
}));

import { GET, POST, PUT, DELETE as CLEAR } from "./route";
import { PATCH, DELETE as REMOVE } from "./[ref]/route";

// ============================================================================
// Хелперы
// ============================================================================

const BASE = "http://localhost:3000";
const PID = PROD_1.id as string;
const DRAFT_PID = PROD_DRAFT.id as string;

function resetDb(): void {
  cartItems = [];
  cartSeq = 0;
  fillingsFail = false;
}

async function call(
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  user: typeof USER_A | typeof USER_B | null,
  body?: unknown,
  refPath?: string
): Promise<NextResponse> {
  getUserFromRequestMock.mockResolvedValue(user);
  const url = refPath ? `${BASE}/api/cart/${refPath}` : `${BASE}/api/cart`;
  const req = new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (refPath) {
    return method === "PATCH" ? PATCH(req, { params: Promise.resolve({ ref: refPath }) }) : REMOVE(req, { params: Promise.resolve({ ref: refPath }) });
  }
  if (method === "GET") return GET(req);
  if (method === "POST") return POST(req);
  if (method === "PUT") return PUT(req);
  return CLEAR(req);
}

async function jsonOf(res: NextResponse): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetDb();
  invalidateIntrospection();
  poolRef.current = {
    connect: async () => ({ query: fakeQuery, release: () => {} }),
  };
  getUserFromRequestMock.mockReset();
  // PostgREST-шим требует JWT_SECRET для разбора Bearer-ключей (конвенция
  // crm/tickets/route.test.ts)
  process.env.JWT_SECRET = "test-jwt-secret-for-pgrst-shim";
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

// ============================================================================
// Контракт
// ============================================================================

describe("GET /api/cart", () => {
  it("401 без сессии", async () => {
    const res = await call("GET", null);
    expect(res.status).toBe(401);
  });

  it("возвращает только СВОИ строки + снапшот товара", async () => {
    cartItems.push(
      { id: "c-1", user_id: USER_A.id, client_ref: "ci_1", product_id: PID, quantity: 2, selected_attributes: { filling: "Вишня" }, custom_config: null, notes: null, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" },
      { id: "c-2", user_id: USER_B.id, client_ref: "ci_b", product_id: PID, quantity: 5, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:02Z", updated_at: "2026-01-01T00:00:02Z" }
    );
    const res = await call("GET", USER_A);
    expect(res.status).toBe(200);
    const data = await jsonOf(res);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].client_ref).toBe("ci_1");
    expect(items[0].quantity).toBe(2);
    expect((items[0].product as Record<string, unknown>).title).toBe("Медовик");
  });
});

describe("POST /api/cart — идемпотентный upsert", () => {
  it("401 без сессии", async () => {
    const res = await call("POST", null, { client_ref: "ci_1", product_id: PID, quantity: 1 });
    expect(res.status).toBe(401);
  });

  it("новая позиция → inserted; повтор с тем же client_ref (ретрай) → updated, БЕЗ дубля", async () => {
    const body = { client_ref: "ci_1", product_id: PID, quantity: 2, selected_attributes: { filling: "Вишня" } };
    const r1 = await call("POST", USER_A, body);
    expect(r1.status).toBe(200);
    expect((await jsonOf(r1)).mode).toBe("inserted");
    expect(cartItems).toHaveLength(1);

    const r2 = await call("POST", USER_A, body);
    expect(r2.status).toBe(200);
    expect((await jsonOf(r2)).mode).toBe("updated");
    expect(cartItems).toHaveLength(1); // идемпотентность
    expect(cartItems[0].quantity).toBe(2);
  });

  it("тот же товар+атрибуты под другим client_ref → merged (MAX количества, ref перезаписан)", async () => {
    await call("POST", USER_A, { client_ref: "old_ref", product_id: PID, quantity: 3, selected_attributes: { filling: "Вишня" } });
    const r = await call("POST", USER_A, { client_ref: "new_ref", product_id: PID, quantity: 2, selected_attributes: { filling: "Вишня" } });
    expect((await jsonOf(r)).mode).toBe("merged");
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].quantity).toBe(3); // MAX(3, 2)
    expect(cartItems[0].client_ref).toBe("new_ref");
  });

  it("валидный custom-конфиг → product_id NULL + custom_config сохранён", async () => {
    const cfg = { productType: "cake", base: "biscuit", tiers: 2 };
    const r = await call("POST", USER_A, { client_ref: "ci_custom", quantity: 1, custom_config: cfg });
    expect(r.status).toBe(200);
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].product_id).toBeNull();
    expect(cartItems[0].custom_config).toEqual(cfg);
  });

  it("невалидный custom-конфиг → 422 (не молчаливое игнорирование)", async () => {
    const r = await call("POST", USER_A, { client_ref: "ci_bad", quantity: 1, custom_config: { productType: "ufo" } });
    expect(r.status).toBe(422);
    expect(cartItems).toHaveLength(0);
  });

  it("custom-конфиг с DB-only начинкой — валидация по реальному каталогу БД: 200", async () => {
    const cfg = { productType: "cake", base: "biscuit", tiers: 2, filling: FILL_DB_ONLY };
    const r = await call("POST", USER_A, { client_ref: "ci_db", quantity: 1, custom_config: cfg });
    expect(r.status).toBe(200);
    expect(cartItems[0].custom_config).toEqual(cfg);
  });

  it("APPROVED-начинка с is_active=false — 422 (недостаточно статуса без активности)", async () => {
    const cfg = { productType: "cake", base: "biscuit", tiers: 2, filling: FILL_INACTIVE };
    const r = await call("POST", USER_A, { client_ref: "ci_off", quantity: 1, custom_config: cfg });
    expect(r.status).toBe(422);
    expect(cartItems).toHaveLength(0);
  });

  it("начинка, отсутствующая и в БД, и в mock — 422 (клиентский UUID не доказательство)", async () => {
    const cfg = { productType: "cake", base: "biscuit", tiers: 2, filling: "no_such_filling" };
    const r = await call("POST", USER_A, { client_ref: "ci_unk", quantity: 1, custom_config: cfg });
    expect(r.status).toBe(422);
    expect(cartItems).toHaveLength(0);
  });

  it("legacy mock-начинка остаётся валидной (слияние mock+DB)", async () => {
    const cfg = { productType: "cake", base: "biscuit", tiers: 2, filling: "chocolate_ganache" };
    const r = await call("POST", USER_A, { client_ref: "ci_legacy", quantity: 1, custom_config: cfg });
    expect(r.status).toBe(200);
    expect(cartItems[0].custom_config).toEqual(cfg);
  });

  it("ошибка загрузки каталога начинок — 503 fail-closed, НЕ даунгрейд до mock", async () => {
    fillingsFail = true;
    const cfg = { productType: "cake", base: "biscuit", tiers: 2, filling: "chocolate_ganache" };
    const r = await call("POST", USER_A, { client_ref: "ci_503", quantity: 1, custom_config: cfg });
    expect(r.status).toBe(503);
    expect(cartItems).toHaveLength(0);
  });

  it("несуществующий товар → 400; draft-товар → 400", async () => {
    const missing = await call("POST", USER_A, { client_ref: "ci_x", product_id: "99999999-9999-9999-9999-999999999999", quantity: 1 });
    expect(missing.status).toBe(400);
    const draft = await call("POST", USER_A, { client_ref: "ci_y", product_id: DRAFT_PID, quantity: 1 });
    expect(draft.status).toBe(400);
  });

  it("неизвестный атрибут → 400; quantity 0 → 400", async () => {
    const badAttr = await call("POST", USER_A, { client_ref: "ci_a", product_id: PID, quantity: 1, selected_attributes: { color: "red" } });
    expect(badAttr.status).toBe(400);
    const badQty = await call("POST", USER_A, { client_ref: "ci_b", product_id: PID, quantity: 0 });
    expect(badQty.status).toBe(400);
  });
});

describe("PUT /api/cart — UNION-слияние", () => {
  it("401 без сессии", async () => {
    const res = await call("PUT", null, { items: [] });
    expect(res.status).toBe(401);
  });

  it("сливает локальное состояние: MAX количества, чужие серверные строки сохраняются", async () => {
    // На сервере (с другого устройства) — позиция B
    cartItems.push({ id: "c-b", user_id: USER_A.id, client_ref: "srv_b", product_id: PID, quantity: 1, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" });
    // Клиент присылает ту же позицию с quantity 2 + свою новую
    const res = await call("PUT", USER_A, {
      items: [
        { client_ref: "ci_b", product_id: PID, quantity: 2 },
        { client_ref: "ci_new", product_id: PID, quantity: 1, selected_attributes: { filling: "Шоколад" } },
      ],
    });
    expect(res.status).toBe(200);
    const data = await jsonOf(res);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    // MAX(1, 2) = 2 по совпавшему контенту
    const merged = items.find((i) => i.selected_attributes === null) as Record<string, unknown>;
    expect(merged.quantity).toBe(2);
    expect(merged.client_ref).toBe("ci_b");
    // новая позиция вставлена
    expect(items.some((i) => i.client_ref === "ci_new")).toBe(true);
    // повторный PUT того же состояния — идемпотентен (без раздувания)
    const res2 = await call("PUT", USER_A, {
      items: [
        { client_ref: "ci_b", product_id: PID, quantity: 2 },
        { client_ref: "ci_new", product_id: PID, quantity: 1, selected_attributes: { filling: "Шоколад" } },
      ],
    });
    const data2 = await jsonOf(res2);
    const items2 = data2.items as Array<Record<string, unknown>>;
    expect(items2).toHaveLength(2);
    expect(items2.find((i) => i.selected_attributes === null)?.quantity).toBe(2);
  });
});

describe("PATCH/DELETE /api/cart/[ref]", () => {
  it("PATCH чужого client_ref → 404 и строка НЕ изменена", async () => {
    cartItems.push({ id: "c-b", user_id: USER_B.id, client_ref: "ci_b", product_id: PID, quantity: 1, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" });
    const res = await call("PATCH", USER_A, { quantity: 9 }, "ci_b");
    expect(res.status).toBe(404);
    expect(cartItems[0].quantity).toBe(1); // чужая строка не тронута
  });

  it("PATCH своей позиции → 200, количество обновлено; 0 → 400", async () => {
    cartItems.push({ id: "c-a", user_id: USER_A.id, client_ref: "ci_a", product_id: PID, quantity: 1, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" });
    const ok = await call("PATCH", USER_A, { quantity: 7 }, "ci_a");
    expect(ok.status).toBe(200);
    expect(cartItems[0].quantity).toBe(7);
    const zero = await call("PATCH", USER_A, { quantity: 0 }, "ci_a");
    expect(zero.status).toBe(400);
  });

  it("DELETE своей → 200 и удалена; повтор → 200 (идемпотент); 401 без сессии", async () => {
    cartItems.push({ id: "c-a", user_id: USER_A.id, client_ref: "ci_a", product_id: PID, quantity: 1, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" });
    const noAuth = await call("DELETE", null, undefined, "ci_a");
    expect(noAuth.status).toBe(401);

    const ok = await call("DELETE", USER_A, undefined, "ci_a");
    expect(ok.status).toBe(200);
    expect(cartItems).toHaveLength(0);

    const again = await call("DELETE", USER_A, undefined, "ci_a");
    expect(again.status).toBe(200);
  });
});

describe("DELETE /api/cart — очистка своей корзины", () => {
  it("401 без сессии", async () => {
    const res = await call("DELETE", null);
    expect(res.status).toBe(401);
  });

  it("очищает ТОЛЬКО свои строки (чужие остаются)", async () => {
    cartItems.push(
      { id: "c-a1", user_id: USER_A.id, client_ref: "ci_1", product_id: PID, quantity: 1, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" },
      { id: "c-a2", user_id: USER_A.id, client_ref: "ci_2", product_id: PID, quantity: 2, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:02Z", updated_at: "2026-01-01T00:00:02Z" },
      { id: "c-b1", user_id: USER_B.id, client_ref: "ci_b", product_id: PID, quantity: 3, selected_attributes: null, custom_config: null, notes: null, created_at: "2026-01-01T00:00:03Z", updated_at: "2026-01-01T00:00:03Z" }
    );
    const res = await call("DELETE", USER_A);
    expect(res.status).toBe(200);
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].user_id).toBe(USER_B.id);
  });
});
