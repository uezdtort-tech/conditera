/**
 * Регрессионные тесты GET /api/products/[id] — колонка fillings (U-06).
 *
 * Рут-кауз U-06: PRODUCT_CARD_COLUMNS не включал products.fillings (jsonb,
 * миграция 0043) → колонка не попадала в ответ → mapApiProductToProduct
 * не мог её замапить → StoreProduct.fillings === undefined для всех
 * DB-товаров → гейт секции «Срезы торта по начинкам»
 * (product-page.tsx → ProductSliceGallery) был недостижим из живых данных.
 *
 * Фикс: fillings добавлена в PRODUCT_CARD_COLUMNS; ответ отдаёт jsonb-колонку
 * как есть (raw passthrough), нормализацию в {name, priceModifier}[] делает
 * маппер витрины (см. src/lib/supabase/use-marketplace.fillings.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

type Row = Record<string, unknown>;

// --- Мок supabaseAdmin: per-table builder (герметично, без сети) ---

const tables: Record<string, Row[] | Row | null> = {};

type Thenable = { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => unknown };

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
} & Thenable;

const builders: Record<string, QueryBuilder> = {};

function makeBuilder(table: string): QueryBuilder {
  const b = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(() => b),
    in: vi.fn(() => b),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: Array.isArray(tables[table]) ? (tables[table] as Row[])[0] ?? null : tables[table],
        error: null,
      })
    ),
    single: vi.fn(() =>
      Promise.resolve({
        data: Array.isArray(tables[table]) ? (tables[table] as Row[])[0] ?? null : tables[table],
        error: null,
      })
    ),
    // await builder — для списковых выборок (media/images/slices/reviews)
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: Array.isArray(tables[table]) ? tables[table] : [],
        error: null,
      }).then(res, rej),
  };
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      builders[table] ??= makeBuilder(table);
      return builders[table];
    }),
  },
}));

import { GET } from "./route";

const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-00000000000b";

function baseProductRow(extra: Row = {}): Row {
  return {
    id: PRODUCT_ID,
    title: "Порционные десерты (20 шт.)",
    slug: "deserty-portSIONnyye-20",
    description: "Набор порционных десертов",
    short_description: null,
    long_description: null,
    price: 4400,
    old_price: null,
    category_id: null,
    weight_grams: null,
    servings: null,
    tags: [],
    diameter_cm: null,
    height_cm: null,
    size_text: null,
    shape: null,
    product_type: null,
    filling_description: null,
    layers_count: null,
    composition: {},
    recipe_id: null,
    min_order_qty: null,
    custom_order_available: null,
    is_available: true,
    production_time_hours: null,
    rating_average: 0,
    reviews_count: 0,
    confectioner_id: null,
    status: "published",
    is_featured: false,
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
    published_at: "2026-10-15T00:00:00Z",
    images: [],
    ...extra,
  };
}

async function callGet(id = PRODUCT_ID): Promise<NextResponse> {
  const request = new NextRequest(`http://localhost:3000/api/products/${id}`);
  return GET(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  // products → одна строка; остальные таблицы → пустые списки
  tables.products = baseProductRow();
  tables.product_media = [];
  tables.product_images = [];
  tables.product_slices = [];
  tables.product_reviews = [];
  tables.confectioners = [];
  tables.profiles = [];
});

describe("GET /api/products/[id] — колонка fillings (регрессия U-06)", () => {
  it("PRODUCT_CARD_COLUMNS запрашивает колонку fillings", async () => {
    await callGet();
    const selectArg = builders.products.select.mock.calls[0]?.[0] as string;
    expect(typeof selectArg).toBe("string");
    expect(selectArg).toMatch(/\bfillings\b/);
  });

  it("fillings из jsonb попадает в ответ карточки", async () => {
    const fillings = [
      { name: "Шоколад-ганаш", priceModifier: 300 },
      { name: "Малина-базилик", priceModifier: 0 },
    ];
    tables.products = baseProductRow({ fillings });
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.product.id).toBe(PRODUCT_ID);
    expect(json.product.fillings).toEqual(fillings);
  });

  it("пустой fillings [] отдаётся как [] (raw passthrough, без выдуманных значений)", async () => {
    tables.products = baseProductRow({ fillings: [] });
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.product.fillings).toEqual([]);
  });

  it("NULL fillings отдаётся как null (нормализует в [] маппер витрины, не route)", async () => {
    // Решение задокументировано: route — raw passthrough (null остаётся null),
    // mapApiProductToProduct приводит null/отсутствие к [] — единая точка
    // нормализации для клиента.
    tables.products = baseProductRow({ fillings: null });
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.product.fillings).toBeNull();
  });

  it("базовый контракт карточки не сломан (id, media/slices/reviews ключи ответа)", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.product.id).toBe(PRODUCT_ID);
    expect(json.product.title).toBe("Порционные десерты (20 шт.)");
    expect(Array.isArray(json.product.images)).toBe(true);
    expect(Array.isArray(json.product.media)).toBe(true);
    expect(json.product.confectioner).toBeNull();
    expect(Array.isArray(json.slices)).toBe(true);
    expect(Array.isArray(json.reviews)).toBe(true);
  });
});
