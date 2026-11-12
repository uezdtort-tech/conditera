/**
 * Тесты POST /api/confectioner/products/[id]/price (set_product_price, 0083).
 *
 * Покрытие: валидация 400 (отрицательный amount, reason 'initial'/невалидный,
 * плохая дата), немедленная установка → planned:false + delta-математика +
 * cost_snapshot из рецепта, будущая date-only дата → planned:true + TZ
 * Europe/Moscow 00:00, идемпотентный replay (23505), 23P01 → 409.
 *
 * Мок-паттерн: vi.mock + vi.hoisted, pool.query маршрутизируется по SQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PRODUCT_ID = "a0000000-0000-4000-8000-000000000001";
const OWNER_ID = "c0000000-0000-4000-8000-000000000001";
const RECIPE_ID = "f0000000-0000-4000-8000-000000000001";

const { state, poolQueryMock, userMock, adminMock } = vi.hoisted(() => ({
  state: {
    productRows: [] as unknown[],
    recipeIdRows: [] as unknown[],
    ingredientRows: [] as unknown[],
    setRows: [] as unknown[],
    setErr: null as { code?: string; message?: string } | null,
    historyRows: [] as unknown[],
  },
  poolQueryMock: vi.fn(),
  userMock: vi.fn(),
  adminMock: vi.fn(),
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: poolQueryMock }),
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => userMock(...args),
}));
vi.mock("@/lib/role-guards", () => ({
  isAdmin: (...args: unknown[]) => adminMock(...args),
}));

function router(sql: string): { rows: unknown[] } {
  if (/SELECT recipe_id FROM public\.products/.test(sql)) return { rows: state.recipeIdRows };
  if (/FROM public\.recipe_ingredients/.test(sql)) return { rows: state.ingredientRows };
  if (/deleted_at IS NULL/.test(sql)) return { rows: state.productRows };
  if (/set_product_price/.test(sql)) {
    if (state.setErr) {
      throw Object.assign(new Error(state.setErr.message ?? "pg error"), state.setErr);
    }
    return { rows: state.setRows.map((result) => ({ result })) };
  }
  if (/FROM public\.product_price_history/.test(sql)) return { rows: state.historyRows };
  return { rows: [] };
}

import { POST } from "./route";

async function callPost(body: unknown): Promise<Response> {
  const request = new NextRequest(
    `http://localhost:3000/api/confectioner/products/${PRODUCT_ID}/price`,
    { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }
  );
  return POST(request, { params: Promise.resolve({ id: PRODUCT_ID }) });
}

/** Склад: 1 шт × 300 RUB (unit 'шт' → 'шт', конверсия не нужна). */
function pricedIngredient(): Record<string, unknown> {
  return { qty: 1, unit: "шт", cost_per_unit: 300, inventory_unit: "шт" };
}

beforeEach(() => {
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation((sql: string) => router(sql));
  userMock.mockReset();
  userMock.mockResolvedValue({ id: OWNER_ID, userId: OWNER_ID });
  adminMock.mockReset();
  adminMock.mockResolvedValue(false);
  state.productRows = [{ id: PRODUCT_ID, confectioner_id: OWNER_ID }];
  state.recipeIdRows = [{ recipe_id: RECIPE_ID }];
  state.ingredientRows = [];
  state.setRows = [];
  state.setErr = null;
  state.historyRows = [];
});

