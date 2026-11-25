import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const env = process.env as Record<string, string | undefined>;
const keys = ["NODE_ENV", "VK_CLIENT_ID", "VK_OAUTH_REDIRECT", "NEXT_PUBLIC_APP_URL"] as const;
const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = saved[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe("VK ID OAuth initiation", () => {
  function configureVk(clientId = "vk-client-12345") {
    env.NODE_ENV = "production";
    env.VK_CLIENT_ID = clientId;
    env.VK_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/vk/callback";
    env.NEXT_PUBLIC_APP_URL = "https://conditera.ru";
  }

  it("creates a VK ID authorization redirect with state and S256 PKCE", async () => {
    configureVk();

    const request = new NextRequest(
      "https://conditera.ru/api/auth/oauth/vk?returnTo=%2Faccount&consentPd=1&consentTerms=1"
    );
    const response = await GET(request, {
      params: Promise.resolve({ provider: "vk" }),
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") || "");
    expect(location.origin).toBe("https://id.vk.ru");
    expect(location.pathname).toBe("/authorize");
    expect(location.searchParams.get("client_id")).toBe("vk-client-12345");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://conditera.ru/api/auth/oauth/vk/callback"
    );
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("vkid.personal_info email");
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");

    const state = response.cookies.get("oauth_state_vk")?.value;
    const verifier = response.cookies.get("oauth_verifier_vk")?.value;
    expect(state).toBeTruthy();
    expect(state).toBe(location.searchParams.get("state"));
    expect(verifier).toBeTruthy();
    expect(location.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier || "").digest("base64url")
    );
    expect(response.cookies.get("oauth_return_to_vk")?.value).toBe("/account");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("reports configured only when real VK credentials are present", async () => {
    configureVk();
    const request = new NextRequest(
      "https://conditera.ru/api/auth/oauth/vk?mode=check"
    );
    const response = await GET(request, {
      params: Promise.resolve({ provider: "vk" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: "vk", configured: true });
  });

  it("does not treat template placeholders as configured credentials", async () => {
    configureVk("CHANGE_ME_VK_CLIENT_ID");
    const request = new NextRequest("https://conditera.ru/api/auth/oauth/vk");
    const response = await GET(request, {
      params: Promise.resolve({ provider: "vk" }),
    });

    expect(response.status).toBe(501);
    expect((await response.json()).configured).not.toBe(true);
  });
});
