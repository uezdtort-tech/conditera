/**
 * Интеграционные unit-тесты транзакционного движка жизненного цикла.
 * Проверяют CAS, историю, платёжный гейт и атомарное закрытие доставки.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    order: {
      id: "11111111-1111-4111-8111-111111111111",
      number: "UK-2026-000042",
      status: "PENDING",
      user_id: "customer-uuid",
      confectioner_id: "confectioner-uuid",
      payment_status: "pending",
      payment_method: "cash",
      delivery_type: "delivery",
    },
    deliveryRows: [] as Array<{ id: string; cost: number | string | null }>,
  };
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes("FROM public.orders o")) {
        return { rows: [{ ...state.order }], rowCount: 1 };
      }
      if (query.includes("FROM public.order_items oi")) {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("FROM public.deliveries")) {
        return { rows: [...state.deliveryRows], rowCount: state.deliveryRows.length };
      }
      if (query.includes("UPDATE public.deliveries")) {
        return {
          rows: state.deliveryRows.length ? [{ id: state.deliveryRows[0].id }] : [],
          rowCount: state.deliveryRows.length ? 1 : 0,
        };
      }
      if (query.includes("UPDATE public.orders SET status")) {
        return { rows: [{ id: state.order.id }], rowCount: 1 };
      }
      if (query.includes("INSERT INTO public.order_status_history")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  };
  return {
    state,
    client,
    pool,
    recordEvent: vi.fn().mockResolvedValue(undefined),
    emitEvent: vi.fn().mockResolvedValue(undefined),
    releaseOrderReservation: vi.fn().mockResolvedValue(undefined),
    getActiveReservation: vi.fn().mockResolvedValue(null),
    sendNotification: vi.fn().mockResolvedValue({ notificationIds: [] }),
  };
});

vi.mock("@/lib/postgrest/pool", () => ({ getPool: () => mocks.pool }));
vi.mock("./events", () => ({ recordEvent: mocks.recordEvent }));
vi.mock("@/lib/n8n", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("./capacity", () => ({
  releaseOrderReservation: mocks.releaseOrderReservation,
  getActiveReservation: mocks.getActiveReservation,
}));
vi.mock("@/lib/notifications", () => ({ sendNotification: mocks.sendNotification }));
vi.mock("./lifecycle-config", () => ({
  readyPhotoRequiredForCategory: vi.fn(() => false),
}));

import { applyOrderTransition, LifecycleError } from "./lifecycle";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function input(to: string, actorRoles: string[] = ["CONFECTIONER"], actorId = "confectioner-uuid", comment?: string) {
  return { orderId: ORDER_ID, to, actorId, actorRoles, comment };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.state.order, {
    id: ORDER_ID,
    number: "UK-2026-000042",
    status: "PENDING",
    user_id: "customer-uuid",
    confectioner_id: "confectioner-uuid",
    payment_status: "pending",
    payment_method: "cash",
    delivery_type: "delivery",
  });
  mocks.state.deliveryRows = [];
});

describe("applyOrderTransition — атомарные переходы", () => {
  it("фиксирует статус, комментарий и историю в одной транзакции", async () => {
    const result = await applyOrderTransition(input("CONFIRMED", ["CONFECTIONER"], "confectioner-uuid", "Принят"));

    expect(result).toMatchObject({
      orderId: ORDER_ID,
      from: "PENDING",
      to: "CONFIRMED",
    });
    const calls = mocks.client.query.mock.calls;
    const update = calls.find(([sql]) => String(sql).includes("UPDATE public.orders SET status"));
    const history = calls.find(([sql]) => String(sql).includes("INSERT INTO public.order_status_history"));
    expect(update?.[1]?.[7]).toBe("PENDING");
    expect(update?.[1]?.[8]).toBe("Принят");
    expect(history?.[1]).toEqual([ORDER_ID, "PENDING", "CONFIRMED", "confectioner-uuid", "Принят"]);
    expect(calls.some(([sql]) => String(sql) === "COMMIT")).toBe(true);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it("не подтверждает заказ с неподтверждённой онлайн-оплатой", async () => {
    mocks.state.order.payment_method = "yookassa";
    mocks.state.order.payment_status = "pending";

    await expect(applyOrderTransition(input("CONFIRMED"))).rejects.toMatchObject({
      code: "PAYMENT_NOT_CONFIRMED",
    });
    expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.orders SET status"))).toBe(false);
    expect(mocks.client.query.mock.calls.some(([sql]) => String(sql) === "ROLLBACK")).toBe(true);
  });

  it("курьер закрывает назначенную доставку и фиксирует заработок из cost", async () => {
    mocks.state.order.status = "IN_DELIVERY";
    mocks.state.order.payment_status = "escrow";
    mocks.state.deliveryRows = [{ id: "delivery-1", cost: 350 }];

    const result = await applyOrderTransition(input("DELIVERED", ["COURIER"], "courier-uuid"));

    expect(result.deliverySync).toBe("ok");
    const deliveryUpdate = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE public.deliveries")
    );
    expect(String(deliveryUpdate?.[0])).toContain("courier_earnings = COALESCE(cost, 0)");
    expect(deliveryUpdate?.[1]).toEqual(["delivery-1"]);
  });

  it("запрещает переход при нескольких активных доставках", async () => {
    mocks.state.order.status = "IN_DELIVERY";
    mocks.state.order.payment_status = "escrow";
    mocks.state.deliveryRows = [
      { id: "delivery-1", cost: 350 },
      { id: "delivery-2", cost: 400 },
    ];

    await expect(applyOrderTransition(input("DELIVERED", ["COURIER"], "courier-uuid"))).rejects.toMatchObject({
      code: "DELIVERY_INVARIANT_VIOLATION",
    });
    expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.orders SET status"))).toBe(false);
  });

  it("не позволяет курьеру завершить заказ без активного назначения", async () => {
    mocks.state.order.status = "IN_DELIVERY";
    mocks.state.order.payment_status = "escrow";

    await expect(applyOrderTransition(input("DELIVERED", ["COURIER"], "courier-uuid"))).rejects.toMatchObject({
      code: "DELIVERY_ASSIGNMENT_REQUIRED",
    });
  });

  it("проверяет владельца при подтверждении получения клиентом", async () => {
    mocks.state.order.status = "DELIVERED";
    await expect(applyOrderTransition(input("COMPLETED", ["CUSTOMER"], "another-customer"))).rejects.toMatchObject({
      code: "FORBIDDEN_ROLE",
    });
  });

  it("отклоняет невозможный переход без записи статуса", async () => {
    await expect(applyOrderTransition(input("COMPLETED"))).rejects.toBeInstanceOf(LifecycleError);
    expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.orders SET status"))).toBe(false);
  });
});