describe("POST /api/confectioner/products/[id]/price", () => {
  it("отрицательный amount → 400 VALIDATION_FAILED", async () => {
    const res = await callPost({ amount: -5, effectiveFrom: "2026-01-01", reason: "ingredients" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILED");
  });

  it("reason 'initial' → 400 INVALID_REASON (зарезервирован за сидом/функцией)", async () => {
    const res = await callPost({ amount: 5000, effectiveFrom: "2026-01-01", reason: "initial" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_REASON");
  });

  it("невалидная дата → 400 INVALID_EFFECTIVE_FROM", async () => {
    const res = await callPost({ amount: 5000, effectiveFrom: "не-дата", reason: "ingredients" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_EFFECTIVE_FROM");
  });

  it("немедленная установка: planned:false, delta-математика, cost_snapshot из рецепта", async () => {
    state.ingredientRows = [pricedIngredient()];
    state.setRows = [
      {
        versionId: "e0000000-0000-4000-8000-000000000009",
        previousAmount: 5000,
        newAmount: 5500,
        effectiveFrom: "2026-01-05T00:00:00.000Z",
        effectiveTo: null,
        planned: false,
      },
    ];

    const res = await callPost({
      amount: 5500,
      effectiveFrom: "2026-01-05T00:00:00Z",
      reason: "ingredients",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      versionId: "e0000000-0000-4000-8000-000000000009",
      previousAmount: 5000,
      newAmount: 5500,
      deltaRub: 500,
      deltaPercent: 10,
      planned: false,
    });

    // cost_snapshot: 1 шт × 300 RUB = 300 (p_cost_snapshot — 9-й параметр)
    const calls = poolQueryMock.mock.calls as Array<[string, unknown[]]>;
    const setCall = calls.find(([sql]) => /set_product_price/.test(sql));
    expect(setCall).toBeDefined();
    expect(setCall![1][8]).toBe(300);
    // p_source = 'confectioner_ui', p_variant_id = NULL, p_actor_is_admin = false
    expect(setCall![1][7]).toBe("confectioner_ui");
    expect(setCall![1][2]).toBeNull();
    expect(setCall![1][10]).toBe(false);
  });

  it("будущая date-only дата: planned:true, 00:00 Europe/Moscow (+03:00)", async () => {
    state.setRows = [
      {
        versionId: "e0000000-0000-4000-8000-00000000000a",
        previousAmount: 5500,
        newAmount: 6000,
        effectiveFrom: "2099-01-31T21:00:00.000Z",
        effectiveTo: null,
        planned: true,
      },
    ];

    const res = await callPost({ amount: 6000, effectiveFrom: "2099-02-01", reason: "labor" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.planned).toBe(true);

    // "2099-02-01" → 2099-02-01T00:00:00+03:00 = 2099-01-31T21:00:00Z (p_effective_from — 5-й параметр)
    const calls = poolQueryMock.mock.calls as Array<[string, unknown[]]>;
    const setCall = calls.find(([sql]) => /set_product_price/.test(sql));
    expect(setCall![1][4]).toBe("2099-01-31T21:00:00.000Z");
  });

  it("гонка idempotency (23505) → replay по ключу: 200 idempotent:true", async () => {
    state.setErr = { code: "23505", message: "duplicate key value violates unique constraint" };
    state.historyRows = [
      {
        id: "e0000000-0000-4000-8000-00000000000b",
        amount: 5500,
        effective_from: "2026-01-05T00:00:00.000Z",
        effective_to: null,
      },
    ];

    const res = await callPost({
      amount: 5500,
      effectiveFrom: "2026-01-05T00:00:00Z",
      reason: "ingredients",
      idempotencyKey: "key-123",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.idempotent).toBe(true);
    expect(json.versionId).toBe("e0000000-0000-4000-8000-00000000000b");
    expect(json.newAmount).toBe(5500);
  });

  it("пересечение интервалов (23P01) → 409 PRICE_PERIOD_CONFLICT", async () => {
    state.setErr = {
      code: "23P01",
      message: "conflicting key value violates exclusion constraint product_price_history_no_overlap",
    };
    const res = await callPost({
      amount: 5500,
      effectiveFrom: "2026-01-05T00:00:00Z",
      reason: "ingredients",
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("PRICE_PERIOD_CONFLICT");
  });

  it("чужой кондитер: 403 (в функцию не доходим)", async () => {
    userMock.mockResolvedValue({ id: "c0000000-0000-4000-8000-000000000002", userId: "c0000000-0000-4000-8000-000000000002" });
    const res = await callPost({ amount: 5000, effectiveFrom: "2026-01-01", reason: "ingredients" });
    expect(res.status).toBe(403);
    const calls = poolQueryMock.mock.calls as Array<[string]>;
    expect(calls.some(([sql]) => /set_product_price/.test(sql))).toBe(false);
  });
});
