/**
 * cart.ts — Zod-схемы для /api/cart (серверная персистентность корзины).
 *
 * Инварианты (миграция 0062):
 *   • позиция либо товарная (productId), либо custom-торт конструктора (custom.config);
 *   • quantity 1..99 (CHECK quantity > 0 в БД, верхняя граница — продуктовая);
 *   • custom-снапшот (title/image/price/confectionerId) — клиентский, цена НЕ
 *     доверенная: checkout пересчитывает по calculateBuilderPrice.
 */
import { z } from "zod";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Кастомизация товарной позиции (структурно = CartItem.customization из lib/types.ts) */
export const cartCustomizationSchema = z.object({
  filling: z.string().max(120).optional(),
  coating: z.string().max(120).optional(),
  decoration: z.string().max(120).optional(),
  inscription: z.string().max(60).optional(),
});

/** Клиентский снимок custom-позиции (display-only; цена не доверенная) */
export const cartSnapshotSchema = z.object({
  title: z.string().max(300).optional(),
  image: z.string().max(2000).optional(),
  price: z.number().min(0).max(10_000_000).optional(),
  confectionerId: z.string().max(120).optional(),
});

/** POST /api/cart — добавить позицию */
export const addToCartSchema = z
  .object({
    productId: z.string().regex(UUID_RE, "productId должен быть UUID").optional(),
    quantity: z.number().int().min(1).max(99).default(1),
    customization: cartCustomizationSchema.optional(),
    custom: z.object({ config: z.record(z.string(), z.unknown()) }).optional(),
    snapshot: cartSnapshotSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.productId && !val.custom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "Позиция требует productId или custom (конфигурация конструктора)",
      });
    }
    if (val.productId && val.custom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom"],
        message: "Позиция не может одновременно иметь productId и custom",
      });
    }
  });

export type AddToCartInput = z.infer<typeof addToCartSchema>;

/** PATCH /api/cart/[itemId] — изменить количество */
export const patchCartQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(99),
});

export type PatchCartQuantityInput = z.infer<typeof patchCartQuantitySchema>;

/**
 * Канонический JSON: отсортированные ключи — стабильное сравнение
 * selected_attributes при upsert (порядок ключей не должен рождать дубли).
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
