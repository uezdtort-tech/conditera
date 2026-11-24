import { describe, expect, it } from "vitest";
import { assertProductionEnvironment } from "./production-env";

function validEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://conditera.ru",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.conditera.ru",
    DATABASE_URL: "postgresql://app:long-random-password-123456@db:5432/postgres",
    DIRECT_DATABASE_URL: "postgresql://app:long-random-password-123456@db:5432/postgres",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(48),
    SUPABASE_SERVICE_ROLE_KEY: "b".repeat(48),
    JWT_SECRET: "c".repeat(64),
    JWT_REFRESH_SECRET: "d".repeat(64),
    TFA_ENCRYPTION_KEY: "e".repeat(64),
    CRON_SECRET: "f".repeat(32),
  };
}

describe("assertProductionEnvironment", () => {
  it("accepts a complete production environment", () => {
    expect(() => assertProductionEnvironment(validEnv())).not.toThrow();
  });

  it("does not enforce production secrets during Next.js production build", () => {
    expect(() => assertProductionEnvironment({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
  });

  it("does not enforce production secrets in development", () => {
    expect(() => assertProductionEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });

  it.each([
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "TFA_ENCRYPTION_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_APP_URL",
    "CRON_SECRET",
  ])("rejects a missing required variable: %s", (name) => {
    const env = validEnv();
    delete env[name];
    expect(() => assertProductionEnvironment(env)).toThrow(new RegExp(name));
  });

  it("rejects placeholder secrets", () => {
    const env = validEnv();
    env.TFA_ENCRYPTION_KEY = "CHANGE_ME_USE_openssl_rand_hex_32";
    expect(() => assertProductionEnvironment(env)).toThrow(/TFA_ENCRYPTION_KEY/);
  });

  it("requires independent JWT and TOTP secrets", () => {
    const env = validEnv();
    env.JWT_REFRESH_SECRET = env.JWT_SECRET;
    expect(() => assertProductionEnvironment(env)).toThrow(/должны различаться/);
  });

  it("rejects a placeholder password embedded in DATABASE_URL", () => {
    const env = validEnv();
    env.DATABASE_URL = "postgresql://app:CHANGE_ME_STRONG_PASSWORD@db:5432/postgres";
    expect(() => assertProductionEnvironment(env)).toThrow(/Пароль в DATABASE_URL/);
  });

  it("rejects a weak database password", () => {
    const env = validEnv();
    env.DATABASE_URL = "postgresql://app:short@db:5432/postgres";
    expect(() => assertProductionEnvironment(env)).toThrow(/Пароль в DATABASE_URL/);
  });

  it("requires HTTPS public URLs", () => {
    const env = validEnv();
    env.NEXT_PUBLIC_APP_URL = "http://conditera.ru";
    expect(() => assertProductionEnvironment(env)).toThrow(/HTTPS/);
  });
});
