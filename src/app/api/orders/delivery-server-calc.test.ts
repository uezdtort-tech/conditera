/**
 * delivery-server-calc.test.ts — PR-2C SECURITY FIX в POST /api/orders.
 *
 * Лочит контракт:
 *   c) клиентское deliveryCost (0 или 5000) БОЛЬШЕ НЕ влияет на расчёт:
 *      доставка считается сервером той же функцией, что в checkout
 *      (lib/finance.calculateDelivery: <3000 → 300₽, ≥3000 → бесплатно);
 *      присланные значения сохраняются ТОЛЬКО в
 *      metadata.pricing.deliveryClientSubmitted (аудит отклонения).
 *   + price_version_id в order_items (fallback → null) и
 *     metadata.pricing.deliverySource === "server_calculated".
 *
 * supabaseAdmin — записывающий fluent-mock (контракт вызовов, не SQL),
 * getPool — SQL-роутинг; история цен пуста → fallback products.price.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface CapturedCall {
  table: string;
  op: string;
  args: unknown[];
}

const captured: CapturedCall[] = [];

const dbState = {
  confectioners: [] as Array<Record<string, unknown>>,
  product: null as Record<string, unknown> | null,
};

/** Fluent thenable builder: пишет вызовы, применяет eq/in-фильтры к dbState. */
function makeBuilder(table: string): unknown {
  const state = { insertSeen: false, filters: [] as Array<[string, unknown]> };
  const api: Record<string, unknown> = {};

  const applyFilters = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    rows.filter((r) =>
      state.filters.every(([col, val]) =>
        Array.isArray(val) ? val.includes(r[col]) : r[col] === val
      )
    );

  const resolve = (): { data: unknown; error: unknown } => {
    if (table === "confectioners") {
      return { data: applyFilters(dbState.confectioners), error: null };
    }
    if (table === "products") return { data: dbState.product, error: null };
    if (state.insertSeen) {
      if (table === "orders") return { data: { id: "order-1", number: "UK-2026-1" }, error: null };
    }
    return { data: null, error: null };
  };

  const thenable = {
    then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve(resolve()).catch(onRejected);
    },
  };
  const recordAndReturn = (op: string) => (...args: unknown[]) => {
    captured.push({ table, op, args });
    if (op === "insert") state.insertSeen = true;
    if (op === "eq") state.filters.push([args[0] as string, args[1]]);
    if (op === "in") state.filters.push([args[0] as string, args[1]]);
    return api;
  };
  Object.assign(api, {
    select: recordAndReturn("select"),
    insert: recordAndReturn("insert"),
    update: recordAndReturn("update"),
    delete: recordAndReturn("delete"),
    eq: recordAndReturn("eq"),
    in: recordAndReturn("in"),
    or: recordAndReturn("or"),
    gte: recordAndReturn("gte"),
    order: recordAndReturn("order"),
    limit: recordAndReturn("limit"),
    maybeSingle: () => {
      const { data } = resolve();
      const arr = Array.isArray(data) ? data : data ? [data as Record<string, unknown>] : [];
      return Promise.resolve({ data: arr[0] ?? null, error: null });
    },
    single: () => {
      const { data } = resolve();
      const arr = Array.isArray(data) ? data : data ? [data as Record<string, unknown>] : [];
      return Promise.resolve({ data: arr[0] ?? null, error: null });
    },
    ...thenable,
  });
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

const ORDERS_USER = { userId: "user-1", id: "user-1", roles: ["CUSTOMER"], name: "Анна" };

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => ORDERS_USER),
}));

vi.mock("@/lib/n8n", () => ({ emitEvent: vi.fn(async () => ({})) }));
vi.mock("@/lib/ops/events", () => ({ recordEvent: vi.fn(async () => ({})) }));
vi.mock("@/lib/anti-fraud", () => ({
  checkFraudLimit: vi.fn(async () => ({ allowed: true, resetAt: Date.now() + 1000 })),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  getClientIP: () => "127.0.0.1",
  RATE_LIMITS: { orders: { limit: 10, windowMs: 60_000 } },
}));
vi.mock("@/lib/yandex-metrika", () => ({ trackEventServer: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications", () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/chat-automation", () => ({ ensureOrderChatRoom: vi.fn(async () => "room-1") }));
vi.mock("@/lib/telegram-bot", () => ({ notifyNewOrder: vi.fn(async () => ({})) }));
vi.mock("@/lib/email", () => ({ sendTemplateEmail: vi.fn(async () => ({})) }));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      if (/sync_effective_product_prices/.test(sql)) return { rows: [{ sync: 0 }], rowCount: 1 };
      if (/get_product_price_at/.test(sql)) return { rows: [], rowCount: 0 }; // пустая история → fallback
      if (sql.includes("FROM public.products")) {
        const p = dbState.product;
        const rows = p
          ? [{ id: p.id, title: p.title, recipe_id: null, production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null, recipe_updated_at: null, category_slug: null }]
          : [];
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  }),
}));

