/**
 * cart-merge.ts — чистая серверная логика синхронизации корзины (P1 «серверная
 * корзина», миграция 0062: cart_items.product_id NULLABLE + custom_config + client_ref).
 *
 * Контракт:
 *   • Клиент (Zustand, localStorage) — источник истины для UI; сервер — durable-зеркало.
 *   • Каждая строка cart_items принадлежит ровно одному user_id (владение проверяют
 *     ВСЕ маршруты /api/cart по user_id из сессии — не из тела запроса).
 *   • client_ref — стабильная ссылка позиции клиентской корзины (itemId). Мутации
 *     (PATCH/DELETE/очистка после checkout) идут по (user_id, client_ref).
 *   • Слияние — UNION по контент-ключу (товар+атрибуты | снимок custom-конфига),
 *     количество = MAX(сервер, клиент) → идемпотентно: повторная синхронизация того
 *     же состояния НЕ раздувает количество (важно при ретраях и повторном логине).
 *   • Цены на сервере корзины НЕ хранятся (у cart_items нет price): финальный
 *     пересчёт делает POST /api/checkout (ЕДИНАЯ формула с клиентом). Здесь —
 *     только структурная валидация (товар существует и опубликован; custom-конфиг
 *     проходит validateBuilderConfig; атрибуты — известные ключи).
 *
 * Сценарии (P1 §2): гость→вход→объединение; перезагрузка; другое устройство;
 * удаление/количество при недоступности API (ретраи на клиенте, абсолютные
 * количества → идемпотентность); параллельные запросы (однопоточная очередь);
 * повтор checkout (очистка серверных строк по client_ref после успеха).
 */

import { z } from "zod";
import {
  validateBuilderConfig,
  calculateBuilderPrice,
  type CakeBuilderConfig,
} from "@/lib/cake-builder-pricing";

/** Ключи атрибутов товара — то же множество, что валидирует POST /api/checkout. */
export const CART_ATTR_KEYS = ["filling", "coating", "decoration", "inscription"] as const;

export const MAX_CART_ITEMS = 50;
export const MAX_CART_QUANTITY = 999;

/** Стабильный JSON: ключи объектов отсортированы — снимки конфигов сравнимы. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export interface CartContentRef {
  product_id: string | null;
  selected_attributes: Record<string, unknown> | null;
  custom_config: unknown;
}

/**
 * Контент-ключ позиции: одинаковый товар с одинаковыми атрибутами (или одинаковый
 * custom-конфиг) — одна позиция корзины независимо от устройства/клиентского ref.
 */
export function cartContentKey(ref: CartContentRef): string {
  if (ref.custom_config !== null && ref.custom_config !== undefined) {
    return `custom:${canonicalJson(ref.custom_config)}`;
  }
  const attrs = canonicalJson(ref.selected_attributes ?? null);
  return `product:${ref.product_id ?? ""}|${attrs}`;
}

// ===== Zod-схемы входа (общие для POST/PUT /api/cart) =====

const attrsSchema = z
  .record(z.string(), z.string().max(200))
  .refine((rec) => Object.keys(rec).every((k) => (CART_ATTR_KEYS as readonly string[]).includes(k)), {
    message: "Неизвестный модификатор товара",
  });

// UUID-формат ЛЮБОЙ версии (не только v4): gen_random_uuid() даёт v4, но
// z.string().uuid() в zod@4 жёстко требует именно v4-биты — контракту корзины
// достаточно формата 8-4-4-4-12 hex (тот же прагматизм, что в checkout: max(100)).
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CartItemInputSchema = z
  .object({
    client_ref: z.string().min(1).max(120),
    product_id: z.string().regex(UUID_LIKE, "product_id должен быть UUID").optional(),
    quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
    selected_attributes: attrsSchema.optional(),
    custom_config: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.product_id && !val.custom_config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Позиция требует product_id или custom_config (конфигурация конструктора)",
      });
    }
    if (val.product_id && val.custom_config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Позиция не может одновременно иметь product_id и custom_config",
      });
    }
  });

