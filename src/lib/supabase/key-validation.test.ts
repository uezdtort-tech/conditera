import { describe, expect, it } from "vitest";
import { isPlaceholderSupabaseKey } from "./key-validation";

function encodeClaims(claims: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

describe("Supabase key validation", () => {
  it("rejects the local demo JWT in production", () => {
    const demoJwt = `header.${encodeClaims({ iss: "supabase-demo", role: "service_role" })}.signature`;
    expect(isPlaceholderSupabaseKey(demoJwt)).toBe(true);
  });

  it("allows the local Supabase demo JWT in development", () => {
    const demoJwt = `header.${encodeClaims({ iss: "supabase-demo", role: "service_role" })}.signature`;
    expect(isPlaceholderSupabaseKey(demoJwt, true)).toBe(false);
  });

  it("always rejects explicit stub keys", () => {
    expect(isPlaceholderSupabaseKey("stub-anon-key", true)).toBe(true);
    expect(isPlaceholderSupabaseKey("stub_service_role_key", true)).toBe(true);
  });

  it("rejects development-only keys in production but accepts them locally", () => {
    expect(isPlaceholderSupabaseKey("dev_local_key_123", false)).toBe(true);
    expect(isPlaceholderSupabaseKey("dev_local_key_123", true)).toBe(false);
  });
});
