#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseEnvFile(path) {
  const values = new Map();
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(key, value);
  }
  return values;
}

export function validateProductionEnv(productionEnvPath, runtimeEnvPath) {
  const errors = [];
  let values;
  try {
    values = new Map([...parseEnvFile(productionEnvPath), ...parseEnvFile(runtimeEnvPath)]);
  } catch (error) {
    return ["Не удалось прочитать оба production env-файла: " + (error?.message || error)];
  }
  const placeholder = /CHANGE_ME|REPLACE_ME|PLACEHOLDER|YOUR_SECRET|TODO/i;
  const requireValue = (key, minimumLength = 1) => {
    const value = values.get(key)?.trim() || "";
    if (!value || placeholder.test(value)) { errors.push(key + ": отсутствует реальное production-значение"); return ""; }
    if (value.length < minimumLength) errors.push(key + ": длина должна быть не менее " + minimumLength + " символов");
    return value;
  };
  const requireTrue = (key) => {
    if ((values.get(key) || "").trim().toLowerCase() !== "true") errors.push(key + ": должен быть true для production");
  };

  const required = [
    ["DOMAIN", 4], ["NODE_ENV", 1], ["NEXT_PUBLIC_APP_URL", 1], ["NEXT_PUBLIC_SUPABASE_URL", 1],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", 32], ["SUPABASE_SERVICE_ROLE_KEY", 32], ["POSTGRES_PASSWORD", 32],
    ["MEILI_URL", 1], ["MEILI_MASTER_KEY", 32], ["SMTP_HOST", 1], ["SMTP_PORT", 1],
    ["SMTP_USER", 1], ["SMTP_PASSWORD", 12], ["SMTP_FROM", 1],
    ["JWT_SECRET", 32], ["JWT_REFRESH_SECRET", 32], ["TFA_ENCRYPTION_KEY", 32], ["IP_HASH_SALT", 32],
    ["CRON_SECRET", 32], ["BOT_SECRET", 32], ["TELEGRAM_WEBHOOK_SECRET", 32], ["TELEGRAM_BOT_TOKEN", 20], ["TELEGRAM_CHANNEL_ID", 2],
    ["YOOKASSA_SHOP_ID", 1], ["YOOKASSA_SECRET_KEY", 16],
    ["N8N_ADMIN_EMAIL", 6], ["N8N_ADMIN_PASSWORD", 24], ["N8N_ENCRYPTION_KEY", 32], ["N8N_WEBHOOK_SECRET", 32], ["N8N_WEBHOOK_URL", 1],
    ["VAPID_PUBLIC_KEY", 80], ["VAPID_PRIVATE_KEY", 32],
    ["YANDEX_CLIENT_ID", 1], ["YANDEX_CLIENT_SECRET", 16], ["GOOGLE_CLIENT_ID", 1], ["GOOGLE_CLIENT_SECRET", 16], ["VK_CLIENT_ID", 1], ["VK_CLIENT_SECRET", 16],
    ["LLM_PROVIDER", 1], ["LLM_MODEL", 1], ["LLM_API_BASE", 1],
    ["APP_DATABASE_PASSWORD", 32], ["BACKUP_DATABASE_PASSWORD", 32], ["SUPABASE_SECRET_KEY_BASE", 32],
    ["PG_META_CRYPTO_KEY", 32], ["REALTIME_DB_ENC_KEY", 16], ["REALTIME_DB_ENC_KEY_GCM", 32],
  ];
  for (const [key, minimumLength] of required) requireValue(key, minimumLength);

  const n8nAdminEmail = values.get("N8N_ADMIN_EMAIL") || "";
  if (n8nAdminEmail && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(n8nAdminEmail)) errors.push("N8N_ADMIN_EMAIL: требуется корректный email владельца n8n");
  const n8nAdminPassword = values.get("N8N_ADMIN_PASSWORD") || "";
  if (n8nAdminPassword && (!/[A-Z]/.test(n8nAdminPassword) || !/[a-z]/.test(n8nAdminPassword) || !/[0-9]/.test(n8nAdminPassword))) {
    errors.push("N8N_ADMIN_PASSWORD: требуется минимум одна заглавная, одна строчная буква и одна цифра для первоначальной настройки владельца n8n");
  }

  requireTrue("EXTERNAL_YANDEX_ENABLED");
  requireTrue("EXTERNAL_GOOGLE_ENABLED");
  requireTrue("EXTERNAL_VK_ENABLED");
  requireTrue("SMTP_TLS_REJECT_UNAUTHORIZED");
  if ((values.get("NODE_ENV") || "").trim() !== "production") errors.push("NODE_ENV: должен быть production");
  if ((values.get("LLM_PROVIDER") || "").trim().toLowerCase() === "none") errors.push("LLM_PROVIDER: AI-функции отключены; production-конфигурация должна указывать работающего провайдера");
  const provider = (values.get("LLM_PROVIDER") || "").trim().toLowerCase();
  if (provider && !["none", "ollama", "local", "lmstudio"].includes(provider)) requireValue("LLM_API_KEY", 16);

  const yookassaSecret = values.get("YOOKASSA_SECRET_KEY") || "";
  if (yookassaSecret && !yookassaSecret.startsWith("live_")) {
    errors.push("YOOKASSA_SECRET_KEY: production принимает только live_-ключ YooKassa, sandbox/test-ключ запрещён");
  }
  const telegramToken = values.get("TELEGRAM_BOT_TOKEN") || "";
  if (telegramToken && !/^\\d{5,}:[A-Za-z0-9_-]{20,}$/.test(telegramToken)) {
    errors.push("TELEGRAM_BOT_TOKEN: некорректный формат токена Bot API");
  }
  const telegramChannel = values.get("TELEGRAM_CHANNEL_ID") || "";
  if (telegramChannel && !/^(?:@[A-Za-z0-9_]{5,}|-100\\d{5,})$/.test(telegramChannel)) {
    errors.push("TELEGRAM_CHANNEL_ID: требуется @имя канала или числовой ID вида -100...");
  }
  for (const [key, providerName] of [
    ["YANDEX_OAUTH_REDIRECT", "yandex"],
    ["GOOGLE_OAUTH_REDIRECT", "google"],
    ["VK_OAUTH_REDIRECT", "vk"],
  ]) {
    const expected = domain ? "https://" + domain + "/api/auth/oauth/" + providerName + "/callback" : "";
    if ((values.get(key) || "").trim() !== expected) {
      errors.push(key + ": должен точно совпадать с " + expected);
    }
  }

  const port = Number(values.get("SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("SMTP_PORT: некорректный TCP-порт");

  const domain = (values.get("DOMAIN") || "").trim().toLowerCase();
  if (domain && (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.includes(".."))) errors.push("DOMAIN: требуется корректный публичный домен");
  const checkUrl = (key, expectedPath) => {
    const raw = values.get(key) || "";
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:") errors.push(key + ": публичный production URL должен использовать HTTPS");
      if (domain && url.hostname.toLowerCase() !== domain) errors.push(key + ": hostname должен совпадать с DOMAIN");
      if (expectedPath !== null && url.pathname.replace(/\/$/, "") !== expectedPath) errors.push(key + ": ожидается путь " + expectedPath);
    } catch { errors.push(key + ": некорректный URL"); }
  };
  checkUrl("NEXT_PUBLIC_APP_URL", "");
  checkUrl("NEXT_PUBLIC_SUPABASE_URL", "/api");
  checkUrl("N8N_WEBHOOK_URL", "/n8n");
  const llmBase = values.get("LLM_API_BASE") || "";
  try {
    const url = new URL(llmBase);
    if (!["http:", "https:"].includes(url.protocol)) errors.push("LLM_API_BASE: требуется HTTP(S) endpoint");
    if (url.hostname === "llm") errors.push("LLM_API_BASE: хост llm отсутствует в production Compose; укажи реальный доступный LLM endpoint");
  } catch { errors.push("LLM_API_BASE: некорректный URL"); }
  return [...new Set(errors)];
}

function main() {
  const productionIndex = process.argv.indexOf("--production-env");
  const runtimeIndex = process.argv.indexOf("--runtime-env");
  const productionPath = productionIndex >= 0 ? process.argv[productionIndex + 1] : ".env.production";
  const runtimePath = runtimeIndex >= 0 ? process.argv[runtimeIndex + 1] : ".env.supabase-runtime";
  const errors = validateProductionEnv(resolve(productionPath), resolve(runtimePath));
  if (errors.length) {
    console.error("BLOCKED: production environment is incomplete or unsafe:");
    for (const error of errors) console.error(" - " + error);
    process.exitCode = 1;
    return;
  }
  console.log("PASS: production environment contains required secrets, live OAuth/payment configuration, verified SMTP settings and an enabled AI provider.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
