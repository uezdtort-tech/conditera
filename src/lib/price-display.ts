/**
 * price-display.ts — витринные правила отображения цены покупателю
 * (PR-4, Z-v32 ADDENDUM Этап 6).
 *
 * Правила:
 *   • «от» перед ценой — ТОЛЬКО когда выбираемые опции могут поднять цену
 *     выше базовой (начинки/покрытия/декор с priceModifier > 0) либо товар
 *     помечен настраиваемым (customizable). Чистая функция — легко тестируется;
 *   • зачёркнутая old_price — только реальная скидка из products.old_price,
 *     строго БОЛЬШЕ текущей цены (защита от фиктивных скидок вида old <= price);
 *   • «Цена действует с DD.MM.YYYY» — форматирование additive-поля
 *     priceEffectiveFrom (PR-2C: effective_from покрывающей now строки истории
 *     цен; null на legacy-фолбэке → строка не показывается). Историю цен
 *     покупателю не отдаём и не показываем — только одну дату актуальности.
 */

import type { Product } from "./types";

/** Группа выбираемых опций с модификаторами цены (начинки/покрытия/декор). */
type PriceModifierOption = { name: string; priceModifier?: number };

function hasPositiveModifier(options?: PriceModifierOption[] | null): boolean {
  return (
    Array.isArray(options) &&
    options.some((o) => Number(o?.priceModifier) > 0)
  );
}

/**
 * isFromPrice — нужен ли маркер «от» перед ценой товара.
 *
 * true, когда цена товара — базовая, а выбор покупателя может её повысить:
 *   • fillings/coatings/decorations содержат опцию с priceModifier > 0, ИЛИ
 *   • product.customizable === true (настраиваемое изделие).
 * null/undefined/пустой товар → false (маркер не рисуем).
 */
export function isFromPrice(
  product: Pick<
    Product,
    "fillings" | "coatings" | "decorations" | "customizable"
  > | null | undefined,
): boolean {
  if (!product) return false;
  if (product.customizable === true) return true;
  return (
    hasPositiveModifier(product.fillings) ||
    hasPositiveModifier(product.coatings) ||
    hasPositiveModifier(product.decorations)
  );
}

/**
 * hasRealDiscount — реальная ли скидка в old_price.
 *
 * Зачёркнутая цена и бейдж «-%» рисуются только когда old_price — конечное
 * число СТРОГО БОЛЬШЕ текущей цены. old_price <= price (и 0/undefined/null)
 * — фиктивная/грязная скидка, не показываем ничего.
 */
export function hasRealDiscount(
  product: Pick<Product, "price" | "oldPrice"> | null | undefined,
): boolean {
  if (!product) return false;
  const oldPrice = product.oldPrice;
  return (
    typeof oldPrice === "number" &&
    Number.isFinite(oldPrice) &&
    oldPrice > product.price
  );
}

/**
 * formatPriceEffectiveFrom — «DD.MM.YYYY» (ru-RU) из additive-поля
 * product.priceEffectiveFrom. null/пустая/невалидная строка → null
 * (legacy-товары без истории цен — строку «Цена действует с …» не показываем).
 * Хелпер только форматирует дату, отданную сервером (покрывающую now);
 * никаких дат он не изобретает и будущих цен не знает.
 */
export function formatPriceEffectiveFrom(
  iso: string | null | undefined,
): string | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
