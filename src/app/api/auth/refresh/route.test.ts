/**
 * route.test.ts — ZV33-8d FIX A (D1): POST /api/auth/refresh не продлевает
 * сессию заблокированного пользователя и чистит сессионные cookie.
 *
 * Лочит:
 *   • blocked profile → 403 {"error":"ACCOUNT_BLOCKED","message":"Аккаунт
 *     заблокирован"} + cd_session/cd_refresh очищены (Max-Age=0), НОВЫЙ токен
 *     НЕ выпускается;
 *   • активный профиль → 200 { accessToken } (роли из user_roles, is_active).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "11111111-1111-4111-8111-111111111106";
const REFRESH_TOKEN = "test-refresh-fixture-token";

type Row = Record<string, unknown>;

let profile: Row | null = {
  id: USER_ID,
  email: "customer@demo.ru",
  name: "Ольга Демо",
  is_blocked: false,
  account_type: "B2C",
};
let roles: string[] = ["CUSTOMER"];

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  getClientIP: () => "127.0.0.1",
}));

vi.mock("@/lib/http-helpers", () => ({
  safeJsonBody: vi.fn(async (req: Request) => {
    const text = await req.text();
    try {
      return { data: JSON.parse(text) };
    } catch {
      return { data: null };
    }
  }),
}));

vi.mock("@/lib/auth", () => ({
  verifyRefreshToken: vi.fn(async (token: string) =>
    token === REFRESH_TOKEN ? { userId: USER_ID } : null
  ),
  createAccessToken: vi.fn(async (payload: { userId: string; roles: string[] }) => {
    expect(payload.userId).toBe(USER_ID);
    return "new-access-token";
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      const chain = () => api;
      Object.assign(api, {
        select: chain,
        eq: chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "profiles" ? profile : null,
            error: null,
          }),
        then: (
          onFulfilled: (v: { data: unknown; error: null }) => unknown,
          onRejected?: (e: unknown) => unknown
        ) =>
          Promise.resolve({
            data: table === "user_roles" ? roles.map((role) => ({ role })) : [],
            error: null,
          }).then(onFulfilled, onRejected),
        catch: (onRejected: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).catch(onRejected),
      });
      return api;
    },
  },
}));

import { POST } from "./route";

function refreshReq(): Promise<Response> {
  const req = new NextRequest("http://localhost/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: REFRESH_TOKEN }),
  });
  return POST(req) as unknown as Promise<Response>;
}

beforeEach(() => {
  profile = {
    id: USER_ID,
    email: "customer@demo.ru",
    name: "Ольга Демо",
    is_blocked: false,
    account_type: "B2C",
  };
  roles = ["CUSTOMER"];
});

describe("POST /api/auth/refresh — ZV33-8d FIX A (D1)", () => {
  it("заблокированный профиль → 403 ACCOUNT_BLOCKED, токен НЕ выпущен, cookie очищены", async () => {
    profile = { ...profile!, is_blocked: true };
    const res = await refreshReq();
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: string;
      message: string;
      accessToken?: string;
    };
    expect(body.error).toBe("ACCOUNT_BLOCKED");
    expect(body.message).toBe("Аккаунт заблокирован");
    expect(body.accessToken).toBeUndefined();

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("cd_session=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("cd_refresh=;") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("активный профиль → 200 { accessToken } с ролями из user_roles", async () => {
    roles = ["CUSTOMER", "CONFECTIONER"];
    const res = await refreshReq();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string };
    expect(body.accessToken).toBe("new-access-token");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
