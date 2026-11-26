/**
 * A-3: /api/courier/dashboard — KPI заработка и история из
 * deliveries.courier_earnings (снимок выплаты), НЕ из orders.delivery_cost
 * (клиентская цена доставки). Регресс: при расхождении источников
 * (earnings=350, delivery_cost=999) KPI должен показывать 350.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

type Row = Record<string, unknown>;

// FIFO результатов запросов к deliveries: (1) сегодня, (2) месяц, (3) история
let deliveriesQueue: { data: Row[] | null; error: { message: string } | null; count?: number | null }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const resultFor = (): { data: Row[] | null; error: { message: string } | null; count: number | null } => {
        if (table === "deliveries") {
          const next = deliveriesQueue.shift();
          return { ...(next ?? { data: [], error: null }), count: next?.count ?? null };
        }
        return { data: [], error: null, count: 2 };
      };
      const makeBuilder = (): Record<string, unknown> => {
        const p = Promise.resolve(resultFor());
        const b = {
          select: vi.fn(() => b),
          eq: vi.fn(() => b),
          in: vi.fn(() => b),
          gte: vi.fn(() => b),
          order: vi.fn(() => b),
          limit: vi.fn(() => b),
          maybeSingle: vi.fn(async () => resultFor()),
          then: (res?: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            p.then(res as never, rej as never),
        };
        return b;
      };
      return makeBuilder();
    }),
  },
}));

vi.mock("@/lib/courier-assignments", () => ({
  getCourierOrderIds: vi.fn().mockResolvedValue(["o-1", "o-2"]),
  isCourierAssignedToOrder: vi.fn().mockReturnValue(false),
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

function isoNow(): string {
  return new Date().toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  deliveriesQueue = [];
  getUserFromRequest.mockResolvedValue(COURIER);
  requireRole.mockReturnValue(null);
});

async function callGet(): Promise<NextResponse> {
  const request = new NextRequest("http://localhost:3000/api/courier/dashboard");
  return GET(request);
}

describe("GET /api/courier/dashboard — канонический источник заработка (A-3)", () => {
  it("KPI считается по courier_earnings, а не по orders.delivery_cost", async () => {
    const today = isoNow();
    deliveriesQueue = [
      { data: [], error: null, count: 2 }, // active count
      { data: [], error: null, count: 2 }, // completed today
      { data: [
        { courier_earnings: 350, cost: 999 },
        { courier_earnings: 400, cost: 999 },
      ], error: null }, // earnings today
      { data: [
        { courier_earnings: 350, cost: 999 },
        { courier_earnings: 400, cost: 999 },
      ], error: null }, // earnings month
      { data: [], error: null }, // active delivery list
      { data: [
        { id: "d1", order_id: "o-1", delivered_at: today, cost: 999, courier_earnings: 350 },
      ], error: null }, // history
    ];

    const res = await callGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      stats: { earningsToday: number; earningsMonth: number; completedToday: number };
      history: Array<{ earnings: number; orderId: string }>;
      stub: boolean;
    };

    expect(json.stub).toBe(false);
    expect(json.stats.completedToday).toBe(2);
    expect(json.stats.earningsToday).toBe(750); // НЕ 999*2
    expect(json.stats.earningsMonth).toBe(750);
    // история: заработок из courier_earnings, номер заказа из orders.number (или order_id)
    expect(json.history).toHaveLength(1);
    expect(json.history[0].earnings).toBe(350); // НЕ 999
  });

  it("legacy-строка courier_earnings=NULL показывается по cost (без перезаписи данных)", async () => {
    const today = isoNow();
    deliveriesQueue = [
      { data: [], error: null, count: 1 },
      { data: [], error: null, count: 1 },
      { data: [{ cost: 500, courier_earnings: null }], error: null },
      { data: [{ cost: 500, courier_earnings: null }], error: null },
      { data: [], error: null },
      { data: [
        { id: "d1", order_id: "o-1", delivered_at: today, cost: 500, courier_earnings: null },
      ], error: null },
    ];

    const res = await callGet();
    const json = (await res.json()) as {
      stats: { earningsToday: number };
      history: Array<{ earnings: number }>;
    };
    expect(json.stats.earningsToday).toBe(500);
    expect(json.history[0].earnings).toBe(500);
  });

  it("ошибка запроса истории → fail-safe stub (без частичных цифр)", async () => {
    deliveriesQueue = [
      { data: [], error: null, count: 0 },
      { data: [], error: null, count: 0 },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: { message: "connection refused" } },
    ];
    const res = await callGet();
    // В test/production недоступность БД закрывается 503 без демо-данных.
    const json = (await res.json()) as { error?: string };
    expect(res.status).toBe(503);
    expect(json.error).toContain("временно недоступны");
  });
});
