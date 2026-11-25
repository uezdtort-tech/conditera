/**
 * PATCH /api/orders/[id] — API-слой делегирует переход единому lifecycle engine.
 * История, CAS, резервы и уведомления принадлежат движку; маршрут не дублирует их.
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
    status: "PENDING",
  };
  const orderQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: { ...order }, error: null })),
  };
  return {
    LifecycleError,
    applyOrderTransition: vi.fn(),
    getUserFromRequest: vi.fn(),
    order,
    orderQuery,
  };
});

vi.mock("@/lib/ops/lifecycle", () => ({
  applyOrderTransition: mocks.applyOrderTransition,
  LifecycleError: mocks.LifecycleError,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn(() => mocks.orderQuery) },
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => mocks.getUserFromRequest(...args),
}));
vi.mock("@/lib/supabase/auth", () => ({
  forbiddenResponse: (message: string) => NextResponse.json({ error: message }, { status: 403 }),
  unauthorizedResponse: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));

import { PATCH } from "./route";

const USER = { id: "confectioner-uuid", roles: ["CONFECTIONER"] };

async function callPatch(status: string, comment?: string) {
  const request = new NextRequest(`http://localhost:3000/api/orders/${mocks.order.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, comment }),
  });
  return PATCH(request, { params: Promise.resolve({ id: mocks.order.id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.status = "PENDING";
  mocks.orderQuery.maybeSingle.mockResolvedValue({ data: { ...mocks.order }, error: null });
  mocks.getUserFromRequest.mockResolvedValue(USER);
  mocks.applyOrderTransition.mockResolvedValue({
    orderId: mocks.order.id,
    orderNumber: mocks.order.number,
    from: "PENDING",
    to: "CONFIRMED",
  });
});

describe("PATCH /api/orders/[id] — единый lifecycle engine", () => {
  it("передаёт переход, роль и комментарий движку и возвращает его результат", async () => {
    const response = await callPatch("CONFIRMED", "Принят кондитером");
    expect(response.status).toBe(200);
    expect(mocks.applyOrderTransition).toHaveBeenCalledWith({
      orderId: mocks.order.id,
      to: "CONFIRMED",
      actorId: USER.id,
      actorRoles: USER.roles,
      comment: "Принят кондитером",
    });
    expect(await response.json()).toMatchObject({
      order: { id: mocks.order.id, number: mocks.order.number, status: "CONFIRMED" },
      transition: { from: "PENDING", to: "CONFIRMED" },
    });
  });

  it("не допускает обход специализированной отмены через PATCH", async () => {
    const response = await callPatch("CANCELLED");
    expect(response.status).toBe(409);
    expect(mocks.applyOrderTransition).not.toHaveBeenCalled();
  });

  it("возвращает 409 при запрещённом переходе, не выполняя побочных действий маршрута", async () => {
    mocks.applyOrderTransition.mockRejectedValue(
      new mocks.LifecycleError("INVALID_TRANSITION", "PENDING -> COMPLETED запрещён")
    );
    const response = await callPatch("COMPLETED");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "INVALID_TRANSITION" });
  });

  it("возвращает 401 без пользователя", async () => {
    mocks.getUserFromRequest.mockResolvedValue(null);
    const response = await callPatch("CONFIRMED");
    expect(response.status).toBe(401);
    expect(mocks.applyOrderTransition).not.toHaveBeenCalled();
  });
});
