/**
 * Тесты courier-assignments — серверного источника истины по назначению
 * курьеров (deliveries.courier_id; orders.courier_id в реальной схеме БД
 * не существует).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const deliveriesResult = { data: null as unknown, error: null as unknown };
const builderMock = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(deliveriesResult)),
  // supabase-js PostgrestBuilder — thenable: await без .single()/maybeSingle()
  then: (resolve: (v: unknown) => void) =>
    resolve({ data: deliveriesResult.data, error: deliveriesResult.error }),
};

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => builderMock),
  },
}));

import {
  getCourierOrderIds,
  isCourierAssignedToOrder,
} from "./courier-assignments";

beforeEach(() => {
  vi.clearAllMocks();
  deliveriesResult.data = null;
  deliveriesResult.error = null;
});

describe("getCourierOrderIds", () => {
  it("возвращает уникальные order_id назначенных доставок", async () => {
    deliveriesResult.data = [
      { order_id: "o1" },
      { order_id: "o2" },
      { order_id: "o1" },
    ];
    const ids = await getCourierOrderIds("courier-1");
    expect(ids).toEqual(["o1", "o2"]);
  });

  it("возвращает пустой список при ошибке БД (fail-safe)", async () => {
    deliveriesResult.error = { message: "boom" };
    const ids = await getCourierOrderIds("courier-1");
    expect(ids).toEqual([]);
  });

  it("возвращает пустой список без строк", async () => {
    deliveriesResult.data = [];
    expect(await getCourierOrderIds("courier-1")).toEqual([]);
  });
});

describe("isCourierAssignedToOrder", () => {
  const courier = "courier-uuid";

  it("true по deliveries embed", () => {
    expect(
      isCourierAssignedToOrder(
        { delivery: [{ courier_id: courier }] },
        courier
      )
    ).toBe(true);
  });

  it("false если назначен другой курьер", () => {
    expect(
      isCourierAssignedToOrder(
        { delivery: [{ courier_id: "other" }] },
        courier
      )
    ).toBe(false);
  });

  it("false при пустом embed (заказ без назначения)", () => {
    expect(isCourierAssignedToOrder({ delivery: [] }, courier)).toBe(false);
  });

  it("легаси-фоллбэк: order.courier_id === courierId", () => {
    expect(isCourierAssignedToOrder({ courier_id: courier }, courier)).toBe(true);
  });

  it("false для null/undefined заказа", () => {
    expect(isCourierAssignedToOrder(null, courier)).toBe(false);
    expect(isCourierAssignedToOrder(undefined, courier)).toBe(false);
  });
});
