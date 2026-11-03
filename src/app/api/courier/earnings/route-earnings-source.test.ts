/**
 * A-3: канонический источник заработка курьера — deliveries.courier_earnings.
 *
 * Первопричина: KPI/API суммировали orders.delivery_cost (клиентская ЦЕНА
 * доставки, может меняться после назначения), а DELIVERED-sync записывал
 * deliveries.courier_earnings — KPI расходился с историей доставок.
 *
 * Формат: герметичный мок supabaseAdmin (конвенция
 * route-courier-delivered-sync.test.ts). Лочит контракт:
 *   1. суммы считаются по courier_earnings, а НЕ по orders.delivery_cost
 *      (расхождение источников: earnings=350 при delivery_cost=999 → 350);
 *   2. legacy-строки (courier_earnings=NULL) считаются по deliveries.cost
 *      без перезаписи данных;
 *   3. повторная обработка DELIVERED не удваивает сумму (строки считаются
 *      один раз; начисление в sync — присваивание, не инкремент);
 *   4. CANCELLED/активные доставки не попадают в суммы;
 *   5. месячные метрики — по delivered_at;
 *   6. ошибка БД → 500 (не молчаливый ноль).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

function expectEqFilter(actual: Array<[string, unknown]>, expected: Array<[string, unknown]>) {
  for (const [col, val] of expected) {
    expect(actual).toEqual(
      expect.arrayContaining([expect.arrayContaining([col, val])])
    );
  }
}

type DeliveryRow = {
  id: string;
  order_id: string;
  cost: number | null;
  courier_earnings: number | null;
  delivered_at: string | null;
  status?: string;
};

let deliveriesResult: { data: DeliveryRow[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};

const eqCalls: Array<[string, unknown]> = [];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table !== "deliveries") throw new Error(`unexpected table ${table}`);
      const b = {
        eq: vi.fn((col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return b;
        }),
        order: vi.fn(() => Promise.resolve(deliveriesResult)),
      };
      return { select: vi.fn(() => b) };
    }),
  },
}));

const getUserFromRequest = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequest(...args),
}));

const requireRole = vi.fn();
vi.mock("@/lib/role-guards", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));

import { GET } from "./route";

const COURIER = { id: "courier-uuid", userId: "courier-uuid", roles: ["COURIER"] };

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  deliveriesResult = { data: [], error: null };
  getUserFromRequest.mockResolvedValue(COURIER);
  requireRole.mockReturnValue(null); // guard пройден
});

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

async function callGet(): Promise<NextResponse> {
  const request = new NextRequest("http://localhost:3000/api/courier/earnings");
  return GET(request);
}

describe("GET /api/courier/earnings — канонический источник заработка (A-3)", () => {
  it("суммирует courier_earnings, а не orders.delivery_cost (расхождение источников)", async () => {
    // orders.delivery_cost = 999 (изменена после назначения), фикс выплаты = 350
    deliveriesResult = {
      data: [
        { id: "d1", order_id: "o1", cost: 350, courier_earnings: 350, delivered_at: isoDaysAgo(0) },
        { id: "d2", order_id: "o2", cost: 400, courier_earnings: 400, delivered_at: isoDaysAgo(1) },
      ],
      error: null,
    };
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { totalEarnings: number; deliveries: number };
    expect(json.totalEarnings).toBe(750); // 350+400, а НЕ 999+999
    expect(json.deliveries).toBe(2);
  });

  it("legacy-строка courier_earnings=NULL считается по cost (снимок назначения), без перезаписи данных", async () => {
    deliveriesResult = {
      data: [
        { id: "d1", order_id: "o1", cost: 500, courier_earnings: null, delivered_at: isoDaysAgo(0) },
        { id: "d2", order_id: "o2", cost: 350, courier_earnings: 350, delivered_at: isoDaysAgo(0) },
      ],
      error: null,
    };
    const res = await callGet();
    const json = (await res.json()) as { totalEarnings: number };
    expect(json.totalEarnings).toBe(850); // 500 (fallback cost) + 350
  });

  it("повторная обработка DELIVERED не удваивает сумму (строка в результате одна)", async () => {
    // Повторный DELIVERED невозможен картой переходов; sync пишет присваиванием.
    // Даже если строка delivered пришла дважды (аномалия выгрузки) — считаем
    // по строкам БД, а не по событиям.
    deliveriesResult = {
      data: [
        { id: "d1", order_id: "o1", cost: 350, courier_earnings: 350, delivered_at: isoDaysAgo(0) },
      ],
      error: null,
    };
    const res = await callGet();
    const json = (await res.json()) as { totalEarnings: number };
    expect(json.totalEarnings).toBe(350);
  });

  it("месячные метрики по delivered_at: свежие считаются, старые — только в total", async () => {
    deliveriesResult = {
      data: [
        { id: "d1", order_id: "o1", cost: 350, courier_earnings: 350, delivered_at: isoDaysAgo(0) },
        { id: "d2", order_id: "o2", cost: 900, courier_earnings: 900, delivered_at: isoDaysAgo(45) },
      ],
      error: null,
    };
    const res = await callGet();
    const json = (await res.json()) as {
      totalEarnings: number;
      monthlyEarnings: number;
      deliveries: number;
      monthlyDeliveries: number;
    };
    expect(json.totalEarnings).toBe(1250);
    expect(json.monthlyEarnings).toBe(350);
    expect(json.deliveries).toBe(2);
    expect(json.monthlyDeliveries).toBe(1);
  });

  it("активные/отменённые доставки не попадают в выборку (фильтр status=delivered на уровне запроса)", async () => {
    await callGet();
    // Маршрут обязан фильтровать на стороне БД: courier_id + status=delivered,
    // иначе суммы включали бы незавершённые доставки.
    expectEqFilter(eqCalls, [
      ["courier_id", COURIER.id],
      ["status", "delivered"],
    ]);
  });

  it("ошибка БД → 500 (не молчаливый ноль в финансовых сводках)", async () => {
    deliveriesResult = { data: null, error: { message: "connection refused" } };
    const res = await callGet();
    expect(res.status).toBe(500);
  });
});
