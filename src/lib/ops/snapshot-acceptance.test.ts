/**
 * snapshot-acceptance.test.ts — ОБЯЗАТЕЛЬНЫЙ сценарий Z-v29 §9.2:
 * «рецепт A → заказ (snapshot A) → рецепт изменён на B → acceptance использует A»,
 * плюс fail-closed/легаси-ветки Acceptance Engine.
 *
 * checkOrderAcceptance под моком getPool (без реальной БД). Лочит:
 *   • заказ со snapshot: потребность считается из СНИМКА — текущий
 *     recipe_ingredients для этого заказа даже НЕ запрашивается;
 *   • легаси-заказ (без snapshot): прежнее поведение — live-рецепт + needSource="live";
 *   • повреждённый snapshot (чужая schema_version / частичный / чужой товар) →
 *     блокирующий SNAPSHOT_INVALID, live-расчёт НЕ выполняется (fail-closed);
 *   • INVENTORY_UNIT_MISMATCH работает и через snapshot-нормы (регресс Z-v27 P);
 *   • рецепт удалён после оформления: snapshot сохраняет потребность
 *     (live-путь дал бы пустую потребность/409 — snapshot надёжнее).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Мок пула: canned-ответы по SQL-признакам + журнал запросов -----------
type OrderRow = {
  number: string;
  confectioner_id: string | null;
  delivery_date: string | null;
  delivery_time_window: string | null;
  delivery_time: string | null;
  product_id: string | null;
  title: string | null;
  quantity: number | string | null;
  recipe_id: string | null;
  production_time_hours: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  category_slug: string | null;
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
    query: async (sql: string, _params?: unknown[]) => {
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

import { checkOrderAcceptance } from "./acceptance";
import { ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION } from "./snapshot";

const R = "8806b15e-7d98-44b5-965d-05ba64b48cc7";
const P = "aaaaaaaa-0000-4000-8000-00000000c001";
const OWNER = "11111111-1111-4111-8111-111111111101";
const DAY = "2030-06-01";
const SNAPSHOT_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

/** Snapshot A: норма 250 г/шт. Live-рецепт B: 500 г/шт. Склад: 600 г. */
// A (2 шт × 250 г = 500) помещается в 600 г; B (2 шт × 500 г = 1000) — нет.
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
      recipe_updated_at: "2026-01-01T09:00:00.000Z",
      production_time_hours: 6,
      prep_time_minutes: null,
      cook_time_minutes: null,
      category_slug: null,
      ingredients: [{ name: "Ягоды", qty: 250, unit: "г", inventory_item_id: "inv-b" }],
    },
  ],
};

function orderRowWith(metadata: unknown): OrderRow[] {
  return [
    {
      number: "UK-2030-000001",
      confectioner_id: OWNER,
      delivery_date: DAY,
      delivery_time_window: null,
      delivery_time: null,
      product_id: P,
      title: "Ягодный бархат",
      quantity: 2,
      recipe_id: R,
      production_time_hours: 6,
      prep_time_minutes: null,
      cook_time_minutes: null,
      category_slug: null,
      metadata: metadata === null ? null : JSON.stringify(metadata),
    },
  ];
}

beforeEach(() => {
  // «Рецепт изменён после заказа»: текущая норма — версия B (500 г).
  recipeIngredients = [
    { recipe_id: R, name: "Ягоды", qty: "500.000", unit: "г", inventory_item_id: "inv-b" },
  ];
  inventoryItems = [
    { id: "inv-b", name: "Ягоды", quantity: "600", unit: "г", cost_per_unit: 300, supplier: null },
  ];
  queriedSql.length = 0;
});

