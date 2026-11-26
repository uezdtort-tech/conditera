import { describe, expect, it } from "vitest";
import {
  canTransitionOrderDispute,
  isTerminalOrderDisputeStatus,
} from "./order-dispute-state";

describe("order dispute state machine", () => {
  it("allows only the declared forward transitions", () => {
    expect(canTransitionOrderDispute("open", "under_review")).toBe(true);
    expect(canTransitionOrderDispute("under_review", "awaiting_customer")).toBe(true);
    expect(canTransitionOrderDispute("under_review", "resolved")).toBe(true);
    expect(canTransitionOrderDispute("awaiting_customer", "under_review")).toBe(true);
  });

  it("rejects reopening terminal disputes and unknown states", () => {
    expect(canTransitionOrderDispute("resolved", "under_review")).toBe(false);
    expect(canTransitionOrderDispute("rejected", "open")).toBe(false);
    expect(canTransitionOrderDispute("open", "resolved")).toBe(false);
    expect(canTransitionOrderDispute("unknown", "under_review")).toBe(false);
  });

  it("identifies terminal states", () => {
    expect(isTerminalOrderDisputeStatus("resolved")).toBe(true);
    expect(isTerminalOrderDisputeStatus("rejected")).toBe(true);
    expect(isTerminalOrderDisputeStatus("under_review")).toBe(false);
  });
});
