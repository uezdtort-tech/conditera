#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateProductionEnv } from "./production-env-preflight.mjs";

const production = {
  DOMAIN: "conditera.ru", NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://conditera.ru",
  NEXT_PUBLIC_SUPABASE_URL: "https://conditera.ru/api", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(64),
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(64), POSTGRES_PASSWORD: "p".repeat(64),
  MEILI_URL: "http://meilisearch:7700", MEILI_MASTER_KEY: "m".repeat(64),
  SMTP_HOST: "mail.conditera.ru", SMTP_PORT: "465", SMTP_USER: "noreply@conditera.ru",
  SMTP_PASSWORD: "smtp-password-".repeat(3), SMTP_FROM: "noreply@conditera.ru", SMTP_TLS_REJECT_UNAUTHORIZED: "true",
  JWT_SECRET: "j".repeat(64), JWT_REFRESH_SECRET: "r".repeat(64), TFA_ENCRYPTION_KEY: "t".repeat(64),
  IP_HASH_SALT: "i".repeat(64), CRON_SECRET: "c".repeat(64), BOT_SECRET: "b".repeat(64),
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(64), TELEGRAM_BOT_TOKEN: "123456:" + "T".repeat(32),
  YOOKASSA_SHOP_ID: "123456", YOOKASSA_SECRET_KEY: "y".repeat(64),
  N8N_ADMIN_EMAIL: "admin@conditera.ru", N8N_ADMIN_PASSWORD: "N8n-Owner-Password-2026-" + "x".repeat(40), N8N_ENCRYPTION_KEY: "e".repeat(32),
  N8N_WEBHOOK_SECRET: "h".repeat(64), N8N_WEBHOOK_URL: "https://conditera.ru/n8n/",
  VAPID_PUBLIC_KEY: "v".repeat(87), VAPID_PRIVATE_KEY: "k".repeat(43),
  EXTERNAL_YANDEX_ENABLED: "true", EXTERNAL_VK_ENABLED: "true",
  YANDEX_CLIENT_ID: "yandex-client-id", YANDEX_CLIENT_SECRET: "Y".repeat(64),
  VK_CLIENT_ID: "vk-client-id", VK_CLIENT_SECRET: "V".repeat(64),
  LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5:7b", LLM_API_BASE: "http://host.docker.internal:11434/v1",
};
const runtime = {
  APP_DATABASE_PASSWORD: "a".repeat(64), BACKUP_DATABASE_PASSWORD: "d".repeat(64),
  SUPABASE_SECRET_KEY_BASE: "s".repeat(64), PG_META_CRYPTO_KEY: "p".repeat(64),
  REALTIME_DB_ENC_KEY: "r".repeat(32), REALTIME_DB_ENC_KEY_GCM: "g".repeat(64),
};
const temp = mkdtempSync(join(tmpdir(), "conditera-production-env-test-"));
const productionPath = join(temp, ".env.production");
const runtimePath = join(temp, ".env.supabase-runtime");
function writeEnv(path, values) {
  writeFileSync(path, Object.entries(values).map(([key, value]) => key + "=" + value).join("\n") + "\n");
}
function getErrors(productionOverrides = {}, runtimeValues = runtime) {
  writeEnv(productionPath, { ...production, ...productionOverrides });
  writeEnv(runtimePath, runtimeValues);
  return validateProductionEnv(productionPath, runtimePath);
}
try {
  assert.deepEqual(getErrors(), [], "A complete valid production configuration must pass");
  assert.ok(getErrors({ EXTERNAL_VK_ENABLED: "false" }).some((error) => error.includes("EXTERNAL_VK_ENABLED")));
  assert.ok(getErrors({ YOOKASSA_SECRET_KEY: "CHANGE_ME" }).some((error) => error.includes("YOOKASSA_SECRET_KEY")));
  assert.ok(getErrors({ SMTP_TLS_REJECT_UNAUTHORIZED: "false" }).some((error) => error.includes("SMTP_TLS_REJECT_UNAUTHORIZED")));
  assert.ok(getErrors({ N8N_WEBHOOK_URL: "https://n8n.conditera.ru" }).some((error) => error.includes("N8N_WEBHOOK_URL")));
  assert.ok(getErrors({ N8N_ADMIN_EMAIL: "not-an-email" }).some((error) => error.includes("N8N_ADMIN_EMAIL")));
  assert.ok(getErrors({ N8N_ADMIN_PASSWORD: "lowercase-password-2026" }).some((error) => error.includes("N8N_ADMIN_PASSWORD")));
  assert.ok(getErrors({ VAPID_PUBLIC_KEY: "CHANGE_ME" }).some((error) => error.includes("VAPID_PUBLIC_KEY")));
  const runtimeWithoutBackup = { ...runtime };
  delete runtimeWithoutBackup.BACKUP_DATABASE_PASSWORD;
  assert.ok(getErrors({}, runtimeWithoutBackup).some((error) => error.includes("BACKUP_DATABASE_PASSWORD")));
  assert.ok(getErrors({ LLM_PROVIDER: "none" }).some((error) => error.includes("LLM_PROVIDER")));
  console.log("PASS: production environment preflight accepts complete config and blocks missing/unsafe OAuth, payment, SMTP, n8n, AI and backup settings.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
