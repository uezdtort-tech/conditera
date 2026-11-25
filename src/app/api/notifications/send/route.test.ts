import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
  eq: vi.fn(),
  contains: vi.fn(),
  limit: vi.fn(),
  getUserFromRequest: vi.fn(),
  requireAnyRole: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: mocks.getUserFromRequest,
}));
vi.mock("@/lib/role-guards", () => ({
  requireAnyRole: mocks.requireAnyRole,
}));
vi.mock("@/lib/notifications", () => ({
  sendNotification: mocks.sendNotification,
  TEMPLATES: { ABANDONED_CART: {} },
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CRON_SECRET = "test-cron-secret-that-is-not-a-production-secret";

function request(body: unknown, secret = CRON_SECRET): Request {
  return new Request("http://localhost/api/notifications/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-cron-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/notifications/send — trusted cron delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    mocks.getUserFromRequest.mockResolvedValue(null);
    mocks.requireAnyRole.mockResolvedValue(null);
    mocks.sendNotification.mockResolvedValue({ notificationIds: ["notification-1"] });
    mocks.select.mockReturnThis();
    mocks.eq.mockReturnThis();
    mocks.contains.mockReturnThis();
    mocks.limit.mockResolvedValue({ data: [], error: null });
    mocks.in.mockResolvedValue({
      data: [{ id: "notification-1", channel: "in_app", status: "sent" }],
      error: null,
    });
    mocks.from.mockReturnValue({ select: mocks.select, in: mocks.in, eq: mocks.eq, contains: mocks.contains, limit: mocks.limit });
  });

  it("accepts a valid Cron Secret and delegates template delivery to the shared engine", async () => {
    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      vars: { itemsCount: 2, total: 1500 },
      channels: ["email", "in_app"],
      data: { cartId: "cart_1", type: "abandoned_cart" },
      dedupKey: "abandoned-cart:cart_1",
    }));

    expect(response.status).toBe(200);
    expect(mocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      template: "ABANDONED_CART",
      dedupKey: "abandoned-cart:cart_1",
      channels: ["email", "in_app"],
    }));
    expect(mocks.from).toHaveBeenCalledWith("notifications");
  });

  it("rejects requests without a valid Cron Secret when no admin session exists", async () => {
    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
    }, "wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("rejects unknown templates and unsupported delivery channels", async () => {
    const unknownTemplate = await POST(request({
      userId: USER_ID,
      template: "NOT_A_TEMPLATE",
    }));
    expect(unknownTemplate.status).toBe(400);

    const unsupportedChannel = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      channels: ["telegram"],
    }));
    expect(unsupportedChannel.status).toBe(400);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("fails closed when a notification ID has no persisted delivery-status row", async () => {
    mocks.in.mockResolvedValue({ data: [], error: null });

    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      dedupKey: "abandoned-cart:cart-log-uuid",
    }));

    expect(response.status).toBe(502);
  });

  it("returns 502 instead of reporting success when a delivery channel failed", async () => {
    mocks.in.mockResolvedValue({
      data: [{ id: "notification-1", channel: "email", status: "failed" }],
      error: null,
    });

    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      channels: ["email"],
    }));

    expect(response.status).toBe(502);
    expect((await response.json()).success).toBe(false);
  });

  it("confirms an existing successful deduplicated delivery instead of leaving the cart pending", async () => {
    mocks.sendNotification.mockResolvedValue({ notificationIds: [] });
    mocks.limit.mockResolvedValue({
      data: [{ id: "notification-existing", channel: "email", status: "sent" }],
      error: null,
    });

    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      dedupKey: "abandoned-cart:cart-log-uuid",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      alreadySent: true,
      notificationIds: ["notification-existing"],
      channels: [{ channel: "email", status: "sent" }],
    });
    expect(mocks.contains).toHaveBeenCalledWith("metadata", { dedup_key: "abandoned-cart:cart-log-uuid" });
  });

  it("keeps a notification pending when the engine skips without an existing successful delivery", async () => {
    mocks.sendNotification.mockResolvedValue({ notificationIds: [] });
    mocks.limit.mockResolvedValue({ data: [], error: null });

    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      dedupKey: "abandoned-cart:cart-log-uuid",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, skipped: true, notificationIds: [] });
  });

  it("keeps quiet-hours notifications retryable while every delivery channel is queued", async () => {
    mocks.in.mockResolvedValue({
      data: [{ id: "notification-queued", channel: "email", status: "queued" }],
      error: null,
    });

    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      dedupKey: "abandoned-cart:cart-log-uuid",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      skipped: true,
      scheduled: true,
      channels: [{ channel: "email", status: "queued" }],
    });
  });

  it("does not confirm a queued deduplicated notification as already delivered", async () => {
    mocks.sendNotification.mockResolvedValue({ notificationIds: [] });
    mocks.limit.mockResolvedValue({
      data: [{ id: "notification-queued", channel: "email", status: "queued" }],
      error: null,
    });

    const response = await POST(request({
      userId: USER_ID,
      template: "ABANDONED_CART",
      dedupKey: "abandoned-cart:cart-log-uuid",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, skipped: true, notificationIds: [] });
  });

  it("rejects malformed user identifiers before invoking the delivery engine", async () => {
    const response = await POST(request({
      userId: "not-a-uuid",
      template: "ABANDONED_CART",
    }));

    expect(response.status).toBe(400);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});
