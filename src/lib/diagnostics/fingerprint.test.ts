/**
 * Тесты fingerprint.ts — стабильная группировка повторяющихся ошибок
 * (DEPLOY-01 §3.1 fingerprint, §4 объединение повторов).
 */
import { describe, it, expect } from "vitest";
import { computeFingerprint, normalizeMessage } from "./fingerprint";

describe("normalizeMessage", () => {
  it("вырезает UUID", () => {
    const out = normalizeMessage("Order 550e8400-e29b-41d4-a716-446655440000 not found");
    expect(out).toContain("<uuid>");
    expect(out).not.toContain("550e8400");
  });

  it("вырезает длинные числа", () => {
    expect(normalizeMessage("payment 123456789 failed")).toContain("<num>");
    expect(normalizeMessage("payment 123456789 failed")).not.toContain("123456789");
  });

  it("вырезает hex-хэши", () => {
    const out = normalizeMessage("checksum a1b2c3d4e5f6a7b8c9d0 mismatch");
    expect(out).toContain("<hex>");
  });

  it("схлопывает пробелы и приводит к нижнему регистру", () => {
    expect(normalizeMessage("Some   UPPER   message")).toBe("some upper message");
  });
});

describe("computeFingerprint", () => {
  it("одна и та же ошибка → один fingerprint", () => {
    const a = computeFingerprint({
      component: "payments",
      errorCode: "WEBHOOK_VERIFY",
      message: "webhook verification failed for payment 987654",
      route: "/api/payment/webhook",
    });
    const b = computeFingerprint({
      component: "payments",
      errorCode: "WEBHOOK_VERIFY",
      message: "webhook verification failed for payment 123456",
      route: "/api/payment/webhook",
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(40);
  });

  it("разные компоненты → разные fingerprint", () => {
    const a = computeFingerprint({ component: "payments", message: "failed" });
    const b = computeFingerprint({ component: "orders", message: "failed" });
    expect(a).not.toBe(b);
  });

  it("разные severity не влияют (fingerprint только по содержимому)", () => {
    const a = computeFingerprint({ component: "api", message: "db timeout" });
    const b = computeFingerprint({ component: "api", message: "db timeout" });
    expect(a).toBe(b);
  });

  it("динамика в route не меняет fingerprint", () => {
    const a = computeFingerprint({
      component: "api",
      message: "not found",
      route: "/api/orders/550e8400-e29b-41d4-a716-446655440000",
    });
    const b = computeFingerprint({
      component: "api",
      message: "not found",
      route: "/api/orders/12345678",
    });
    expect(a).toBe(b);
  });
});
