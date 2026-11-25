import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { emitEvent } from "./n8n";

describe("n8n event emitter", () => {
  const originalBase = process.env.N8N_BASE_URL;
  const originalWebhookBase = process.env.N8N_WEBHOOK_BASE_URL;
  const originalWebhookSecret = process.env.N8N_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.N8N_WEBHOOK_BASE_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
    (globalThis as typeof globalThis & { __conditeraN8nWarned?: boolean }).__conditeraN8nWarned = false;
    mocks.insert.mockResolvedValue({ data: null, error: null });
    mocks.from.mockReturnValue({ insert: mocks.insert });
  });

  afterEach(() => {
    if (originalBase === undefined) delete process.env.N8N_BASE_URL;
    else process.env.N8N_BASE_URL = originalBase;
    if (originalWebhookBase === undefined) delete process.env.N8N_WEBHOOK_BASE_URL;
    else process.env.N8N_WEBHOOK_BASE_URL = originalWebhookBase;
    if (originalWebhookSecret === undefined) delete process.env.N8N_WEBHOOK_SECRET;
    else process.env.N8N_WEBHOOK_SECRET = originalWebhookSecret;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not enable event delivery just because the internal health URL exists", async () => {
    process.env.N8N_BASE_URL = "http://n8n:5678";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await emitEvent("order.created", { orderId: "order-1" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("dead-letters non-2xx webhook responses instead of silently losing events", async () => {
    process.env.N8N_WEBHOOK_BASE_URL = "http://n8n:5678/webhook";
    process.env.N8N_WEBHOOK_SECRET = "test-n8n-webhook-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response("inactive workflow", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await emitEvent("order.created", { orderId: "order-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://n8n:5678/webhook/conditera-order.created",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-N8N-Secret": "test-n8n-webhook-secret" }),
      }),
    );
    expect(mocks.from).toHaveBeenCalledWith("audit_log");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: "n8n.dead-letter",
      entity_id: "order.created",
    }));
  });
});
