import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyWebhook } from "@/lib/yookassa";

function request(headers: Record<string, string> = {}) {
  return new Request("https://conditera.test/api/payment/webhook", { headers });
}

describe("YooKassa webhook source verification", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    vi.stubEnv("E2E_PAYMENT_STUB_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://conditera.test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("принимает адрес из опубликованного диапазона YooKassa", () => {
    expect(verifyWebhook(request({ "x-real-ip": "185.71.76.13" }))).toBe(true);
    expect(verifyWebhook(request({ "x-real-ip": "77.75.156.11" }))).toBe(true);
    expect(verifyWebhook(request({ "x-real-ip": "2a02:5180::1" }))).toBe(true);
  });

  it("отклоняет адрес вне диапазонов YooKassa и не доверяет поддельному XFF при наличии X-Real-IP", () => {
    expect(verifyWebhook(request({ "x-real-ip": "8.8.8.8" }))).toBe(false);
    expect(verifyWebhook(request({
      "x-real-ip": "8.8.8.8",
      "x-forwarded-for": "185.71.76.13",
    }))).toBe(false);
  });

  it("отклоняет webhook без IP-адреса", () => {
    expect(verifyWebhook(request())).toBe(false);
  });

  it("выбирает адрес из XFF по числу доверенных proxy hops", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(verifyWebhook(request({
      "x-forwarded-for": "198.51.100.20, 185.71.76.14, 10.0.0.5",
    }))).toBe(true);
    expect(verifyWebhook(request({
      "x-forwarded-for": "185.71.76.14, 198.51.100.20, 10.0.0.5",
    }))).toBe(false);
  });

  it("не применяет production IP allowlist в development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(verifyWebhook(request({ "x-real-ip": "8.8.8.8" }))).toBe(true);
  });
});
