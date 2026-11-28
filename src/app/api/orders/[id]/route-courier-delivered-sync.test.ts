/**
 * PATCH /api/orders/[id] — маршрут проверяет назначение курьера,
 * а транзакционную синхронизацию доставки и courier_earnings выполняет lifecycle engine.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => {
  class LifecycleError extends Error {
    code: string;
    detail?: string;
    constructor(code: string, message: string, detail?: string) {
      super(message);
      this.code = code;
      this.detail = detail;
    }
  }
  const order = {
    id: "ord-1111-2222-3333",
    number: "UK-2026-000042",
    user_id: "customer-uuid",
    confectioner_id: "confectioner-uuid",
    status: "IN_DELIVERY",
  };
  const orderQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: { ...order }, error: null })),
  };
  const assignmentResult = { data: [{ id: "delivery-1" }] as { id: string }[] | null, error: null as { message: string } | null };
  const assignmentQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => assignmentResult),
  };
  return {
    LifecycleError,
    applyOrderTransition: vi.fn(),
    getUserFromRequest: vi.fn(),
    order,
    orderQuery,
    assignmentResult,
    assignmentQuery,
    from: vi.fn((table: string) => table === "orders" ? orderQuery : assignmentQuery),
  };
});

vi.mock("@/lib/ops/lifecycle", () => ({
  applyOrderTransition: mocks.applyOrderTransition,
  LifecycleError: mocks.LifecycleError,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => mocks.from(table) },
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => mocks.getUserFromRequest(...args),
}));
vi.mock("@/lib/supabase/auth", () => ({
  forbiddenResponse: (message: string) => NextResponse.json({ error: message }, { status: 403 }),
  unauthorizedResponse: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));

import { PATCH } from "./route";

const COURIER = { id: "courier-uuid", roles: ["CUSTOMER", "COURIER"] };

async function callPatch() {
  const request = new NextRequest(`http://localhost:3000/api/orders/${mocks.order.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "DELIVERED" }),
  });
  return PATCH(request, { params: Promise.resolve({ id: mocks.order.id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.status = "IN_DELIVERY";
  mocks.assignmentResult.data = [{ id: "delivery-1" }];
  mocks.assignmentResult.error = null;
  mocks.orderQuery.maybeSingle.mockResolvedValue({ data: { ...mocks.order }, error: null });
  mocks.getUserFromRequest.mockResolvedValue(COURIER);
  mocks.applyOrderTransition.mockResolvedValue({
    orderId: mocks.order.id,
    orderNumber: mocks.order.number,
    from: "IN_DELIVERY",
    to: "DELIVERED",
    deliverySync: "ok",
  });
});

describe("PATCH /api/orders/[id] — courier assignment and delivery result", () => {
  it("allows the assigned courier and returns the engine's atomic delivery sync result", async () => {
    const response = await callPatch();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      transition: { from: "IN_DELIVERY", to: "DELIVERED" },
      deliverySync: "ok",
    });
    expect(mocks.applyOrderTransition).toHaveBeenCalledTimes(1);
  });

  it("rejects a courier without an active assignment before invoking the engine", async () => {
    mocks.assignmentResult.data = [];
    const response = await callPatch();
    expect(response.status).toBe(403);
    expect(mocks.applyOrderTransition).not.toHaveBeenCalled();
  });

  it("fails closed when the assignment lookup fails", async () => {
    mocks.assignmentResult.error = { message: "database unavailable" };
    const response = await callPatch();
    expect(response.status).toBe(503);
    expect(mocks.applyOrderTransition).not.toHaveBeenCalled();
  });

  it("maps duplicate active delivery assignments to 409", async () => {
    mocks.applyOrderTransition.mockRejectedValue(
      new mocks.LifecycleError("DELIVERY_INVARIANT_VIOLATION", "Несколько активных доставок")
    );
    const response = await callPatch();
    expect(response.status).toBe(409);
  });
});
