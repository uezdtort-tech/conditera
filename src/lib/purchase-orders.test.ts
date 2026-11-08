/**
 * purchase-orders.test.ts — unit-тесты бизнес-логики закупочных заказов (Z-v17).
 *
 * Лочит контракты src/lib/purchase-orders.ts:
 *  - валидация кратности MOQ/order_step;
 *  - матрица ACTION_TRANSITIONS: роль определяет допустимые действия,
 *    поставщик не может отменить, покупатель не может подтвердить;
 *  - notificationForAction: каждому действию соответствует шаблон.
 *
 * SQL-слой (резервы, CAS, транзакции) покрывается integration-прогоном
 * на реальной БД (docs/evidence/... + scripts verify), здесь — чистая логика.
 */
import { describe, it, expect } from "vitest";
import {
  isQuantityCompliant,
  ACTION_TRANSITIONS,
  ACTION_TARGET,
  notificationForAction,
  type OrderAction,
} from "./purchase-orders";

describe("isQuantityCompliant (MOQ + кратность)", () => {
  it("принимает количество, равное MOQ при шаге 1", () => {
    expect(isQuantityCompliant(5, 5, 1)).toBe(true);
  });

  it("отклоняет количество меньше MOQ", () => {
    expect(isQuantityCompliant(4, 5, 1)).toBe(false);
  });

  it("принимает MOQ + k*step", () => {
    expect(isQuantityCompliant(11, 5, 3)).toBe(true); // 5 + 2*3
    expect(isQuantityCompliant(8, 5, 3)).toBe(true); // 5 + 1*3
  });

  it("отклоняет не кратное шагу после MOQ", () => {
    expect(isQuantityCompliant(10, 5, 3)).toBe(false); // 5+5, 5 не кратен 3
  });

  it("отклоняет нецелые и неположительные", () => {
    expect(isQuantityCompliant(0, 1, 1)).toBe(false);
    expect(isQuantityCompliant(2.5, 1, 1)).toBe(false);
    expect(isQuantityCompliant(-3, 1, 1)).toBe(false);
  });

  it("деградирует отсутствующие minOrderQty/orderStep к 1", () => {
    expect(isQuantityCompliant(3, 0, 0)).toBe(true);
  });
});

describe("ACTION_TRANSITIONS — разграничение ролей", () => {
  it("поставщик может подтвердить/отказать/обрабатывать/отгружать SUBMITTED-цепочку", () => {
    expect(ACTION_TRANSITIONS.supplier?.confirm).toEqual(["SUBMITTED"]);
    expect(ACTION_TRANSITIONS.supplier?.reject).toEqual(["SUBMITTED"]);
    expect(ACTION_TRANSITIONS.supplier?.process).toEqual(["CONFIRMED"]);
    expect(ACTION_TRANSITIONS.supplier?.ready_for_shipment).toEqual(["PROCESSING"]);
    expect(ACTION_TRANSITIONS.supplier?.ship).toEqual(["READY_FOR_SHIPMENT"]);
  });

  it("поставщик НЕ может отменить заказ или подтвердить доставку", () => {
    expect(ACTION_TRANSITIONS.supplier?.cancel).toBeUndefined();
    expect(ACTION_TRANSITIONS.supplier?.confirm_delivery).toBeUndefined();
  });

  it("покупатель НЕ может подтвердить или отгрузить заказ", () => {
    expect(ACTION_TRANSITIONS.buyer?.confirm).toBeUndefined();
    expect(ACTION_TRANSITIONS.buyer?.reject).toBeUndefined();
    expect(ACTION_TRANSITIONS.buyer?.ship).toBeUndefined();
  });

  it("покупатель может отменить до обработки и подтвердить доставку SHIPPED", () => {
    expect(ACTION_TRANSITIONS.buyer?.cancel).toEqual(["DRAFT", "SUBMITTED", "CONFIRMED"]);
    expect(ACTION_TRANSITIONS.buyer?.confirm_delivery).toEqual(["SHIPPED"]);
  });

  it("администратор не вмешивается в статусную машину v17", () => {
    expect(Object.keys(ACTION_TRANSITIONS.admin ?? {}).length).toBe(0);
  });

  it("спор доступен обеим сторонам из активных статусов", () => {
    const active = ["CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED"];
    expect(ACTION_TRANSITIONS.buyer?.dispute).toEqual(active);
    expect(ACTION_TRANSITIONS.supplier?.dispute).toEqual(active);
  });

  it("каждому действию соответствует ровно один целевой статус", () => {
    const actions: OrderAction[] = [
      "submit",
      "confirm",
      "reject",
      "process",
      "ready_for_shipment",
      "ship",
      "confirm_delivery",
      "cancel",
      "dispute",
    ];
    for (const a of actions) {
      expect(ACTION_TARGET[a]).toBeTruthy();
    }
  });
});

describe("notificationForAction", () => {
  it("отказ содержит причину", () => {
    const note = notificationForAction("reject", "PO-2026-0001", { reason: "Нет сырья" });
    expect(note.body).toContain("Нет сырья");
    expect(note.title).toContain("PO-2026-0001");
  });

  it("отмена сообщает об освобождении резерва", () => {
    const note = notificationForAction("cancel", "PO-2026-0002");
    expect(note.body).toContain("Резерв освобождён");
  });

  it("доставка сообщает о списании остатков", () => {
    const note = notificationForAction("confirm_delivery", "PO-2026-0003");
    expect(note.body).toContain("списаны");
  });

  it("у каждого действия есть непустые title/body", () => {
    const actions: OrderAction[] = [
      "submit",
      "confirm",
      "reject",
      "process",
      "ready_for_shipment",
      "ship",
      "confirm_delivery",
      "cancel",
      "dispute",
    ];
    for (const a of actions) {
      const note = notificationForAction(a, "PO-X", { reason: "r" });
      expect(note.title.length).toBeGreaterThan(0);
      expect(note.body.length).toBeGreaterThan(0);
    }
  });
});
