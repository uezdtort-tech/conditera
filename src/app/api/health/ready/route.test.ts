/**
 * Тесты /api/health/live и /api/health/ready (DEPLOY-01 §5):
 * liveness минимальный (без внутренней информации), readiness —
 * 200/503 по БД, БЕЗ секретов/адресов/имён env-переменных.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

import { GET as GET_LIVE } from "../live/route";
import { GET as GET_READY } from "../ready/route";

beforeEach(() => {
  queryMock.mockReset();
});

describe("GET /api/health/live (liveness)", () => {
  it("всегда 200 {status:alive}, без данных об окружении", async () => {
    const res = await GET_LIVE();
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("alive");
    const body = JSON.stringify(data);
    expect(body).not.toContain("env");
    expect(body).not.toContain("url");
    expect(body).not.toContain("key");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/health/ready (readiness)", () => {
  it("БД жива → 200 {status:ready, database:ok}", async () => {
    queryMock.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const res = await GET_READY();
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ready");
    expect(data.database).toBe("ok");
  });

  it("БД недоступна → 503 {status:not-ready, database:unavailable}", async () => {
    queryMock.mockRejectedValue(new Error("connection refused"));
    const res = await GET_READY();
    expect(res.status).toBe(503);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("not-ready");
    expect(data.database).toBe("unavailable");
  });

  it("НЕТ secrets/адресов/имён env-переменных в ответе", async () => {
    queryMock.mockRejectedValue(new Error("connection refused to postgresql://secret@host"));
    const res = await GET_READY();
    const body = JSON.stringify((await res.json()) as unknown);
    expect(body).not.toContain("postgresql://");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("SUPABASE");
    expect(body).not.toContain("Missing");
  });
});
