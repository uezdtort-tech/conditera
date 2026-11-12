/**
 * catalog-catchup.test.ts — PR-2C: ленивый catch-up цен в каталоге.
 *
 * Лочит контракт:
 *   d) GET /api/products и GET /api/products/[id] вызывают
 *      sync_effective_product_prices (best-effort) ДО чтения данных;
 *   + additive-поле priceEffectiveFrom в карточке: effective_from покрывающей
 *     версии get_product_price_at; null на legacy-фолбэке.
 *
 * supabaseAdmin — per-table builder-mock; getPool — SQL-роутинг со spy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

type Row = Record<string, unknown>;

const tables: Record<string, Row[] | Row | null> = {};

function makeBuilder(table: string): unknown {
  const api: Record<string, unknown> = {};
  const recordAndReturn = (op: string) => (..._args: unknown[]) => {
    void op;
    return api;
  };
  const resolveList = () => (Array.isArray(tables[table]) ? tables[table] : []);
  Object.assign(api, {
    select: recordAndReturn("select"),
    eq: recordAndReturn("eq"),
    in: recordAndReturn("in"),
    or: recordAndReturn("or"),
    order: recordAndReturn("order"),
    range: recordAndReturn("range"),
    limit: recordAndReturn("limit"),
    maybeSingle: () =>
      Promise.resolve({
        data: Array.isArray(tables[table]) ? (tables[table] as Row[])[0] ?? null : tables[table],
        error: null,
      }),
    single: () =>
      Promise.resolve({
        data: Array.isArray(tables[table]) ? (tables[table] as Row[])[0] ?? null : tables[table],
        error: null,
      }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: resolveList(), error: null }).then(res, rej),
    catch: (onRejected: (e: unknown) => unknown) =>
      Promise.resolve({ data: resolveList(), error: null }).catch(onRejected),
  });
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeBuilder(table)),
  },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => null),
}));
vi.mock("@/lib/role-guards", () => ({
  requireRole: vi.fn(async () => null),
  requireAnyRole: vi.fn(async () => null),
  isAdmin: vi.fn(async () => false),
}));

// --- pool spy: catch-up + get_product_price_at ---
const poolCalls: string[] = [];
const poolState = { priceAtRows: [] as Row[] };

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string) => {
      poolCalls.push(sql);
      if (/sync_effective_product_prices/.test(sql)) return { rows: [{ sync: 0 }], rowCount: 1 };
      if (/get_product_price_at/.test(sql)) return { rows: poolState.priceAtRows, rowCount: poolState.priceAtRows.length };
      return { rows: [], rowCount: 0 };
    }),
  }),
}));

import { GET as getList } from "../products/route";
import { GET as getCard } from "../products/[id]/route";

const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-00000000000b";

function baseProductRow(extra: Row = {}): Row {
  return {
    id: PRODUCT_ID,
    title: "Порционные десерты (20 шт.)",
    slug: "deserty-portSIONnyye-20",
    price: 4400,
    confectioner_id: null,
    status: "published",
    images: [],
    fillings: null,
    ...extra,
  };
}

beforeEach(() => {
  poolCalls.length = 0;
  poolState.priceAtRows = [];
  tables.products = [];
  tables.product_categories = [];
  tables.confectioners = [];
  tables.product_media = [];
  tables.product_images = [];
  tables.product_slices = [];
  tables.product_reviews = [];
  tables.profiles = [];
});

describe("PR-2C: catch-up цен в каталоге", () => {
  it("(d) GET /api/products: sync_effective_product_prices вызван (best-effort), ответ не изменён", async () => {
    const res = await getList(new NextRequest("http://localhost:3000/api/products?limit=5"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.products)).toBe(true);
    expect(json.total).toBe(0);
    expect(poolCalls.some((s) => /sync_effective_product_prices/.test(s))).toBe(true);
  });

  it("(d) catch-up синка не ломает выдачу при ошибке БД (best-effort)", async () => {
    // Сломаем пул: sync бросит — маршрут всё равно 200
    const poolModule = await import("@/lib/postgrest/pool");
    const pool = (poolModule as unknown as { getPool: () => { query: (sql: string) => Promise<unknown> } }).getPool();
    const orig = pool.query.bind(pool);
    pool.query = ((sql: string) => {
      if (/sync_effective_product_prices/.test(sql)) return Promise.reject(new Error("db down"));
      return orig(sql);
    }) as typeof pool.query;

    const res = await getList(new NextRequest("http://localhost:3000/api/products"));
    expect(res.status).toBe(200);
  });

  it("(d) GET /api/products/[id]: sync ДО резолва цены + priceEffectiveFrom покрывающей версии", async () => {
    tables.products = baseProductRow();
    poolState.priceAtRows = [
      {
        version_id: "pv-9",
        amount: 4400,
        currency: "RUB",
        effective_from: "2026-02-01T00:00:00.000Z",
        effective_to: null,
        reason: "ingredients",
      },
    ];

    const res = await getCard(new NextRequest(`http://localhost:3000/api/products/${PRODUCT_ID}`), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    // additive-поле (остальной контракт карточки не тронут)
    expect(json.product.priceEffectiveFrom).toBe("2026-02-01T00:00:00.000Z");
    expect(json.product.id).toBe(PRODUCT_ID);
    expect(json.product.price).toBe(4400);

    const syncIdx = poolCalls.findIndex((s) => /sync_effective_product_prices/.test(s));
    const priceIdx = poolCalls.findIndex((s) => /get_product_price_at/.test(s));
    expect(syncIdx).toBeGreaterThan(-1);
    expect(priceIdx).toBeGreaterThan(syncIdx);
  });

  it("legacy-фолбэк (пустая история) → priceEffectiveFrom null, карточка 200", async () => {
    tables.products = baseProductRow();
    const res = await getCard(new NextRequest(`http://localhost:3000/api/products/${PRODUCT_ID}`), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.product.priceEffectiveFrom).toBeNull();
  });
});