export const CartMergeInputSchema = z.object({
  items: z.array(CartItemInputSchema).max(MAX_CART_ITEMS),
});

export type CartItemInput = z.infer<typeof CartItemInputSchema>;

/** Строка cart_items в нормализованном виде (как её отдаёт БД через shim). */
export interface CartRow {
  id: string;
  user_id: string;
  client_ref: string | null;
  product_id: string | null;
  quantity: number;
  selected_attributes: Record<string, unknown> | null;
  custom_config: unknown;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CartProductSnapshot {
  id: string;
  title: string;
  price: number;
  images: unknown;
}

/**
 * Валидация custom-конфига (ЕДИНАЯ формула с checkout: validateBuilderConfig).
 * Возвращает ошибку-строку или null (валиден).
 */
export function validateCustomConfigError(
  customConfig: Record<string, unknown>
): string | null {
  const validation = validateBuilderConfig(customConfig as CakeBuilderConfig);
  if (!validation.valid) return validation.reason || "Некорректная конфигурация конструктора";
  const price = validateBuilderPrice(customConfig as CakeBuilderConfig);
  if (price === null || !Number.isFinite(price) || price < 0) {
    return "Не удалось рассчитать цену конфигурации конструктора";
  }
  return null;
}

function validateBuilderPrice(config: CakeBuilderConfig): number | null {
  // lib чистая и без side effects — используется и на клиенте (store.ts),
  // поэтому статический импорт безопасен для обоих окружений.
  return calculateBuilderPrice(config);
}

export interface MergeOpUpdate {
  id: string;
  quantity: number;
  client_ref: string;
}

/** Минимальная форма позиции для слияния (допускает product_id: null — после валидации маршрута). */
export interface MergeableItem {
  client_ref: string;
  product_id?: string | null;
  quantity: number;
  selected_attributes?: Record<string, string> | null;
  custom_config?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface MergePlan {
  inserts: MergeableItem[];
  updates: MergeOpUpdate[];
  /** Строки сервера, которых нет у клиента (другое устройство) — сохраняются. */
  keptServerKeys: string[];
}

/**
 * План слияния состояния клиента в корзину сервера.
 *
 * Для каждого контент-ключа:
 *   • есть на сервере → quantity = MAX(server, incoming); client_ref обновляется на
 *     клиентский (клиент после adoption владеет ссылками для PATCH/DELETE);
 *   • нет на сервере → insert (client_ref = клиентский);
 *   • серверные ключи без входящей пары → сохраняются (union, другое устройство).
 *
 * Идемпотентность: два одинаковых вызова дают одинаковый результат — MAX не
 * накапливает количество, inserts/updates стабильны.
 */
export function planCartMerge(serverRows: CartRow[], incoming: MergeableItem[]): MergePlan {
  const byKey = new Map<string, { row: CartRow }>();
  for (const row of serverRows) {
    byKey.set(cartContentKey(row), { row });
  }

  const inserts: MergeableItem[] = [];
  const updates: MergeOpUpdate[] = [];
  const seenIncoming = new Set<string>();

  for (const item of incoming) {
    const key = cartContentKey({
      product_id: item.product_id ?? null,
      selected_attributes: item.selected_attributes ?? null,
      custom_config: item.custom_config ?? null,
    });
    seenIncoming.add(key);
    const existing = byKey.get(key);
    if (!existing) {
      inserts.push({ ...item, product_id: item.product_id ?? undefined });
      continue;
    }
    const serverQty = Number(existing.row.quantity) || 1;
    const mergedQty = Math.max(serverQty, item.quantity);
    if (mergedQty !== serverQty || existing.row.client_ref !== item.client_ref) {
      updates.push({
        id: existing.row.id,
        quantity: mergedQty,
        client_ref: item.client_ref,
      });
    }
  }

  const keptServerKeys: string[] = [];
  for (const row of serverRows) {
    const key = cartContentKey(row);
    if (!seenIncoming.has(key)) keptServerKeys.push(key);
  }

  return { inserts, updates, keptServerKeys };
}
