#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const modeArg = (process.argv[2] || "dev").toLowerCase();
const mode = modeArg === "prod" || modeArg === "production" ? "production" : "development";
const profile = (process.argv[3] || "").toLowerCase();
const envFile = path.join(ROOT, mode === "production" ? ".env.production" : ".env.local");

function parseEnvFile(filePath) {
  const values = {};
  const source = fs.readFileSync(filePath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

export function isFilled(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  return !/^(stub_|change_me|fallback-|dev[-_]|placeholder|example|dummy|test[-_])/i.test(normalized);
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function validateEnvironment(values, selectedMode = "development", selectedProfile = "", root = ROOT) {
  const production = selectedMode === "production";
  const errors = [];
  const warnings = [];
  const checks = [];

  const required = (name, description) => {
    const ok = isFilled(values[name]);
    checks.push({ name, ok, required: true, description });
    if (!ok) errors.push(`${name} — не заполнено (${description})`);
  };
  const optional = (name, description) => {
    const ok = isFilled(values[name]);
    checks.push({ name, ok, required: false, description });
    if (!ok) warnings.push(`${name} — пусто (опционально, ${description})`);
  };
  const error = (message) => errors.push(message);
  const value = (name) => (values[name] || "").trim();

  // Database and Supabase — one logical PG17 database, with separate app/backup roles.
  required("DATABASE_URL", "PostgreSQL runtime URL (conditera_app)");
  required("DIRECT_DATABASE_URL", "direct PostgreSQL URL (conditera_app)");
  required("BACKUP_DATABASE_URL", "dedicated read-only backup URL (conditera_backup)");
  required("APP_DATABASE_PASSWORD", "separate application database role password");
  required("BACKUP_DATABASE_PASSWORD", "separate backup database role password");
  required("NEXT_PUBLIC_SUPABASE_URL", "Supabase public URL");
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase anon key");
  required("SUPABASE_SERVICE_ROLE_KEY", "server-only service role key");

  const databaseUrl = value("DATABASE_URL");
  if (databaseUrl.startsWith("file:")) error("DATABASE_URL не может использовать file: URL");
  if (production) {
    const databaseContracts = [
      ["DATABASE_URL", "conditera_app", "APP_DATABASE_PASSWORD"],
      ["DIRECT_DATABASE_URL", "conditera_app", "APP_DATABASE_PASSWORD"],
      ["BACKUP_DATABASE_URL", "conditera_backup", "BACKUP_DATABASE_PASSWORD"],
    ];
    for (const [name, expectedUser, passwordVariable] of databaseContracts) {
      const raw = value(name);
      if (!isFilled(raw)) continue;
      try {
        const parsed = new URL(raw);
        const password = decodeURIComponent(parsed.password);
        const expectedPasswordRef = `\${${passwordVariable}}`;
        const passwordFromEnvReference = password === expectedPasswordRef;
        const configuredPassword = value(passwordVariable);
        const validPassword = isFilled(configuredPassword) && configuredPassword.length >= 32 &&
          (passwordFromEnvReference || password === configuredPassword);
        const database = parsed.pathname.replace(/^\//, "");
        if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname ||
            parsed.username !== expectedUser || database !== "conditera" || !validPassword) {
          error(`${name} должен подключаться к базе conditera от роли ${expectedUser} с отдельным неплейсхолдерным паролем`);
        }
      } catch {
        error(`${name} имеет некорректный формат PostgreSQL URL`);
      }
    }
    if (value("BACKUP_DATABASE_URL") === value("DATABASE_URL") ||
        value("BACKUP_DATABASE_URL") === value("DIRECT_DATABASE_URL")) {
      error("BACKUP_DATABASE_URL должен использовать отдельную роль conditera_backup");
    }
  }

  const publicSupabaseUrl = value("NEXT_PUBLIC_SUPABASE_URL");
  if (isFilled(publicSupabaseUrl)) {
    try {
      const parsed = new URL(publicSupabaseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) error("NEXT_PUBLIC_SUPABASE_URL должен быть абсолютным http(s) URL");
      if (production && parsed.protocol !== "https:") error("NEXT_PUBLIC_SUPABASE_URL должен использовать HTTPS в production");
      if (production && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) error("Production NEXT_PUBLIC_SUPABASE_URL не может указывать на localhost");
    } catch {
      error("NEXT_PUBLIC_SUPABASE_URL имеет некорректный URL");
    }
  }

  for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const payload = decodeJwtPayload(value(name));
    if (payload?.iss === "supabase-demo") error(`${name} содержит локальный Supabase demo JWT`);
  }
  if (isFilled(value("NEXT_PUBLIC_SUPABASE_ANON_KEY")) &&
      value("NEXT_PUBLIC_SUPABASE_ANON_KEY") === value("SUPABASE_SERVICE_ROLE_KEY")) {
    error("SUPABASE_SERVICE_ROLE_KEY должен отличаться от NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (production) {
    for (const [name, description] of [
      ["POSTGRES_PASSWORD", "PostgreSQL superuser password"],
      ["APP_DATABASE_PASSWORD", "separate application database role password"],
      ["BACKUP_DATABASE_PASSWORD", "separate backup database role password"],
      ["SUPABASE_SECRET_KEY_BASE", "Supabase runtime secret key base"],
      ["PG_META_CRYPTO_KEY", "postgres-meta encryption key"],
      ["REALTIME_DB_ENC_KEY", "Realtime encryption key"],
      ["REALTIME_DB_ENC_KEY_GCM", "Realtime AES-GCM key"],
      ["MEILI_MASTER_KEY", "Meilisearch master key"],
      ["N8N_ADMIN_PASSWORD", "n8n admin password"],
      ["SIMPLEX_BRIDGE_API_KEY", "SimpleX bridge API key"],
      ["ANON_KEY", "legacy Supabase anon alias"],
      ["SERVICE_ROLE_KEY", "legacy Supabase service-role alias"],
      ["ENCRYPTOR_KEY", "legacy Supabase compose encryption key"],
      ["SECRET_KEY_BASE", "legacy Supabase compose secret"],
    ]) required(name, description);

    if (value("SUPABASE_LOCAL_SHIMS_ENABLED") === "true") {
      error("SUPABASE_LOCAL_SHIMS_ENABLED запрещён в production — используйте Supabase runtime через Kong");
    }
    if (isFilled(value("ANON_KEY")) && isFilled(value("NEXT_PUBLIC_SUPABASE_ANON_KEY")) &&
        value("ANON_KEY") !== value("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
      error("ANON_KEY должен совпадать с NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    if (isFilled(value("SERVICE_ROLE_KEY")) && isFilled(value("SUPABASE_SERVICE_ROLE_KEY")) &&
        value("SERVICE_ROLE_KEY") !== value("SUPABASE_SERVICE_ROLE_KEY")) {
      error("SERVICE_ROLE_KEY должен совпадать с SUPABASE_SERVICE_ROLE_KEY");
    }

    const lengthRules = [
      ["POSTGRES_PASSWORD", 32, "min"],
      ["APP_DATABASE_PASSWORD", 32, "min"],
      ["BACKUP_DATABASE_PASSWORD", 32, "min"],
      ["SUPABASE_SECRET_KEY_BASE", 32, "min"],
      ["MEILI_MASTER_KEY", 32, "min"],
      ["N8N_ADMIN_PASSWORD", 24, "min"],
      ["SIMPLEX_BRIDGE_API_KEY", 32, "min"],
      ["CRON_SECRET", 32, "min"],
      ["SECRET_KEY_BASE", 32, "min"],
    ];
    for (const [name, length, rule] of lengthRules) {
      if (isFilled(value(name)) && value(name).length < length) error(`${name} короче ${length} символов`);
    }
    for (const [name, length] of [["ENCRYPTOR_KEY", 32], ["PG_META_CRYPTO_KEY", 32], ["REALTIME_DB_ENC_KEY", 16], ["REALTIME_DB_ENC_KEY_GCM", 32]]) {
      if (isFilled(value(name)) && value(name).length !== length) error(`${name} должен содержать ровно ${length} символов`);
    }
  } else {
    optional("POSTGRES_PASSWORD", "PostgreSQL password for self-hosted local stack");
  }

  // Auth and encryption secrets
  required("JWT_SECRET", "JWT signing secret");
  required("JWT_REFRESH_SECRET", "independent refresh-token secret");
  required("TFA_ENCRYPTION_KEY", "2FA backup-code encryption key");
  required("CRON_SECRET", "cron endpoint secret");
  const jwt = value("JWT_SECRET");
  const refresh = value("JWT_REFRESH_SECRET");
  const tfa = value("TFA_ENCRYPTION_KEY");
  if (isFilled(jwt) && isFilled(refresh) && jwt === refresh) error("JWT_SECRET и JWT_REFRESH_SECRET должны быть разными значениями");
  if (production) {
    for (const name of ["JWT_SECRET", "JWT_REFRESH_SECRET", "CRON_SECRET"]) {
      if (isFilled(value(name)) && value(name).length < 32) error(`${name} короче 32 символов`);
    }
    if (isFilled(tfa) && !/^[a-f0-9]{64}$/i.test(tfa)) error("TFA_ENCRYPTION_KEY должен содержать ровно 64 hex-символа (32 байта)");
    if (isFilled(tfa) && (tfa === jwt || tfa === refresh)) error("TFA_ENCRYPTION_KEY должен отличаться от JWT_SECRET и JWT_REFRESH_SECRET");
  }

  // Public app URL
  if (production) {
    required("NEXT_PUBLIC_APP_URL", "public HTTPS app URL");
    const appUrl = value("NEXT_PUBLIC_APP_URL");
    if (isFilled(appUrl)) {
      try {
        const parsedAppUrl = new URL(appUrl);
        if (parsedAppUrl.protocol !== "https:" || !parsedAppUrl.hostname) {
          error("NEXT_PUBLIC_APP_URL должен быть абсолютным HTTPS URL в production");
        }
      } catch {
        error("NEXT_PUBLIC_APP_URL имеет некорректный URL");
      }
    }
  }

  // Yandex Metrika
  required("NEXT_PUBLIC_YANDEX_METRIKA_ID", "Yandex Metrika counter ID");
  optional("YANDEX_METRIKA_OAUTH_TOKEN", "server-side Metrika conversions");
  optional("YANDEX_GEOCODER_API_KEY", "Yandex Geocoder");

  // OAuth providers
  // OAuth providers
  if (production) {
    required("YANDEX_CLIENT_ID", "Yandex ID client ID");
    required("YANDEX_CLIENT_SECRET", "Yandex ID client secret");
    required("YANDEX_OAUTH_REDIRECT", "Yandex ID callback URL");
    required("VK_CLIENT_ID", "VK ID client ID");
    required("VK_OAUTH_REDIRECT", "VK ID callback URL");
    const appBase = value("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
    if (isFilled(appBase) && isFilled(value("YANDEX_OAUTH_REDIRECT")) &&
        value("YANDEX_OAUTH_REDIRECT") !== `${appBase}/api/auth/oauth/yandex/callback`) {
      error("YANDEX_OAUTH_REDIRECT должен совпадать с NEXT_PUBLIC_APP_URL + /api/auth/oauth/yandex/callback");
    }
    if (isFilled(appBase) && isFilled(value("VK_OAUTH_REDIRECT")) &&
        value("VK_OAUTH_REDIRECT") !== `${appBase}/api/auth/oauth/vk/callback`) {
      error("VK_OAUTH_REDIRECT должен совпадать с NEXT_PUBLIC_APP_URL + /api/auth/oauth/vk/callback");
    }
    if (isFilled(value("YANDEX_CLIENT_SECRET")) && value("YANDEX_CLIENT_SECRET").length < 16) {
      error("YANDEX_CLIENT_SECRET короче 16 символов");
    }
  } else {
    optional("YANDEX_CLIENT_ID", "Yandex ID");
    optional("YANDEX_OAUTH_REDIRECT", "Yandex ID callback");
    optional("VK_CLIENT_ID", "VK ID");
    optional("VK_OAUTH_REDIRECT", "VK ID callback");
  }
    required("GOOGLE_CLIENT_ID", "Google OAuth client ID");
    required("GOOGLE_CLIENT_SECRET", "Google OAuth client secret");
    required("GOOGLE_OAUTH_REDIRECT", "Google OAuth callback URL");
    if (isFilled(value("GOOGLE_CLIENT_SECRET")) && value("GOOGLE_CLIENT_SECRET").length < 16) {
      error("GOOGLE_CLIENT_SECRET короче 16 символов");
    }
    const appBase = value("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
    if (isFilled(appBase) && isFilled(value("GOOGLE_OAUTH_REDIRECT")) &&
        value("GOOGLE_OAUTH_REDIRECT") !== `${appBase}/api/auth/oauth/google/callback`) {
      error("GOOGLE_OAUTH_REDIRECT должен совпадать с NEXT_PUBLIC_APP_URL + /api/auth/oauth/google/callback");
    }
  } else {
    optional("GOOGLE_CLIENT_ID", "Google OAuth");
  }

  // Telegram
  optional("TELEGRAM_BOT_TOKEN", "Telegram bot");
  optional("TELEGRAM_CHANNEL_ID", "Telegram channel");
  optional("TELEGRAM_OAUTH_REDIRECT", "Telegram login callback");

  // YooKassa — required for the production payment lifecycle.
  if (production) {
    required("YOOKASSA_SHOP_ID", "YooKassa shop ID");
    required("YOOKASSA_SECRET_KEY", "YooKassa secret key");
    if (isFilled(value("YOOKASSA_SECRET_KEY")) && !value("YOOKASSA_SECRET_KEY").startsWith("live_")) {
      error("YOOKASSA_SECRET_KEY должен быть production-ключом с префиксом live_");
    }
  } else {
    optional("YOOKASSA_SHOP_ID", "YooKassa shop ID");
    optional("YOOKASSA_SECRET_KEY", "YooKassa secret key");
  }

  // SMTP
  required("SMTP_HOST", "SMTP host");
  required("SMTP_FROM", "SMTP sender address");
  const smtpFrom = value("SMTP_FROM");
  const smtpMailbox = smtpFrom.match(/^(?:[^<>]*<)?([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/);
  if (isFilled(smtpFrom) && !smtpMailbox) {
    error("SMTP_FROM должен содержать корректный email-адрес или отображаемое имя с адресом в угловых скобках");
  }
  if (production) {
    required("SMTP_USER", "SMTP user");
    required("SMTP_PASSWORD", "SMTP password");
    required("SMTP_PORT", "SMTP port");
    required("SMTP_SECURE", "SMTP TLS mode");
    const smtpPort = Number(value("SMTP_PORT"));
    const smtpSecure = value("SMTP_SECURE").toLowerCase();
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) error("SMTP_PORT должен быть целым числом от 1 до 65535");
    if (!["true", "false"].includes(smtpSecure)) error("SMTP_SECURE должен быть true или false");
    if (smtpPort === 465 && smtpSecure !== "true") error("Для SMTP_PORT=465 требуется SMTP_SECURE=true");
    if (smtpPort === 587 && smtpSecure !== "false") error("Для SMTP_PORT=587 требуется SMTP_SECURE=false");
  } else {
    optional("SMTP_USER", "SMTP user");
    optional("SMTP_PASSWORD", "SMTP password");
  }

  // Supabase Storage buckets
  optional("SUPABASE_STORAGE_HOSTNAME", "custom Storage CDN hostname");
  required("STORAGE_BUCKET_AVATARS", "avatars bucket");
  required("STORAGE_BUCKET_PORTFOLIO", "portfolio bucket");

  // Optional mail profile advisory
  if (selectedProfile === "mail" || selectedProfile === "full") {
    const mailEnv = path.join(root, "mailu.env");
    if (!fs.existsSync(mailEnv)) warnings.push("mailu.env отсутствует: профиль mail/full не сможет запустить Mailu");
    else {
      const mailValues = parseEnvFile(mailEnv);
      if (!/^[a-f0-9]{64}$/i.test(mailValues.SECRET_KEY || "")) warnings.push("mailu.env: SECRET_KEY отсутствует или не 64-hex");
    }
  }

  return { errors, warnings, checks, ok: errors.length === 0 };
}

function main() {
  const label = mode === "production" ? "production" : "development";
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Environment check: ${label}`);
  console.log(`  File: ${path.basename(envFile)}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  if (!fs.existsSync(envFile)) {
    console.error(`  ✗ Файл ${path.basename(envFile)} не найден.`);
    console.error(mode === "production" ? "  Создайте .env.production из .env.production.example" : "  Создайте .env.local из .env.local.example");
    process.exitCode = 1;
    return;
  }

  let values;
  try {
    values = parseEnvFile(envFile);
  } catch (error) {
    console.error(`  ✗ Не удалось прочитать env-файл: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = validateEnvironment(values, mode, profile, ROOT);
  for (const check of result.checks) {
    if (check.ok) console.log(`  ✓ ${check.name} (${check.description})`);
    else if (!check.required) console.warn(`  ⚠ ${check.name} — пусто (опционально, ${check.description})`);
  }
  for (const message of result.errors) console.error(`  ✗ ${message}`);
  for (const message of result.warnings) console.warn(`  ⚠ ${message}`);

  console.log("");
  if (result.ok) {
    console.log(`  Ошибок: 0. Предупреждений: ${result.warnings.length}.`);
    console.log("  Обязательные переменные окружения проверены.");
  } else {
    console.error(`  Ошибок: ${result.errors.length}. Предупреждений: ${result.warnings.length}.`);
    console.error("  Запуск/деплой не готов: исправьте ошибки выше.");
    process.exitCode = 1;
  }
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
