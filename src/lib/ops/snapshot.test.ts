/**
 * snapshot.test.ts — контракт snapshot производственной потребности (Z-v29).
 *
 * Лочит (ТЗ Z-v29 §4/§8):
 *   • сборка buildAcceptanceSnapshot: серверное чтение БД (products→recipes→
 *     recipe_ingredients), агрегация строк корзины по product_id, исходные
 *     единицы, паритет live-агрегации (нормы ≤ 0 срезаются, пустая unit → "шт"),
 *     детерминированный порядок (items по product_id), fail при ошибке БД;
 *   • чтение readAcceptanceSnapshot: отсутствие → "absent" (легаси), строгая
 *     валидация — повреждённый/частичный/чужая schema_version → "invalid"
 *     (fail-closed, НЕ молчаливый live);
 *   • validateSnapshotCoversOrder: snapshot другого товара/количестваé не
 *     проходит покрытие.
 *
 * Пул замокан (canned-ответы по SQL-признакам) — реальная БД не затрагивается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type ProdRow = {
  id: string;
  title: string | null;
  recipe_id: string | null;
  production_time_hours: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  recipe_updated_at: Date | string | null;
  category_slug: string | null;
};
type RiRow = { recipe_id: string; name: string; qty: string; unit: string; inventory_item_id: string | null };

let products: ProdRow[] = [];
let recipeIngredients: RiRow[] = [];
let productsError: Error | null = null;
const queriedSql: string[] = [];

// Z-v30: buildAcceptanceSnapshot читает ВСЁ одним statement'ом
// (products LEFT JOIN recipes LEFT JOIN categories LEFT JOIN recipe_ingredients) —
// statement-level MVCC согласованность против гонки правки рецепта.
vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      queriedSql.push(sql);
      if (sql.includes("FROM public.products") && sql.includes("public.recipe_ingredients")) {
        if (productsError) throw productsError;
        // Разворачиваем JOIN как его отдал бы PG: строка товара на каждую норму
        // его рецепта; товар без рецепта/норм — одна строка с NULL-полями норм.
        type JoinedMockRow = ProdRow & {
          ing_name: string | null;
          ing_qty: string | number | null;
          ing_unit: string | null;
          ing_inventory_item_id: string | null;
        };
        const rows: JoinedMockRow[] = products.flatMap((p): JoinedMockRow[] => {
          const ings = recipeIngredients.filter(
            (ri) => p.recipe_id !== null && ri.recipe_id === p.recipe_id
          );
          if (ings.length === 0) {
            return [
              {
                ...p,
                ing_name: null,
                ing_qty: null,
                ing_unit: null,
                ing_inventory_item_id: null,
              },
            ];
          }
          return ings.map((ri) => ({
            ...p,
            ing_name: ri.name,
            ing_qty: ri.qty,
            ing_unit: ri.unit,
            ing_inventory_item_id: ri.inventory_item_id,
          }));
        });
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  }),
}));

import {
  ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION,
  buildAcceptanceSnapshot,
  readAcceptanceSnapshot,
  validateSnapshotCoversOrder,
  type AcceptanceSnapshot,
} from "./snapshot";

const P1 = "aaaaaaaa-0000-4000-8000-00000000c001";
const P2 = "aaaaaaaa-0000-4000-8000-00000000c002";
const R = "8806b15e-7d98-44b5-965d-05ba64b48cc7";

beforeEach(() => {
  products = [];
  recipeIngredients = [];
  productsError = null;
  queriedSql.length = 0;
});

describe("buildAcceptanceSnapshot — серверная сборка", () => {
  it("собирает snapshot из БД: нормы на 1 единицу, исходные единицы, inventory_item_id", async () => {
    products = [
      {
        id: P1, title: "Ягодный бархат", recipe_id: R,
        production_time_hours: 6, prep_time_minutes: 30, cook_time_minutes: 45,
        recipe_updated_at: new Date("2026-01-01T10:00:00Z"), category_slug: "cakes",
      },
    ];
    recipeIngredients = [
      { recipe_id: R, name: "Ягоды", qty: "250.000", unit: "г", inventory_item_id: "inv-b" },
      { recipe_id: R, name: "Мука", qty: "0.200", unit: "кг", inventory_item_id: null },
    ];

    const built = await buildAcceptanceSnapshot({ items: [{ product_id: P1, quantity: 2 }], source: "checkout" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const s = built.snapshot;
    expect(s.schema_version).toBe(ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION);
    expect(s.snapshot_id).toBeTruthy();
    expect(s.created_at).toBeTruthy();
    expect(s.source).toBe("checkout");
    expect(s.legacy).toBe(false);
    expect(s.items).toHaveLength(1);
    const item = s.items[0];
    expect(item.product_id).toBe(P1);
    expect(item.quantity).toBe(2);
    expect(item.recipe_id).toBe(R);
    expect(item.recipe_version_id).toBeNull(); // товарный контур версии не пишет
    expect(item.recipe_updated_at).toBe("2026-01-01T10:00:00.000Z");
    expect(item.production_time_hours).toBe(6);
    expect(item.category_slug).toBe("cakes");
    // Нормы — как в recipe_ingredients (исходные единицы БЕЗ конвертации)
    expect(item.ingredients).toEqual([
      { name: "Ягоды", qty: 250, unit: "г", inventory_item_id: "inv-b" },
      { name: "Мука", qty: 0.2, unit: "кг", inventory_item_id: null },
    ]);
  });

  it("агрегирует несколько строк корзины одного товара по quantity", async () => {
    products = [
      { id: P1, title: "Торт", recipe_id: R, production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null, recipe_updated_at: null, category_slug: null },
    ];
    recipeIngredients = [
      { recipe_id: R, name: "Мука", qty: "100", unit: "г", inventory_item_id: null },
    ];
    const built = await buildAcceptanceSnapshot({
      items: [{ product_id: P1, quantity: 1 }, { product_id: P1, quantity: 2 }],
      source: "checkout",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.items).toHaveLength(1);
    expect(built.snapshot.items[0].quantity).toBe(3);
  });

  it("детерминированный порядок: items отсортированы по product_id", async () => {
    products = [
      { id: P2, title: "B", recipe_id: null, production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null, recipe_updated_at: null, category_slug: null },
      { id: P1, title: "A", recipe_id: null, production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null, recipe_updated_at: null, category_slug: null },
    ];
    recipeIngredients = [];
    const built = await buildAcceptanceSnapshot({
      items: [{ product_id: P2, quantity: 1 }, { product_id: P1, quantity: 1 }],
      source: "checkout",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.items.map((i) => i.product_id)).toEqual([P1, P2]);
  });

  it("паритет live-агрегации: нормы ≤ 0 срезаются, пустая unit → «шт»", async () => {
    products = [
      { id: P1, title: "Торт", recipe_id: R, production_time_hours: null, prep_time_minutes: null, cook_time_minutes: null, recipe_updated_at: null, category_slug: null },
    ];
    recipeIngredients = [
      { recipe_id: R, name: "Соль", qty: "0", unit: "г", inventory_item_id: null },
      { recipe_id: R, name: "Яйцо", qty: "2", unit: "", inventory_item_id: null },
    ];
    const built = await buildAcceptanceSnapshot({ items: [{ product_id: P1, quantity: 1 }], source: "checkout" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.items[0].ingredients).toEqual([
      { name: "Яйцо", qty: 2, unit: "шт", inventory_item_id: null },
    ]);
  });

  it("fail-closed: товар не найден в БД → ok:false", async () => {
    products = []; // товар «исчез» между проверкой и сборкой
    recipeIngredients = [];
    const built = await buildAcceptanceSnapshot({ items: [{ product_id: P1, quantity: 1 }], source: "checkout" });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toContain("products_not_found");
  });

  it("fail-closed: ошибка БД → ok:false (вызывающий обязан прервать создание заказа)", async () => {
    productsError = new Error("connection refused");
    const built = await buildAcceptanceSnapshot({ items: [{ product_id: P1, quantity: 1 }], source: "checkout" });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toContain("products_load_failed");
  });

  it("отклоняет некорректный product_id/quantity без обращения к БД", async () => {
    const bad1 = await buildAcceptanceSnapshot({ items: [{ product_id: "not-a-uuid", quantity: 1 }], source: "checkout" });
    expect(bad1.ok).toBe(false);
    const bad2 = await buildAcceptanceSnapshot({ items: [{ product_id: P1, quantity: 0 }], source: "checkout" });
    expect(bad2.ok).toBe(false);
    expect(queriedSql).toHaveLength(0);
  });

  it("Z-v30: товары+рецепты+нормы читаются ОДНИМ statement'ом (нет смешанного snapshot при гонке правки)", async () => {
    products = [
      {
        id: P1, title: "Торт", recipe_id: R,
        production_time_hours: 1, prep_time_minutes: 10, cook_time_minutes: 20,
        recipe_updated_at: new Date("2026-02-01T00:00:00Z"), category_slug: "cakes",
      },
    ];
    recipeIngredients = [
      { recipe_id: R, name: "Ягоды", qty: "250", unit: "г", inventory_item_id: "inv-b" },
    ];
    const built = await buildAcceptanceSnapshot({ items: [{ product_id: P1, quantity: 2 }], source: "checkout" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.items[0].ingredients).toHaveLength(1);
    // Ровно один SQL-запрос на всю сборку: statement выполняется над одним
    // MVCC-снимком → конкурентная правка рецепта не даёт смесь «нормы B +
    // параметры A», которую давали два отдельных запроса.
    expect(queriedSql).toHaveLength(1);
    expect(queriedSql[0]).toContain("FROM public.products");
    expect(queriedSql[0]).toContain("LEFT JOIN public.recipe_ingredients");
  });
});

describe("readAcceptanceSnapshot — строгая валидация", () => {
  const validSnapshot: AcceptanceSnapshot = {
    schema_version: 1,
    snapshot_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    created_at: "2026-01-01T10:00:00.000Z",
    source: "checkout",
    legacy: false,
    items: [
      {
        product_id: P1,
        title: "Торт",
        quantity: 2,
        recipe_id: R,
        recipe_version_id: null,
        recipe_updated_at: null,
        production_time_hours: 6,
        prep_time_minutes: null,
        cook_time_minutes: null,
        category_slug: null,
        ingredients: [{ name: "Ягоды", qty: 250, unit: "г", inventory_item_id: "inv-b" }],
      },
    ],
  };

  it("нет metadata / нет ключа → absent (легаси-заказ, НЕ ошибка)", () => {
    expect(readAcceptanceSnapshot(null).status).toBe("absent");
    expect(readAcceptanceSnapshot({}).status).toBe("absent");
    expect(readAcceptanceSnapshot({ acceptance_snapshot: null }).status).toBe("absent");
    expect(readAcceptanceSnapshot({ idempotency_key: "x" }).status).toBe("absent");
  });

  it("валидный snapshot проходит round-trip", () => {
    const parsed = readAcceptanceSnapshot({ acceptance_snapshot: validSnapshot });
    expect(parsed.status).toBe("valid");
    if (parsed.status !== "valid") return;
    expect(parsed.snapshot.items[0].ingredients[0].qty).toBe(250);
    expect(parsed.snapshot.items[0].product_id).toBe(P1);
  });

  it("неизвестная schema_version → invalid (fail-closed, не подменяем текущим рецептом)", () => {
    const parsed = readAcceptanceSnapshot({
      acceptance_snapshot: { ...validSnapshot, schema_version: 99 },
    });
    expect(parsed).toEqual({ status: "invalid", reason: "unknown_schema_version" });
  });

  it("частичный snapshot: ингредиент без qty → invalid:bad_ingredient", () => {
    const broken = JSON.parse(JSON.stringify(validSnapshot));
    delete broken.items[0].ingredients[0].qty;
    expect(readAcceptanceSnapshot({ acceptance_snapshot: broken })).toEqual({
      status: "invalid",
      reason: "bad_ingredient",
    });
  });

  it("частичный snapshot: qty ≤ 0 / пустое имя / пустая единица → invalid", () => {
    const q0 = JSON.parse(JSON.stringify(validSnapshot));
    q0.items[0].ingredients[0].qty = 0;
    expect(readAcceptanceSnapshot({ acceptance_snapshot: q0 }).status).toBe("invalid");

    const noName = JSON.parse(JSON.stringify(validSnapshot));
    noName.items[0].ingredients[0].name = "   ";
    expect(readAcceptanceSnapshot({ acceptance_snapshot: noName }).status).toBe("invalid");

    const noUnit = JSON.parse(JSON.stringify(validSnapshot));
    noUnit.items[0].ingredients[0].unit = "";
    expect(readAcceptanceSnapshot({ acceptance_snapshot: noUnit }).status).toBe("invalid");
  });

  it("items не массив / пустой → invalid", () => {
    expect(
      readAcceptanceSnapshot({ acceptance_snapshot: { ...validSnapshot, items: "nope" } })
    ).toEqual({ status: "invalid", reason: "malformed" });
    expect(
      readAcceptanceSnapshot({ acceptance_snapshot: { ...validSnapshot, items: [] } })
    ).toEqual({ status: "invalid", reason: "empty_items" });
  });

  it("позиция без product_id/quantity → invalid:bad_item", () => {
    const noPid = JSON.parse(JSON.stringify(validSnapshot));
    noPid.items[0].product_id = "garbage";
    expect(readAcceptanceSnapshot({ acceptance_snapshot: noPid }).status).toBe("invalid");

    const badQty = JSON.parse(JSON.stringify(validSnapshot));
    badQty.items[0].quantity = 1.5;
    expect(readAcceptanceSnapshot({ acceptance_snapshot: badQty }).status).toBe("invalid");
  });
});

describe("validateSnapshotCoversOrder — защита от подмены товара/количества", () => {
  const snapshot: AcceptanceSnapshot = {
    schema_version: 1,
    snapshot_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    created_at: "2026-01-01T10:00:00.000Z",
    source: "checkout",
    legacy: false,
    items: [
      {
        product_id: P1, title: "Торт", quantity: 3, recipe_id: R, recipe_version_id: null,
        recipe_updated_at: null, production_time_hours: null, prep_time_minutes: null,
        cook_time_minutes: null, category_slug: null,
        ingredients: [{ name: "Мука", qty: 100, unit: "г", inventory_item_id: null }],
      },
    ],
  };

  it("совпадающий состав и количества → ok", () => {
    expect(validateSnapshotCoversOrder(snapshot, [{ product_id: P1, quantity: 3 }])).toEqual({ ok: true });
    // разбитые строки того же товара суммируются
    expect(
      validateSnapshotCoversOrder(snapshot, [
        { product_id: P1, quantity: 1 },
        { product_id: P1, quantity: 2 },
      ])
    ).toEqual({ ok: true });
  });

  it("snapshot другого товара не может быть подставлен в заказ", () => {
    const r = validateSnapshotCoversOrder(snapshot, [{ product_id: P2, quantity: 3 }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("product_set_mismatch");
  });

  it("расхождение количества → fail-closed", () => {
    const r = validateSnapshotCoversOrder(snapshot, [{ product_id: P1, quantity: 5 }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("quantity_mismatch");
  });
});
