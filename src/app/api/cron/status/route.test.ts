import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  verifyCronSecret: vi.fn(),
  getUserFromRequest: vi.fn(),
  requireAnyRole: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/cron-auth", () => ({
  verifyCronSecret: mocks.verifyCronSecret,
  cronUnauthorized: () => ({ body: "Unauthorized" }),
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: mocks.getUserFromRequest,
}));
vi.mock("@/lib/role-guards", () => ({
  requireAnyRole: mocks.requireAnyRole,
}));

import { GET } from "./route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

function request(): NextRequest {
  return new NextRequest("http://localhost/api/cron/status");
}

describe("GET /api/cron/status — access control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCronSecret.mockReturnValue(false);
    mocks.getUserFromRequest.mockResolvedValue(null);
    mocks.requireAnyRole.mockResolvedValue(null);
    mocks.select.mockReturnThis();
    mocks.eq.mockReturnThis();
    mocks.maybeSingle.mockResolvedValue({ data: { value: "[]" }, error: null });
    mocks.from.mockReturnValue({
      select: mocks.select,
      eq: mocks.eq,
      maybeSingle: mocks.maybeSingle,
    });
  });

  it("rejects a request with an arbitrary Authorization header and no valid session", async () => {
    const req = new NextRequest("http://localhost/api/cron/status", {
      headers: { authorization: "Bearer attacker-controlled-token" },
    });
    const response = await GET(req);

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.requireAnyRole).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-admin user", async () => {
    mocks.getUserFromRequest.mockResolvedValue({ id: ADMIN_ID });
    mocks.requireAnyRole.mockResolvedValue(new NextResponse("Forbidden", { status: 403 }));

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.requireAnyRole).toHaveBeenCalledWith(ADMIN_ID, ["ADMIN", "SUPER_ADMIN"]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("allows an authenticated administrator", async () => {
    mocks.getUserFromRequest.mockResolvedValue({ id: ADMIN_ID });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runs: [], total: 0 });
    expect(mocks.from).toHaveBeenCalledWith("site_settings");
  });

  it("allows a valid cron secret without requiring a user session", async () => {
    mocks.verifyCronSecret.mockReturnValue(true);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.getUserFromRequest).not.toHaveBeenCalled();
    expect(mocks.requireAnyRole).not.toHaveBeenCalled();
  });
});
