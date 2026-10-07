/**
 * cake-builder-pricing.ts — ЕДИНАЯ формула цены конструктора тортов.
 *
 * Изоморфный модуль (без side-effects, без "use client", только чистые данные):
 *   • клиент: cake-builder-page.tsx (живая оценка) и store.addToCart (custom-позиции);
 *   • сервер: POST /api/checkout (пересчёт цены custom-позиций, НЕ доверяем клиенту).
 *
 * Формула перенесена 1:1 из calculatePrice() в cake-builder-page.tsx:
 *   unit = productType.priceBase + base.priceBase + filling.price + coating.price
 *          + Σ decorations.price
 *   «порция»: unit + max(0, servings − minServings) × 180
 *   «шт»:     unit × quantity
 * Затем применяется региональный коэффициент города (calculateRegionalPriceSync).
 *
 * Ярусы/форма (tiers/shape) в формулу НЕ входят — как и в исходном
 * расчёте клиента (это подсказки для RFQ-запроса кондитерам).
 */

import { CAKE_BUILDER_OPTIONS } from "./mock-data";
import { calculateRegionalPriceSync } from "./regional-pricing";

// ===== Типы =====

/** Снимок конфига конструктора — хранится в CartItem.custom.config и в order_items.selected_attributes. */
export interface CakeBuilderConfig {
  productType?: string;
  eventType?: string;
  base?: string;
  tiers?: number;
  shape?: string;
  filling?: string;
  coating?: string;
  decorations?: string[];
  dietary?: string[];
  city?: string;
  deliveryDate?: string;
  deliveryType?: "delivery" | "pickup";
  address?: string;
  servings?: number;
  quantity?: number;
  inscription?: string;
  comment?: string;
}

/** Опция начинки (id конструктора, человекочитаемая метка, надбавка в рублях). */
export interface BuilderFillingOption {
  id: string;
  label: string;
  price: number;
}

/** Строка таблицы fillings (для слияния с mock-справочником на сервере). */
export interface DbFillingRow {
  id: string;
  name: string;
  price_multiplier: number;
}

export interface BuilderPricingOptions {
  /** Динамические начинки (из БД). Если не переданы — mock-справочник CAKE_BUILDER_OPTIONS. */
  fillings?: BuilderFillingOption[];
}

export interface BuilderValidationResult {
  valid: boolean;
  reason?: string;
}

// ===== Константы формулы =====

/** Надбавка за каждую порцию сверх minServings (руб). Как в клиенте. */
export const BUILDER_EXTRA_SERVINGS_RATE = 180;

/** Максимальное количество/порций на одну позицию. */
export const BUILDER_MAX_QUANTITY = 999;

// ===== Начинки =====

/** Mock-справочник как BuilderFillingOption[]. */
export function getMockBuilderFillings(): BuilderFillingOption[] {
  return CAKE_BUILDER_OPTIONS.fillings.map((f) => ({
    id: f.id,
    label: f.label,
    price: f.price,
  }));
}

/**
 * Слить начинки из БД с mock-справочником (сервер):
 *   DB: price = Math.round((price_multiplier − 1) × 1000) — тот же маппинг,
 *   что в cake-builder-page.tsx (1.0 → 0, 1.3 → 300).
 * Mock идёт ПЕРВЫМ (стабильный порядок), DB-начинки добавляются после.
 */
export function mergeBuilderFillings(dbRows?: DbFillingRow[] | null): BuilderFillingOption[] {
  const merged = new Map<string, BuilderFillingOption>();
  for (const f of getMockBuilderFillings()) merged.set(f.id, f);
  for (const row of dbRows || []) {
    if (!row || typeof row.id !== "string" || typeof row.name !== "string") continue;
    const multiplier = Number(row.price_multiplier);
    const price = Number.isFinite(multiplier) ? Math.round((multiplier - 1) * 1000) : 0;
    merged.set(row.id, { id: row.id, label: row.name, price: Math.max(0, price) });
  }
  return Array.from(merged.values());
}

function resolveFillings(opts?: BuilderPricingOptions): BuilderFillingOption[] {
  return opts?.fillings && opts.fillings.length > 0 ? opts.fillings : getMockBuilderFillings();
}

// ===== Цена =====

/**
 * Базовая цена КОНФИГУРАЦИИ (без регионального коэффициента) — та же формула,
 * что была в cake-builder-page.tsx calculatePrice(). Возвращает null,
 * если productType неизвестен (валидация отдаст 422).
 */