describe("checkOrderAcceptance — snapshot исторического заказа (Z-v29)", () => {
  it("ОБЯЗАТЕЛЬНЫЙ сценарий: рецепт A → заказ → рецепт B → acceptance считает по A", async () => {
    orderRows = orderRowWith({ acceptance_snapshot: SNAPSHOT_A });

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r).not.toBeNull();
    if (!r) return;

    // Источник потребности помечен явно
    expect(r.needSource).toBe("snapshot");

    // Live-рецепт (версия B) даже НЕ запрашивался — потребность из snapshot
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(false);

    // Потребность по A: 2 × 250 = 500 г ≤ 600 г → выполнимо, БЕЗ блокировок
    expect(r.canAccept).toBe(true);
    expect(r.reasons.map((x) => x.code)).not.toContain("LOW_STOCK");
    expect(r.reasons.map((x) => x.code)).not.toContain("SNAPSHOT_INVALID");
    expect(r.owners[0].inventory.canProduce).toBe(true);
    expect(r.owners[0].inventory.shortageCount).toBe(0);
  });

  it("повторный acceptance того же заказа — тот же результат (snapshot неизменяем)", async () => {
    orderRows = orderRowWith({ acceptance_snapshot: SNAPSHOT_A });
    const first = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    const second = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(first?.canAccept).toBe(second?.canAccept);
    expect(first?.owners[0].inventory).toEqual(second?.owners[0].inventory);
  });

  it("легаси-заказ без snapshot — прежнее поведение: live-рецепт B, явный needSource=live", async () => {
    orderRows = orderRowWith({ contact: { name: "x", phone: "y" } }); // metadata без snapshot

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.needSource).toBe("live");
    // Live-путь читает ТЕКУЩИЙ рецепт (B): 2 × 500 = 1000 > 600 → нехватка
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(true);
    expect(r.owners[0].inventory.canProduce).toBe(false);
    expect(r.owners[0].inventory.shortages[0]).toMatchObject({ name: "Ягоды", unit: "г" });
    expect(r.canAccept).toBe(false);
  });

  it("повреждённый snapshot (чужая schema_version) → SNAPSHOT_INVALID, live-расчёт НЕ выполняется", async () => {
    orderRows = orderRowWith({
      acceptance_snapshot: { ...SNAPSHOT_A, schema_version: 99 },
    });

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.reasons.map((x) => x.code)).toContain("SNAPSHOT_INVALID");
    expect(r.canAccept).toBe(false);
    expect(r.availability).toBe("unavailable");
    // Fail-closed: потребность не считается НИ из snapshot, НИ из текущего рецепта
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(false);
    expect(r.owners[0].inventory.canProduce).toBe(false);
  });

  it("частичный snapshot (ингредиент без qty) → SNAPSHOT_INVALID", async () => {
    const broken = JSON.parse(JSON.stringify(SNAPSHOT_A));
    delete broken.items[0].ingredients[0].qty;
    orderRows = orderRowWith({ acceptance_snapshot: broken });

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r?.reasons.map((x) => x.code)).toContain("SNAPSHOT_INVALID");
    expect(r?.canAccept).toBe(false);
  });

  it("snapshot другого товара не может быть подставлен в заказ → SNAPSHOT_INVALID", async () => {
    const foreign = JSON.parse(JSON.stringify(SNAPSHOT_A));
    foreign.items[0].product_id = "aaaaaaaa-0000-4000-8000-00000000c099";
    orderRows = orderRowWith({ acceptance_snapshot: foreign });

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r?.reasons.map((x) => x.code)).toContain("SNAPSHOT_INVALID");
    expect(r?.canAccept).toBe(false);
  });

  it("несовместимая единица склада (Z-v27 P) блокирует и через snapshot-нормы", async () => {
    inventoryItems = [
      { id: "inv-b", name: "Ягоды", quantity: "10", unit: "ложка", cost_per_unit: null, supplier: null },
    ];
    orderRows = orderRowWith({ acceptance_snapshot: SNAPSHOT_A });

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    const codes = r?.reasons.map((x) => x.code) ?? [];
    expect(codes).toContain("INVENTORY_UNIT_MISMATCH");
    expect(r?.canAccept).toBe(false);
    expect(r?.owners[0].inventory.canProduce).toBe(false);
  });

  it("нехватка по snapshot → LOW_STOCK (потребность A, не B): 2×250=500 > 400 г", async () => {
    inventoryItems = [
      { id: "inv-b", name: "Ягоды", quantity: "400", unit: "г", cost_per_unit: 300, supplier: null },
    ];
    orderRows = orderRowWith({ acceptance_snapshot: SNAPSHOT_A });

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r?.reasons.map((x) => x.code)).toContain("LOW_STOCK");
    // Дефицит посчитан по SNAPSHOT-норме: 500 − 400 = 100 г (по live-B было бы 600)
    expect(r?.owners[0].inventory.shortages[0]).toMatchObject({ shortage: 100, unit: "г" });
    expect(r?.canAccept).toBe(false);
  });

  it("рецепт удалён после оформления: snapshot сохраняет потребность (live не читается)", async () => {
    // Live-мир: recipe_ingredients пуст (рецепт удалили) — но snapshot есть
    recipeIngredients = [];
    orderRows = orderRowWith({ acceptance_snapshot: SNAPSHOT_A });

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r?.needSource).toBe("snapshot");
    expect(queriedSql.some((s) => s.includes("FROM public.recipe_ingredients"))).toBe(false);
    expect(r?.canAccept).toBe(true);
    expect(r?.owners[0].inventory.canProduce).toBe(true);
  });

  it("расхождение суммарного количества order_items (2+1) со snapshot (2) → fail-closed", async () => {
    const rows = orderRowWith({ acceptance_snapshot: SNAPSHOT_A });
    rows.push({ ...rows[0], quantity: 1 });
    orderRows = rows; // суммарно 3 шт, а snapshot зафиксировал 2

    const r = await checkOrderAcceptance("99999999-9999-4999-8999-999999999999");
    expect(r?.reasons.map((x) => x.code)).toContain("SNAPSHOT_INVALID");
  });
});
