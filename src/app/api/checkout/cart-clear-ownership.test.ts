/**
 * Регрессия POST /api/checkout — очистка серверной корзины ПОСЛЕ успеха
 * (P1 §2 «повтор checkout» + владение строками).
 *
 * Дофикс: `.delete().in("id", cartItemIds)` — id от клиента это client_ref
 * (itemId Zustand-корзины, НЕ uuid cart_items), а удаление без
 * `.eq("user_id", …)` позволяло бы admin-клиенту (RLS bypass) удалить ЧУЖИЕ
 * строки по перебору uuid. Лочит контракт:
 *   a) удаление корзины идёт по `.in("client_ref", ids)` + `.eq("user_id", user.id)`;
 *   b) НЕТ `.in("id", …)` по cart_items (регрессия старого дефекта);
 *   c) очистка происходит ТОЛЬКО после успешного создания заказа/платежа
 *      (сбой создания позиций → delete по cart_items НЕ вызывается).
 *
 * supabaseAdmin — записывающий fluent-mock (не реальный шим: checkout гоняет
 * много таблиц, здесь важен КОНТРАКТ вызовов, а не трансляция SQL).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "a@test.local", roles: ["CUSTOMER"] };
const PID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ROW = { id: PID, title: "Медовик", price: 1800, status: "published", confectioner_id: null, fillings: [] };
const ORDER_ROW = { id: "order-1", number: "UK-2026-000001", total: 3600, subtotal: 3600, delivery_cost: 0, discount: 0, metadata: {} };

// Z-v29: checkout теперь фиксирует metadata.acceptance_snapshot сервером
// (buildAcceptanceSnapshot читает products/recipes через пул). Товар без
// рецепта → snapshot с пустыми нормами; контракт очистки корзины не меняется.
vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      if (sql.includes("FROM public.products")) {
        return {
          rows: [{ id: PID, title: "Медовик", recipe_id: null, production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null, recipe_updated_at: null, category_slug: null }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM public.recipe_ingredients")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  }),
}));

interface CapturedCall {
  table: string;
  op: string;
  args: unknown[];
}

const captured: CapturedCall[] = [];

/** Thenable fluent-builder: каждый метод записывает вызов и возвращает себя. */
function makeBuilder(table: string): unknown {
  const state = { table, insertSeen: false };
  const api: Record<string, unknown> = {};
  const thenable = {
    then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
      const data = table === "products" ? [PRODUCT_ROW] : state.insertSeen && table === "orders" ? ORDER_ROW : null;
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
      const data = state.insertSeen && table === "orders" ? ORDER_ROW : null;
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

vi.mock("@/lib/yookassa", () => ({
  isYookassaConfigured: () => false,
  isLocalE2EPaymentStubEnabled: () => false,
  createPayment: vi.fn(),
}));

vi.mock("@/lib/ops/acceptance", () => ({
  checkAcceptance: vi.fn(async () => ({
    canAccept: true,
    availability: [],
    reasons: [],
    suggestions: [],
    alternativeWindows: [],
  })),
  loadProductItemsData: vi.fn(async () => []),
}));

vi.mock("@/lib/promo-codes", () => ({
  extractIdempotencyKey: () => null,
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

import { POST } from "./route";

const BASE = "http://localhost:3000";

function checkoutRequest(body: unknown): NextRequest {
  return new NextRequest(`${BASE}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  cartItems: [{ id: "ci_1", product_id: PID, quantity: 2 }],
  customerName: "Анна Петрова",
  customerPhone: "+7 999 123-45-67",
  deliveryType: "delivery",
  deliveryAddress: "ул. Тверская, д. 10, кв. 5",
  deliveryCity: "Москва",
  customerName2: undefined,
};

beforeEach(() => {
  captured.length = 0;
});

describe("POST /api/checkout — очистка серверной корзины (владение + client_ref)", () => {
  it("успешный checkout: delete по cart_items идёт по client_ref + user_id, БЕЗ in('id')", async () => {
    const res = await POST(checkoutRequest(VALID_BODY));
    expect(res.status).toBe(200);

    const cartOps = captured.filter((c) => c.table === "cart_items");
    expect(cartOps.length).toBeGreaterThan(0);

    const deleteCalls = cartOps.filter((c) => c.op === "delete");
    expect(deleteCalls).toHaveLength(1);

    // фильтры после delete: .in("client_ref", ids).eq("user_id", user.id)
    const inCalls = cartOps.filter((c) => c.op === "in");
    expect(inCalls).toHaveLength(1);
    expect(inCalls[0].args[0]).toBe("client_ref");
    expect(inCalls[0].args[1]).toEqual(["ci_1"]);

    const eqCalls = cartOps.filter((c) => c.op === "eq");
    expect(eqCalls.length).toBeGreaterThanOrEqual(1);
    expect(eqCalls.some((c) => c.args[0] === "user_id" && c.args[1] === USER.id)).toBe(true);

    // регрессия старого дефекта: удаление по "id" (uuid) запрещено
    expect(inCalls.some((c) => c.args[0] === "id")).toBe(false);
  });

  it("очистка корзины происходит ПОСЛЕ создания заказа и платежа", async () => {
    await POST(checkoutRequest(VALID_BODY));
    const orderOf = (call: CapturedCall) => captured.indexOf(call);
    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert");
    const paymentsInsert = captured.find((c) => c.table === "payments" && c.op === "insert");
    const cartDelete = captured.find((c) => c.table === "cart_items" && c.op === "delete");
    expect(orderInsert).toBeDefined();
    expect(paymentsInsert).toBeDefined();
    expect(cartDelete).toBeDefined();
    expect(orderOf(cartDelete!)).toBeGreaterThan(orderOf(orderInsert!));
    expect(orderOf(cartDelete!)).toBeGreaterThan(orderOf(paymentsInsert!));
  });
});
