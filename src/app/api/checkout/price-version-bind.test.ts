/**
 * price-version-bind.test.ts — PR-2C: привязка версии цены в checkout.
 *
 * Лочит контракт:
 *   a) покрывающая now строка истории цен (version_id X, amount 500) →
 *      order_items insert несёт price_version_id X, unit_price 500, а
 *      metadata.pricing.items[0] = { productId, priceVersionId: X, unitPrice }.
 *   b) planned-будущая версия (effective_from > now) НЕ используется —
 *      get_product_price_at гарантирует только покрывающую строку; берётся
 *      amount покрывающей версии.
 *   e) legacy-фолбэк (version_id NULL / пустая история) → поведение как раньше:
 *      products.price, price_version_id null.
 *
 * supabaseAdmin — записывающий builder-mock; getPool — SQL-роутинг по паттернам
 * price-history/route.test.ts. Реальная БД не затрагивается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "a@test.local", roles: ["CUSTOMER"] };
const PID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ROW = {
  id: PID, title: "Ягодный бархат", price: 1800, status: "published",
  confectioner_id: null, fillings: [],
};

interface CapturedCall {
  table: string;
  op: string;
  args: unknown[];
}
const captured: CapturedCall[] = [];

// Состояние «БД» для pool-мока + журнал SQL-вызовов (порядок синка и резолва)
const { poolState, poolCalls } = vi.hoisted(() => ({
  poolState: { priceAtRows: [] as Array<Record<string, unknown>> },
  poolCalls: [] as string[],
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      poolCalls.push(sql);
      // Z-v30: сборка snapshot — merged statement products LEFT JOIN recipe_ingredients
      if (sql.includes("FROM public.products") && sql.includes("public.recipe_ingredients")) {
        return {
          rows: [{
            id: PID, title: "Ягодный бархат", recipe_id: null,
            production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null,
            recipe_updated_at: null, category_slug: null,
            ing_name: null, ing_qty: null, ing_unit: null, ing_inventory_item_id: null,
          }],
          rowCount: 1,
        };
      }
      if (/sync_effective_product_prices/.test(sql)) return { rows: [{ sync: 0 }], rowCount: 1 };
      if (/get_product_price_at/.test(sql)) {
        // Семантика 0083: покрывающая now строка (effective_from <= now, effective_to null/будущее).
        const now = Date.now();
        const covering = poolState.priceAtRows
          .filter((r) => {
            const from = new Date(String(r.effective_from)).getTime();
            const to = r.effective_to ? new Date(String(r.effective_to)).getTime() : null;
            return from <= now && (to === null || to > now);
          })
          .sort((a, b) => new Date(String(b.effective_from)).getTime() - new Date(String(a.effective_from)).getTime());
        return { rows: covering.slice(0, 1), rowCount: covering.length ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  }),
}));

function makeBuilder(table: string): unknown {
  const state = { insertSeen: false };
  const api: Record<string, unknown> = {};
  const thenable = {
    then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
      const data =
        table === "products"
          ? [PRODUCT_ROW]
          : state.insertSeen && table === "orders"
            ? { id: "order-1", number: "UK-2026-000001" }
            : null;
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve({ data: null, error: null }).catch(onRejected);
    },
  };
  const recordAndReturn = (op: string) => (...args: unknown[]) => {
    captured.push({ table, op, args });
    if (op === "insert") state.insertSeen = true;
    return api;
  };
  Object.assign(api, {
    select: recordAndReturn("select"),
    insert: recordAndReturn("insert"),
    update: recordAndReturn("update"),
    delete: recordAndReturn("delete"),
    upsert: recordAndReturn("upsert"),
    eq: recordAndReturn("eq"),
    neq: recordAndReturn("neq"),
    in: recordAndReturn("in"),
    gte: recordAndReturn("gte"),
    lte: recordAndReturn("lte"),
    order: recordAndReturn("order"),
    limit: recordAndReturn("limit"),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => {
      const data = state.insertSeen && table === "orders" ? { id: "order-1", number: "UK-2026-000001" } : null;
      return Promise.resolve({ data, error: null });
    },
    ...thenable,
  });
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => makeBuilder(table),
  },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => USER),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  getClientIP: () => "127.0.0.1",
  RATE_LIMITS: { payment: { limit: 5, windowMs: 60_000 } },
}));

vi.mock("@/lib/builder-fillings-server", () => ({
  loadBuilderFillingsForValidation: vi.fn(async () => []),
}));

vi.mock("@/lib/yookassa", () => ({
  isYookassaConfigured: () => false,
  isLocalE2EPaymentStubEnabled: () => false,
  createPayment: vi.fn(),
}));

vi.mock("@/lib/ops/acceptance", () => ({
  checkAcceptance: vi.fn(async () => ({
    canAccept: true,
    availability: "available",
    reasons: [],
    suggestions: [],
    alternativeWindows: [],
    owners: [],
  })),
  loadProductItemsData: vi.fn(async () => []),
}));

vi.mock("@/lib/promo-codes", () => ({
  extractIdempotencyKey: vi.fn(() => undefined),
  normalizePromoCodeInput: () => null,
  validatePromoCode: vi.fn(),
  applyPromoCodeToOrder: vi.fn(),
}));

vi.mock("@/lib/ops/events", () => ({
  recordEvent: vi.fn(async () => ({})),
}));

vi.mock("@/lib/n8n", () => ({
  emitEvent: vi.fn(async () => ({})),
}));

vi.mock("@/lib/notifications", () => ({
  sendNotification: vi.fn(async () => ({})),
}));

vi.mock("@/lib/financial-ledger", () => ({
  recordFinancialEntrySafe: vi.fn(async () => ({ ok: true })),
}));

import { POST } from "./route";

function checkoutRequest(cartItems: unknown[]): NextRequest {
  return new NextRequest("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cartItems,
      customerName: "Анна Петрова",
      customerPhone: "+7 999 123-45-67",
      deliveryType: "delivery",
      deliveryAddress: "ул. Тверская, д. 10, кв. 5",
      deliveryCity: "Москва",
    }),
  });
}

const PRODUCT_BODY = [{ id: "ci_1", product_id: PID, quantity: 2 }];

beforeEach(() => {
  captured.length = 0;
  poolCalls.length = 0;
  poolState.priceAtRows = [];
});

describe("POST /api/checkout — привязка версии цены (PR-2C)", () => {
  it("(a) покрывающая версия {amount 500, version_id X}: price_version_id в insert + metadata.pricing", async () => {
    poolState.priceAtRows = [
      {
        version_id: "pv-100",
        amount: 500,
        currency: "RUB",
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        reason: "ingredients",
      },
    ];

    const res = await POST(checkoutRequest(PRODUCT_BODY));
    expect(res.status).toBe(200);

    const itemsInsert = captured.find((c) => c.table === "order_items" && c.op === "insert");
    expect(itemsInsert).toBeDefined();
    const rows = itemsInsert!.args[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].price_version_id).toBe("pv-100");
    expect(rows[0].unit_price).toBe(500);
    expect(rows[0].total).toBe(1000);

    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert");
    expect(orderInsert).toBeDefined();
    const metadata = (orderInsert!.args[0] as { metadata: Record<string, unknown> }).metadata;
    const pricing = metadata.pricing as {
      resolvedAt: string;
      currency: string;
      deliverySource: string;
      items: Array<{ productId: string; priceVersionId: string | null; unitPrice: number }>;
    };
    expect(pricing.currency).toBe("RUB");
    expect(pricing.deliverySource).toBe("server");
    expect(typeof pricing.resolvedAt).toBe("string");
    expect(pricing.items).toEqual([
      { productId: PID, priceVersionId: "pv-100", unitPrice: 500 },
    ]);

    // catch-up вызван ДО резолва цены
    // (здесь порядок не наблюдаем через один мок — лочим сам факт вызова ниже в (d)-тесте каталога)
  });

  it("(b) planned-будущая версия не используется: unit_price = покрывающий amount", async () => {
    poolState.priceAtRows = [
      {
        // Будущая версия — get_product_price_at(now) её НЕ возвращает (гарантия функции),
        // мок эмулирует семантику покрывающей выборки.
        version_id: "pv-future",
        amount: 9999,
        currency: "RUB",
        effective_from: "2099-01-01T00:00:00.000Z",
        effective_to: null,
        reason: "ingredients",
      },
      {
        version_id: "pv-covering",
        amount: 500,
        currency: "RUB",
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        reason: "ingredients",
      },
    ];

    const res = await POST(checkoutRequest(PRODUCT_BODY));
    expect(res.status).toBe(200);

    const rows = (captured.find((c) => c.table === "order_items" && c.op === "insert")!
      .args[0] as Array<Record<string, unknown>>);
    expect(rows[0].unit_price).toBe(500); // покрывающий amount, не 9999
    expect(rows[0].price_version_id).toBe("pv-covering");
  });

  it("(e) legacy-фолбэк version_id NULL → products.price как раньше, version null", async () => {
    poolState.priceAtRows = [
      {
        version_id: null, // legacy-фолбэк самой функции
        amount: 1800,
        currency: "RUB",
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        reason: "products_fallback",
      },
    ];

    const res = await POST(checkoutRequest(PRODUCT_BODY));
    expect(res.status).toBe(200);

    const rows = (captured.find((c) => c.table === "order_items" && c.op === "insert")!
      .args[0] as Array<Record<string, unknown>>);
    expect(rows[0].unit_price).toBe(1800); // products.price, идентично прошлому поведению
    expect(rows[0].price_version_id).toBeNull();

    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert")!;
    const pricing = (orderInsert.args[0] as { metadata: Record<string, unknown> }).metadata
      .pricing as { items: Array<{ priceVersionId: string | null; unitPrice: number }> };
    expect(pricing.items[0]).toEqual({ productId: PID, priceVersionId: null, unitPrice: 1800 });
  });

  it("(e2) пустая история → products.price, price_version_id null", async () => {
    const res = await POST(checkoutRequest(PRODUCT_BODY));
    expect(res.status).toBe(200);
    const rows = (captured.find((c) => c.table === "order_items" && c.op === "insert")!
      .args[0] as Array<Record<string, unknown>>);
    expect(rows[0].unit_price).toBe(1800);
    expect(rows[0].price_version_id).toBeNull();
  });

  it("catch-up (sync_effective_product_prices) вызван ДО резолва цены (порядок pool-вызовов)", async () => {
    poolState.priceAtRows = [
      {
        version_id: "pv-100",
        amount: 500,
        currency: "RUB",
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        reason: "ingredients",
      },
    ];
    const res = await POST(checkoutRequest(PRODUCT_BODY));
    expect(res.status).toBe(200);

    const syncIdx = poolCalls.findIndex((s) => /sync_effective_product_prices/.test(s));
    const priceIdx = poolCalls.findIndex((s) => /get_product_price_at/.test(s));
    expect(syncIdx).toBeGreaterThan(-1);
    expect(priceIdx).toBeGreaterThan(syncIdx);
  });
});
