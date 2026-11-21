import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const state = {
    singleResults: {} as Record<string, unknown[]>,
    updateResults: {} as Record<string, unknown[]>,
    fromCalls: [] as string[],
    refundPayment: vi.fn(),
  };
  const from = vi.fn((table: string) => {
    state.fromCalls.push(table);
    let operation = "select";
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.neq = vi.fn(() => query);
    query.in = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.update = vi.fn(() => { operation = "update"; return query; });
    query.upsert = vi.fn(() => { operation = "upsert"; return query; });
    query.maybeSingle = vi.fn(async () => {
      const queue = state.singleResults[table] ?? [];
      return { data: queue.shift() ?? null, error: null };
    });
    query.single = vi.fn(async () => {
      const queue = state.singleResults[table] ?? [];
      return { data: queue.shift() ?? null, error: null };
    });
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: (operation === "update" ? state.updateResults[table] : []), error: null }).then(resolve, reject);
    return query;
  });
  return { state, from };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/yookassa", () => ({
  verifyWebhook: vi.fn(() => true),
  isYookassaConfigured: vi.fn(() => false),
  getPaymentStatus: vi.fn(),
  getRefund: vi.fn(),
  refundPayment: mocks.state.refundPayment,
}));

import { POST } from "@/app/api/payment/webhook/route";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PAYMENT_ID = "provider-payment-1";

function request() {
  return new NextRequest("http://localhost/api/payment/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "payment.succeeded",
      object: {
        id: PAYMENT_ID,
        status: "succeeded",
        amount: { value: "100.00", currency: "RUB" },
        metadata: { orderId: ORDER_ID },
      },
    }),
  });
}

function payment(status = "pending") {
  return {
    id: "payment-row-1",
    order_id: ORDER_ID,
    amount: 100,
    status,
    refund_amount: 0,
  };
}

function order(status = "PENDING") {
  return {
    id: ORDER_ID,
    number: "C-100",
    total: 100,
    payment_method: "yookassa",
    payment_status: "pending",
    status,
    customer_id: null,
    user_id: null,
    confectioner_id: null,
  };
}

describe("payment webhook POST — cancellation race", () => {
  beforeEach(() => {
    mocks.state.singleResults = {};
    mocks.state.updateResults = {};
    mocks.state.fromCalls = [];
    mocks.state.refundPayment.mockReset().mockResolvedValue({ success: true, refund: { id: "refund-1" } });
  });

  it("возвращает уже списанный платёж, если отмена выигрывает гонку escrow CAS", async () => {
    mocks.state.singleResults.payments = [payment("pending")];
    mocks.state.singleResults.orders = [order("PENDING"), order("CANCELLED")];
    mocks.state.updateResults.payments = [{ id: "payment-row-1" }];
    mocks.state.updateResults.orders = [];

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, refundInitiated: true });
    expect(mocks.state.fromCalls).toEqual(["payments", "orders", "payments", "orders", "orders"]);
    expect(mocks.state.refundPayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      100,
      expect.stringContaining("C-100"),
      `uezd_konditer:refund:late:${ORDER_ID}`,
    );
  });

  it("не пропускает повторный payment.succeeded до проверки terminal-заказа", async () => {
    mocks.state.singleResults.payments = [payment("succeeded")];
    mocks.state.singleResults.orders = [order("CANCELLED")];

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, refundInitiated: true });
    expect(mocks.state.refundPayment).toHaveBeenCalledTimes(1);
    expect(mocks.state.fromCalls).toEqual(["payments", "orders"]);
  });
});
