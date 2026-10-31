/**
 * cart-merge.test.ts — регрессия чистой логики серверной корзины (P1 §2).
 *
 * Лочит контракт:
 *   • canonicalJson — стабильный порядок ключей (снимки конфигов сравнимы);
 *   • cartContentKey — товар+атрибуты и custom-конфиг дают разные семейства
 *     ключей; порядок ключей конфига не влияет на ключ;
 *   • planCartMerge — UNION: серверные строки без входящей пары сохраняются;
 *     количество = MAX (идемпотентность: повторный merge того же состояния не
 *     накапливает количество); client_ref перезаписывается на клиентский;
 *   • validateCustomConfigError — неизвестный productType / невалидная конфа
 *     дают ошибку, валидный конфиг — null.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  cartContentKey,
  planCartMerge,
  validateCustomConfigError,
  type CartRow,
  type CartItemInput,
} from "./cart-merge";

function row(partial: Partial<CartRow>): CartRow {
  return {
    id: partial.id ?? `row-${Math.random().toString(36).slice(2)}`,
    user_id: partial.user_id ?? "user-a",
    client_ref: partial.client_ref ?? null,
    product_id: partial.product_id ?? null,
    quantity: partial.quantity ?? 1,
    selected_attributes: partial.selected_attributes ?? null,
    custom_config: partial.custom_config ?? null,
    notes: partial.notes ?? null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function input(partial: Partial<CartItemInput>): CartItemInput {
  return {
    client_ref: partial.client_ref ?? "ci_x",
    product_id: partial.product_id,
    quantity: partial.quantity ?? 1,
    selected_attributes: partial.selected_attributes,
    custom_config: partial.custom_config,
    notes: partial.notes,
  };
}

describe("canonicalJson", () => {
  it("стабилен к порядку ключей", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("вложенные объекты и массивы сортируются рекурсивно", () => {
    expect(canonicalJson({ x: { d: 1, c: 2 }, y: [3, { i: 1, h: 2 }] })).toBe(
      canonicalJson({ y: [3, { h: 2, i: 1 }], x: { c: 2, d: 1 } })
    );
  });

  it("null/undefined нормализуются в null", () => {
    expect(canonicalJson(undefined)).toBe(canonicalJson(null));
  });
});

describe("cartContentKey", () => {
  it("одинаковый товар с одинаковыми атрибутами — один ключ", () => {
    const k1 = cartContentKey({ product_id: "p1", selected_attributes: { filling: "Вишня" }, custom_config: null });
    const k2 = cartContentKey({ product_id: "p1", selected_attributes: { filling: "Вишня" }, custom_config: null });
    expect(k1).toBe(k2);
  });

  it("разные атрибуты — разные ключи", () => {
    const k1 = cartContentKey({ product_id: "p1", selected_attributes: { filling: "Вишня" }, custom_config: null });
    const k2 = cartContentKey({ product_id: "p1", selected_attributes: { filling: "Шоколад" }, custom_config: null });
    expect(k1).not.toBe(k2);
  });

  it("порядок ключей конфига не влияет на custom-ключ", () => {
    const k1 = cartContentKey({ product_id: null, selected_attributes: null, custom_config: { tiers: 2, base: "biscuit", city: "Москва" } });
    const k2 = cartContentKey({ product_id: null, selected_attributes: null, custom_config: { city: "Москва", base: "biscuit", tiers: 2 } });
    expect(k1).toBe(k2);
  });

  it("custom-ключ не конфликтует с product-ключом", () => {
    const custom = cartContentKey({ product_id: null, selected_attributes: null, custom_config: { tiers: 2 } });
    const product = cartContentKey({ product_id: null, selected_attributes: null, custom_config: null });
    expect(custom).not.toBe(product);
  });
});

describe("planCartMerge", () => {
  it("новые позиции клиента → inserts", () => {
    const plan = planCartMerge(
      [],
      [input({ client_ref: "ci_1", product_id: "11111111-1111-1111-1111-111111111111", quantity: 2 })]
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].client_ref).toBe("ci_1");
    expect(plan.updates).toHaveLength(0);
  });

  it("тот же контент под другим client_ref → update с MAX количества и перезаписью ref", () => {
    const pid = "22222222-2222-2222-2222-222222222222";
    const server = [row({ id: "srv-1", product_id: pid, quantity: 3, client_ref: "srv_legacy_1" })];
    const plan = planCartMerge(server, [input({ client_ref: "ci_local", product_id: pid, quantity: 2 })]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: "srv-1", quantity: 3, client_ref: "ci_local" });
  });

  it("клиентское количество больше серверного → берётся клиентское", () => {
    const pid = "33333333-3333-3333-3333-333333333333";
    const server = [row({ id: "srv-1", product_id: pid, quantity: 2, client_ref: "old" })];
    const plan = planCartMerge(server, [input({ client_ref: "new", product_id: pid, quantity: 5 })]);
    expect(plan.updates[0].quantity).toBe(5);
  });

  it("повторный merge того же состояния — идемпотентен (никаких updates)", () => {
    const pid = "44444444-4444-4444-4444-444444444444";
    const incoming = [input({ client_ref: "ci_1", product_id: pid, quantity: 4 })];
    const first = planCartMerge([], incoming);
    // применяем план к «БД» (как сделал бы маршрут)
    const merged: CartRow[] = [
      ...first.inserts.map((i) =>
        row({ product_id: i.product_id, quantity: i.quantity, client_ref: i.client_ref, id: "gen-1" })
      ),
    ];
    const second = planCartMerge(merged, incoming);
    expect(second.inserts).toHaveLength(0);
    expect(second.updates).toHaveLength(0);
  });

  it("серверные строки без входящей пары сохраняются (другое устройство)", () => {
    const pidA = "55555555-5555-5555-5555-555555555555";
    const pidB = "66666666-6666-6666-6666-666666666666";
    const server = [
      row({ id: "srv-a", product_id: pidA, quantity: 1, client_ref: "srv_a" }),
      row({ id: "srv-b", product_id: pidB, quantity: 1, client_ref: "srv_b" }),
    ];
    const plan = planCartMerge(server, [input({ client_ref: "ci_a", product_id: pidA, quantity: 1 })]);
    expect(plan.inserts).toHaveLength(0);
    // pidA совпал по контенту: количество не изменилось, но client_ref
    // переписывается на клиентский (последующие PATCH/DELETE этого клиента
    // попадают в строку) — это единственный update
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: "srv-a", quantity: 1, client_ref: "ci_a" });
    expect(plan.keptServerKeys).toHaveLength(1); // pidB остаётся (другое устройство)
  });

  it("custom-позиции сливаются по снимку конфига (порядок ключей не важен)", () => {
    const cfg = { productType: "cake", tiers: 2 };
    const server = [row({ id: "srv-c", custom_config: cfg, quantity: 1, client_ref: "srv_c" })];
    const plan = planCartMerge(server, [input({ client_ref: "ci_c", custom_config: { tiers: 2, productType: "cake" }, quantity: 1 })]);
    expect(plan.inserts).toHaveLength(0);
    // контент совпал: MAX=1, client_ref переписывается на клиентский
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: "srv-c", quantity: 1, client_ref: "ci_c" });
  });
});

describe("validateCustomConfigError", () => {
  it("валидный конфиг → null", () => {
    expect(validateCustomConfigError({ productType: "cake", tiers: 1, base: "biscuit" })).toBeNull();
  });

  it("неизвестный productType → ошибка", () => {
    const err = validateCustomConfigError({ productType: "ufo" });
    expect(err).toBeTruthy();
    expect(err).toContain("тип изделия");
  });

  it("неизвестная начинка → ошибка (не молчаливое игнорирование)", () => {
    const err = validateCustomConfigError({ productType: "cake", filling: "кирпич" });
    expect(err).toBeTruthy();
  });
});