export function calculateBuilderUnitPrice(
  config: CakeBuilderConfig,
  opts?: BuilderPricingOptions
): number | null {
  const pt = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === config.productType);
  if (!pt) return null;

  let unitPrice = pt.priceBase;

  const base = CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === config.base);
  if (base) unitPrice += base.priceBase;

  const fillings = resolveFillings(opts);
  const filling = fillings.find((f) => f.id === config.filling);
  if (filling) unitPrice += filling.price;

  const coating = CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === config.coating);
  if (coating) unitPrice += coating.price;

  (config.decorations || []).forEach((decId) => {
    const dec = CAKE_BUILDER_OPTIONS.decorations.find((d) => d.id === decId);
    if (dec) unitPrice += dec.price;
  });

  if (pt.unit === "порция") {
    const servings = config.servings || pt.defaultServings || 8;
    const extraServings = Math.max(0, servings - (pt.minServings || 4));
    return unitPrice + extraServings * BUILDER_EXTRA_SERVINGS_RATE;
  }

  const quantity = config.quantity || pt.defaultQuantity || 1;
  return unitPrice * quantity;
}

/**
 * Итоговая цена позиции конструктора с региональным коэффициентом города
 * (та же цепочка, что в клиенте: base → calculateRegionalPriceSync).
 * null — если конфиг невалиден (нет productType / отрицательная цена).
 */
export function calculateBuilderPrice(
  config: CakeBuilderConfig,
  opts?: BuilderPricingOptions
): number | null {
  const unit = calculateBuilderUnitPrice(config, opts);
  if (unit === null) return null;
  const regional = calculateRegionalPriceSync(unit, config.city || "");
  return regional.price;
}

// ===== Валидация =====

/**
 * Валидация конфига конструктора (сервер — ДО создания order_item):
 *   • productType обязателен и известен;
 *   • base/coating/decorations/dietary (если переданы) должны существовать в справочнике;
 *   • filling (если передан) должен существовать в переданном списке начинок
 *     (mock + DB) — неизвестный модификатор = отказ, НЕ молчаливое игнорирование;
 *   • quantity/servings — целые 1..999;
 *   • итоговая цена обязана быть конечной и НЕ отрицательной.
 */
export function validateBuilderConfig(
  config: unknown,
  opts?: BuilderPricingOptions
): BuilderValidationResult {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, reason: "Конфигурация конструктора обязательна" };
  }
  const cfg = config as CakeBuilderConfig;

  const pt = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === cfg.productType);
  if (!pt) {
    return { valid: false, reason: "Неизвестный тип изделия конструктора" };
  }

  if (cfg.base !== undefined && cfg.base !== null && cfg.base !== "") {
    if (!CAKE_BUILDER_OPTIONS.bases.some((b) => b.id === cfg.base)) {
      return { valid: false, reason: "Неизвестная основа торта" };
    }
  }

  if (cfg.coating !== undefined && cfg.coating !== null && cfg.coating !== "") {
    if (!CAKE_BUILDER_OPTIONS.coatings.some((c) => c.id === cfg.coating)) {
      return { valid: false, reason: "Неизвестное покрытие торта" };
    }
  }

  if (cfg.filling !== undefined && cfg.filling !== null && cfg.filling !== "") {
    const fillings = resolveFillings(opts);
    if (!fillings.some((f) => f.id === cfg.filling)) {
      return { valid: false, reason: "Неизвестная начинка торта" };
    }
  }

  if (cfg.decorations !== undefined) {
    if (!Array.isArray(cfg.decorations)) {
      return { valid: false, reason: "decorations должен быть массивом" };
    }
    if (cfg.decorations.length > 20) {
      return { valid: false, reason: "Слишком много элементов декора" };
    }
    for (const d of cfg.decorations) {
      if (!CAKE_BUILDER_OPTIONS.decorations.some((o) => o.id === d)) {
        return { valid: false, reason: `Неизвестный декор: ${String(d).slice(0, 40)}` };
      }
    }
  }

  if (cfg.dietary !== undefined) {
    if (!Array.isArray(cfg.dietary)) {
      return { valid: false, reason: "dietary должен быть массивом" };
    }
    for (const d of cfg.dietary) {
      if (!CAKE_BUILDER_OPTIONS.dietary.some((o) => o.id === d)) {
        return { valid: false, reason: `Неизвестная диетическая опция: ${String(d).slice(0, 40)}` };
      }
    }
  }

  const isIntInRange = (v: unknown, label: string) => {
    if (v === undefined || v === null) return null; // поле опционально
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > BUILDER_MAX_QUANTITY) {
      return `${label} должен быть целым числом от 1 до ${BUILDER_MAX_QUANTITY}`;
    }
    return null;
  };
  const qtyErr = isIntInRange(cfg.quantity, "Количество");
  if (qtyErr) return { valid: false, reason: qtyErr };
  const servingsErr = isIntInRange(cfg.servings, "Число порций");
  if (servingsErr) return { valid: false, reason: servingsErr };

  if (cfg.inscription !== undefined && cfg.inscription !== null) {
    if (typeof cfg.inscription !== "string" || cfg.inscription.length > 100) {
      return { valid: false, reason: "Надпись на торте — до 100 символов" };
    }
  }
  if (cfg.comment !== undefined && cfg.comment !== null) {
    if (typeof cfg.comment !== "string" || cfg.comment.length > 1000) {
      return { valid: false, reason: "Комментарий — до 1000 символов" };
    }
  }

  // Цена проверяется ДО и ПОСЛЕ регионального коэффициента: regional-clamp
  // может замаскировать отрицательную базу (calculateRegionalPriceSync → 0).
  const unitPrice = calculateBuilderUnitPrice(cfg, opts);
  if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return { valid: false, reason: "Не удалось рассчитать корректную (неотрицательную) цену конфигурации" };
  }
  const price = calculateBuilderPrice(cfg, opts);
  if (price === null || !Number.isFinite(price) || price < 0) {
    return { valid: false, reason: "Не удалось рассчитать корректную (неотрицательную) цену конфигурации" };
  }

  return { valid: true };
}

