import { describe, expect, it } from "vitest";
import { isLocalSupabaseShimAllowed } from "./local-shim";

describe("local Supabase compatibility shim gate", () => {
  it("allows local development", () => {
    expect(isLocalSupabaseShimAllowed({ NODE_ENV: "development" })).toBe(true);
  });

  it("blocks production by default", () => {
    expect(isLocalSupabaseShimAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows production-mode shims only for explicit CI integration tests", () => {
    expect(
      isLocalSupabaseShimAllowed({
        NODE_ENV: "production",
        CI: "true",
        SUPABASE_LOCAL_SHIMS_ENABLED: "true",
      })
    ).toBe(true);
  });

  it("does not allow the shim when only one CI guard is present", () => {
    expect(
      isLocalSupabaseShimAllowed({
        NODE_ENV: "production",
        CI: "true",
      })
    ).toBe(false);
    expect(
      isLocalSupabaseShimAllowed({
        NODE_ENV: "production",
        SUPABASE_LOCAL_SHIMS_ENABLED: "true",
      })
    ).toBe(false);
  });
});
