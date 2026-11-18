import { expect, test } from "@playwright/test";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";

const providers = [
  {
    id: "yandex",
    authorizeOrigin: "https://oauth.yandex.ru",
    callback: "https://conditera.ru/api/auth/oauth/yandex/callback",
    challengeMethod: "S256",
  },
  {
    id: "vk",
    authorizeOrigin: "https://id.vk.ru",
    callback: "https://conditera.ru/api/auth/oauth/vk/callback",
    challengeMethod: "s256",
  },
  {
    id: "google",
    authorizeOrigin: "https://accounts.google.com",
    callback: "https://conditera.ru/api/auth/oauth/google/callback",
    challengeMethod: "S256",
  },
] as const;

test.describe("OAuth providers", () => {
  for (const provider of providers) {
    test(provider.id + " reports configured and starts Authorization Code + PKCE", async ({ request }) => {
      const check = await request.get(baseUrl + "/api/auth/oauth/" + provider.id + "?mode=check");
      expect(check.status()).toBe(200);
      expect((await check.json()).configured).toBe(true);

      const response = await request.get(
        baseUrl + "/api/auth/oauth/" + provider.id +
          "?returnTo=%2Fdashboard%2Forders&consentPd=1&consentTerms=1",
        { maxRedirects: 0 }
      );
      expect(response.status()).toBe(302);

      const location = response.headers()["location"];
      expect(location).toBeTruthy();
      const authorizeUrl = new URL(location);
      expect(authorizeUrl.origin).toBe(provider.authorizeOrigin);
      expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(provider.callback);
      expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
      expect(authorizeUrl.searchParams.get("state")).toBeTruthy();
      expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
      expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe(provider.challengeMethod);

      const setCookies = (await response.headersArray())
        .filter((header) => header.name.toLowerCase() === "set-cookie")
        .map((header) => header.value)
        .join("\n");
      expect(setCookies).toContain("oauth_state_" + provider.id);
      expect(setCookies).toContain("oauth_return_to_" + provider.id);
      expect(setCookies).toContain("oauth_verifier_" + provider.id);
      expect(setCookies).toContain("oauth_consent_pd_" + provider.id);
      expect(setCookies).toContain("oauth_consent_terms_" + provider.id);
    });
  }

  test("rejects an external returnTo and falls back to the dashboard", async ({ request }) => {
    const response = await request.get(
      baseUrl + "/api/auth/oauth/yandex?returnTo=https%3A%2F%2Fevil.example",
      { maxRedirects: 0 }
    );
    expect(response.status()).toBe(302);
    const cookies = (await response.headersArray())
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value);
    const returnToCookie = cookies.find((value) => value.includes("oauth_return_to_yandex"));
    expect(returnToCookie).toContain("%2Fdashboard");
  });

  test("returns provider cancellation to the login page", async ({ request }) => {
    const response = await request.get(
      baseUrl + "/api/auth/oauth/yandex/callback?error=access_denied",
      { maxRedirects: 0 }
    );
    expect(response.status()).toBe(302);
    const location = new URL(response.headers()["location"]);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("oauthError")).toBeTruthy();
  });

  test("rejects callback without matching state before contacting provider", async ({ request }) => {
    const response = await request.get(
      baseUrl + "/api/auth/oauth/yandex/callback?code=fake-code&state=wrong-state",
      { maxRedirects: 0 }
    );
    expect(response.status()).toBe(302);
    const location = new URL(response.headers()["location"]);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("oauthError")).toContain("state");
  });
});
