/**
 * route.test.ts — ZV33-8d FIX A (D1): GET /api/auth/session не поддерживает
 * сессию заблокированного пользователя.
 *
 * Лочит:
 *   • blocked profile (cd_session) → 403 {"error":"ACCOUNT_BLOCKED"} без
 *     accessToken + сессионные cookie очищены (cd_session и cd_refresh,
 *     Max-Age=0);
 *   • активный профиль → 200 { user, accessToken, sessionMode: "app" } как
 *     раньше (имя из профиля — источник истины);
 *   • нет cookie → 200 { user: null }.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "11111111-1111-4111-8111-111111111106";
const TOKEN = "header.payload.sig";

type Row = Record<string, unknown>;

let profile: Row | null = { id: USER_ID, name: "Ольга Демо", is_blocked: false };

vi.mock("@/lib/auth", () => ({
  verifyAccessToken: vi.fn(async (token: string) =>
    token === TOKEN ? { userId: USER_ID, email: "customer@demo.ru", roles: ["CUSTOMER"] } : null
  ),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "profiles") {
        throw new Error(`unexpected table ${table}`);
      }
      const api: Record<string, unknown> = {};
      const chain = () => api;
      Object.assign(api, {
        select: chain,
        eq: chain,
        maybeSingle: () => Promise.resolve({ data: profile, error: null }),
      });
      return api;
    },
  },
}));

import { GET } from "./route";

function sessionReq(withCookie: boolean): Promise<Response> {
  const req = new NextRequest("http://localhost/api/auth/session", {
    method: "GET",
    headers: withCookie ? { cookie: `cd_session=${TOKEN}` } : {},
  });
  return GET(req) as unknown as Promise<Response>;
}

beforeEach(() => {
  profile = { id: USER_ID, name: "Ольга Демо", is_blocked: false };
});

describe("GET /api/auth/session — ZV33-8d FIX A (D1)", () => {
  it("заблокированный профиль → 403 ACCOUNT_BLOCKED, БЕЗ accessToken, cookie очищены", async () => {
    profile = { id: USER_ID, name: "Ольга Демо", is_blocked: true };
    const res = await sessionReq(true);
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: string;
      message: string;
      accessToken?: string;
    };
    expect(body.error).toBe("ACCOUNT_BLOCKED");
    expect(body.message).toBe("Аккаунт заблокирован");
    expect(body.accessToken).toBeUndefined();

    // Сессионные cookie очищены (обе, Max-Age=0)
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("cd_session=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("cd_refresh=;") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("активный профиль → 200 { user, accessToken, sessionMode:'app' } как раньше", async () => {
    const res = await sessionReq(true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; name: string; roles: string[] };
      accessToken: string;
      sessionMode: string;
    };
    expect(body.user.id).toBe(USER_ID);
    expect(body.user.name).toBe("Ольга Демо"); // имя из профиля — источник истины
    expect(body.user.roles).toEqual(["CUSTOMER"]);
    expect(body.accessToken).toBe(TOKEN);
    expect(body.sessionMode).toBe("app");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("нет cd_session → 200 { user: null }", async () => {
    const res = await sessionReq(false);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: unknown }).user).toBeNull();
  });
});
