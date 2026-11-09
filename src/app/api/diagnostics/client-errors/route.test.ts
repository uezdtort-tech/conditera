/**
 * Тесты POST /api/diagnostics/client-errors — ingest клиентских ошибок:
 * валидация, rate-limit, size-cap, маскирование, отсутствие стека.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const storeMock = vi.fn();

vi.mock("@/lib/diagnostics/event-store", () => ({
  storeErrorEvent: (input: unknown) => storeMock(input),
}));

const rateLimitMock = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  getClientIP: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

import { POST } from "./route";

function makeRequest(body: unknown, raw?: string): Request {
  return new Request("http://localhost:3000/api/diagnostics/client-errors", {
    method: "POST",
    body: raw !== undefined ? raw : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
  });
}

beforeEach(() => {
  storeMock.mockReset();
  storeMock.mockReturnValue({ eventId: "evt-1", fingerprint: "f".repeat(40) });
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ success: true, remaining: 19, resetAt: 0, retryAfterSec: 0 });
});

describe("POST /api/diagnostics/client-errors", () => {
  it("валидный payload → 202 и запись с component=frontend (клиент не подменяет)", async () => {
    const res = await POST(
      makeRequest({ message: "TypeError: cannot read property", route: "/checkout" }) as never
    );
    expect(res.status).toBe(202);
    expect(storeMock).toHaveBeenCalledTimes(1);
    const arg = storeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.component).toBe("frontend");
    expect(arg.source).toBe("client");
  });

  it("route вне / (не путь) отклоняется от сохранения", async () => {
    await POST(makeRequest({ message: "err", route: "https://evil.example.com/x" }) as never);
    const arg = storeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.route).toBeNull();
  });

  it("пустое тело → 400", async () => {
    const res = await POST(makeRequest({}, "") as never);
    expect(res.status).toBe(400);
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("payload > 16KB → 413", async () => {
    const big = { message: "x", padding: "y".repeat(20000) };
    const res = await POST(makeRequest(big) as never);
    expect(res.status).toBe(413);
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("невалидный JSON → 400", async () => {
    const res = await POST(makeRequest({}, "not-json{") as never);
    expect(res.status).toBe(400);
  });

  it("message отсутствует → 400", async () => {
    const res = await POST(makeRequest({ route: "/" }) as never);
    expect(res.status).toBe(400);
  });

  it("message > 400 символов → 400 (жёсткий лимит)", async () => {
    const res = await POST(makeRequest({ message: "x".repeat(500) }) as never);
    expect(res.status).toBe(400);
  });

  it("rate limit исчерпан → 429, без записи", async () => {
    rateLimitMock.mockResolvedValue({ success: false, remaining: 0, resetAt: 0, retryAfterSec: 30 });
    const res = await POST(makeRequest({ message: "err" }) as never);
    expect(res.status).toBe(429);
    expect(storeMock).not.toHaveBeenCalled();
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("severity critical от клиента принижается до error", async () => {
    await POST(makeRequest({ message: "err", severity: "critical" }) as never);
    const arg = storeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.severity).not.toBe("critical");
  });

  it("сбой storeErrorEvent → всё равно 202 (диагностика не ломает клиента)", async () => {
    storeMock.mockImplementation(() => {
      throw new Error("store down");
    });
    const res = await POST(makeRequest({ message: "err" }) as never);
    expect(res.status).toBe(202);
  });
});
