/**
 * offer-format.ts — ZV33-4: чистые хелперы UI индивидуальных предложений
 * (вкладка «Заявки из конструктора» кондитера + «Предложения кондитеров»
 * покупателя). Изоморфный модуль без side-effects — используется и в
 * клиентских компонентах, и в unit-тестах.
 *
 * Единицы: negotiations.quoted_price / quoted_delivery_cost — КОПЕЙКИ
 * (миграция 0004); UI показывает ₽ = /100 (kopecksToRubles из
 * negotiation-binding — единственная точка конвертации).
 *
 * Даты: valid_until/accepted_at — TIMESTAMPTZ; по ТЗ показываем в
 * Europe/Moscow независимо от таймзоны браузера (ru-RU).
 */

import {
  clampOfferValidityDays,
  offerValidUntilFrom,
} from "./negotiation-binding";
import type { CakeBuilderConfig } from "./cake-builder-pricing";

// ===== Форматирование цен =====

/** Копейки → строка «3 500 ₽» (рубли, без копеек — предложения идут целыми рублями). */
export function formatOfferPrice(kopecks: number | null | undefined): string {
  if (kopecks === null || kopecks === undefined || !Number.isFinite(kopecks)) {
    return "—";
  }
  const rub = Math.round(kopecks) / 100;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(rub);
}

// ===== Форматирование дат (Europe/Moscow) =====

const MOSCOW_TZ = "Europe/Moscow";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «26 ноября, 14:30» (МСК) — дата+время предложения/принятия. */
export function formatMoscowDateTime(
  value: string | Date | null | undefined
): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MOSCOW_TZ,
  }).format(d);
}

/** «26 ноября 2026» (МСК) — дата истечения предложения. */
export function formatMoscowDate(
  value: string | Date | null | undefined
): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: MOSCOW_TZ,
  }).format(d);
}

// ===== Истечение предложения =====

/**
 * Истекло ли предложение: valid_until строго в прошлом.
 * null/невалидная дата → false (нет срока — не показываем «Истекло»;
 * серверный гард в PATCH accept всё равно вернёт 410 при истечении).
 */
export function isOfferExpired(
  validUntil: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  const d = toDate(validUntil);
  if (!d) return false;
  return d.getTime() < now.getTime();
}

// ===== Превью срока действия в форме предложения =====

/** Кламп дней 1..60 (дефолт 14) — тот же контракт, что на сервере. */
export { clampOfferValidityDays, offerValidUntilFrom };

/**
 * Живое превью «Действует до: …» для формы предложения.
 * Возвращает дату от переданного момента (в форме — «сейчас») + days.
 */
export function previewOfferValidUntil(
  daysInput: unknown,
  now: Date = new Date()
): Date {
  return offerValidUntilFrom(now, clampOfferValidityDays(daysInput));
}

// ===== История предложения (revisions) =====

export type NegotiationRevisionReason =
  | "initial"
  | "price_adjustment"
  | "discount_offered"
  | "counter_offer"
  | "accepted";

/** Метки change_reason (0085/0004) — неизвестные причины показываем как есть. */
const REVISION_REASON_LABELS: Record<NegotiationRevisionReason, string> = {
  initial: "Первичное предложение",
  price_adjustment: "Обновление цены",
  counter_offer: "Встречное предложение",
  accepted: "Принято",
  discount_offered: "Скидка",
};

export function mapRevisionReason(reason: string | null | undefined): string {
  if (!reason) return "Изменение";
  return REVISION_REASON_LABELS[reason as NegotiationRevisionReason] || reason;
}

// ===== Снимок заявки → конфиг конструктора (checkout binding) =====

/**
 * Сырая строка inquiries (GET /api/inquiries, filter=own) — снимок проекта
 * торта (миграция 0004). productType в снимке НЕ хранится.
 */
export interface InquirySnapshot {
  event_type: string | null;
  base: string | null;
  filling: string | null;
  coating: string | null;
  decorations: string[] | null;
  dietary: string[] | null;
  servings: number | null;
  city: string | null;
  delivery_date: string | null;
  delivery_type: string | null;
  inscription: string | null;
  comment: string | null;
}

/**
 * Собрать CakeBuilderConfig из снимка заявки для custom-позиции корзины
 * (POST /api/checkout cartItems[].custom). ВАЖНОЕ ДОПУЩЕНИЕ: inquiries не
 * хранят product_type — заявки создаются только из конструктора тортов, поэтому
 * подставляем "cake" (валидный id CAKE_BUILDER_OPTIONS.productTypes).
 * Если сервер не примет снимок (legacy-значения) — /api/checkout честно
 * вернёт 422 с причиной, UI покажет ошибку (цены в теле клиента нет).
 */
export function buildInquiryBuilderConfig(
  snapshot: InquirySnapshot
): CakeBuilderConfig {
  return {
    productType: "cake",
    eventType: snapshot.event_type || undefined,
    base: snapshot.base || undefined,
    filling: snapshot.filling || undefined,
    coating: snapshot.coating || undefined,
    decorations: (snapshot.decorations || []).length
      ? snapshot.decorations!
      : undefined,
    dietary: (snapshot.dietary || []).length ? snapshot.dietary! : undefined,
    city: snapshot.city || undefined,
    deliveryDate: snapshot.delivery_date || undefined,
    deliveryType: snapshot.delivery_type === "pickup" ? "pickup" : "delivery",
    servings: snapshot.servings || undefined,
    quantity: 1,
    inscription: snapshot.inscription || undefined,
    comment: snapshot.comment || undefined,
  };
}

// ===== Отображение цены корзины при binding (ZV33-4b D4) =====

/**
 * Юнит-цена ПОЗИЦИИ корзины для отображения (cart drawer, сводка checkout,
 * кнопка «Оплатить»). Пока корзина привязана к принятому предложению
 * (pendingNegotiationId в store), custom-позиция, добавленная вкладкой
 * «Предложения кондитеров», несёт agreedPriceRub — показываем ЕГО, а не
 * estimate calculateBuilderPrice (раньше покупатель видел «Оплатить
 * 4 060 ₽», а сервер создавал заказ по согласованной цене).
 *
 * Сервер остаётся авторитетным: тело checkout цены не содержит,
 * подстановка — из negotiations.quoted_price (negotiation-binding).
 */
export function cartItemDisplayUnitPrice(
  item: { price: number; agreedPriceRub?: number | null },
  bindingActive: boolean
): number {
  if (
    bindingActive &&
    item.agreedPriceRub !== null &&
    item.agreedPriceRub !== undefined &&
    Number.isFinite(item.agreedPriceRub) &&
    item.agreedPriceRub > 0
  ) {
    return item.agreedPriceRub;
  }
  return item.price;
}
