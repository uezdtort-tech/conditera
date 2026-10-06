import { z } from "zod";

export const createProductSchema = z.object({
  title: z.string().min(3, "Название минимум 3 символа"),
  slug: z.string().min(3).optional(),
  description: z.string().min(10, "Описание минимум 10 символов"),
  price: z.number().int().min(1, "Цена минимум 1₽"),
  category: z.string().min(1),
  images: z.array(z.string()).min(1, "Минимум 1 изображение"),
  weight: z.string().optional(),
  fillings: z.any().optional(),
  coatings: z.any().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

// ====================================================================
// Карточка товара (миграция 0052: новые колонки products + product_media)
// ====================================================================

/** Состав (структура клиентского типа Product.composition в src/lib/types.ts) */
export const productCompositionSchema = z.object({
  ingredients: z
    .array(z.string().min(1).max(120))
    .max(60, "Максимум 60 ингредиентов")
    .optional(),
  allergens: z
    .array(z.string().min(1).max(80))
    .max(30, "Максимум 30 аллергенов")
    .optional(),
  nutritionalValue: z
    .object({
      calories: z.number().min(0).max(10000).optional(),
      protein: z.number().min(0).max(1000).optional(),
      fat: z.number().min(0).max(1000).optional(),
      carbs: z.number().min(0).max(1000).optional(),
    })
    .optional(),
  storageConditions: z.string().max(500).optional(),
  shelfLife: z.string().max(300).optional(),
});

/**
 * Все поля карточки товара с лимитами.
 * Базовый (непустой) вариант: title/description/price обязательны.
 * Для PATCH используй updateProductSchema (= .partial()).
 */
export const productCardFieldsSchema = z.object({
  title: z.string().min(3, "Название минимум 3 символа").max(200),
  shortDescription: z.string().max(500).nullable().optional(),
  description: z
    .string()
    .min(10, "Описание минимум 10 символов")
    .max(5000),
  longDescription: z.string().max(20000).nullable().optional(),
  price: z.number().int().min(1, "Цена минимум 1₽").max(100_000_000),
  oldPrice: z.number().int().min(0).max(100_000_000).nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
  servings: z.number().int().min(0).max(10_000).nullable().optional(),
  diameterCm: z.number().min(0).max(999.99).nullable().optional(),
  heightCm: z.number().min(0).max(999.99).nullable().optional(),
  sizeText: z.string().max(100).nullable().optional(),
  shape: z.string().max(100).nullable().optional(),
  productType: z.string().max(100).nullable().optional(),
  fillingDescription: z.string().max(2000).nullable().optional(),
  layersCount: z.number().int().min(0).max(20).nullable().optional(),
  minOrderQty: z.number().int().min(1).max(10_000),
  customOrderAvailable: z.boolean(),
  isAvailable: z.boolean(),
  productionTimeHours: z.number().int().min(0).max(2160).nullable().optional(),
  recipeId: z.uuid().nullable().optional(),
  tags: z
    .array(z.string().min(1).max(40))
    .max(20, "Максимум 20 тегов")
    .optional(),
  composition: productCompositionSchema.nullable().optional(),
});

export type ProductCardFieldsInput = z.infer<typeof productCardFieldsSchema>;

/**
 * PATCH /api/products/[id] — все поля опциональны.
 * status: 'blocked' НЕ разрешён через общий PATCH (см. adminUpdateProductSchema).
 */
export const updateProductSchema = productCardFieldsSchema
  .partial()
  .extend({
    status: z.enum(["draft", "published", "archived"]).optional(),
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** Расширенная PATCH-схема для ADMIN/SUPER_ADMIN: доступен и 'blocked'. */
export const adminUpdateProductSchema = updateProductSchema.extend({
  status: z.enum(["draft", "published", "archived", "blocked"]).optional(),
});

export type AdminUpdateProductInput = z.infer<typeof adminUpdateProductSchema>;

/**
 * POST /api/products от имени ADMIN/SUPER_ADMIN:
 * title/price обязательны, description обязателен к передаче, но может быть
 * пустым при создании черновика (проверка ≥10 символов — при публикации,
 * по аналогии с PATCH: PUBLISH_VALIDATION_FAILED).
 * confectionerId (camel) — ОБЯЗАТЕЛЕН: товар создаётся от имени выбранного кондитера.
 */
export const adminCreateProductSchema = productCardFieldsSchema
  .partial()
  .extend({
    title: z.string().min(3, "Название минимум 3 символа").max(200),
    description: z.string().max(5000),
    price: z.number().int().min(1, "Цена минимум 1₽").max(100_000_000),
    confectionerId: z.uuid(),
    status: z.enum(["draft", "published", "archived"]).optional(),
  });

export type AdminCreateProductInput = z.infer<typeof adminCreateProductSchema>;

/**
 * POST /api/products от CONFECTIONER: легаси-ветка сохраняет ручные проверки
 * title/price (обратная совместимость), схема валидирует только НОВЫЕ поля
 * карточки (всё опционально, title/price/description/categoryId — мимо zod).
 */
export const confectionerCreateProductSchema = productCardFieldsSchema
  .partial()
  .omit({
    title: true,
    description: true,
    price: true,
    categoryId: true,
  });

export type ConfectionerCreateProductInput = z.infer<
  typeof confectionerCreateProductSchema
>;
