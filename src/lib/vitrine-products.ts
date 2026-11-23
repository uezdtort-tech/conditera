/**
 * vitrine-products.ts — единая селекция источника товаров для публичной
 * витрины (каталог, главная) — ZV31-017.
 *
 * Проблема (аудит Z31-5-e): с пустым ответом /api/products публичный каталог
 * рендерил mock-товары из store (MOCK_PRODUCTS): «Торт „Купеческий медовик"»
 * за 2 300 ₽, которых нет в БД; клик по карточке давал 404 /api/products/p2.
 *
 * Контракт (ZV31-017):
 *   • по умолчанию (DEMO_MODE выключен) витрина показывает ТОЛЬКО live-данные
 *     /api/products: loading → skeleton, ошибка → ошибка + «Повторить»,
 *     пусто → честное «Каталог пока пуст». Mock-товары не показываются НИКОГДА;
 *   • demo-escape-hatch: process.env.NEXT_PUBLIC_DEMO_MODE === "1" (по умолчанию
 *     OFF) возвращает прежний dual-mode — mock-сид store до прихода live-данных;
 *   • при ОШИБКЕ API mock НЕ подставляется ни в каком режиме — серверный сбой
 *     не маскируется демо-данными (честная ошибка + retry).
 */

import type { Product } from "./types";

/** Явный demo-режим витрины (opt-in, по умолчанию OFF). */
export function isDemoVitrineMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "1";
}

export interface VitrineProductsInput {
  /** Demo-escape-hatch включён (NEXT_PUBLIC_DEMO_MODE === "1"). */
  demoMode: boolean;
  /** Live-запрос /api/products завершился ошибкой. */
  isError: boolean;
  /** Данные live-запроса (undefined — грузится или упал). */
  live: Product[] | undefined;
  /** store.products (в demo-режиме содержит mock-сид, иначе live-гидрация). */
  storeProducts: Product[];
}

/**
 * selectVitrineProducts — что именно рендерит публичная витрина.
 *
 *   • isError → только live-данные (обычно undefined → пусто → состояние
 *     ошибки с «Повторить»); mock никогда не подменяет серверный сбой;
 *   • demoMode → dual-mode: mock-сид store, пока live не вернул строки
 *     (прежнее поведение — только по явному флагу);
 *   • по умолчанию → только live-данные (пустой ответ = честная пустота).
 */
export function selectVitrineProducts({
  demoMode,
  isError,
  live,
  storeProducts,
}: VitrineProductsInput): Product[] {
  if (isError) {
    return live ?? [];
  }
  if (demoMode) {
    return live && live.length > 0 ? live : storeProducts;
  }
  return live ?? [];
}
