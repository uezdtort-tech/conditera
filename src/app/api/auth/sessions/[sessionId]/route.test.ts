import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUserFromRequest: vi.fn(),
  verifyAccessToken: vi.fn(),
  revokeUserSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: mocks.getUserFromRequest,
  verifyAccessToken: mocks.verifyAccessToken,
}));
vi.mock("@/lib/session-registry", () => ({
  revokeUserSession: mocks.revokeUserSession,
}));

import { DELETE } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111106";
const CURRENT_SESSION_ID = "22222222-2222-4222-8222-222222222201";
const OTHER_SESSION_ID = "33333333-3333-4333-8333-333333333301";

function request(sessionId: string) {
  return new NextRequest(`http://localhost/api/auth/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { authorization: "Bearer access-token" },
  });
}

function context(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserFromRequest.mockResolvedValue({ id: USER_ID });
  mocks.verifyAccessToken.mockResolvedValue({ userId: USER_ID, sid: CURRENT_SESSION_ID });
  mocks.revokeUserSession.mockResolvedValue(true);
});

describe("DELETE /api/auth/sessions/[sessionId]", () => {
  it("requires an authenticated user", async () => {
    mocks.getUserFromRequest.mockResolvedValueOnce(null);
    const response = await DELETE(request(OTHER_SESSION_ID), context(OTHER_SESSION_ID));
    expect(response.status).toBe(401);
    expect(mocks.revokeUserSession).not.toHaveBeenCalled();
  });

  it("requires a verified active session belonging to the user", async () => {
    mocks.verifyAccessToken.mockResolvedValueOnce(null);
    const response = await DELETE(request(OTHER_SESSION_ID), context(OTHER_SESSION_ID));
    expect(response.status).toBe(401);
    expect(mocks.revokeUserSession).not.toHaveBeenCalled();
  });

  it("rejects malformed session identifiers", async () => {
    const response = await DELETE(request("bad-id"), context("bad-id"));
    expect(response.status).toBe(400);
    expect(mocks.revokeUserSession).not.toHaveBeenCalled();
  });

  it("does not allow revoking the current session through device management", async () => {
    const response = await DELETE(request(CURRENT_SESSION_ID), context(CURRENT_SESSION_ID));
    expect(response.status).toBe(409);
    expect(mocks.revokeUserSession).not.toHaveBeenCalled();
  });

  it("revokes only the requested session belonging to the current user", async () => {
    const response = await DELETE(request(OTHER_SESSION_ID), context(OTHER_SESSION_ID));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: OTHER_SESSION_ID });
    expect(mocks.revokeUserSession).toHaveBeenCalledWith(
      OTHER_SESSION_ID,
      USER_ID,
      "user_revoked_session",
    );
  });

  it("returns 404 when the session is not owned or is already revoked", async () => {
    mocks.revokeUserSession.mockResolvedValueOnce(false);
    const response = await DELETE(request(OTHER_SESSION_ID), context(OTHER_SESSION_ID));
    expect(response.status).toBe(404);
  });
});
