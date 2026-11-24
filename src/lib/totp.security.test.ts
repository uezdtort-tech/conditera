import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of ["NEXT_PHASE", "TFA_ENCRYPTION_KEY"]) {
    const value = ORIGINAL_ENV[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.resetModules();
});

describe("TOTP encryption key production contract", () => {
  it("rejects a missing key when encryption is used at production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PHASE;
    delete process.env.TFA_ENCRYPTION_KEY;

    const totp = await import("./totp");
    expect(() => totp.encryptSecret("JBSWY3DPEHPK3PXP")).toThrow(
      /TFA_ENCRYPTION_KEY/
    );
  });

  it("rejects a non-hex or wrong-length production key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PHASE = "phase-production-server";
    process.env.TFA_ENCRYPTION_KEY = "not-a-64-character-hex-key";

    const totp = await import("./totp");
    expect(() => totp.encryptSecret("JBSWY3DPEHPK3PXP")).toThrow(
      /64 hex-символов/
    );
  });

  it("round-trips encrypted secrets with a valid 32-byte production key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PHASE = "phase-production-server";
    process.env.TFA_ENCRYPTION_KEY = "a".repeat(64);

    const totp = await import("./totp");
    const encrypted = totp.encryptSecret("JBSWY3DPEHPK3PXP");
    expect(totp.decryptSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a build-only key during production prerender without accepting it at runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PHASE = "phase-production-build";
    delete process.env.TFA_ENCRYPTION_KEY;

    const totp = await import("./totp");
    const encrypted = totp.encryptSecret("JBSWY3DPEHPK3PXP");
    expect(totp.decryptSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP");

    process.env.NEXT_PHASE = "phase-production-server";
    delete process.env.TFA_ENCRYPTION_KEY;
    vi.resetModules();
    const runtimeTotp = await import("./totp");
    expect(() => runtimeTotp.decryptSecret(encrypted)).toThrow(/TFA_ENCRYPTION_KEY/);
  });
});
