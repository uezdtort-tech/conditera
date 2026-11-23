/**
 * Тесты vitrine-products.ts — селекция источника товаров публичной витрины
 * (ZV31-017: mock-товары убраны из публичного каталога).
 *
 * Контракт:
 *   • по умолчанию (demo OFF) витрина рендерит ТОЛЬКО live-данные
 *     /api/products — mock из store не подставляется никогда;
 *   • ошибка API → live ?? [] (mock НИКОГДА не маскирует серверный сбой);
 *   • demo-escape-hatch (NEXT_PUBLIC_DEMO_MODE='1') → прежний dual-mode:
 *     mock-сид store до прихода live-строк.
 */
import { describe, it, expect } from "vitest";
import { selectVitrineProducts } from "./vitrine-products";
import type { Product } from "./types";

const LIVE_A = { id: "live-1", title: "Живой торт", price: 1900 } as Product;
const LIVE_B = { id: "live-2", title: "Живой наполеон", price: 2400 } as Product;
const MOCK_A = { id: "p2", title: "Торт «Купеческий медовик»", price: 2300 } as Product;

describe("selectVitrineProducts (ZV31-017)", () => {
  describe("честный режим (demo OFF — по умолчанию)", () => {
    it("live грузится (undefined) → пусто → витрина показывает loading-состояние", () => {
      const products = selectVitrineProducts({
        demoMode: false,
        isError: false,
        live: undefined,
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([]);
    });

    it("live пуст ([] — пустая БД) → пусто → честное «Каталог пока пуст», НЕ mock", () => {
      const products = selectVitrineProducts({
        demoMode: false,
        isError: false,
        live: [],
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([]);
      expect(products).not.toContain(MOCK_A);
    });

    it("live с данными → рендерятся live-товары (реальный путь не изменился)", () => {
      const products = selectVitrineProducts({
        demoMode: false,
        isError: false,
        live: [LIVE_A, LIVE_B],
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([LIVE_A, LIVE_B]);
      expect(products.map((p) => p.id)).not.toContain("p2");
    });
  });

  describe("ошибка API — mock никогда не подменяет серверный сбой", () => {
    it("isError без live-данных → пусто (состояние ошибки + «Повторить»), даже если store содержит mock", () => {
      const products = selectVitrineProducts({
        demoMode: false,
        isError: true,
        live: undefined,
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([]);
    });

    it("isError + в demo-режиме тоже без mock (демо не маскирует ошибку)", () => {
      const products = selectVitrineProducts({
        demoMode: true,
        isError: true,
        live: undefined,
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([]);
    });

    it("isError после успешной загрузки (рефетч упал) → остаются последние live-данные", () => {
      const products = selectVitrineProducts({
        demoMode: false,
        isError: true,
        live: [LIVE_A],
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([LIVE_A]);
    });
  });

  describe("demo-escape-hatch (NEXT_PUBLIC_DEMO_MODE='1')", () => {
    it("live грузится → mock-сид store (прежний dual-mode для демо-стендов)", () => {
      const products = selectVitrineProducts({
        demoMode: true,
        isError: false,
        live: undefined,
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([MOCK_A]);
    });

    it("live вернул строки → mock замещается live-данными", () => {
      const products = selectVitrineProducts({
        demoMode: true,
        isError: false,
        live: [LIVE_A],
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([LIVE_A]);
    });

    it("live пуст ([] — пустая БД) → mock остаётся (осознанный dual-mode демо-режима)", () => {
      const products = selectVitrineProducts({
        demoMode: true,
        isError: false,
        live: [],
        storeProducts: [MOCK_A],
      });
      expect(products).toEqual([MOCK_A]);
    });
  });
});
