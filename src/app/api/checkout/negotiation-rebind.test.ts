/**
 * negotiation-rebind.test.ts — ZV33-4b D1: гвард «один заказ на принятое
 * предложение» в POST /api/checkout.
 *
 * Лочит:
 *   a) negotiations.order_id NOT NULL → 409 OFFER_ALREADY_ORDERED ДО создания
 *      заказа (раньше каждый новый Idempotency-Key плодил полный дубль заказа
 *      по согласованной цене — 4 заказа на одно предложение в верификации);
 *   b) order_id NULL → binding проходит: заказ создаётся, custom-позиция
 *      получает серверную quoted_price (копейки→рубли), а привязка
 *      negotiations.order_id выполняется УСЛОВНО (is order_id null) —
 *      last-write-wins невозможен.
 *
 * supabaseAdmin — записывающий builder-mock (паттерн price-version-bind.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "a@test.local", roles: ["CUSTOMER"] };
const NEG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EXISTING_ORDER = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/** Согласованное предложение: 1 500 000 копеек = 15 000 ₽ */
function makeNegotiationRow(order_id: string | null) {
  return {
    id: NEG_ID,
    user_id: USER.id,
    status: "accepted",
    quoted_price: 1500000,
    quoted_delivery_cost: 0,
    valid_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    order_id,
  };
}

let negotiationRow: Record<string, unknown> | null = null;

interface CapturedCall {
  table: string;
  op: string;
  args: unknown[];
}
const captured: CapturedCall[] = [];

const { poolState, poolCalls } = vi.hoisted(() => ({
  poolState: { priceAtRows: [] as Array<Record<string, unknown>> },
  poolCalls: [] as string[],
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      poolCalls.push(sql);
      if (/sync_effective_product_prices/.test(sql)) return { rows: [{ sync: 0 }], rowCount: 1 };
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
        table === "negotiations"
          ? negotiationRow
            ? [negotiationRow]
            : []
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
    is: recordAndReturn("is"),
    in: recordAndReturn("in"),
    gte: recordAndReturn("gte"),
    lte: recordAndReturn("lte"),
    order: recordAndReturn("order"),
    limit: recordAndReturn("limit"),
    maybeSingle: () => {
      captured.push({ table, op: "maybeSingle", args: [] });
      const data = table === "negotiations" ? (negotiationRow as unknown) : null;
      return Promise.resolve({ data, error: null });
    },
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

/** Валидная custom-конфигурация (ids из CAKE_BUILDER_OPTIONS mock-справочника). */
const VALID_CUSTOM_CONFIG = {
  productType: "cake",
  base: "sponge",
  filling: "condensed_milk",
  servings: 12,
  city: "Москва",
};

function checkoutRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cartItems: [{ id: "ci_offer_1", quantity: 1, custom: VALID_CUSTOM_CONFIG }],
      customerName: "Анна Петрова",
      customerPhone: "+7 999 123-45-67",
      deliveryType: "delivery",
      deliveryAddress: "ул. Тверская, д. 10, кв. 5",
      deliveryCity: "Москва",
      negotiationId: NEG_ID,
    }),
  });
}

beforeEach(() => {
  captured.length = 0;
  poolCalls.length = 0;
  poolState.priceAtRows = [];
  negotiationRow = null;
});

describe("POST /api/checkout — гвард «один заказ на предложение» (ZV33-4b D1)", () => {
  it("(a) negotiations.order_id NOT NULL → 409 OFFER_ALREADY_ORDERED ДО создания заказа", async () => {
    negotiationRow = makeNegotiationRow(EXISTING_ORDER);

    const res = await POST(checkoutRequest());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("OFFER_ALREADY_ORDERED");
    expect(body.message).toBe("Заказ по этому предложению уже оформлен");

    // Заказ НЕ создан: ни orders.insert, ни order_items.insert
    expect(captured.find((c) => c.table === "orders" && c.op === "insert")).toBeUndefined();
    expect(captured.find((c) => c.table === "order_items" && c.op === "insert")).toBeUndefined();
    // Условная привязка тоже не выполнялась
    expect(captured.find((c) => c.table === "negotiations" && c.op === "update")).toBeUndefined();
  });

  it("(b) order_id NULL → заказ создаётся по серверной цене, привязка условная (is order_id null)", async () => {
    negotiationRow = makeNegotiationRow(null);

    const res = await POST(checkoutRequest());
    expect(res.status).toBe(200);

    const ordersInsert = captured.find((c) => c.table === "orders" && c.op === "insert");
    expect(ordersInsert).toBeDefined();

    // Серверная цена: custom-позиция = quoted_price / 100 = 15 000 ₽ (не estimate)
    const itemsInsert = captured.find((c) => c.table === "order_items" && c.op === "insert");
    expect(itemsInsert).toBeDefined();
    const rows = itemsInsert!.args[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].product_id).toBeNull();
    expect(rows[0].unit_price).toBe(15000);
    expect(rows[0].total).toBe(15000);

    // УСЛОВНАЯ привязка: update ... .eq("id", NEG_ID).is("order_id", null)
    const negUpdate = captured.find((c) => c.table === "negotiations" && c.op === "update");
    expect(negUpdate).toBeDefined();
    expect(negUpdate!.args[0]).toEqual({ order_id: "order-1" });
    const isFilter = captured.find((c) => c.table === "negotiations" && c.op === "is");
    expect(isFilter).toBeDefined();
    expect(isFilter!.args).toEqual(["order_id", null]);
    const eqFilter = captured.find((c) => c.table === "negotiations" && c.op === "eq");
    expect(eqFilter!.args).toEqual(["id", NEG_ID]);
  });
});
