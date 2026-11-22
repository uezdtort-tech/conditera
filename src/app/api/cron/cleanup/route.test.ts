import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  verifyCronSecret: vi.fn(),
  runFullCleanup: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/cron-auth", () => ({
  verifyCronSecret: mocks.verifyCronSecret,
  cronUnauthorized: () => ({ body: "Unauthorized" }),
}));
vi.mock("@/lib/cleanup", () => ({
  runFullCleanup: mocks.runFullCleanup,
}));

import { GET } from "./route";

function request(): NextRequest {
  return new NextRequest("http://localhost/api/cron/cleanup");
}

describe("GET /api/cron/cleanup — partial failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCronSecret.mockReturnValue(true);
    mocks.insert.mockReturnThis();
    mocks.select.mockReturnThis();
    mocks.single.mockResolvedValue({ data: { id: "maintenance-log-1" }, error: null });
    mocks.update.mockReturnThis();
    mocks.eq.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({
      insert: mocks.insert,
      select: mocks.select,
      single: mocks.single,
      update: mocks.update,
      eq: mocks.eq,
    });
  });

  it("returns 500 and records failed when any cleanup operation fails", async () => {
    mocks.runFullCleanup.mockResolvedValue({
      totalDeleted: 3,
      totalDurationMs: 25,
      results: [
        { type: "old_logs", success: true, recordsAffected: 3, durationMs: 10 },
        { type: "expired_semaphores", success: false, recordsAffected: 0, durationMs: 15, errorMessage: "database timeout" },
      ],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("expired_semaphores");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorMessage: expect.stringContaining("database timeout"),
    }));
  });

  it("returns 200 and records success only when every cleanup operation succeeds", async () => {
    mocks.runFullCleanup.mockResolvedValue({
      totalDeleted: 3,
      totalDurationMs: 25,
      results: [
        { type: "old_logs", success: true, recordsAffected: 3, durationMs: 10 },
        { type: "expired_semaphores", success: true, recordsAffected: 0, durationMs: 15 },
      ],
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      errorMessage: null,
    }));
  });
});