import { POST } from "./route";

const BASE = "http://localhost:3000";
const PID = "11111111-1111-1111-1111-111111111111";

function jsonReq(body: unknown): NextRequest {
  return new NextRequest(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  captured.length = 0;
  dbState.confectioners = [];
  dbState.product = null;
});

describe("POST /api/orders — серверный расчёт доставки (PR-2C)", () => {
  it("deliveryCost 0 от клиента: сервер считает 300₽ (1800 < 3000), значение → deliveryClientSubmitted", async () => {
    dbState.product = { id: PID, title: "Медовик", price: 1800, images: ["a.png"], confectioner_id: "uuid-conf-1" };

    const res = await POST(
      jsonReq({
        items: [{ productId: PID, quantity: 1 }],
        deliveryAddress: "г. Москва, ул. Тверская 1",
        deliveryCost: 0,
      })
    );
    expect(res.status).toBe(201);

    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert")!;
    const payload = orderInsert.args[0] as Record<string, unknown>;
    expect(payload.delivery_cost).toBe(300); // calculateDelivery(1800).cost — та же формула, что в checkout
    expect(payload.total).toBe(2100); // 1800 + 300

    const pricing = (payload.metadata as Record<string, unknown>).pricing as {
      deliverySource: string;
      deliveryClientSubmitted: number | null;
      currency: string;
      items: Array<{ productId: string; priceVersionId: string | null; unitPrice: number }>;
    };
    expect(pricing.deliverySource).toBe("server_calculated");
    expect(pricing.deliveryClientSubmitted).toBe(0); // присланный 0 записан ТОЛЬКО в аудит
    expect(pricing.currency).toBe("RUB");
    expect(pricing.items).toEqual([
      { productId: PID, priceVersionId: null, unitPrice: 1800 },
    ]);

    // fallback-цена: order_items без версии (история цен пуста)
    const itemsInsert = captured.find((c) => c.table === "order_items" && c.op === "insert")!;
    const itemRows = itemsInsert.args[0] as Array<Record<string, unknown>>;
    expect(itemRows[0].price).toBe(1800);
    expect(itemRows[0].price_version_id).toBeNull();
  });

  it("deliveryCost 5000 от клиента: всё равно серверные 300₽ (клиентская цена не доверяется)", async () => {
    dbState.product = { id: PID, title: "Медовик", price: 1800, images: [], confectioner_id: null };

    const res = await POST(
      jsonReq({
        items: [{ productId: PID, quantity: 1 }],
        deliveryAddress: "г. Москва, ул. Тверская 1",
        deliveryCost: 5000,
      })
    );
    expect(res.status).toBe(201);

    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert")!;
    const payload = orderInsert.args[0] as Record<string, unknown>;
    expect(payload.delivery_cost).toBe(300); // НЕ 5000
    expect(payload.total).toBe(2100); // НЕ 6800

    const pricing = (payload.metadata as Record<string, unknown>).pricing as {
      deliveryClientSubmitted: number | null;
    };
    expect(pricing.deliveryClientSubmitted).toBe(5000); // отклонение зафиксировано в аудите
  });

  it("itemsTotal ≥ 3000 → бесплатная доставка (единая формула с checkout), version binding через историю", async () => {
    dbState.product = { id: PID, title: "Медовик", price: 1800, images: [], confectioner_id: null };

    const res = await POST(
      jsonReq({
        items: [{ productId: PID, quantity: 2 }],
        deliveryAddress: "г. Москва, ул. Тверская 1",
        deliveryCost: 0,
      })
    );
    expect(res.status).toBe(201);

    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert")!;
    const payload = orderInsert.args[0] as Record<string, unknown>;
    expect(payload.delivery_cost).toBe(0); // 3600 ≥ 3000 → бесплатно, как в checkout
    expect(payload.total).toBe(3600);
  });
});
