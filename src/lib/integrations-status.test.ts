import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getIntegrationsStatus, countConfiguredIntegrations } from "./integrations-status";

const ENV_KEYS = [
  "YANDEX_CLIENT_ID",
  "YANDEX_OAUTH_REDIRECT",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT",
  "VK_CLIENT_ID",
  "VK_OAUTH_REDIRECT",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "TELEGRAM_BOT_TOKEN",
] as const;

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("integrations-status", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) setEnv(key, saved[key]);
  });

  it("reports every integration as not configured when env is empty", () => {
    const status = getIntegrationsStatus();
    expect(status.oauth).toEqual({ yandex: false, google: false, vk: false });
    expect(status.email).toBe(false);
    expect(status.telegram).toBe(false);
    expect(countConfiguredIntegrations(status)).toBe(0);
  });

  it("requires the complete Yandex and SMTP configuration", () => {
    process.env.YANDEX_CLIENT_ID = "yandex-client-id";
    process.env.YANDEX_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/yandex/callback";
    process.env.SMTP_HOST = "mail.conditera.ru";
    process.env.SMTP_USER = "noreply@conditera.ru";
    process.env.SMTP_PASSWORD = "smtp-password-fixture";
    process.env.SMTP_FROM = "noreply@conditera.ru";

    const status = getIntegrationsStatus();
    expect(status.oauth.yandex).toBe(true);
    expect(status.oauth.google).toBe(false);
    expect(status.oauth.vk).toBe(false);
    expect(status.email).toBe(true);
    expect(countConfiguredIntegrations(status)).toBe(2);
  });

  it("reports VK ID configured only when both client id and callback are present", () => {
    process.env.VK_CLIENT_ID = "vk-client-id";
    expect(getIntegrationsStatus().oauth.vk).toBe(false);

    process.env.VK_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/vk/callback";
    expect(getIntegrationsStatus().oauth.vk).toBe(true);
  });

  it("requires Google client id, client secret and callback", () => {
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/google/callback";
    expect(getIntegrationsStatus().oauth.google).toBe(false);

    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-fixture";
    expect(getIntegrationsStatus().oauth.google).toBe(true);
  });

  it("treats empty and placeholder values as not configured", () => {
    process.env.YANDEX_CLIENT_ID = "   ";
    process.env.YANDEX_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/yandex/callback";
    process.env.GOOGLE_CLIENT_ID = "stub_placeholder";
    process.env.GOOGLE_CLIENT_SECRET = "real-secret";
    process.env.GOOGLE_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/google/callback";
    process.env.VK_CLIENT_ID = "CHANGE_ME_VK_CLIENT_ID";
    process.env.VK_OAUTH_REDIRECT = "https://conditera.ru/api/auth/oauth/vk/callback";
    const status = getIntegrationsStatus();

    expect(status.oauth).toEqual({ yandex: false, google: false, vk: false });
  });

  it("does not expose secret values in the returned status", () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:TOPSECRET_TEST";
    process.env.SMTP_PASSWORD = "SMTP_TEST_TOPSECRET";
    const status = getIntegrationsStatus() as unknown as Record<string, unknown>;

    expect(JSON.stringify(status)).not.toContain("TOPSECRET");
  });
});
