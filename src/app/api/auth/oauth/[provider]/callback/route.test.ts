import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const state = {
    reads: {} as Record<string, Array<{ data: any; error: any }>>,
    writes: {} as Record<string, Array<{ data: any; error: any }>>,
    fromCalls: [] as string[],
    fetch: vi.fn(),
    createUser: vi.fn(),
    generateLink: vi.fn(),
    verifyOtp: vi.fn(),
    createUserSession: vi.fn(),
    setSessionRefreshJti: vi.fn(),
    createAccessToken: vi.fn(),
    createRefreshToken: vi.fn(),
    setSessionCookies: vi.fn(),
  };

  function take(queue: Record<string, Array<{ data: any; error: any }>>, table: string) {
    return queue[table]?.shift() ?? { data: null, error: null };
  }

  const from = vi.fn((table: string) => {
    state.fromCalls.push(table);
    let operation = "select";
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.neq = vi.fn(() => query);
    query.in = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.maybeSingle = vi.fn(async () => take(state.reads, table));
    query.single = vi.fn(async () => take(state.reads, table));
    query.insert = vi.fn(() => { operation = "write"; return query; });
    query.upsert = vi.fn(() => { operation = "write"; return query; });
    query.update = vi.fn(() => { operation = "write"; return query; });
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(operation === "select" ? take(state.reads, table) : take(state.writes, table)).then(resolve, reject);
    return query;
  });

  return { state, from };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: {
      admin: {
        createUser: mocks.state.createUser,
        generateLink: mocks.state.generateLink,
        deleteUser: vi.fn(),
      },
    },
  },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { verifyOtp: mocks.state.verifyOtp } })),
}));
vi.mock("@/lib/supabase/url", () => ({
  resolveSupabaseServerUrl: vi.fn(() => "https://supabase.conditera.test"),
}));
vi.mock("@/lib/auth", () => ({
  createAccessToken: mocks.state.createAccessToken,
  createRefreshToken: mocks.state.createRefreshToken,
}));
vi.mock("@/lib/session-cookies", () => ({
  setSessionCookies: mocks.state.setSessionCookies,
}));
vi.mock("@/lib/session-registry", () => ({
  createUserSession: mocks.state.createUserSession,
  setSessionRefreshJti: mocks.state.setSessionRefreshJti,
}));

import { GET } from "@/app/api/auth/oauth/[provider]/callback/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STATE = "state-callback-test";
const PROFILE = {
  id: USER_ID,
  email: "new.oauth@example.test",
  name: "Новый пользователь",
  account_type: "individual",
  is_blocked: false,
  deleted_at: null,
};

function responseJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

function queueNewCustomer() {
  mocks.state.reads = {
    oauth_identity_links: [{ data: null, error: null }],
    profiles: [{ data: null, error: null }, { data: PROFILE, error: null }],
    user_roles: [{ data: [], error: null }],
  };
  mocks.state.writes = {
    profiles: [{ data: PROFILE, error: null }],
    user_roles: [{ data: null, error: null }],
    user_consent_events: [{ data: null, error: null }],
    oauth_identity_links: [{ data: null, error: null }],
  };
  mocks.state.createUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.state.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hashed-magic-link" } }, error: null });
  mocks.state.verifyOtp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.state.createUserSession.mockResolvedValue("session-oauth-1");
  mocks.state.setSessionRefreshJti.mockResolvedValue(undefined);
  mocks.state.createAccessToken.mockResolvedValue("app-access-token");
  mocks.state.createRefreshToken.mockResolvedValue("app-refresh-token");
  mocks.state.setSessionCookies.mockImplementation((response: any) => response);
}

function callbackRequest(
  provider: "yandex" | "vk",
  options: { state?: string; cookieState?: string; extraQuery?: string; consent?: boolean } = {},
) {
  const queryState = options.state ?? STATE;
  const cookieState = options.cookieState ?? STATE;
  const consent = options.consent !== false;
  const cookies = [
    `oauth_state_${provider}=${cookieState}`,
    `oauth_verifier_${provider}=pkce-verifier-test`,
    `oauth_return_to_${provider}=%2Fdashboard%3Ftab%3Dorders`,
    `oauth_consent_pd_${provider}=${consent ? "1" : "0"}`,
    `oauth_consent_terms_${provider}=${consent ? "1" : "0"}`,
  ];
  const extra = options.extraQuery ? `&${options.extraQuery}` : "";
  return new NextRequest(
    `https://conditera.test/api/auth/oauth/${provider}/callback?code=provider-code&state=${queryState}${extra}`,
    { headers: { cookie: cookies.join("; "), "user-agent": "Conditera OAuth integration test", "x-forwarded-for": "192.0.2.10" } },
  );
}

