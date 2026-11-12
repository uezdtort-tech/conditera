/**
 * Тесты GET /api/confectioner/products/[id]/cost-analysis
 *
 * Покрытие: нет рецепта → currentCost.available:false + reason, маржа null;
 * рецепт со складом → маржа-математика; costExceedsPrice при cost >= price;
 * costGrewWhilePriceStale (снимки выросли >10% при «застоявшейся» цене);
 * честные маркеры: notice о недоступности исторической себестоимости,
 * ingredientDynamics.available:false, approximate:true.
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
    priceAtRows: [] as unknown[],
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
  if (/get_product_price_at/.test(sql)) return { rows: state.priceAtRows };
  if (/cost_snapshot_rub IS NOT NULL/.test(sql)) return { rows: state.historyRows };
  return { rows: [] };
}

import { GET } from "./route";

async function callGet(): Promise<Response> {
  const request = new NextRequest(
    `http://localhost:3000/api/confectioner/products/${PRODUCT_ID}/cost-analysis`
  );
  return GET(request, { params: Promise.resolve({ id: PRODUCT_ID }) });
}

beforeEach(() => {
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation((sql: string) => router(sql));
  userMock.mockReset();
  userMock.mockResolvedValue({ id: OWNER_ID, userId: OWNER_ID });
  adminMock.mockReset();
  adminMock.mockResolvedValue(false);
  state.productRows = [{ id: PRODUCT_ID, confectioner_id: OWNER_ID }];
  state.recipeIdRows = [];
  state.ingredientRows = [];
  state.priceAtRows = [
    {
      version_id: "e0000000-0000-4000-8000-000000000002",
      amount: 6000,
      currency: "RUB",
      effective_from: "2025-12-01T00:00:00.000Z",
      reason: "ingredients",
    },
  ];
  state.historyRows = [];
});

describe("GET /api/confectioner/products/[id]/cost-analysis", () => {
  it("нет рецепта: available:false + reason, маржа null, честные маркеры на месте", async () => {
    state.recipeIdRows = []; // products.recipe_id IS NULL
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.currentCost).toMatchObject({
      available: false,
      amountRub: null,
      approximate: true,
      basis: "recipe_ingredients × current inventory cost_per_unit",
    });
    expect(typeof json.currentCost.reason).toBe("string");
    expect(json.margin).toBeNull();
    expect(json.currentPrice).toMatchObject({ amount: 6000, approximate: false });
    expect(json.ingredientDynamics).toEqual({
      available: false,
      reason: "historical purchase prices were not tracked",
    });
    expect(json.warnings.costExceedsPrice).toBe(false);
    expect(json.warnings.marginLow).toBeNull();
  });

  it("рецепт со складом: маржа-математика (цена 6000, себестоимость 600 → 5400 / 90%)", async () => {
    state.recipeIdRows = [{ recipe_id: RECIPE_ID }];
    // 2 ингредиента × (1 шт × 300 RUB) = 600
    state.ingredientRows = [
      { qty: 1, unit: "шт", cost_per_unit: 300, inventory_unit: "шт" },
      { qty: 1, unit: "шт", cost_per_unit: 300, inventory_unit: "шт" },
    ];
    state.historyRows = [
      { effective_from: "2026-01-01T00:00:00.000Z", cost_snapshot_rub: 500 },
    ];

    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.currentCost).toMatchObject({ available: true, amountRub: 600, approximate: true });
    expect(json.margin).toEqual({ amountRub: 5400, percent: 90 });
    expect(json.warnings).toMatchObject({ costExceedsPrice: false, marginLow: false });
    expect(json.priceHistoryCosts.items).toEqual([
      { effectiveFrom: "2026-01-01T00:00:00.000Z", costRub: 500, approximate: true },
    ]);
    expect(json.priceHistoryCosts.notice).toContain("историческая себестоимость недоступна");
  });

  it("costExceedsPrice: себестоимость 7000 >= цена 6000 → true, marginLow true", async () => {
    state.recipeIdRows = [{ recipe_id: RECIPE_ID }];
    // 1 шт × 7000 RUB
    state.ingredientRows = [
      { qty: 1, unit: "шт", cost_per_unit: 7000, inventory_unit: "шт" },
    ];
    const res = await callGet();
    const json = await res.json();
    expect(json.warnings.costExceedsPrice).toBe(true);
    expect(json.margin).toEqual({ amountRub: -1000, percent: -16.7 });
    expect(json.warnings.marginLow).toBe(true);
  });

  it("costGrewWhilePriceStale: снимки 1000→1200 (>10%) при цене с 2025-12-01 (до старшего снимка) → true", async () => {
    state.recipeIdRows = [{ recipe_id: RECIPE_ID }];
    state.ingredientRows = [
      { qty: 1, unit: "шт", cost_per_unit: 300, inventory_unit: "шт" },
    ];
    state.historyRows = [
      { effective_from: "2026-01-01T00:00:00.000Z", cost_snapshot_rub: 1000 },
      { effective_from: "2026-02-01T00:00:00.000Z", cost_snapshot_rub: 1200 },
    ];
    const res = await callGet();
    const json = await res.json();
    // Покрывающая цена effective_from 2025-12-01 <= старшего снимка 2026-01-01,
    // рост 20% > 10% → предупреждение
    expect(json.warnings.costGrewWhilePriceStale).toBe(true);
  });
});
