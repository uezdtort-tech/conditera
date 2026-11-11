/**
 * acceptance.test.ts — регрессия Z-v27 (сценарий P): fail-closed при
 * неизвестной/несовместимой единице склада.
 *
 * checkAcceptance под моком getPool (без реальной БД). Лочит:
 *   • unit_mismatch-ингредиент склада → БЛОКИРУЮЩИЙ код INVENTORY_UNIT_MISMATCH
 *     (раньше checkout-гейт пропускал такой заказ, а accept затем отклонял —
 *     оплаченный заказ зависал; Z-v27 P1, исправлено);
 *   • полностью совместимые остатки → canAccept=true, без новых кодов
 *     (регресс против ложных блокировок);
 *   • блокировки через computeIngredientNeeds (shortage) сохраняются.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Мок пула: canned-ответы по SQL-признакам ----------------------------
type ProdRow = {
  id: string; title: string; confectioner_id: string | null;
  recipe_id: string | null; production_time_hours: number | null;
  prep_time_minutes: number | null; cook_time_minutes: number | null;
  category_slug: string | null;
};
type RiRow = { recipe_id: string; name: string; qty: string; unit: string; inventory_item_id: string | null };
type InvRow = { id: string; name: string; quantity: string; unit: string; cost_per_unit: number | null; supplier: string | null };

let products: ProdRow[] = [];
let recipeIngredients: RiRow[] = [];
let inventoryItems: InvRow[] = [];

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      if (sql.includes("FROM public.products")) {
        return { rows: products, rowCount: products.length };
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

import { checkAcceptance, loadProductItemsData } from "./acceptance";

const R = "8806b15e-7d98-44b5-965d-05ba64b48cc7";
const P = "aaaaaaaa-0000-4000-8000-00000000c001";
const OWNER = "11111111-1111-4111-8111-111111111101";
const DAY = "2030-06-01";

beforeEach(() => {
  products = [];
  recipeIngredients = [];
  inventoryItems = [];
});

describe("checkAcceptance — unit_mismatch fail-closed (Z-v27 P)", () => {
  it("неизвестная единица склада («ложка») → INVENTORY_UNIT_MISMATCH блокирует checkout-гейт", async () => {
    products = [{
      id: P, title: "Тест-товар", confectioner_id: OWNER, recipe_id: R,
      production_time_hours: 6, prep_time_minutes: null, cook_time_minutes: null,
      category_slug: null,
    }];
    recipeIngredients = [{ recipe_id: R, name: "Ягоды", qty: "250.000", unit: "г", inventory_item_id: "inv-b" }];
    inventoryItems = [{ id: "inv-b", name: "Ягоды", quantity: "1000", unit: "ложка", cost_per_unit: null, supplier: null }];

    const items = await loadProductItemsData([{ productId: P, quantity: 1 }]);
    const r = await checkAcceptance({ items, assignedConfectionerId: OWNER, deliveryDate: DAY, deliveryTimeWindow: null, deliveryTime: null });
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain("INVENTORY_UNIT_MISMATCH");
    expect(r.canAccept).toBe(false);
    expect(r.availability).toBe("unavailable");
  });

  it("несовместимое измерение (склад «л», рецепт «г») → тоже блокирует", async () => {
    products = [{
      id: P, title: "Тест-товар", confectioner_id: OWNER, recipe_id: R,
      production_time_hours: 6, prep_time_minutes: null, cook_time_minutes: null,
      category_slug: null,
    }];
    recipeIngredients = [{ recipe_id: R, name: "Мука", qty: "450.000", unit: "г", inventory_item_id: "inv-f" }];
    inventoryItems = [{ id: "inv-f", name: "Мука", quantity: "25", unit: "л", cost_per_unit: null, supplier: null }];

    const items = await loadProductItemsData([{ productId: P, quantity: 1 }]);
    const r = await checkAcceptance({ items, assignedConfectionerId: OWNER, deliveryDate: DAY, deliveryTimeWindow: null, deliveryTime: null });
    expect(r.reasons.map((x) => x.code)).toContain("INVENTORY_UNIT_MISMATCH");
    expect(r.canAccept).toBe(false);
  });

  it("совместимые остатки → canAccept=true, новых кодов нет (нет ложных блокировок)", async () => {
    products = [{
      id: P, title: "Тест-товар", confectioner_id: OWNER, recipe_id: R,
      production_time_hours: 6, prep_time_minutes: null, cook_time_minutes: null,
      category_slug: null,
    }];
    recipeIngredients = [{ recipe_id: R, name: "Ягоды", qty: "250.000", unit: "г", inventory_item_id: "inv-b" }];
    inventoryItems = [{ id: "inv-b", name: "Ягоды", quantity: "1000", unit: "г", cost_per_unit: null, supplier: null }];

    const items = await loadProductItemsData([{ productId: P, quantity: 1 }]);
    const r = await checkAcceptance({ items, assignedConfectionerId: OWNER, deliveryDate: DAY, deliveryTimeWindow: null, deliveryTime: null });
    const codes = r.reasons.map((x) => x.code);
    expect(codes).not.toContain("INVENTORY_UNIT_MISMATCH");
    expect(codes).not.toContain("LOW_STOCK");
    expect(r.canAccept).toBe(true);
    expect(r.owners[0].inventory.canProduce).toBe(true);
  });

  it(" shortage при совместимых единицах по-прежнему блокирует (LOW_STOCK)", async () => {
    products = [{
      id: P, title: "Тест-товар", confectioner_id: OWNER, recipe_id: R,
      production_time_hours: 6, prep_time_minutes: null, cook_time_minutes: null,
      category_slug: null,
    }];
    recipeIngredients = [{ recipe_id: R, name: "Ягоды", qty: "250.000", unit: "г", inventory_item_id: "inv-b" }];
    inventoryItems = [{ id: "inv-b", name: "Ягоды", quantity: "100", unit: "г", cost_per_unit: null, supplier: null }];

    const items = await loadProductItemsData([{ productId: P, quantity: 1 }]);
    const r = await checkAcceptance({ items, assignedConfectionerId: OWNER, deliveryDate: DAY, deliveryTimeWindow: null, deliveryTime: null });
    expect(r.reasons.map((x) => x.code)).toContain("LOW_STOCK");
    expect(r.canAccept).toBe(false);
  });
});
