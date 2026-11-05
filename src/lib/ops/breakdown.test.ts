/**
 * breakdown.test.ts — регрессия расчёта потребности в ингредиентах
 * (приёмка Z-v12, сценарий: заказ → рецепт → склад).
 *
 * computeIngredientNeeds под моком getPool (без реальной БД). Лочит:
 *   • накопление потребности по порциям (норма × quantity);
 *   • конверсию единиц г↔кг, мл↔л, шт↔дес;
 *   • shortage при нехватке и точный остаток после конверсии;
 *   • no_stock для ингредиента без привязки к складу (и без имени);
 *   • позицию БЕЗ recipe_id — молча пропускается (нет ингредиентов);
 *   • unit_mismatch (неизвестная единица склада) — не входит в shortages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Мок пула: canned-ответы по SQL-признакам ----------------------------
type RiRow = { recipe_id: string; name: string; qty: string; unit: string; inventory_item_id: string | null };
type InvRow = { id: string; name: string; quantity: string; unit: string; cost_per_unit: number | null; supplier: string | null };

let recipeIngredients: RiRow[] = [];
let inventoryItems: InvRow[] = [];

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
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

import { computeIngredientNeeds } from "./breakdown";

const R = "8806b15e-7d98-44b5-965d-05ba64b48cc7"; // «Красный бархат (демо)»
const OWNER = "11111111-1111-4111-8111-111111111101";

beforeEach(() => {
  recipeIngredients = [];
  inventoryItems = [];
});

describe("computeIngredientNeeds — конверсия и накопление", () => {
  it("450 г ×2 = 0.9 кг потребности при складе 25 кг → ok", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Мука", qty: "450.000", unit: "г", inventory_item_id: "inv-flour" }];
    inventoryItems = [{ id: "inv-flour", name: "Мука пшеничная в/с", quantity: "25.00", unit: "кг", cost_per_unit: null, supplier: null }];
    const needs = await computeIngredientNeeds([{ recipe_id: R, quantity: 2 }], OWNER);
    expect(needs.ingredients).toHaveLength(1);
    const flour = needs.ingredients[0];
    expect(flour.required).toBe(900); // 450 г ×2 — в единице рецепта (г)
    expect(flour.unit).toBe("г");
    expect(flour.stock).toBe(25000); // склад 25 кг → 25000 г
    expect(flour.status).toBe("ok");
    expect(needs.can_produce).toBe(true);
  });

  it("600 мл ×2 = 1.2 л при складе 7 л → ok", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Сливки", qty: "600.000", unit: "мл", inventory_item_id: "inv-cream" }];
    inventoryItems = [{ id: "inv-cream", name: "Сливки 33-35%", quantity: "7.00", unit: "л", cost_per_unit: null, supplier: null }];
    const needs = await computeIngredientNeeds([{ recipe_id: R, quantity: 2 }], OWNER);
    expect(needs.ingredients[0].required).toBe(1200);
    expect(needs.ingredients[0].stock).toBe(7000);
    expect(needs.ingredients[0].status).toBe("ok");
  });

  it("8 шт ×2 = 1.6 дес потребности при складе 15 дес → ok (алиас дес, Z-v12)", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Яйца", qty: "8.000", unit: "шт", inventory_item_id: "inv-eggs" }];
    inventoryItems = [{ id: "inv-eggs", name: "Яйцо куриное С0", quantity: "15.00", unit: "дес", cost_per_unit: null, supplier: null }];
    const needs = await computeIngredientNeeds([{ recipe_id: R, quantity: 2 }], OWNER);
    const eggs = needs.ingredients[0];
    expect(eggs.required).toBe(16);
    expect(eggs.stock).toBe(150);
    expect(eggs.status).toBe("ok");
    expect(needs.can_produce).toBe(true);
  });
});

describe("computeIngredientNeeds — дефицит", () => {
  it("нехватка шоколада: треба 6000 г, на складе 5.5 кг → shortage 500 г", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Шоколад", qty: "3000.000", unit: "г", inventory_item_id: "inv-choco" }];
    inventoryItems = [{ id: "inv-choco", name: "Шоколад тёмный 70%", quantity: "5.50", unit: "кг", cost_per_unit: 800, supplier: null }];
    const needs = await computeIngredientNeeds([{ recipe_id: R, quantity: 2 }], OWNER);
    const choco = needs.ingredients[0];
    expect(choco.status).toBe("shortage");
    expect(choco.stock).toBe(5500);
    expect(choco.shortage).toBe(500);
    expect(needs.shortages).toHaveLength(1);
    expect(needs.can_produce).toBe(false);
    expect(needs.total_shortage_cost).toBe(800); // ceil(0.5кг)=1 × 800
  });

  it("нет привязки к складу и нет имени на складе → no_stock, вся потребность в дефиците", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Ягоды", qty: "250.000", unit: "г", inventory_item_id: null }];
    inventoryItems = [{ id: "inv-x", name: "Мука пшеничная в/с", quantity: "25.00", unit: "кг", cost_per_unit: null, supplier: null }];
    const needs = await computeIngredientNeeds([{ recipe_id: R, quantity: 2 }], OWNER);
    const berries = needs.ingredients[0];
    expect(berries.status).toBe("no_stock");
    expect(berries.shortage).toBe(500);
    expect(needs.shortages).toHaveLength(1);
    expect(needs.can_produce).toBe(false);
  });
});

describe("computeIngredientNeeds — крайние случаи", () => {
  it("позиция без recipe_id не даёт ингредиентов (нет молчаливого расчёта)", async () => {
    const needs = await computeIngredientNeeds([{ recipe_id: null, quantity: 3 }], OWNER);
    expect(needs.ingredients).toHaveLength(0);
    expect(needs.shortages).toHaveLength(0);
    expect(needs.can_produce).toBe(false); // ingredients.length === 0
  });

  it("несовместимая единица склада → unit_mismatch, не входит в shortages", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Сахар", qty: "2", unit: "чашка", inventory_item_id: "inv-sugar" }];
    inventoryItems = [{ id: "inv-sugar", name: "Сахар-песок", quantity: "18.00", unit: "кг", cost_per_unit: null, supplier: null }];
    const needs = await computeIngredientNeeds([{ recipe_id: R, quantity: 1 }], OWNER);
    expect(needs.ingredients[0].status).toBe("unit_mismatch");
    expect(needs.ingredients[0].shortage).toBeNull();
    expect(needs.shortages).toHaveLength(0);
    expect(needs.can_produce).toBe(false);
  });

  it("несколько позиций одного рецепта — суммарная порционность", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Мука", qty: "450.000", unit: "г", inventory_item_id: "inv-flour" }];
    inventoryItems = [{ id: "inv-flour", name: "Мука пшеничная в/с", quantity: "25.00", unit: "кг", cost_per_unit: null, supplier: null }];
    const needs = await computeIngredientNeeds(
      [
        { recipe_id: R, quantity: 1 },
        { recipe_id: R, quantity: 3 },
      ],
      OWNER
    );
    expect(needs.ingredients[0].required).toBe(1800); // 450 × (1+3)
  });

  it("без склада (ownerId null) → no_stock для всех ингредиентов рецепта", async () => {
    recipeIngredients = [{ recipe_id: R, name: "Мука", qty: "450.000", unit: "г", inventory_item_id: "inv-flour" }];
    const needs = await computeIngredientNeeds([{ recipe_id: R, quantity: 1 }], null);
    expect(needs.ingredients[0].status).toBe("no_stock");
    expect(needs.can_produce).toBe(false);
  });
});
