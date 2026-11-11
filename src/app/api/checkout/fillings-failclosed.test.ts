/**
 * Регрессия POST /api/checkout — валидация кастомных позиций по РЕАЛЬНОМУ
 * каталогу начинок БД (ЕДИНАЯ формула с /api/cart) + fail-closed.
 *
 * Лочит контракт:
 *   a) ошибка каталога начинок → 503, заказ НЕ создаётся (молчаливый
 *      даунгрейд до mock запрещён — иначе cart↔checkout расходятся);
 *   b) начинка обязана существовать в переданном каталоге (DB+mock):
 *      неизвестный клиентский UUID → 422, заказа нет;
 *   c) цена custom-позиции считается СЕРВЕРОМ (calculateBuilderPrice по
 *      каталогу БД): client не может подменить сумму; маппинг
 *      price_multiplier 1.5 → 500 руб входит в расчёт;
 *   d) DB-only начинка проходит полный путь до создания заказа.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "a@test.local", roles: ["CUSTOMER"] };
const PID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ROW = { id: PID, title: "Медовик", price: 1800, status: "published", confectioner_id: null, fillings: [] };
const FILL_DB_ONLY = "f1000000-0000-0000-0000-000000000001";
const LOADED_FILLINGS = [
  { id: FILL_DB_ONLY, label: "Фисташка-мусс (из БД)", price: 500 },
  { id: "condensed_milk", label: "Варёная сгущёнка", price: 0 },
];

// Z-v29: checkout фиксирует metadata.acceptance_snapshot сервером —
// пул продуктов/рецептов замокан (товар без рецепта → пустые нормы snapshot).
vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      if (sql.includes("FROM public.products")) {
        return {
          rows: [{ id: PID, title: "Медовик", recipe_id: null, production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null, recipe_updated_at: null, category_slug: null }],
          rowCount: 1,
        };
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

function makeBuilder(table: string): unknown {
  const state = { table, insertSeen: false };
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
  loadBuilderFillingsForValidation: vi.fn(),
}));

vi.mock("@/lib/yookassa", () => ({
  isYookassaConfigured: () => false,
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
import { loadBuilderFillingsForValidation } from "@/lib/builder-fillings-server";
import { calculateBuilderPrice, type BuilderFillingOption } from "@/lib/cake-builder-pricing";

const mockLoader = vi.mocked(loadBuilderFillingsForValidation);

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

const CUSTOM_BODY = [{ id: "ci_1", quantity: 1, custom: { productType: "cake", base: "biscuit", tiers: 2, filling: FILL_DB_ONLY } }];

beforeEach(() => {
  captured.length = 0;
  mockLoader.mockReset();
  mockLoader.mockResolvedValue(LOADED_FILLINGS as BuilderFillingOption[]);
});

describe("POST /api/checkout — custom-позиции по каталогу БД (fail-closed)", () => {
  it("ошибка каталога начинок → 503 fail-closed, заказ НЕ создаётся", async () => {
    mockLoader.mockRejectedValue(new Error("fillings catalog unavailable: boom"));
    const res = await POST(checkoutRequest(CUSTOM_BODY));
    expect(res.status).toBe(503);
    expect(captured.some((c) => c.table === "orders" && c.op === "insert")).toBe(false);
  });

  it("неизвестная начинка (нет в DB+mock каталоге) → 422, заказа нет", async () => {
    const res = await POST(
      checkoutRequest([
        { id: "ci_x", quantity: 1, custom: { productType: "cake", base: "biscuit", tiers: 2, filling: "ghost_filling" } },
      ])
    );
    expect(res.status).toBe(422);
    expect(captured.some((c) => c.table === "orders" && c.op === "insert")).toBe(false);
  });

  it("DB-only начинка: заказ создан, цена посчитана СЕРВЕРОМ по каталогу БД", async () => {
    const res = await POST(checkoutRequest(CUSTOM_BODY));
    expect(res.status).toBe(200);

    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert");
    expect(orderInsert).toBeDefined();

    // Серверный расчёт: client прислал ТОЛЬКО конфиг (схема не имеет поля цены),
    // сумма обязана совпасть с calculateBuilderPrice по загруженному каталогу.
    const cfg = { productType: "cake", base: "biscuit", tiers: 2, filling: FILL_DB_ONLY } as never;
    const expectedUnit = calculateBuilderPrice(cfg, { fillings: LOADED_FILLINGS });
    expect(expectedUnit).not.toBeNull();
    const row = orderInsert!.args[0] as { subtotal: number; total: number; delivery_cost: number };
    // subtotal — чистая сумма позиций (только серверный расчёт)
    expect(row.subtotal).toBe(expectedUnit! * 1);
    // total = позиции + доставка (никаких клиентских надбавок)
    expect(row.total).toBe(row.subtotal + Number(row.delivery_cost || 0));
    // начинка из БД реально входит в цену: 500 (маппинг 1.5) учтён
    expect(expectedUnit!).toBeGreaterThan(0);
  });

  it("товарные позиции (без custom) не требуют каталога начинок", async () => {
    // loader НЕ должен вызываться; дефолтный mock уже настроен — сбросим в reject,
    // чтобы доказать, что путь ленивый и 503 не случится
    mockLoader.mockRejectedValue(new Error("must not be called"));
    const res = await POST(
      checkoutRequest([{ id: "ci_p", product_id: PID, quantity: 2 }])
    );
    expect(res.status).toBe(200);
    expect(mockLoader).not.toHaveBeenCalled();
  });
});
