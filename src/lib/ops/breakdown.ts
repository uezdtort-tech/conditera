/**
 * breakdown.ts — расчёт «разбора заказа» (Task 2-b).
 *
 * Считает потребность в ингредиентах по позициям заказа:
 *   order_items → products.recipe_id → recipe_ingredients (норма на 1 единицу товара),
 *   required = Σ ingredient.qty × item.quantity (порционность v1 не учитываем),
 * и сопоставляет со складом владельца заказа (inventory_items, is_active):
 *   • сперва по recipe_ingredients.inventory_item_id;
 *   • если null — по точному совпадению lower(trim(name)) (без синонимов).
 *
 * Единицы совместяются через convertQty (src/lib/ops/units.ts); несовместимая
 * единица склада → status='unit_mismatch' (shortage=null, запрос не падает).
 *
 * Используется двумя роутами:
 *   GET  /api/orders/[id]/breakdown        (просмотр)
 *   POST /api/orders/[id]/purchase-draft   (черновик закупки из дефицита)
 *
 * Бюджет: 3 SQL на вызов (order+items+products, recipe_ingredients, inventory_items).
 */

import { getPool } from "@/lib/postgrest/pool";
import { convertQty } from "./units";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IngredientStatus = "ok" | "shortage" | "no_stock" | "unit_mismatch";

export interface BreakdownIngredient {
  name: string;
  unit: string;
  required: number;
  stock: number | null;
  shortage: number | null;
  status: IngredientStatus;
  inventory_item_id: string | null;
  estimated_cost: number | null;
  /** Доп. поля для UI (сырые данные позиции склада). */
  warehouse_item_name: string | null;
  warehouse_unit: string | null;
  warehouse_quantity: number | null;
  supplier: string | null;
  note: string | null;
}

export interface BreakdownOrderInfo {
  id: string;
  number: string;
  status: string;
  delivery_date: string | null;
  delivery_time_window: string | null;
  confectioner_id: string | null;
}

export interface BreakdownItem {
  product_id: string | null;
  title: string;
  quantity: number;
  recipe_id: string | null;
}

export interface OrderBreakdown {
  order: BreakdownOrderInfo;
  items: BreakdownItem[];
  ingredients: BreakdownIngredient[];
  /** Подмножество ingredients: status='shortage' (shortage>0) или 'no_stock'. */
  shortages: BreakdownIngredient[];
  /** true, если каждая позиция ingredients в статусе 'ok'. */
  can_produce: boolean;
  /** Сумма estimated_cost по дефицитным позициям (руб; null-оценки не считаются). */
  total_shortage_cost: number;
}

type OrderItemRow = {
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
};

type RecipeIngredientRow = {
  recipe_id: string;
  name: string;
  qty: string | number;
  unit: string;
  inventory_item_id: string | null;
};

type InventoryRow = {
  id: string;
  name: string;
  quantity: string | number;
  unit: string;
  cost_per_unit: number | null;
  supplier: string | null;
};

