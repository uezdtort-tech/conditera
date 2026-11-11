/**
 * snapshot-breakdown.test.ts — единый источник потребности для breakdown и
 * purchase-draft (Z-v29 §7 ТЗ): разбор заказа считается ИЗ snapshot
 * исторического заказа; повреждённый snapshot → SNAPSHOT_INVALID (fail-closed),
 * а не расчёт по случайной версии рецепта.
 *
 * computeOrderBreakdown под моком getPool. purchase-draft переиспользует
 * computeOrderBreakdown (см. route) — функция-level покрытие здесь закрывает
 * оба роута; damaged-ветка роутов → 409 SNAPSHOT_INVALID.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type OrderRow = {
  order_id: string;
  number: string;
  status: string;
  delivery_date: string | null;
  delivery_time_window: string | null;
  confectioner_id: string | null;
  product_id: string | null;
  quantity: number | string | null;
  title: string | null;
  recipe_id: string | null;
  metadata: string | null;
};
type RiRow = { recipe_id: string; name: string; qty: string; unit: string; inventory_item_id: string | null };
type InvRow = { id: string; name: string; quantity: string; unit: string; cost_per_unit: number | null; supplier: string | null };

let orderRows: OrderRow[] = [];
let recipeIngredients: RiRow[] = [];
let inventoryItems: InvRow[] = [];
const queriedSql: string[] = [];

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      queriedSql.push(sql);
      if (sql.includes("FROM public.orders")) {
        return { rows: orderRows, rowCount: orderRows.length };
      }
      if (sql.includes("FROM public.recipe_ingredients")) {
        return { rows: recipeIngredients, rowCount: recipeIngredients.length };
      }
      if (sql.includes("FROM public.inventory_items")) {
        return { rows: inventoryItems, rowCount: inventoryItems.length };
      }
      return { rows: [], rowCount: 0 };
    },
  }),
}));

import { computeOrderBreakdown, computeIngredientNeeds } from "./breakdown";
import { ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION } from "./snapshot";

const R = "8806b15e-7d98-44b5-965d-05ba64b48cc7";
const P = "aaaaaaaa-0000-4000-8000-00000000c001";
const OWNER = "11111111-1111-4111-8111-111111111101";
const ORDER_ID = "99999999-9999-4999-8999-999999999999";
const SNAPSHOT_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

const SNAPSHOT_A = {
  schema_version: ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: SNAPSHOT_ID,
  created_at: "2026-01-01T10:00:00.000Z",
  source: "checkout",
  legacy: false,
  items: [
    {
      product_id: P,
      title: "Ягодный бархат",
      quantity: 2,
      recipe_id: R,
      recipe_version_id: null,
      recipe_updated_at: null,
      production_time_hours: 6,
      prep_time_minutes: null,
      cook_time_minutes: null,
      category_slug: null,
      ingredients: [
        { name: "Ягоды", qty: 250, unit: "г", inventory_item_id: "inv-b" },
        { name: "Мука", qty: 300, unit: "г", inventory_item_id: null },
      ],
    },
  ],
};

function orderRowWith(metadata: unknown): OrderRow[] {
  return [
    {
      order_id: ORDER_ID,
      number: "UK-2030-000001",
      status: "CONFIRMED",
      delivery_date: "2030-06-01",
      delivery_time_window: null,
      confectioner_id: OWNER,
      product_id: P,
      quantity: 2,
      title: "Ягодный бархат",
      recipe_id: R,
      metadata: metadata === null ? null : JSON.stringify(metadata),
    },
  ];
}

beforeEach(() => {
  // Live-рецепт изменён ПОСЛЕ заказа: 500 г (snapshot фиксирует 250 г)
  recipeIngredients = [
    { recipe_id: R, name: "Ягоды", qty: "500.000", unit: "г", inventory_item_id: "inv-b" },
  ];
  inventoryItems = [
    { id: "inv-b", name: "Ягоды", quantity: "600", unit: "г", cost_per_unit: 300, supplier: null },
    { id: "inv-f", name: "мука", quantity: "1000", unit: "г", cost_per_unit: 50, supplier: null },
  ];
  queriedSql.length = 0;
});

describe("computeOrderBreakdown — snapshot как единый источник потребности", () => {
  it("разбор исторического заказа считается по snapshot A, не по live B", async () => {
    orderRows = orderRowWith({ acceptance_snapshot: SNAPSHOT_A });

    const result = await computeOrderBreakdown(ORDER_ID);
    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    const b = result.breakdown;
    expect(b.need_source).toBe("snapshot");
    // Live-рецепт (B) не читался — потребность из snapshot
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(false);
    const berries = b.ingredients.find((i) => i.name === "Ягоды");
    expect(berries).toBeDefined();
    expect(berries!.required).toBe(500); // 2 × 250 (A), а не 2 × 500 (B)
    expect(berries!.status).toBe("ok");
    // Мука: привязка по имени (inventory_item_id=null в snapshot)
    const flour = b.ingredients.find((i) => i.name === "Мука");
    expect(flour!.required).toBe(600);
    expect(flour!.status).toBe("ok");
    expect(b.can_produce).toBe(true);
    // recipe_id позиции — ИСХОДНЫЙ (зафиксированный)
    expect(b.items[0].recipe_id).toBe(R);
  });

  it("легаси-заказ без snapshot → live-расчёт с явным need_source=live", async () => {
    orderRows = orderRowWith({ contact: { name: "x" } });

    const result = await computeOrderBreakdown(ORDER_ID);
    if (!result || !result.ok) return void expect.unreachable("expected ok");
    expect(result.breakdown.need_source).toBe("live");
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(true);
    const berries = result.breakdown.ingredients.find((i) => i.name === "Ягоды");
    expect(berries!.required).toBe(1000); // live B: 2 × 500
    expect(berries!.status).toBe("shortage"); // 600 на складе < 1000
    expect(result.breakdown.total_shortage_cost).toBeGreaterThan(0);
  });

  it("повреждённый snapshot → ok:false SNAPSHOT_INVALID (не live-расчёт)", async () => {
    orderRows = orderRowWith({
      acceptance_snapshot: { ...SNAPSHOT_A, schema_version: 2 },
    });

    const result = await computeOrderBreakdown(ORDER_ID);
    expect(result).toEqual({
      ok: false,
      code: "SNAPSHOT_INVALID",
      message: expect.stringContaining("unknown_schema_version"),
    });
    // НИ snapshot, НИ текущий рецепт не используются
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(false);
  });

  it("snapshot не соответствует позициям заказа → SNAPSHOT_INVALID", async () => {
    const foreign = JSON.parse(JSON.stringify(SNAPSHOT_A));
    foreign.items[0].quantity = 7; // order_items: 2
    orderRows = orderRowWith({ acceptance_snapshot: foreign });

    const result = await computeOrderBreakdown(ORDER_ID);
    expect(result && !result.ok ? result.code : "").toBe("SNAPSHOT_INVALID");
  });

  it("заказ не найден → null (без изменений)", async () => {
    orderRows = [];
    expect(await computeOrderBreakdown(ORDER_ID)).toBeNull();
  });
});

describe("computeIngredientNeeds — norm-режим (механика snapshot)", () => {
  it("нормы передаются напрямую: recipe_ingredients не запрашивается", async () => {
    const needs = await computeIngredientNeeds(
      [
        {
          recipe_id: R,
          quantity: 2,
          ingredientNorms: [{ name: "Ягоды", qty: 250, unit: "г", inventory_item_id: "inv-b" }],
        },
      ],
      OWNER
    );
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(false);
    expect(needs.ingredients[0]).toMatchObject({ name: "Ягоды", required: 500, status: "ok" });
  });

  it("смешанный батч: snapshot-позиция + легаси-позиция", async () => {
    recipeIngredients = [
      { recipe_id: R, name: "Ягоды", qty: "500.000", unit: "г", inventory_item_id: "inv-b" },
    ];
    const needs = await computeIngredientNeeds(
      [
        {
          recipe_id: R,
          quantity: 1,
          ingredientNorms: [{ name: "Ягоды", qty: 250, unit: "г", inventory_item_id: "inv-b" }],
        },
        { recipe_id: R, quantity: 1 }, // легаси — live
      ],
      OWNER
    );
    // Агрегация обеих позиций в один ключ: 250 (snapshot) + 500 (live) = 750
    const berries = needs.ingredients.find((i) => i.name === "Ягоды");
    expect(berries!.required).toBe(750);
  });

  it("unit_mismatch внутри snapshot-норм → fail-closed (не нулевой расход)", async () => {
    const needs = await computeIngredientNeeds(
      [
        {
          recipe_id: R,
          quantity: 1,
          ingredientNorms: [
            { name: "Ягоды", qty: 250, unit: "г", inventory_item_id: "inv-b" },
            { name: "Ягоды", qty: 1, unit: "л", inventory_item_id: "inv-b" },
          ],
        },
      ],
      OWNER
    );
    expect(needs.can_produce).toBe(false);
    expect(needs.ingredients.some((i) => i.status === "unit_mismatch")).toBe(true);
    // Совокупный расход «Ягоды» не считается (несовместимые единицы не складываются)
    const berries = needs.ingredients.find((i) => i.name === "Ягоды");
    expect(berries!.status).toBe("unit_mismatch");
    expect(berries!.shortage).toBeNull();
  });
});
