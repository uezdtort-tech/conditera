import { describe, expect, it } from "vitest";
import { shouldSkipFinalPaymentWebhook } from "./payment-webhook-idempotency";

describe("payment webhook final replay policy", () => {
  it("acknowledges duplicate non-success final events with the same persisted status", () => {
    expect(shouldSkipFinalPaymentWebhook("payment.canceled", "cancelled", "cancelled")).toBe(true);
  });

  it("does not skip payment.succeeded or refund.succeeded before compensation checks", () => {
    expect(shouldSkipFinalPaymentWebhook("payment.succeeded", "succeeded", "succeeded")).toBe(false);
    expect(shouldSkipFinalPaymentWebhook("refund.succeeded", "refunded", "refunded")).toBe(false);
  });

  it("does not skip a changed state or a non-final state", () => {
    expect(shouldSkipFinalPaymentWebhook("payment.canceled", "succeeded", "cancelled")).toBe(false);
    expect(shouldSkipFinalPaymentWebhook("payment.waiting_for_capture", "pending", "pending")).toBe(false);
    expect(shouldSkipFinalPaymentWebhook("payment.canceled", "cancelled", "succeeded")).toBe(false);
  });
});
