import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getIntegrationsStatus, countConfiguredIntegrations } from "./integrations-status";

/**
 * Контракт статусов интеграций (дополнение к master prompt §9):
 *  - учитывается только НАЛИЧИЕ переменной, значение никогда не раскрывается;
 *  - пустая строка и префикс "stub_" = NOT_CONFIGURED (как в OAuth-роуте).
 */
const ENV_KEYS = [
  "YANDEX_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "VK_CLIENT_ID",
  "SMTP_HOST",
  "TELEGRAM_BOT_TOKEN",
] as const;

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("integrations-status", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) setEnv(k, saved[k]);
  });

  it("все NOT_CONFIGURED, когда env пуст", () => {
    const s = getIntegrationsStatus();
    expect(s.oauth).toEqual({ yandex: false, google: false, vk: false });
    expect(s.email).toBe(false);
    expect(s.telegram).toBe(false);
    expect(countConfiguredIntegrations(s)).toBe(0);
  });

  it("настроенные провайдеры детектируются по наличию значения", () => {
    process.env.YANDEX_CLIENT_ID = "secret-value-never-logged";
    process.env.SMTP_HOST = "mail.example.test";
    const s = getIntegrationsStatus();
    expect(s.oauth.yandex).toBe(true);
    expect(s.oauth.google).toBe(false);
    expect(s.email).toBe(true);
    expect(countConfiguredIntegrations(s)).toBe(2);
  });

  it("пустая строка и stub_* считаются NOT_CONFIGURED", () => {
    process.env.YANDEX_CLIENT_ID = "   ";
    process.env.GOOGLE_CLIENT_ID = "stub_placeholder";
    process.env.VK_CLIENT_ID = "stub_x";
    const s = getIntegrationsStatus();
    expect(s.oauth).toEqual({ yandex: false, google: false, vk: false });
  });

  it("значения секретов не попадают в результат", () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:TOPSECRET";
    const s = getIntegrationsStatus() as unknown as Record<string, unknown>;
    expect(JSON.stringify(s)).not.toContain("TOPSECRET");
  });
});
