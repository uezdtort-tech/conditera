/**
 * src/lib/supplier-warehouse-validation.ts — серверная валидация товара
 * каталога поставщика (supplier_products, Z-v17).
 *
 * Вынесено из src/app/api/supplier/warehouse/route.ts (R03V-фикс):
 * Next.js route-файлам разрешены только handler-экспорты (GET/HEAD/POST/…,
 * runtime/config и т.п.) — прочие экспорты ломают генерируемую route-type
 * проверку (TS2344 «Property … is not assignable to type 'never'»).
 *
 * Контракт не менялся: те же сообщения об ошибках, та же семантика partial.
 */

export const UNITS = ["piece", "kg", "g", "liter", "ml", "box", "pack"] as const;

export const CATEGORIES = [
  "flour", "sugar", "chocolate", "dairy", "eggs", "oils", "nuts",
  "berries", "fillings", "colors", "flavors", "decor", "packaging",
  "equipment", "other",
] as const;

export interface ProductInput {
  productName?: string;
  sku?: string;
  category?: string;
  description?: string;
  unit?: string;
  quantity?: number;
  minStock?: number;
  price?: number;       // копейки
  costPrice?: number;   // копейки
  producer?: string;
  brand?: string;
  minOrderQty?: number;
  orderStep?: number;
  shelfLifeDays?: number;
  storageConditions?: string;
  deliveryRegion?: string;
  imageUrl?: string;
}

/** Серверная валидация товара. Возвращает сообщения об ошибках. */
export function validateProduct(input: ProductInput, partial = false): string[] {
  const errors: string[] = [];
  const has = (v: unknown) => v !== undefined;
  if (!partial || has(input.productName)) {
    const name = String(input.productName ?? "").trim();
    if (name.length < 2 || name.length > 200) errors.push("Название товара: 2–200 символов");
  }
  if (has(input.unit) && !UNITS.includes(input.unit as (typeof UNITS)[number])) {
    errors.push(`Единица измерения должна быть одной из: ${UNITS.join(", ")}`);
  }
  if (has(input.category) && !CATEGORIES.includes(input.category as (typeof CATEGORIES)[number])) {
    errors.push(`Категория должна быть одной из: ${CATEGORIES.join(", ")}`);
  }
  for (const [key, label] of [
    ["price", "Цена"],
    ["costPrice", "Себестоимость"],
    ["quantity", "Остаток"],
    ["minStock", "Мин. остаток"],
    ["minOrderQty", "Мин. партия"],
    ["orderStep", "Кратность"],
    ["shelfLifeDays", "Срок годности"],
  ] as const) {
    if (has(input[key])) {
      const n = Number(input[key]);
      if (!Number.isInteger(n) || n < 0) errors.push(`${label} должна быть целым неотрицательным числом`);
    }
  }
  if (has(input.price) && Number(input.price) > 100_000_000_00) {
    errors.push("Цена превышает допустимый максимум");
  }
  if (has(input.minOrderQty) && Number(input.minOrderQty) < 1) {
    errors.push("Мин. партия должна быть >= 1");
  }
  if (has(input.orderStep) && Number(input.orderStep) < 1) {
    errors.push("Кратность должна быть >= 1");
  }
  return errors;
}
