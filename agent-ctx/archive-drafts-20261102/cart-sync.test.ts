/**
 * Тесты src/lib/cart-sync.ts — merge-стратегия DB-wins (чистая функция).
 *
 * Покрывает (Stage 3 feature cart-persistence):
 *   • пустые случаи (сервер пуст / локал пуст / оба пусты);
 *   • дедуп товарных дубликатов: quantity = MAX(local, server), dbId от сервера;
 *   • custom-торты никогда не дедуплицируются против сервера (всегда toPush);
 *   • распространение dbId (сервер-only позиции → serverToCartItem);
 *   • cap 50 (серверные приоритетны, лишние локальные отбрасываются).
 */

import { describe, it, expect } from "vitest";
import {
  mergeServerCart,
  serverToCartItem,
  productCartKey,
  dbItemId,
  CART_SYNC_CAP,
  type ServerCartItem,
} from "./cart-sync";
import type { CartItem } from "./types";

const PID = "22222222-2222-4222-8222-222222222222";
const PID2 = "33333333-3333-4333-8333-333333333333";

function localItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    itemId: `ci_local_${Math.random().toString(36).slice(2, 8)}`,
    productId: PID,
    title: "Медовик",
    image: "/img.jpg",
    price: 1500,
    quantity: 1,
    confectionerId: "c1",
    ...overrides,
  };
}

function serverItem(overrides: Partial<ServerCartItem> = {}): ServerCartItem {
  return {
    dbId: `db-row-${Math.random().toString(36).slice(2, 8)}`,
    productId: PID,
    quantity: 1,
    selectedAttributes: null,
    metadata: null,
    product: { id: PID, title: "Медовик (сервер)", price: 1500, image: "/srv.jpg", confectionerId: "c1" },
    ...overrides,
  };
}

describe("mergeServerCart: пустые случаи", () => {
  it("оба пусты → items=[], toPush=[]", () => {
    const { items, toPush } = mergeServerCart([], []);
    expect(items).toEqual([]);
    expect(toPush).toEqual([]);
  });

  it("сервер пуст → все локальные позиции сохраняются и помечаются к push", () => {
    const a = localItem();
    const b = localItem({ productId: PID2, title: "Эклер" });
    const { items, toPush } = mergeServerCart([], [a, b]);
    expect(items).toEqual([a, b]);
    expect(toPush).toEqual([a, b]);
  });

  it("локал пуст → серверные строки маппятся в CartItem (serverToCartItem)", () => {
    const s = serverItem({ quantity: 3 });
    const { items, toPush } = mergeServerCart([s], []);
    expect(items).toHaveLength(1);
    expect(toPush).toEqual([]);
    expect(items[0]).toMatchObject({
      dbId: s.dbId,
      itemId: dbItemId(s.dbId),
      productId: PID,
      quantity: 3,
      title: "Медовик (сервер)",
      image: "/srv.jpg",
      price: 1500,
      confectionerId: "c1",
    });
  });
});

