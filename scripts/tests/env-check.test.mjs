import test from "node:test";
import assert from "node:assert/strict";
import { validateEnvironment } from "../env-check.mjs";

const validProduction = () => ({
  DATABASE_URL: `postgresql://conditera_app:${"d".repeat(40)}@db:5432/conditera`,
  NEXT_PUBLIC_SUPABASE_URL: "https://conditera.ru/api",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-fixture",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-fixture",
  POSTGRES_PASSWORD: "p".repeat(40),
  APP_DATABASE_PASSWORD: "a".repeat(40),
  SUPABASE_SECRET_KEY_BASE: "s".repeat(40),
  PG_META_CRYPTO_KEY: "m".repeat(32),
  REALTIME_DB_ENC_KEY: "r".repeat(16),
  REALTIME_DB_ENC_KEY_GCM: "g".repeat(32),
  MEILI_MASTER_KEY: "m".repeat(40),
  N8N_ADMIN_PASSWORD: "n".repeat(24),
  SIMPLEX_BRIDGE_API_KEY: "s".repeat(32),
  ANON_KEY: "public-anon-fixture",
  SERVICE_ROLE_KEY: "server-role-fixture",
  ENCRYPTOR_KEY: "e".repeat(32),
  SECRET_KEY_BASE: "l".repeat(32),
  JWT_SECRET: "j".repeat(32),
  JWT_REFRESH_SECRET: "r".repeat(32),
  TFA_ENCRYPTION_KEY: "a".repeat(64),
  CRON_SECRET: "c".repeat(32),
  NEXT_PUBLIC_APP_URL: "https://conditera.ru",
  NEXT_PUBLIC_YANDEX_METRIKA_ID: "111432662",
  YANDEX_CLIENT_ID: "yandex-client",
  YANDEX_OAUTH_REDIRECT: "https://conditera.ru/api/auth/oauth/yandex/callback",
  VK_CLIENT_ID: "vk-client",
  VK_OAUTH_REDIRECT: "https://conditera.ru/api/auth/oauth/vk/callback",
  YOOKASSA_SHOP_ID: "shop-id",
  YOOKASSA_SECRET_KEY: "shop-secret",
  SMTP_HOST: "mail.conditera.ru",
  SMTP_FROM: "noreply@conditera.ru",
  SMTP_USER: "noreply@conditera.ru",
  SMTP_PASSWORD: "smtp-password-fixture-1234567890",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  STORAGE_BUCKET_AVATARS: "avatars",
  STORAGE_BUCKET_PORTFOLIO: "portfolio",
});

test("accepts a complete production environment", () => {
  const result = validateEnvironment(validProduction(), "production");
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(result.errors, []);
});

test("rejects weak or placeholder DATABASE_URL password", () => {
  const env = validProduction();
  env.DATABASE_URL = "postgresql://app:CHANGE_ME_PASSWORD@db:5432/conditera";
  const result = validateEnvironment(env, "production");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("DATABASE_URL")));
});

test("rejects reused JWT signing secrets and invalid TOTP key", () => {
  const env = validProduction();
  env.JWT_REFRESH_SECRET = env.JWT_SECRET;
  env.TFA_ENCRYPTION_KEY = "not-a-64-hex-key";
  const result = validateEnvironment(env, "production");
  assert.ok(result.errors.some((message) => message.includes("JWT_SECRET")));
  assert.ok(result.errors.some((message) => message.includes("TFA_ENCRYPTION_KEY")));
});

test("rejects wrong OAuth callback URL and missing VK credentials", () => {
  const env = validProduction();
  env.VK_CLIENT_ID = "CHANGE_ME_VK_CLIENT_ID";
  env.YANDEX_OAUTH_REDIRECT = "https://wrong.example/callback";
  const result = validateEnvironment(env, "production");
  assert.ok(result.errors.some((message) => message.includes("VK_CLIENT_ID")));
  assert.ok(result.errors.some((message) => message.includes("YANDEX_OAUTH_REDIRECT")));
});

test("rejects local Supabase compatibility shims on production", () => {
  const env = validProduction();
  env.SUPABASE_LOCAL_SHIMS_ENABLED = "true";
  const result = validateEnvironment(env, "production");
  assert.ok(result.errors.some((message) => message.includes("SUPABASE_LOCAL_SHIMS_ENABLED")));
});

test("development mode does not require production-only payment and OAuth credentials", () => {
  const env = validProduction();
  delete env.YANDEX_CLIENT_ID;
  delete env.YANDEX_OAUTH_REDIRECT;
  delete env.VK_CLIENT_ID;
  delete env.VK_OAUTH_REDIRECT;
  delete env.YOOKASSA_SHOP_ID;
  delete env.YOOKASSA_SECRET_KEY;
  delete env.POSTGRES_PASSWORD;
  delete env.APP_DATABASE_PASSWORD;
  delete env.SUPABASE_SECRET_KEY_BASE;
  delete env.PG_META_CRYPTO_KEY;
  delete env.REALTIME_DB_ENC_KEY;
  delete env.REALTIME_DB_ENC_KEY_GCM;
  delete env.MEILI_MASTER_KEY;
  delete env.N8N_ADMIN_PASSWORD;
  delete env.SIMPLEX_BRIDGE_API_KEY;
  delete env.ANON_KEY;
  delete env.SERVICE_ROLE_KEY;
  delete env.ENCRYPTOR_KEY;
  delete env.SECRET_KEY_BASE;
  delete env.NEXT_PUBLIC_APP_URL;
  delete env.SMTP_USER;
  delete env.SMTP_PASSWORD;
  delete env.SMTP_PORT;
  delete env.SMTP_SECURE;
  const result = validateEnvironment(env, "development");
  assert.equal(result.ok, true, result.errors.join("\n"));
});