/** Агрегат одного ингредиента по всем позициям заказа. */
interface IngredientAgg {
  name: string;
  unit: string;
  required: number;
  inventoryItemId: string | null;
  unitMismatchWithinRecipes: boolean;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Посчитать разбор заказа. Возвращает null, если заказ не найден
 * (или id не похож на uuid — чтобы не ловить ошибку каста из БД).
 */
export async function computeOrderBreakdown(
  orderId: string
): Promise<OrderBreakdown | null> {
  if (!UUID_RE.test(orderId)) return null;
  const pool = getPool();

  // --- SQL 1: заказ + позиции + привязка товаров к рецептам ---
  const itemsResult = await pool.query<OrderItemRow>(
    `SELECT
       o.id::text AS order_id,
       o.number,
       o.status::text AS status,
       to_char(o.delivery_date, 'YYYY-MM-DD') AS delivery_date,
       o.delivery_time_window,
       o.confectioner_id::text AS confectioner_id,
       oi.product_id::text AS product_id,
       oi.quantity,
       COALESCE(NULLIF(oi.product_title, ''), NULLIF(oi.title, ''), p.title, 'Товар') AS title,
       p.recipe_id::text AS recipe_id
     FROM public.orders o
     LEFT JOIN public.order_items oi ON oi.order_id = o.id
     LEFT JOIN public.products p ON p.id = oi.product_id
     WHERE o.id = $1::uuid`,
    [orderId]
  );
  if (itemsResult.rowCount === 0) return null;

  const first = itemsResult.rows[0];
  const order: BreakdownOrderInfo = {
    id: first.order_id,
    number: first.number,
    status: first.status,
    delivery_date: first.delivery_date,
    delivery_time_window: first.delivery_time_window,
    confectioner_id: first.confectioner_id,
  };
  const items: BreakdownItem[] = itemsResult.rows
    .filter((r) => r.product_id !== null || r.title !== null)
    .map((r) => ({
      product_id: r.product_id,
      title: r.title ?? "Товар",
      quantity: Number(r.quantity ?? 0),
      recipe_id: r.recipe_id,
    }));

  const needs = await computeIngredientNeeds(
    items.map((i) => ({ recipe_id: i.recipe_id, quantity: i.quantity })),
    order.confectioner_id
  );

  return {
    order,
    items,
    ingredients: needs.ingredients,
    shortages: needs.shortages,
    can_produce: needs.can_produce,
    total_shortage_cost: needs.total_shortage_cost,
  };
}

export interface IngredientNeedInput {
  recipe_id: string | null;
  quantity: number;
}

export interface IngredientNeeds {
  ingredients: BreakdownIngredient[];
  shortages: BreakdownIngredient[];
  can_produce: boolean;
  total_shortage_cost: number;
}

/**
 * Потребность в ингредиентах для набора позиций (recipe_id × quantity)
 * относительно склада владельца. Реиспользуется:
 *   • computeOrderBreakdown (разбор существующего заказа);
 *   • Acceptance Engine P0.5 (гипотетическая проверка «можем ли принять»).
 *
 * Бюджет: 2 SQL (recipe_ingredients, inventory_items).
 */
export async function computeIngredientNeeds(
  items: IngredientNeedInput[],
  ownerId: string | null
): Promise<IngredientNeeds> {
  const pool = getPool();

  // --- SQL A: ингредиенты всех задействованных рецептов ---
  const recipeIds = [
    ...new Set(
      items
        .map((i) => i.recipe_id)
        .filter((id): id is string => id !== null && UUID_RE.test(id))
    ),
  ];
  const recipeIngredients: RecipeIngredientRow[] = [];
  if (recipeIds.length > 0) {
    const riResult = await pool.query<RecipeIngredientRow>(
      `SELECT recipe_id::text, name, qty, unit, inventory_item_id::text
       FROM public.recipe_ingredients
       WHERE recipe_id = ANY($1::uuid[])
       ORDER BY sort_order, name`,
      [recipeIds]
    );
    recipeIngredients.push(...riResult.rows);
  }

  // --- SQL B: активный склад владельца ---
  const inventory: InventoryRow[] = [];
  if (ownerId) {
    const invResult = await pool.query<InventoryRow>(
      `SELECT id::text, name, quantity, unit, cost_per_unit, supplier
       FROM public.inventory_items
       WHERE owner_id = $1::uuid AND is_active`,
      [ownerId]
    );
    inventory.push(...invResult.rows);
  }

  const aggregates = new Map<string, IngredientAgg>();

  // Кол-во единиц товара на рецепт (для гипотетических позиций тоже)
  const qtyByRecipe = new Map<string, number>();
  for (const item of items) {
    if (!item.recipe_id) continue;
    const q = Math.max(Number(item.quantity) || 0, 0);
    qtyByRecipe.set(item.recipe_id, (qtyByRecipe.get(item.recipe_id) ?? 0) + q);
  }
  const itemQuantityFor = (recipeId: string): number =>
    qtyByRecipe.get(recipeId) ?? 0;

  for (const ri of recipeIngredients) {
    const perUnit = Number(ri.qty);
    if (!Number.isFinite(perUnit) || perUnit <= 0) continue;
    // recipe_ingredients — норма на 1 единицу товара; в наборе может быть
    // несколько позиций товаров с одним рецептом — берём суммарное количество.
    const itemQuantity = itemQuantityFor(ri.recipe_id);
    if (itemQuantity <= 0) continue;

    const contribution = perUnit * itemQuantity;
    const invKey = ri.inventory_item_id;
    const nameKey = `n:${ri.name.trim().toLowerCase()}`;
    const key = invKey ?? nameKey;

    let agg = aggregates.get(key);
    if (!agg) {
      agg = {
        name: ri.name.trim(),
        unit: ri.unit.trim() || "шт",
        required: 0,
        inventoryItemId: invKey,
        unitMismatchWithinRecipes: false,
      };
      aggregates.set(key, agg);
    }
    if (invKey && !agg.inventoryItemId) agg.inventoryItemId = invKey;

    const converted = convertQty(contribution, ri.unit, agg.unit);
    if (converted === null) {
      agg.unitMismatchWithinRecipes = true;
    } else {
      agg.required = round6(agg.required + converted);
    }
  }

  // --- Сопоставление со складом ---
  const invById = new Map(inventory.map((i) => [i.id, i]));
  const invByName = new Map(
    inventory.map((i) => [i.name.trim().toLowerCase(), i])
  );

  const ingredients: BreakdownIngredient[] = [];
  for (const agg of aggregates.values()) {
    // Строгий контракт: по inventory_item_id; если null — по точному имени.
    const inv = agg.inventoryItemId
      ? invById.get(agg.inventoryItemId) ?? null
      : invByName.get(agg.name.toLowerCase()) ?? null;

    const base = {
      name: agg.name,
      unit: agg.unit,
      required: round3(agg.required),
      inventory_item_id: inv ? inv.id : null,
      warehouse_item_name: inv ? inv.name : null,
      warehouse_unit: inv ? inv.unit : null,
      warehouse_quantity: inv ? Number(inv.quantity) : null,
      supplier: inv ? inv.supplier : null,
    };

    if (!inv) {
      ingredients.push({
        ...base,
        stock: null,
        shortage: round3(agg.required),
        status: "no_stock",
        estimated_cost: null,
        note: "Позиция отсутствует на складе",
      });
      continue;
    }

    const stockInUnit = convertQty(Number(inv.quantity), inv.unit, agg.unit);
    if (stockInUnit === null || agg.unitMismatchWithinRecipes) {
      ingredients.push({
        ...base,
        stock: Number(inv.quantity),
        shortage: null,
        status: "unit_mismatch",
        estimated_cost: null,
        note: `Единицы несовместимы: на складе «${inv.unit}»`,
      });
      continue;
    }

    const stock = round3(stockInUnit);
    if (stock + 1e-9 >= agg.required) {
      ingredients.push({
        ...base,
        stock,
        shortage: 0,
        status: "ok",
        estimated_cost: null,
        note: null,
      });
      continue;
    }

    const shortage = round3(agg.required - stock);
    // Стоимость дефицита: shortage → в единицу склада → ceil (целые закупочные
    // единицы) × cost_per_unit (руб за единицу inventory_items).
    const shortageInWarehouseUnit = convertQty(shortage, agg.unit, inv.unit);
    const unitsToBuy =
      shortageInWarehouseUnit !== null ? Math.ceil(round6(shortageInWarehouseUnit)) : null;
    const estimatedCost =
      unitsToBuy !== null && inv.cost_per_unit && inv.cost_per_unit > 0
        ? Math.round(unitsToBuy * inv.cost_per_unit)
        : null;

    ingredients.push({
      ...base,
      stock,
      shortage,
      status: "shortage",
      estimated_cost: estimatedCost,
      note: null,
    });
  }

  const shortages = ingredients.filter(
    (i) => i.status === "shortage" || i.status === "no_stock"
  );
  const totalShortageCost = shortages.reduce(
    (sum, i) => sum + (i.estimated_cost ?? 0),
    0
  );

  return {
    ingredients,
    shortages,
    can_produce:
      ingredients.length > 0 && ingredients.every((i) => i.status === "ok"),
    total_shortage_cost: totalShortageCost,
  };
}

/**
 * Дефицит в единице склада с округлением вверх до 0.01 — для позиций
 * черновика закупки (purchase_draft_items.quantity).
 * Если склад-позиции нет — дефицит остаётся в единице рецепта.
 */
export function shortageForDraft(
  ingredient: BreakdownIngredient
): { quantity: number; unit: string } {
  const shortage = ingredient.shortage ?? 0;
  if (ingredient.warehouse_unit && ingredient.unit) {
    const converted = convertQty(shortage, ingredient.unit, ingredient.warehouse_unit);
    if (converted !== null) {
      return {
        quantity: Math.ceil(round6(converted) * 100) / 100,
        unit: ingredient.warehouse_unit,
      };
    }
  }
  return { quantity: Math.ceil(round6(shortage) * 100) / 100, unit: ingredient.unit };
}
