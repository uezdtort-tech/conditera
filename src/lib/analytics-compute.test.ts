import { describe, expect, it } from "vitest";
import {
  computeMonthlyRevenue,
  computeOrdersByStatus,
  computeTopProducts,
} from "./analytics-compute";
import type { Order, OrderItem } from "@/lib/types";

const NOW = new Date("2025-06-15T12:00:00Z"); // фиксируем «сегодня» для детерминизма

let seq = 0;
function makeOrder(overrides: Partial<Order> = {}): Order {
  seq += 1;
  return {
    id: `o${seq}`,
    number: `N${seq}`,
    customerId: "u1",
    customerName: "Тест",
    items: [],
    total: 0,
    status: "COMPLETED",
    deliveryDate: "2025-06-01",
    deliveryCost: 0,
    createdAt: "2025-06-01T10:00:00Z",
    paymentMethod: "card",
    paymentStatus: "escrow",
    ...overrides,
  };
}

function item(title: string, quantity = 1, price = 1000): OrderItem {
  return { productId: "p1", title, image: "", price, quantity };
}

describe("computeMonthlyRevenue", () => {
  it("null/undefined → пустой массив", () => {
    expect(computeMonthlyRevenue(null)).toEqual([]);
    expect(computeMonthlyRevenue(undefined)).toEqual([]);
  });

  it("пустой список заказов → 6 нулевых месяцев (Янв..Июн при now=2025-06-15)", () => {
    const points = computeMonthlyRevenue([], 6, NOW);
    expect(points.map((p) => p.label)).toEqual(["Янв", "Фев", "Мар", "Апр", "Май", "Июн"]);
    expect(points.map((p) => p.month)).toEqual([
      "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
    ]);
    expect(points.every((p) => p.revenue === 0)).toBe(true);
  });

  it("считает только COMPLETED; будущие месяцы, вне окна и битые даты пропускает", () => {
    const orders: Order[] = [
      makeOrder({ total: 5000, createdAt: "2025-02-10T10:00:00Z" }),
      makeOrder({ total: 2500, createdAt: "2025-02-20T10:00:00Z" }),
      makeOrder({ total: 1000, createdAt: "2025-06-01T10:00:00Z" }),
      makeOrder({ total: 99999, status: "CONFIRMED", createdAt: "2025-03-01T10:00:00Z" }),
      makeOrder({ total: 777, status: "CANCELLED", createdAt: "2025-01-05T10:00:00Z" }),
      makeOrder({ total: 4242, createdAt: "2025-07-01T10:00:00Z" }), // будущий месяц — skip
      makeOrder({ total: 900, createdAt: "2024-12-31T10:00:00Z" }), // до окна — skip
      makeOrder({ total: 300, createdAt: "не дата" }), // invalid — skip
      makeOrder({ total: 300, createdAt: "" }), // отсутствует — skip
    ];
    const points = computeMonthlyRevenue(orders, 6, NOW);
    expect(points.find((p) => p.month === "2025-02")?.revenue).toBe(7500);
    expect(points.find((p) => p.month === "2025-06")?.revenue).toBe(1000);
    expect(points.find((p) => p.month === "2025-03")?.revenue).toBe(0); // не COMPLETED
    expect(points.find((p) => p.month === "2025-01")?.revenue).toBe(0); // только CANCELLED
    // Σ по всем месяцам = только реальные COMPLETED в окне (5000 + 2500 + 1000)
    expect(points.reduce((s, p) => s + p.revenue, 0)).toBe(8500);
  });

  it("null/NaN total трактуется как 0", () => {
    const orders: Order[] = [
      makeOrder({ total: null as unknown as number, createdAt: "2025-05-02T10:00:00Z" }),
      makeOrder({ total: Number.NaN, createdAt: "2025-05-09T10:00:00Z" }),
      makeOrder({ total: 500, createdAt: "2025-05-11T10:00:00Z" }),
    ];
    const points = computeMonthlyRevenue(orders, 6, NOW);
    expect(points.find((p) => p.month === "2025-05")?.revenue).toBe(500);
  });

  it("граница окна: заказ ровно 6 месяцев назад включается", () => {
    const orders = [makeOrder({ total: 1234, createdAt: "2025-01-05T10:00:00Z" })];
    const points = computeMonthlyRevenue(orders, 6, NOW);
    expect(points.find((p) => p.month === "2025-01")?.revenue).toBe(1234);
  });
});

