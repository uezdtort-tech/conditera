import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: {} }));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("JWT production secret contract", () => {
  it("does not accept AUTH_SECRET as a substitute for JWT_SECRET", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PHASE = "phase-production-server";
    delete process.env.JWT_SECRET;
    process.env.AUTH_SECRET = "a".repeat(64);
    process.env.JWT_REFRESH_SECRET = "b".repeat(64);

    await expect(import("./auth")).rejects.toThrow(/JWT_SECRET/);
  });

  it("does not accept AUTH_REFRESH_SECRET as a substitute for JWT_REFRESH_SECRET", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PHASE = "phase-production-server";
    process.env.JWT_SECRET = "a".repeat(64);
    delete process.env.JWT_REFRESH_SECRET;
    process.env.AUTH_REFRESH_SECRET = "b".repeat(64);

    await expect(import("./auth")).rejects.toThrow(/JWT_REFRESH_SECRET/);
  });

  it("rejects reuse of the access-token secret for refresh tokens", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PHASE = "phase-production-server";
    process.env.JWT_SECRET = "a".repeat(64);
    process.env.JWT_REFRESH_SECRET = "a".repeat(64);

    await expect(import("./auth")).rejects.toThrow(/должны быть разными/);
  });
});
