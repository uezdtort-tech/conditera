import { describe, expect, it } from "vitest";
import { isConfiguredValue, isPlaceholderValue } from "./placeholder-value";

describe("placeholder environment values", () => {
  it.each([
    undefined,
    null,
    "",
    "   ",
    "stub-client-id",
    "stub_client_id",
    "CHANGE_ME_CLIENT_ID",
    "fallback-client-id",
    "dev_client_id",
    "placeholder-client-id",
    "example-client-id",
    "dummy-client-id",
    "test-client-id",
  ])("rejects placeholder %s", (value) => {
    expect(isPlaceholderValue(value)).toBe(true);
    expect(isConfiguredValue(value)).toBe(false);
  });

  it("accepts configured provider credentials", () => {
    expect(isPlaceholderValue("vk-client-12345")).toBe(false);
    expect(isConfiguredValue("vk-client-12345")).toBe(true);
  });
});
