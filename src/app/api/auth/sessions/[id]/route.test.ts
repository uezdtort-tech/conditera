import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserFromRequest = vi.fn();
const revokeUserSession = vi.fn();

vi.mock("@/lib/auth", () => ({ getUserFromRequest }));
vi.mock("@/lib/session-registry", () => ({ revokeUserSession }));

import { DELETE } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111106";
const SESSION_ID = "22222222-2222-4222-8222-222222222201";

function request(id: string) {
  return new NextRequest(`http://localhost/api/auth/sessions/${id}`, { method: "DELETE" });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserFromRequest.mockResolvedValue({ id: USER_ID });
  revokeUserSession.mockResolvedValue(true);
});

describe("DELETE /api/auth/sessions/[id]", () => {
  it("requires authentication", async () => {
    getUserFromRequest.mockResolvedValueOnce(null);
    const response = await DELETE(request(SESSION_ID), context(SESSION_ID));
    expect(response.status).toBe(401);
    expect(revokeUserSession).not.toHaveBeenCalled();
  });

  it("rejects malformed session identifiers", async () => {
    const response = await DELETE(request("not-a-uuid"), context("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(revokeUserSession).not.toHaveBeenCalled();
  });

  it("revokes only the requested session belonging to the current user", async () => {
    const response = await DELETE(request(SESSION_ID), context(SESSION_ID));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revokeUserSession).toHaveBeenCalledWith(SESSION_ID, USER_ID, "user_revoked_device");
  });

  it("returns 404 when the session is not owned or is already revoked", async () => {
    revokeUserSession.mockResolvedValueOnce(false);
    const response = await DELETE(request(SESSION_ID), context(SESSION_ID));
    expect(response.status).toBe(404);
  });
});
