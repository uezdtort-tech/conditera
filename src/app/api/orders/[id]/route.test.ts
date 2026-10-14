/**
 * Регрессионные тесты GET /api/orders/[id] — scope доступа.
 *
 * P1 (courier-scope): роль COURIER не должна автоматически давать доступ
 * к подробностям чужих заказов. Курьер читает только заказ, на который
 * назначен (orders.courier_id — канонический маркер назначения).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- Моки модулей (герметично, без сети и Supabase) ---

const singleResult = { data: null as unknown, error: null as unknown };

const builderMock = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockImplementation(() => Promise.resolve(singleResult)),
};

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => builderMock),
  },
}));

const getUserFromRequest = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequest(...args),
}));

vi.mock("@/lib/supabase/auth", () => ({
  forbiddenResponse: (message: string) =>
    NextResponse.json({ error: message }, { status: 403 }),
  unauthorizedResponse: () =>
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/n8n", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ops/events", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from "./route";

const ORDER_ID = "ord-1111-2222-3333";

const baseOrder = {
  id: ORDER_ID,
  number: "UK-2026-000001",
  user_id: "customer-uuid",
  confectioner_id: "confectioner-uuid",
  courier_id: null as string | null,
  status: "IN_DELIVERY",
  delivery: [] as { courier_id?: string | null }[],
};

function makeUser(id: string, roles: string[]) {
  return { id, roles, email: `${id}@test.local` };
}

async function callGet(): Promise<NextResponse> {
  const request = new NextRequest(`http://localhost:3000/api/orders/${ORDER_ID}`);
  return GET(request, { params: Promise.resolve({ id: ORDER_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  singleResult.data = { ...baseOrder };
  singleResult.error = null;
});

describe("GET /api/orders/[id] — scope доступа", () => {
  it("401 без аутентификации", async () => {
    getUserFromRequest.mockResolvedValue(null);
    const res = await callGet();
    expect(res.status).toBe(401);
  });

  it("404 если заказ не найден", async () => {
    getUserFromRequest.mockResolvedValue(makeUser("customer-uuid", ["CUSTOMER"]));
    singleResult.data = null;
    singleResult.error = { message: "Not found" };
    const res = await callGet();
    expect(res.status).toBe(404);
  });

  it("200 владелец заказа (CUSTOMER)", async () => {
    getUserFromRequest.mockResolvedValue(makeUser("customer-uuid", ["CUSTOMER"]));
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order.id).toBe(ORDER_ID);
  });

  it("200 кондитер своего заказа", async () => {
    getUserFromRequest.mockResolvedValue(makeUser("confectioner-uuid", ["CONFECTIONER"]));
    const res = await callGet();
    expect(res.status).toBe(200);
  });

  it("403 чужой кондитер", async () => {
    getUserFromRequest.mockResolvedValue(makeUser("other-confectioner", ["CONFECTIONER"]));
    const res = await callGet();
    expect(res.status).toBe(403);
  });

  it("200 назначенный курьер (deliveries[].courier_id === user.id)", async () => {
    // Канонический маркер назначения — deliveries.courier_id (orders.courier_id
    // в реальной схеме БД не существует).
    singleResult.data = {
      ...baseOrder,
      delivery: [{ id: "d1", courier_id: "courier-uuid" }],
    };
    getUserFromRequest.mockResolvedValue(makeUser("courier-uuid", ["COURIER"]));
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order.delivery[0].courier_id).toBe("courier-uuid");
  });

  it("200 назначенный курьер (легаси-фоллбэк order.courier_id)", async () => {
    singleResult.data = { ...baseOrder, courier_id: "courier-uuid", delivery: [] };
    getUserFromRequest.mockResolvedValue(makeUser("courier-uuid", ["COURIER"]));
    const res = await callGet();
    expect(res.status).toBe(200);
  });

  it("403 неназначенный курьер на чужой заказ (регрессия P1 courier-scope)", async () => {
    // Канонический регрессионный случай: до фикса роль COURIER была в
    // привилегированном списке и любой курьер читал любой заказ.
    singleResult.data = {
      ...baseOrder,
      delivery: [{ id: "d1", courier_id: "another-courier" }],
    };
    getUserFromRequest.mockResolvedValue(makeUser("courier-uuid", ["COURIER"]));
    const res = await callGet();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Курьер не назначен");
  });

  it("403 курьер на заказ без назначения в deliveries (пустой embed)", async () => {
    singleResult.data = { ...baseOrder, delivery: [] };
    getUserFromRequest.mockResolvedValue(makeUser("courier-uuid", ["COURIER"]));
    const res = await callGet();
    expect(res.status).toBe(403);
  });

  it("200 ADMIN на любой заказ", async () => {
    getUserFromRequest.mockResolvedValue(makeUser("admin-uuid", ["ADMIN"]));
    const res = await callGet();
    expect(res.status).toBe(200);
  });

  it("200 SUPPORT на любой заказ", async () => {
    getUserFromRequest.mockResolvedValue(makeUser("support-uuid", ["SUPPORT"]));
    const res = await callGet();
    expect(res.status).toBe(200);
  });

  it("403 посторонний пользователь", async () => {
    getUserFromRequest.mockResolvedValue(makeUser("stranger-uuid", ["CUSTOMER"]));
    const res = await callGet();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Нет доступа к этому заказу");
  });
});