// ===== Человекочитаемое описание =====

/**
 * Человекочитаемый заголовок custom-позиции (CartItem.title / order_items.product_title):
 *   «Торт на заказ: бисквит, малиновый конфитюр, свежие ягоды, 12 порций».
 */
export function describeBuilderConfig(
  config: CakeBuilderConfig,
  opts?: BuilderPricingOptions
): string {
  const pt = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === config.productType);
  const parts: string[] = [];

  const base = CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === config.base);
  if (base) parts.push(base.label);

  if (config.filling) {
    const fillings = resolveFillings(opts);
    const filling = fillings.find((f) => f.id === config.filling);
    if (filling) parts.push(`начинка: ${filling.label}`);
  }

  const coating = CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === config.coating);
  if (coating) parts.push(coating.label);

  (config.decorations || []).forEach((decId) => {
    const dec = CAKE_BUILDER_OPTIONS.decorations.find((d) => d.id === decId);
    if (dec) parts.push(dec.label);
  });

  if (pt?.unit === "порция" && config.servings) parts.push(`${config.servings} порций`);
  if (pt?.unit === "шт" && config.quantity) parts.push(`${config.quantity} шт`);

  const head = pt ? `${pt.label} на заказ` : "Изделие на заказ";
  return parts.length > 0 ? `${head}: ${parts.join(", ")}` : head;
}

/** Короткие параметры для CartDrawer/checkout-подтверждения (ключ → значение). */
export function builderConfigParams(
  config: CakeBuilderConfig,
  opts?: BuilderPricingOptions
): Array<{ label: string; value: string }> {
  const params: Array<{ label: string; value: string }> = [];
  const pt = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === config.productType);
  if (pt) params.push({ label: "Изделие", value: pt.label });
  const base = CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === config.base);
  if (base) params.push({ label: "Основа", value: base.label });
  if (config.filling) {
    const fillings = resolveFillings(opts);
    const filling = fillings.find((f) => f.id === config.filling);
    if (filling) params.push({ label: "Начинка", value: filling.label });
  }
  const coating = CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === config.coating);
  if (coating) params.push({ label: "Покрытие", value: coating.label });
  const decors = (config.decorations || [])
    .map((d) => CAKE_BUILDER_OPTIONS.decorations.find((o) => o.id === d)?.label)
    .filter(Boolean) as string[];
  if (decors.length > 0) params.push({ label: "Декор", value: decors.join(", ") });
  if (config.servings) params.push({ label: "Порций", value: String(config.servings) });
  if (config.quantity && pt?.unit === "шт") params.push({ label: "Количество", value: String(config.quantity) });
  if (config.inscription) params.push({ label: "Надпись", value: config.inscription });
  return params;
}
