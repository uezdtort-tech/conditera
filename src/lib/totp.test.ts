import { afterEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;
const originalNextPhase = process.env.NEXT_PHASE;
const originalTfaKey = process.env.TFA_ENCRYPTION_KEY;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalNextPhase === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = originalNextPhase;

  if (originalTfaKey === undefined) delete process.env.TFA_ENCRYPTION_KEY;
  else process.env.TFA_ENCRYPTION_KEY = originalTfaKey;

  vi.resetModules();
});

describe("TOTP encryption key configuration", () => {
  it("rejects a missing key in production runtime", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    delete process.env.TFA_ENCRYPTION_KEY;
    vi.resetModules();

    await expect(import("./totp")).rejects.toThrow(/TFA_ENCRYPTION_KEY/);
  });

  it.each([
    "CHANGE_ME_USE_openssl_rand_hex_32",
    "dev_tfa_key_change_me_in_production_aaaaaaaaaaaaaaaa",
    "fallback-not-a-secret",
    "stub-secret-value-that-is-long-enough",
    "placeholder-secret-value-that-is-long-enough",
  ])("rejects a placeholder key in production runtime: %s", async (key) => {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.TFA_ENCRYPTION_KEY = key;
    vi.resetModules();

    await expect(import("./totp")).rejects.toThrow(/TFA_ENCRYPTION_KEY/);
  });

  it("rejects a short key in production runtime", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.TFA_ENCRYPTION_KEY = "too-short";
    vi.resetModules();

    await expect(import("./totp")).rejects.toThrow(/TFA_ENCRYPTION_KEY/);
  });

  it("allows a valid production key and preserves encrypted-secret round trips", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.TFA_ENCRYPTION_KEY = "a".repeat(64);
    vi.resetModules();

    const { encryptSecret, decryptSecret } = await import("./totp");
    const secret = "JBSWY3DPEHPK3PXP";

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("uses a build-only key during the production build phase", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PHASE = "phase-production-build";
    delete process.env.TFA_ENCRYPTION_KEY;
    vi.resetModules();

    const { encryptSecret, decryptSecret } = await import("./totp");
    const secret = "JBSWY3DPEHPK3PXP";

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});
