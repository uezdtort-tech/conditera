/**
 * Тесты /api/cron/diagnostics-cleanup — ретеншн app_error_events
 * (DEPLOY-01 §5/§12): X-Cron-Secret гейт, удаление старых raw-событий,
 * запись maintenance_logs, честный 500 при сбое.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const insertMock = vi.fn();

vi.mock("@/lib/cron-auth", () => ({
  verifyCronSecret: (req: unknown) => verifyMock(req),
  cronUnauthorized: () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (payload: unknown) => {
        insertMock(payload);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

const verifyMock = vi.fn();

import { GET } from "./route";
import type { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new Request("http://localhost:3000/api/cron/diagnostics-cleanup", {
    headers: { "X-Cron-Secret": "test-secret" },
  }) as NextRequest;
}

beforeEach(() => {
  verifyMock.mockReset();
  verifyMock.mockReturnValue(true);
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rowCount: 42, rows: [] });
  insertMock.mockReset();
  process.env.DIAGNOSTICS_RETENTION_DAYS = undefined;
});

describe("GET /api/cron/diagnostics-cleanup", () => {
  it("без секрета → 401, удаления нет", async () => {
    verifyMock.mockReturnValue(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("удаление по ретеншену (по умолчанию 90 дней) + лог операции", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deletedEvents: number; retentionDays: number };
    expect(body.ok).toBe(true);
    expect(body.deletedEvents).toBe(42);
    expect(body.retentionDays).toBe(90);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("DELETE FROM public.app_error_events");
    expect(sql).toContain("occurred_at < now()");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.type).toBe("DIAGNOSTICS_CLEANUP");
    expect(payload.status).toBe("success");
  });

  it("кастомный DIAGNOSTICS_RETENTION_DAYS уважается", async () => {
    process.env.DIAGNOSTICS_RETENTION_DAYS = "30";
    const res = await GET(makeRequest());
    const body = (await res.json()) as { retentionDays: number };
    expect(body.retentionDays).toBe(30);
  });

  it("сбой DELETE → 500 + лог failed (честный статус)", async () => {
    queryMock.mockRejectedValue(new Error("lock timeout"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("failed");
  });
});