describe("mergeServerCart: дедуп товарных дубликатов (DB-wins)", () => {
  it("та же позиция (product + кастомизация) → quantity = MAX(local, server), dbId от сервера", () => {
    const local = localItem({
      quantity: 2,
      customization: { filling: "Малина" },
    });
    const s = serverItem({
      quantity: 5,
      selectedAttributes: { filling: "Малина" },
    });
    const { items, toPush } = mergeServerCart([s], [local]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5); // MAX(2, 5)
    expect(items[0].dbId).toBe(s.dbId);
    expect(items[0].itemId).toBe(local.itemId); // локальный ключ UI сохранён
    expect(toPush).toEqual([]); // смёржена — push не нужен
  });

  it("сервер меньше локала → берём локальное (MAX)", () => {
    const local = localItem({ quantity: 4 });
    const s = serverItem({ quantity: 1 });
    const { items } = mergeServerCart([s], [local]);
    expect(items[0].quantity).toBe(4);
    expect(items[0].dbId).toBe(s.dbId);
  });

  it("разная кастомизация той же позиции → две отдельные позиции", () => {
    const local = localItem({ customization: { filling: "Шоколад" } });
    const s = serverItem({ selectedAttributes: { filling: "Малина" } });
    const { items, toPush } = mergeServerCart([s], [local]);
    expect(items).toHaveLength(2);
    expect(toPush).toEqual([local]); // локальная без пары → push
  });

  it("сигнатура кастомизации не зависит от порядка ключей", () => {
    const local = localItem({
      customization: { filling: "Малина", coating: "Глазурь" },
    });
    const s = serverItem({
      selectedAttributes: { coating: "Глазурь", filling: "Малина" },
      quantity: 7,
    });
    const { items, toPush } = mergeServerCart([s], [local]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(7);
    expect(toPush).toEqual([]);
  });

  it("позиция без кастомизации смёржится с серверной без атрибутов (null vs undefined)", () => {
    const local = localItem({ customization: undefined });
    const s = serverItem({ selectedAttributes: null });
    const { items } = mergeServerCart([s], [local]);
    expect(items).toHaveLength(1);
    expect(items[0].dbId).toBe(s.dbId);
  });

  it("productCartKey стабилен и различает товары", () => {
    expect(productCartKey(PID, { a: "1" })).toBe(productCartKey(PID, { a: "1" }));
    expect(productCartKey(PID, { a: "1" })).not.toBe(productCartKey(PID2, { a: "1" }));
    expect(productCartKey(PID, { a: "1" })).not.toBe(productCartKey(PID, { a: "2" }));
    expect(productCartKey(PID, null)).toBe(productCartKey(PID, null));
  });
});

describe("mergeServerCart: custom-торты (никогда не дедуплицируются)", () => {
  it("локальный custom-торт сохраняется и всегда попадает в toPush", () => {
    const custom = localItem({
      productId: "", // custom-позиция: товара в БД нет
      custom: { config: { base: "biscuit" } as never },
      title: "Торт из конструктора",
    });
    const s = serverItem(); // серверная товарная позиция — не мешает custom
    const { items, toPush } = mergeServerCart([s], [custom]);
    expect(items).toHaveLength(2);
    expect(toPush).toEqual([custom]);
    expect(items.find((i) => i.custom)).toBe(custom);
  });

  it("серверный custom-торт (productId=null, metadata.custom) маппится с конфигом", () => {
    const s = serverItem({
      productId: null,
      product: null,
      metadata: {
        custom: { config: { base: "biscuit", filling: "vanilla" } },
        title: "Бисквитный торт",
        image: "/builder-bg.png",
        price: 2400,
        confectionerId: "",
      },
      quantity: 2,
    });
    const { items } = mergeServerCart([s], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productId: "",
      title: "Бисквитный торт",
      image: "/builder-bg.png",
      price: 2400,
      quantity: 2,
      dbId: s.dbId,
    });
    expect(items[0].custom?.config).toEqual({ base: "biscuit", filling: "vanilla" });
  });

  it("два custom-торта (одинаковый конфиг) → оба сохраняются (нет дедупа)", () => {
    const c1 = localItem({ productId: "", custom: { config: { base: "biscuit" } as never } });
    const c2 = localItem({ productId: "", custom: { config: { base: "biscuit" } as never } });
    const { items, toPush } = mergeServerCart([], [c1, c2]);
    expect(items).toHaveLength(2);
    expect(toPush).toHaveLength(2);
  });
});

describe("mergeServerCart: dbId propagation", () => {
  it("серверная позиция с кастомизацией маппится в item.customization (известные ключи)", () => {
    const s = serverItem({
      selectedAttributes: { filling: "Малина", unknown_key: "x" },
    });
    const item = serverToCartItem(s);
    expect(item.customization).toEqual({ filling: "Малина" });
  });

  it("dbItemId — стабильный префикс для itemId", () => {
    expect(dbItemId("abc")).toBe("ci_db_abc");
    expect(dbItemId("abc")).toBe(dbItemId("abc"));
  });
});

describe("mergeServerCart: cap 50", () => {
  it("более 50 итоговых позиций → обрезается до 50, лишние локальные не пушатся", () => {
    const serverRows = Array.from({ length: CART_SYNC_CAP }, (_, i) =>
      serverItem({ dbId: `db-${i}`, productId: `p-${i}` })
    );
    const extraLocals = [localItem({ productId: "extra-1" }), localItem({ productId: "extra-2" })];
    const { items, toPush } = mergeServerCart(serverRows, extraLocals);
    expect(items).toHaveLength(CART_SYNC_CAP);
    // Серверные заполнили весь кап → локальные отброшены (не показаны → не пушим)
    expect(toPush).toEqual([]);
  });

  it("49 серверных + 3 локальные → 50 позиций, в toPush только влезшие", () => {
    const serverRows = Array.from({ length: CART_SYNC_CAP - 1 }, (_, i) =>
      serverItem({ dbId: `db-${i}`, productId: `p-${i}` })
    );
    const l1 = localItem({ productId: "extra-1" });
    const l2 = localItem({ productId: "extra-2" });
    const l3 = localItem({ productId: "extra-3" });
    const { items, toPush } = mergeServerCart(serverRows, [l1, l2, l3]);
    expect(items).toHaveLength(CART_SYNC_CAP);
    expect(toPush).toEqual([l1]); // только первая влезла в кап
  });
});
