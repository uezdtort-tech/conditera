import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
});

describe("VK ID OAuth callback", () => {
  it("rejects a mismatched state before exchanging the authorization code", async () => {
    env.NODE_ENV = "production";
    env.VK_CLIENT_ID = "vk-client-12345";
    env.VK_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/vk/callback";
    env.NEXT_PUBLIC_APP_URL = "https://conditera.ru";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const request = new NextRequest(
      "https://conditera.ru/api/auth/oauth/vk/callback?code=authorization-code&state=attacker-state&device_id=device-123"
    );
    request.cookies.set("oauth_state_vk", "expected-state");
    request.cookies.set("oauth_verifier_vk", "valid-pkce-verifier");
    request.cookies.set("oauth_return_to_vk", "%2Faccount");

    const response = await GET(request, {
      params: Promise.resolve({ provider: "vk" }),
    });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/login");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("oauth_state_vk=");
  });

  it("handles provider cancellation without calling token endpoints", async () => {
    env.NODE_ENV = "production";
    env.VK_CLIENT_ID = "vk-client-12345";
    env.VK_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/vk/callback";
    env.NEXT_PUBLIC_APP_URL = "https://conditera.ru";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const request = new NextRequest(
      "https://conditera.ru/api/auth/oauth/vk/callback?error=access_denied"
    );
    request.cookies.set("oauth_return_to_vk", "%2Faccount");

    const response = await GET(request, {
      params: Promise.resolve({ provider: "vk" }),
    });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/login");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