describe("computeOrdersByStatus", () => {
  it("null/undefined/[] → []", () => {
    expect(computeOrdersByStatus(null)).toEqual([]);
    expect(computeOrdersByStatus(undefined)).toEqual([]);
    expect(computeOrdersByStatus([])).toEqual([]);
  });

  it("включает только присутствующие статусы, сортировка count desc", () => {
    const orders = [
      makeOrder({ status: "COMPLETED" }),
      makeOrder({ status: "COMPLETED" }),
      makeOrder({ status: "COMPLETED" }),
      makeOrder({ status: "PENDING" }),
      makeOrder({ status: "READY" }),
      makeOrder({ status: "READY" }),
    ];
    expect(computeOrdersByStatus(orders)).toEqual([
      { status: "COMPLETED", count: 3 },
      { status: "READY", count: 2 },
      { status: "PENDING", count: 1 },
    ]);
  });

  it("нет нулевых секторов: статусы вне данных не попадают в результат", () => {
    const orders = [makeOrder({ status: "DISPUTE" })];
    expect(computeOrdersByStatus(orders)).toEqual([{ status: "DISPUTE", count: 1 }]);
  });

  it("при равном count — сортировка по алфавиту статуса", () => {
    const orders = [makeOrder({ status: "READY" }), makeOrder({ status: "PENDING" })];
    expect(computeOrdersByStatus(orders).map((s) => s.status)).toEqual(["PENDING", "READY"]);
  });
});

describe("computeTopProducts", () => {
  it("null/undefined/[] → []", () => {
    expect(computeTopProducts(null)).toEqual([]);
    expect(computeTopProducts(undefined)).toEqual([]);
    expect(computeTopProducts([])).toEqual([]);
  });

  it("агрегирует по названию, суммирует quantity, сортирует desc и уважает limit", () => {
    const orders = [
      makeOrder({ items: [item("Торт Медовик", 2, 3000), item("Капкейки", 1, 900)] }),
      makeOrder({ items: [item("Торт Медовик", 1, 3000)] }),
      makeOrder({ items: [item("Эклеры", 5, 400)] }),
    ];
    const top = computeTopProducts(orders, 2);
    // сортировка по count desc: у Эклеров 5 единиц против 3 у Медовика
    expect(top).toEqual([
      { name: "Эклеры", count: 5, revenue: 2000 },
      { name: "Торт Медовик", count: 3, revenue: 9000 },
    ]);
  });

  it("пропускает позиции без названия; qty<=0/нет → 1; null price → 0", () => {
    const orders = [
      makeOrder({
        items: [
          item("", 3), // пустое название — skip
          { productId: "p", title: "   ", image: "", price: 100, quantity: 2 }, // пробелы — skip
          { productId: "p", title: "Без qty", image: "", price: 500, quantity: undefined as unknown as number },
          { productId: "p", title: "Без цены", image: "", price: null as unknown as number, quantity: 2 },
        ],
      }),
    ];
    // сортировка по count desc: у «Без цены» 2 единицы против 1 у «Без qty»
    expect(computeTopProducts(orders, 5)).toEqual([
      { name: "Без цены", count: 2, revenue: 0 },
      { name: "Без qty", count: 1, revenue: 500 },
    ]);
  });

  it("заказы без items (null/undefined) не ломают вычисления", () => {
    const orders = [
      makeOrder({ items: undefined as unknown as OrderItem[] }),
      makeOrder(),
    ];
    expect(computeTopProducts(orders, 5)).toEqual([]);
  });

  it("при равном count побеждает бо́льшая выручка, далее алфавит", () => {
    const orders = [
      makeOrder({ items: [item("Б", 2, 1000)] }),
      makeOrder({ items: [item("А", 2, 3000)] }),
      makeOrder({ items: [item("В", 2, 3000)] }),
    ];
    expect(computeTopProducts(orders, 3).map((p) => p.name)).toEqual(["А", "В", "Б"]);
  });
});