describe("OAuth provider callbacks — Yandex ID and VK ID", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.conditera.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("YANDEX_CLIENT_ID", "yandex-client-id");
    vi.stubEnv("YANDEX_OAUTH_REDIRECT", "https://app.conditera.test/api/auth/oauth/yandex/callback");
    vi.stubEnv("VK_CLIENT_ID", "vk-client-id");
    vi.stubEnv("VK_OAUTH_REDIRECT", "https://app.conditera.test/api/auth/oauth/vk/callback");
    mocks.state.fromCalls = [];
    mocks.state.fetch.mockReset();
    mocks.state.createUser.mockReset();
    mocks.state.generateLink.mockReset();
    mocks.state.verifyOtp.mockReset();
    mocks.state.createUserSession.mockReset();
    mocks.state.setSessionRefreshJti.mockReset();
    mocks.state.createAccessToken.mockReset();
    mocks.state.createRefreshToken.mockReset();
    mocks.state.setSessionCookies.mockReset();
    vi.stubGlobal("fetch", mocks.state.fetch);
    queueNewCustomer();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("завершает новый вход через Yandex ID: PKCE, отдельные согласия, профиль и app-JWT", async () => {
    mocks.state.fetch
      .mockResolvedValueOnce(responseJson({ access_token: "yandex-access" }))
      .mockResolvedValueOnce(responseJson({
        id: "yandex-subject-77",
        default_email: "new.oauth@example.test",
        real_name: "Новый пользователь",
        display_name: "Новый пользователь",
        is_avatar_empty: true,
      }));

    const response = await GET(callbackRequest("yandex"), {
      params: Promise.resolve({ provider: "yandex" }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.conditera.test/dashboard?tab=orders");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.state.fetch).toHaveBeenCalledTimes(2);
    const tokenRequest = mocks.state.fetch.mock.calls[0][1] as RequestInit;
    expect(String(tokenRequest.body)).toContain("code_verifier=pkce-verifier-test");
    expect(String(tokenRequest.body)).toContain("client_id=yandex-client-id");
    expect(mocks.state.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "new.oauth@example.test",
      email_confirm: true,
    }));
    expect(mocks.state.fromCalls).toContain("user_consent_events");
    expect(mocks.state.fromCalls).toContain("oauth_identity_links");
    expect(mocks.state.createUserSession).toHaveBeenCalledWith(USER_ID, expect.any(NextRequest), "oauth");
    expect(mocks.state.setSessionRefreshJti).toHaveBeenCalledWith("session-oauth-1", USER_ID, expect.any(String));
    expect(mocks.state.createAccessToken).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, sid: "session-oauth-1" }));
    expect(mocks.state.setSessionCookies).toHaveBeenCalled();
    expect(response.cookies.get("oauth_state_yandex")?.value).toBe("");
  });

  it("завершает новый вход через VK ID и сверяет state и provider user_id", async () => {
    mocks.state.fetch
      .mockResolvedValueOnce(responseJson({
        access_token: "vk-access",
        user_id: "vk-subject-91",
        state: STATE,
      }))
      .mockResolvedValueOnce(responseJson({
        user: {
          user_id: "vk-subject-91",
          email: "new.oauth@example.test",
          first_name: "Новый",
          last_name: "Пользователь",
        },
      }));

    const response = await GET(callbackRequest("vk", { extraQuery: "device_id=vk-device-1" }), {
      params: Promise.resolve({ provider: "vk" }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.conditera.test/dashboard?tab=orders");
    expect(mocks.state.fetch).toHaveBeenCalledTimes(2);
    const tokenUrl = String(mocks.state.fetch.mock.calls[0][0]);
    const tokenRequest = mocks.state.fetch.mock.calls[0][1] as RequestInit;
    expect(tokenUrl).toContain("device_id=vk-device-1");
    expect(tokenUrl).toContain("code_verifier=pkce-verifier-test");
    expect(String(tokenRequest.body)).toBe("code=provider-code");
    const profileRequest = mocks.state.fetch.mock.calls[1][1] as RequestInit;
    expect(String(profileRequest.body)).toContain("access_token=vk-access");
    expect(mocks.state.createUserSession).toHaveBeenCalledWith(USER_ID, expect.any(NextRequest), "oauth");
    expect(mocks.state.setSessionCookies).toHaveBeenCalled();
    expect(response.cookies.get("oauth_state_vk")?.value).toBe("");
  });

  it("отклоняет несовпадающий state до обращения к провайдеру", async () => {
    const response = await GET(callbackRequest("yandex", { cookieState: "different-state" }), {
      params: Promise.resolve({ provider: "yandex" }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login?");
    expect(response.headers.get("location")).toContain("oauthError=");
    expect(mocks.state.fetch).not.toHaveBeenCalled();
    expect(mocks.state.createUser).not.toHaveBeenCalled();
    expect(response.cookies.get("oauth_state_yandex")?.value).toBe("");
  });

  it("не создаёт аккаунт без обоих обязательных согласий", async () => {
    mocks.state.fetch
      .mockResolvedValueOnce(responseJson({ access_token: "yandex-access" }))
      .mockResolvedValueOnce(responseJson({
        id: "yandex-subject-77",
        default_email: "new.oauth@example.test",
        real_name: "Новый пользователь",
        is_avatar_empty: true,
      }));

    const response = await GET(callbackRequest("yandex", { consent: false }), {
      params: Promise.resolve({ provider: "yandex" }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login?");
    expect(mocks.state.createUser).not.toHaveBeenCalled();
    expect(mocks.state.createUserSession).not.toHaveBeenCalled();
  });
});
