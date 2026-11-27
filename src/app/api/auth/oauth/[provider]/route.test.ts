import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/auth/oauth/[provider]/route";

function request(provider: string, query = "") {
  return new NextRequest(
    `https://conditera.test/api/auth/oauth/${provider}${query ? `?${query}` : ""}`,
  );
}

describe("OAuth initiation — Yandex ID and VK ID", () => {
  beforeEach(() => {
    vi.stubEnv("YANDEX_CLIENT_ID", "yandex-client-id");
    vi.stubEnv("YANDEX_OAUTH_REDIRECT", "https://app.conditera.test/api/auth/oauth/yandex/callback");
    vi.stubEnv("VK_CLIENT_ID", "vk-client-id");
    vi.stubEnv("VK_OAUTH_REDIRECT", "https://app.conditera.test/api/auth/oauth/vk/callback");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("создаёт Yandex authorization URL с PKCE S256, state и отдельными согласиями", async () => {
    const response = await GET(request("yandex", "returnTo=%2Fdashboard%3Ftab%3Dorders&consentPd=1&consentTerms=1"), {
      params: Promise.resolve({ provider: "yandex" }),
    });
    const location = new URL(response.headers.get("location") || "");

    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://oauth.yandex.ru/authorize");
    expect(location.searchParams.get("client_id")).toBe("yandex-client-id");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("scope")).toContain("login:email");
    expect(response.cookies.get("oauth_state_yandex")?.value).toBe(location.searchParams.get("state"));
    expect(response.cookies.get("oauth_verifier_yandex")?.value).toBeTruthy();
    expect(decodeURIComponent(response.cookies.get("oauth_return_to_yandex")?.value || "")).toBe("/dashboard?tab=orders");
    expect(response.cookies.get("oauth_consent_pd_yandex")?.value).toBe("1");
    expect(response.cookies.get("oauth_consent_terms_yandex")?.value).toBe("1");
  });

  it("создаёт VK ID authorization URL с device-flow PKCE и state", async () => {
    const response = await GET(request("vk", "returnTo=%2Fdashboard"), {
      params: Promise.resolve({ provider: "vk" }),
    });
    const location = new URL(response.headers.get("location") || "");

    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://id.vk.ru/authorize");
    expect(location.searchParams.get("client_id")).toBe("vk-client-id");
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("scope")).toBe("email");
    expect(response.cookies.get("oauth_state_vk")?.value).toBe(location.searchParams.get("state"));
    expect(response.cookies.get("oauth_verifier_vk")?.value).toBeTruthy();
    expect(decodeURIComponent(response.cookies.get("oauth_return_to_vk")?.value || "")).toBe("/dashboard");
  });

  it("не принимает внешний returnTo и возвращает пользователя только на внутренний dashboard", async () => {
    const response = await GET(request("yandex", "returnTo=%2F%2Fevil.example%2Fsteal"), {
      params: Promise.resolve({ provider: "yandex" }),
    });

    expect(response.status).toBe(302);
    expect(decodeURIComponent(response.cookies.get("oauth_return_to_yandex")?.value || "")).toBe("/dashboard");
  });

  it("режим check сообщает, настроен ли провайдер, без запуска OAuth", async () => {
    const configured = await GET(request("vk", "mode=check"), {
      params: Promise.resolve({ provider: "vk" }),
    });
    expect(configured.status).toBe(200);
    expect(await configured.json()).toEqual({ provider: "vk", configured: true });

    vi.stubEnv("VK_CLIENT_ID", "stub_vk_client");
    const notConfigured = await GET(request("vk", "mode=check"), {
      params: Promise.resolve({ provider: "vk" }),
    });
    expect(await notConfigured.json()).toEqual({ provider: "vk", configured: false });
  });

  it("возвращает безопасные ошибки для неподдерживаемого и ненастроенного провайдера", async () => {
    const unsupported = await GET(request("unknown"), {
      params: Promise.resolve({ provider: "unknown" }),
    });
    expect(unsupported.status).toBe(400);

    vi.stubEnv("YANDEX_CLIENT_ID", "stub_yandex_client");
    const unconfigured = await GET(request("yandex"), {
      params: Promise.resolve({ provider: "yandex" }),
    });
    expect(unconfigured.status).toBe(501);
  });
});
