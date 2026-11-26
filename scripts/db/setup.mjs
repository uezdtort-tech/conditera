#!/usr/bin/env node
/**
 * scripts/db/setup.mjs — полная подготовка локальной БД «Conditera».
 *
 *   npm run db:setup            — embedded PG (если нужно) → compat → миграции → env-ключи
 *                                 демо-данные создаются ТОЛЬКО при SEED_MODE=demo
 *   npm run db:seed             — явный запуск demo seeds (или SEED_MODE=demo) + env-ключи
 *
 * Plain Node (без bun и Unix-shell), работает на Windows/macOS/Linux.
 * PostgreSQL: встроенный (@embedded-postgres) или свой — через DATABASE_URL.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import path from "node:path";
import { finishSession, initAgentLogSession, logStep } from "../lib/agent-log.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(require.resolve("./setup.mjs")), "..", "..");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const COMPAT_SQL = path.join(ROOT, "supabase", "compat", "0000_supabase_compat.sql");
const SEED_FILES = [
  path.join(ROOT, "supabase", "seed.sql"),
  path.join(ROOT, "supabase", "seed_cms_crm.sql"),
  path.join(ROOT, "supabase", "seed_fillings.sql"),
  path.join(ROOT, "supabase", "seed_confectioners.sql"),
  path.join(ROOT, "supabase", "seed_vitrine.sql"),
  path.join(ROOT, "supabase", "compat", "0002_seed_decor.sql"),
  path.join(ROOT, "supabase", "compat", "0003_seed_inventory.sql"),
  path.join(ROOT, "supabase", "compat", "0004_seed_bot_user.sql"),
  path.join(ROOT, "supabase", "compat", "0005_seed_product_images.sql"),
  path.join(ROOT, "supabase", "compat", "0006_seed_reviews.sql"),
  path.join(ROOT, "supabase", "compat", "0007_seed_video_feed.sql"),
  path.join(ROOT, "scripts", "db", "seed-product-media.mjs"),
  path.join(ROOT, "scripts", "db", "seed-ops-center.mjs"),
];
const ENV_LOCAL = path.join(ROOT, ".env.local");
const ENV_FILE = path.join(ROOT, ".env");

// SQLSTATE классов "already exists" — глотаем с однострочным notice
const IDEMPOTENT_SQLSTATES = new Set([
  "42P07", // duplicate_table
  "42710", // duplicate_object
  "42701", // duplicate_column
  "42723", // duplicate_function
  "42P06", // duplicate_schema
  "42712", // duplicate_alias
  "42704", // undefined_object (ветки DROP/COMMENT без IF EXISTS)
]);

const SKIP_EXTENSIONS = ["pg_cron", "pgsodium"]; // отсутствуют в vanilla PG
const DEMO_PASSWORD = "Demo123!";

// ============================================================================
// 0. Журнал агента (scripts/lib/agent-log.mjs) — append-only, fail-safe:
//    ошибки журналирования НЕ влияют на поведение, вывод и коды выхода setup.
//    Пишутся ТОЛЬКО верхнеуровневые шаги (env → pg → миграции → сиды →
//    env-ключи); секреты в журнал не передаются (ниже — только источники
//    и факты, без значений).
// ============================================================================
initAgentLogSession({
  run: process.argv.includes("--seed-only")
    ? "db:setup --seed-only (npm run db:seed)"
    : "db:setup (npm run db:setup)",
  reason: "подготовка локальной БД Conditera: embedded PG → compat → миграции → сиды → env-ключи",
});

// ============================================================================
// 1. Разбор .env / .env.local (крошечный парсер, .env.local побеждает)
// ============================================================================
function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

logStep("env", "START", "чтение .env/.env.local и резолв DATABASE_URL (значения секретов не логируются)");
const fileEnv = { ...parseEnvFile(ENV_FILE), ...parseEnvFile(ENV_LOCAL) };


function isPostgresUrl(u) {
  return typeof u === "string" && /^postgres(ql)?:\/\//i.test(u.trim());
}

// Итоговый DATABASE_URL: process.env > .env.local > .env > embedded-дефолт
let DATABASE_URL = process.env.DATABASE_URL || "";
let databaseUrlSource = "process env";
if (!isPostgresUrl(DATABASE_URL)) {
  DATABASE_URL = fileEnv.DATABASE_URL || "";
  databaseUrlSource = ".env/.env.local";
}
if (!isPostgresUrl(DATABASE_URL)) {
  DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/conditera";
  databaseUrlSource = "default (embedded)";
}

// Sanitize legacy .env: Prisma-era `DATABASE_URL=file:...` ломает bun/next env
// priority (bun читает .env с приоритетом выше .env.local) — заменяем на PG-URL.
try {
  if (existsSync(ENV_FILE)) {
    const envRaw = readFileSync(ENV_FILE, "utf8");
    if (/^DATABASE_URL=file:/m.test(envRaw)) {
      const fixed = envRaw.replace(/^DATABASE_URL=file:.*$/m, `DATABASE_URL=${DATABASE_URL}`);
      writeFileSync(ENV_FILE, fixed);
      console.log("  ✔ .env: legacy DATABASE_URL=file:… заменён на локальный PostgreSQL URL");
    }
  }
} catch (err) {
  logStep("env", "WARN", `.env sanitize пропущен (некритично): ${err && err.message ? err.message : err}`);
}

logStep("env", "OK", `окружение проверено; источник DATABASE_URL: ${databaseUrlSource}; режим: ${process.argv.includes("--seed-only") ? "--seed-only (только сиды)" : "полный setup"}`);

function maskUrl(u) {
  return u.replace(/:\/\/([^:@/]+):([^@/]*)@/, "://$1:***@");
}
function maskSecret(v) {
  if (!v) return "(missing)";
  const head = v.slice(0, 6);
  return `${head}…(${v.length} chars)`;
}

// ============================================================================
// 2. SQL-сплиттер (dollar-quote aware) — по мотивам scripts/apply-migrations.ts
// ============================================================================
function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  let inDollarQuote = null;
  let inSingleQuote = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    if (next2 === "--" && !inDollarQuote && !inSingleQuote) {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (next2 === "/*" && !inDollarQuote && !inSingleQuote) {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (ch === "$" && !inDollarQuote && !inSingleQuote) {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        current += m[0];
        i += m[0].length;
        inDollarQuote = m[0];
        continue;
      }
    }
    if (inDollarQuote && sql.slice(i, i + inDollarQuote.length) === inDollarQuote) {
      current += inDollarQuote;
      i += inDollarQuote.length;
      inDollarQuote = null;
      continue;
    }
    if (ch === "'" && !inDollarQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }
    if (ch === "'" && inSingleQuote && !inDollarQuote) {
      // удвоенная кавычка внутри литерала
      if (sql[i + 1] === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingleQuote = false;
      current += ch;
      i++;
      continue;
    }
    if (ch === ";" && !inDollarQuote && !inSingleQuote) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

// ============================================================================
// 3. Препроцессинг операторов (Supabase-измы → vanilla PG)
// ============================================================================
function preprocessStatement(stmt) {
  let s = stmt;

  // 3.1. CREATE EXTENSION: pg_cron/pgsodium — скип; остальное остаётся
  const extMatch = s.match(/^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-zA-Z0-9_-]+)["']?/i);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    if (SKIP_EXTENSIONS.includes(ext)) {
      return { skip: true, reason: `${ext} not available locally` };
    }
  }

  // pg_cron is conditionally installed inside a DO block for Supabase PG17.
  // It is managed in the postgres maintenance DB, not the application DB;
  // vanilla PostgreSQL also lacks the extension, so skip the whole DO block.
  if (/CREATE\\s+EXTENSION\\s+pg_cron/i.test(s) && SKIP_EXTENSIONS.includes("pg_cron")) {
    return { skip: true, reason: "pg_cron is managed outside the application database" };
  }

  // pgsodium is conditionally installed inside a DO block for Supabase PG17.
  // Skip the complete block in vanilla PostgreSQL where pgsodium is unavailable.
  if (/CREATE\s+EXTENSION\s+pgsodium/i.test(s) && SKIP_EXTENSIONS.includes("pgsodium")) {
    return { skip: true, reason: "pgsodium not available locally" };
  }

  // 3.2. Схема extensions → public (uuid-ossp/pgcrypto/pg_trgm и т.п.)
  s = s.replace(/WITH\s+SCHEMA\s+extensions/gi, "WITH SCHEMA public");

  // 3.3. uuid_generate_v4() → gen_random_uuid()
  s = s.replace(/\buuid_generate_v4\s*\(\s*\)/gi, "gen_random_uuid()");

  return { skip: false, sql: s };
}

function isTxControl(stmt) {
  const u = stmt.replace(/^\s*\(?\s*/, "").toUpperCase();
  return (
    u === "BEGIN" ||
    u === "COMMIT" ||
    u === "ROLLBACK" ||
    u === "END" ||
    u === "START TRANSACTION" ||
    u.startsWith("BEGIN;") ||
    u.startsWith("BEGIN ") ||
    u.startsWith("COMMIT;") ||
    u.startsWith("END;")
  );
}

function isCreateIndexConcurrently(stmt) {
  return /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(stmt);
}

function isIdempotentError(err) {
  const code = err && err.code;
  if (code && IDEMPOTENT_SQLSTATES.has(code)) return true;
  const msg = (err && err.message) || "";
  return /already exists/i.test(msg) || /already a member/i.test(msg) || /multiple primary keys/i.test(msg);
}

// ============================================================================
// 4. Подключение / доступность БД
// ============================================================================
async function pingDatabase(url, timeoutMs = 4000) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    try { await client.end(); } catch { /* noop */ }
  }
}

function failNoPostgres() {
  logStep("pg", "FAIL", `PostgreSQL недоступен (DATABASE_URL = ${maskUrl(DATABASE_URL)})`);
  finishSession({ result: "FAIL", step: "pg", exitCode: 1 });
  console.error("\nPostgreSQL is not available.");
  console.error("Check DATABASE_URL and make sure PostgreSQL is running.");
  console.error(`  DATABASE_URL = ${maskUrl(DATABASE_URL)}`);
  console.error("Hint: embedded dev database → npm run db:start   |   your own PostgreSQL → start it and verify the URL.");
  process.exit(1);
}

async function ensureDatabaseExists(url) {
  const u = new URL(url);
  const dbName = (u.pathname || "/postgres").replace(/^\//, "") || "postgres";
  const adminUrl = `${u.protocol}//${u.username}${u.password ? ":" + u.password : ""}@${u.hostname}:${u.port || "5432"}/postgres`;
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 4000 });
  try {
    await client.connect();
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (res.rowCount === 0) {
      console.log(`» creating database "${dbName}"`);
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    try { await client.end(); } catch { /* noop */ }
  }
}

// ============================================================================
// 5. Демо-пользователи
// ============================================================================
const DEMO_USERS = [
  { id: "11111111-1111-4111-8111-111111111106", email: "customer@demo.ru", role: "CUSTOMER", name: "Демо Покупатель" },
  { id: "11111111-1111-4111-8111-111111111101", email: "confectioner@demo.ru", role: "CONFECTIONER", name: "Демо Кондитер (Сахарная печать)", confectionerId: "c0" },
  { id: "11111111-1111-4111-8111-111111111107", email: "admin@demo.ru", role: "ADMIN", name: "Демо Администратор" },
  { id: "11111111-1111-4111-8111-111111111108", email: "support@demo.ru", role: "SUPPORT", name: "Демо Поддержка" },
  { id: "11111111-1111-4111-8111-111111111109", email: "decor@demo.ru", role: "SUPPLIER", name: "Демо Поставщик декора" },
  { id: "11111111-1111-4111-8111-111111111110", email: "animator@demo.ru", role: "ANIMATOR_AGENCY", name: "Демо Аниматоры" },
];

async function upsertDemoUsers(client) {
  console.log("\n─── Demo users ───");
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  // Плэйсхолдеры из seed.sql (RECIPE_DEVELOPER / LOYALTY_PARTNERS) — чтобы
  // FK-сиды (recipe_marketplace.author_id, loyalty_partners.user_id) прошли.
  for (const [idx, meta] of [
    [1, "RECIPE_DEVELOPER (seed placeholder)"],
    [2, "LOYALTY_PARTNER (seed placeholder)"],
    [3, "LOYALTY_PARTNER (seed placeholder)"],
    [4, "LOYALTY_PARTNER (seed placeholder)"],
  ]) {
    const id = `00000000-0000-0000-0000-00000000000${idx}`;
    await client.query(
      `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, $2, '', now(), $3::jsonb, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [id, `system-${idx}@conditera.local`, JSON.stringify({ name: meta })]
    );
  }

  for (const u of DEMO_USERS) {
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, $2, '', now(), $3::jsonb, now(), now())
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
        [u.id, u.email, JSON.stringify({ name: u.name, demo: true })]
      );

      await client.query(
        `INSERT INTO public.profiles (id, email, name, is_verified, password_hash, is_blocked, loyalty_level, bonus_balance)
         VALUES ($1, $2, $3, true, $4, false, 'BRONZE', 0)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           is_verified = true,
           password_hash = EXCLUDED.password_hash`,
        [u.id, u.email, u.name, passwordHash]
      );

      await client.query(
        `INSERT INTO public.user_roles (user_id, role, is_active)
         VALUES ($1, $2::user_role, true)
         ON CONFLICT (user_id, role) DO UPDATE SET is_active = true, deactivated_at = NULL`,
        [u.id, u.role]
      );
      if (u.role !== "CUSTOMER") {
        // триггер on_auth_user_created добавляет CUSTOMER — деактивируем для не-покупателей
        await client.query(
          `UPDATE public.user_roles SET is_active = false WHERE user_id = $1 AND role = 'CUSTOMER'`,
          [u.id]
        );
      }

      if (u.confectionerId) {
        const res = await client.query(
          `UPDATE public.confectioners SET "userId" = $1 WHERE id = $2`,
          [u.id, u.confectionerId]
        );
        if (res.rowCount === 0) {
          await client.query(
            `INSERT INTO public.confectioners
               (id, "userId", "businessName", slug, description, avatar, cover, city, location,
                rating, "reviewsCount", "ordersCount", verified, "verificationStatus",
                "trustLevel", tariff, "legalInfo", "taxMode", specialization, "portfolioImages",
                "followersCount", "responseTime", "joinedAt", "selfPickup", "deliveryOptions",
                "paymentSettings", "ecoBadges", balance, "totalEarnings", "monthlyEarnings",
                "createdAt", "updatedAt")
             VALUES ($1, $1, 'Демо Кондитер', 'demo-konditer', 'Демо-кондитер локального рантайма.',
                     'https://i.pravatar.cc/150?img=12', 'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=1200',
                     'Москва', '{}'::jsonb, 5, 0, 0, true, 'approved', 'VERIFIED', 'BASIC', '{}'::jsonb, 'NPD',
                     ARRAY['Демо']::TEXT[], ARRAY[]::TEXT[], 0, 'быстро', now(), true,
                     ARRAY['own']::TEXT[], '{}'::jsonb, ARRAY[]::TEXT[], 0, 0, 0, now(), now())
             ON CONFLICT (id) DO NOTHING`,
            [u.confectionerId]
          );
          await client.query(`UPDATE public.confectioners SET "userId" = $1 WHERE id = $2`, [u.id, u.confectionerId]);
        }
      }

      await client.query("COMMIT");
      console.log(`  ✔ ${u.email.padEnd(22)} ${u.role}`);
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* noop */ }
      console.warn(`  ⚠ demo user ${u.email}: ${String(err.message).slice(0, 140)}`);
      logStep("seeds", "WARN", `demo user ${u.email}: ${String(err.message).slice(0, 140)}`);
    }
  }
}

// ============================================================================
// 5b. Post-seed backfill: initial-строки истории цен (ZV33-7b FIX 1 / ZV33-6 B1)
// ============================================================================
// Проблема (ZV33-6 аудит, B1): миграция 0083 сеет initial-версии цен для
// товаров, существующих НА МОМЕНТ миграции. db:setup применяет миграции ДО
// сидов, а seed_vitrine.sql вставляет 12 товаров ПОСЛЕ — на свежей БД
// product_price_history оставался пустым, и все товары жили на NULL-version
// fallback (get_product_price_at синтезировал строку из products.price).
//
// Решение: идемпотентный POST-SEED шаг — для каждого товара БЕЗ единой
// строки product_price_history вставить initial-версию той же формы, что
// бэкфилл 0083 (amount = products.price, effective_from = products.created_at,
// created_by = products.confectioner_id), source='system'.
// Повторный прогон — no-op (WHERE NOT EXISTS); перекрытий нет по построению
// (вставляем только при полном отсутствии истории товара).
async function backfillProductPriceHistory(client) {
  // 1) Товары с NULL confectioner_id: created_by NOT NULL — их сесить нечем,
  //    честно считаем и предупреждаем (не молча пропускаем).
  const orphan = await client.query(
    `SELECT count(*)::int AS c FROM products p
      WHERE p.confectioner_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM product_price_history h WHERE h.product_id = p.id)`
  );
  if (orphan.rows[0].c > 0) {
    console.warn(`  ⚠ price-history backfill: ${orphan.rows[0].c} товаров без confectioner_id пропущено (created_by NOT NULL)`);
  }

  const res = await client.query(
    `INSERT INTO public.product_price_history (
       product_id, product_variant_id, amount, currency,
       effective_from, effective_to, reason, source, cost_snapshot_rub, created_by
     )
     SELECT
       p.id, NULL, p.price, COALESCE(p.currency, 'RUB'),
       COALESCE(p.created_at, now()), NULL, 'initial', 'system', NULL, p.confectioner_id
     FROM public.products p
     WHERE p.confectioner_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.product_price_history h
         WHERE h.product_id = p.id
           AND h.product_variant_id IS NULL
       )`
  );

  const total = await client.query(
    `SELECT (SELECT count(*)::int FROM public.products) AS products,
            (SELECT count(*)::int FROM public.product_price_history) AS history,
            (SELECT count(*)::int FROM public.products p
              WHERE NOT EXISTS (SELECT 1 FROM public.product_price_history h WHERE h.product_id = p.id)) AS missing`
  );
  const t = total.rows[0];
  if (res.rowCount > 0 || t.missing > 0) {
    console.log(`  ✔ price-history backfill: +${res.rowCount} initial rows (products=${t.products}, history=${t.history}, missing=${t.missing})`);
  } else {
    console.log(`  ✔ price-history backfill: no-op (all ${t.products} products already versioned)`);
  }
  if (t.missing > 0) {
    console.warn(`  ⚠ price-history backfill: ${t.missing} товаров остались без истории — проверьте seed`);
    logStep("seeds", "WARN", `price-history backfill: ${t.missing} товаров остались без истории (exitCode=1)`);
    process.exitCode = 1;
  }
}

// ============================================================================
// 6. env-ключи (.env.local — только добавление, существующие НЕ трогаем)
// ============================================================================
function generateSupabaseJwt(role, secret) {
  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ role, iss: "local", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600 }));
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function ensureEnvKeys() {
  console.log("\n─── Env keys (.env.local) ───");
  const existing = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const present = new Set(
    lines
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => l.slice(0, l.indexOf("=")).trim())
  );

  const existingValue = (key) =>
    lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1) || "";
  // В CI/production process.env имеет приоритет над .env.local и должен
  // быть тем же ключом, которым подписываются локальные Supabase JWT.
  const jwtSecret = process.env.JWT_SECRET || existingValue("JWT_SECRET") || crypto.randomBytes(48).toString("hex");
  const jwtRefresh = process.env.JWT_REFRESH_SECRET || existingValue("JWT_REFRESH_SECRET") || crypto.randomBytes(48).toString("hex");
  const additions = [];
  const add = (key, value) => {
    if (process.env[key]) {
      console.log(`  = ${key}: supplied by process environment`);
      return;
    }
    if (present.has(key)) {
      const currentVal = existingValue(key);
      console.log(`  = ${key}: ${maskSecret(currentVal)} (kept)`);
      return;
    }
    additions.push(`${key}=${value}`);
    console.log(`  + ${key}: ${maskSecret(value)}`);
  };
  const addOrReplaceGenerated = (key, value) => {
    if (process.env[key]) {
      console.log(`  = ${key}: supplied by process environment`);
      return;
    }
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) {
      lines[index] = `${key}=${value}`;
      console.log(`  ~ ${key}: regenerated for the effective JWT_SECRET`);
      return;
    }
    additions.push(`${key}=${value}`);
    console.log(`  + ${key}: ${maskSecret(value)}`);
  };

  add("DATABASE_URL", DATABASE_URL);
  add("JWT_SECRET", jwtSecret);
  add("JWT_REFRESH_SECRET", jwtRefresh);
  add("CRON_SECRET", crypto.randomBytes(32).toString("hex"));
  add("BOT_SECRET", crypto.randomBytes(32).toString("hex"));
  add("N8N_BASE_URL", "http://127.0.0.1:5678");
  add("N8N_WEBHOOK_BASE_URL", "http://127.0.0.1:5678/webhook");
  // Self-hosted LLM (Ollama в той же Docker-сети, что Supabase/n8n).
  // Если Ollama недоступна — AI-роуты автоматически падают на платформенный
  // провайдер/fallback (fail-safe, см. src/lib/llm.ts).
  add("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
  add("OLLAMA_MODEL", "llama3.2");
  add("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  add("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:3000");
  const effectiveSecret = process.env.JWT_SECRET || existingValue("JWT_SECRET") || jwtSecret;
  addOrReplaceGenerated("SUPABASE_SERVICE_ROLE_KEY", generateSupabaseJwt("service_role", effectiveSecret));
  addOrReplaceGenerated("NEXT_PUBLIC_SUPABASE_ANON_KEY", generateSupabaseJwt("anon", effectiveSecret));

  if (additions.length > 0 || lines.join("\n") !== existing) {
    let content = lines.join("\n");
    if (!content) {
      content = [
        "# Generated by scripts/db/setup.mjs (npm run db:setup) — локальный рантайм Conditera.",
        "# PostgreSQL + собственные JWT вместо Supabase-стека. НЕ коммитить.",
        "",
      ].join("\n");
    } else if (!content.endsWith("\n")) {
      content += "\n";
    }
    writeFileSync(ENV_LOCAL, content + additions.join("\n") + (additions.length ? "\n" : ""), "utf8");
    console.log(`  → written to ${path.relative(ROOT, ENV_LOCAL)}`);
  } else {
    console.log("  all keys present — nothing to add");
  }
}

// ============================================================================
// 7. Применение файла SQL с savepoint-обработкой ошибок
// ============================================================================
async function runStatements(client, statements, { label, mode, inTx }) {
  let applied = 0;
  let skipped = 0;
  let warned = 0;
  for (let idx = 0; idx < statements.length; idx++) {
    const raw = statements[idx];
    if (!raw) continue;
    if (isTxControl(raw)) continue;
    const prep = preprocessStatement(raw);
    if (prep.skip) {
      console.log(`  [skip] ${label}: ${prep.reason}`);
      skipped++;
      continue;
    }
    const stmt = prep.sql;
    // CREATE INDEX CONCURRENTLY — только вне транзакции
    if (isCreateIndexConcurrently(stmt) && inTx) {
      try {
        await client.query(stmt);
        applied++;
      } catch (err) {
        if (isIdempotentError(err)) skipped++;
        else { warned++; console.warn(`  ⚠ ${label} stmt ${idx + 1}: ${String(err.message).slice(0, 160)}`); }
      }
      continue;
    }
    const sp = inTx ? `sp_${label.replace(/[^a-zA-Z0-9]/g, "")}_${idx}` : null;
    try {
      if (sp) await client.query(`SAVEPOINT ${sp}`);
      await client.query(stmt);
      if (sp) await client.query(`RELEASE SAVEPOINT ${sp}`);
      applied++;
    } catch (err) {
      if (sp) {
        try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); await client.query(`RELEASE SAVEPOINT ${sp}`); } catch { /* noop */ }
      }
      if (isIdempotentError(err)) {
        skipped++;
        continue;
      }
      if (mode === "seed") {
        warned++;
        console.warn(`  ⚠ seed ${label} stmt ${idx + 1}: ${String(err.message).slice(0, 160)}`);
        continue;
      }
      // migration mode — fatal
      const context = stmt.slice(0, 300);
      console.error(`\n✖ Migration failed: ${label}, statement ${idx + 1}/${statements.length}`);
      console.error(`  SQL: ${context}${stmt.length > 300 ? "…" : ""}`);
      console.error(`  PG: ${err.message} (code ${err.code || "?"})`);
      throw err;
    }
  }
  return { applied, skipped, warned };
}

// ============================================================================
// Основной поток
// ============================================================================
async function main() {
  const seedOnly = process.argv.includes("--seed-only");
  const seedMode = (process.env.SEED_MODE || (seedOnly ? "demo" : "none")).trim().toLowerCase();
  if (seedMode !== "none" && seedMode !== "demo") {
    throw new Error(`SEED_MODE должен быть none или demo, получено: ${seedMode}`);
  }
  const runDemoSeeds = seedMode === "demo";
  console.log(`» DATABASE_URL: ${maskUrl(DATABASE_URL)} (${databaseUrlSource})`);
  console.log(`» SEED_MODE: ${seedMode}${runDemoSeeds ? " (demo data enabled)" : " (demo data disabled)"}`);

  // 2. Доступность БД (+ автостарт embedded)
  logStep("pg", "START", "проверка/старт PostgreSQL (embedded или внешний через DATABASE_URL)");
  const ADV_LOCK_KEY = "hashtext('conditera_migrations')";
  let client;
  try {
    if (DATABASE_URL.includes("127.0.0.1:54329") || DATABASE_URL.includes("localhost:54329")) {
      const runtime = await import("./runtime.mjs");
      const status = await runtime.getStatus();
      if (!status.running) {
        console.log("» embedded PostgreSQL is not running — starting...");
        await runtime.start();
      }
      await runtime.ensureDatabase(DATABASE_URL);
    } else {
      const ping = await pingDatabase(DATABASE_URL);
      if (!ping.ok) failNoPostgres();
      await ensureDatabaseExists(DATABASE_URL);
    }

    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    console.log("✔ connected to PostgreSQL");

    // Z-v26 (F4): сериализация параллельных запусков setup.
    // Session-level advisory lock: жизненный цикл однозначен — освобождается при
    // выходе (успех/ошибка/обрыв соединения/креш процесса), вечная блокировка
    // невозможна. Второй экземпляр ждёт, затем видит полный леджер и завершается
    // без работы (доказано: без блокировки два параллельных setup давали
    // spurious-падение на CREATE SCHEMA — гонка pg_namespace_nspname_index).
    await client.query(`SELECT pg_advisory_lock(${ADV_LOCK_KEY})`);
    console.log("✔ advisory lock acquired (conditera_migrations)");
    logStep("pg", "OK", "PostgreSQL доступен; подключение установлено; advisory lock получен");
  } catch (err) {
    logStep("pg", "FAIL", String(err && err.message ? err.message : err));
    throw err;
  }

  try {
    // 4. Compat-слой (идемпотентен)
    logStep("migrations", "START", "compat-слой → миграции + ledger (→ local fixups)");
    if (!seedOnly) {
      console.log("\n─── Supabase compat layer ───");
      const compatSql = readFileSync(COMPAT_SQL, "utf8");
      await client.query("BEGIN");
      try {
        const res = await runStatements(client, splitSqlStatements(compatSql), { label: "compat", mode: "migration", inTx: true });
        await client.query("COMMIT");
        console.log(`  ✔ compat: ${res.applied} applied, ${res.skipped} idempotent-skip`);
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* noop */ }
        logStep("migrations", "FAIL", `compat layer failed: ${err.message}`);
        throw new Error(`compat layer failed: ${err.message}`);
      }
    }

    // 5. Миграции + ledger
    console.log("\n─── Migrations ───");
    await client.query(
      `CREATE TABLE IF NOT EXISTS public.schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    const ledger = await client.query(`SELECT filename FROM public.schema_migrations`);
    const appliedFiles = new Set(ledger.rows.map((r) => r.filename));

    let files = existsSync(MIGRATIONS_DIR)
      ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
      : [];
    // natural sort: 0001, 0016, 0016b, 0017, 0017b, … (по ведущему числу + суффиксу)
    files.sort((a, b) => {
      const pa = a.match(/^(\d+)(.*)$/);
      const pb = b.match(/^(\d+)(.*)$/);
      const na = pa ? Number(pa[1]) : Number.MAX_SAFE_INTEGER;
      const nb = pb ? Number(pb[1]) : Number.MAX_SAFE_INTEGER;
      if (na !== nb) return na - nb;
      const sa = pa && pa[2] ? 1 : 0;
      const sb = pb && pb[2] ? 1 : 0;
      if (sa !== sb) return sa - sb; // 0016 до 0016b
      return a.localeCompare(b);
    });

    // Migration filename aliases: preserve the existing schema_migrations
    // ledger when historical branches renamed/re-numbered equivalent SQL files.
    // Only aliases whose canonical file exists in this tree are materialized.
    const migrationAliases = [
      ["0061_user_consent_events.sql", "0061a_user_consent_events.sql"],
      ["0062_reference_catalog.sql", "0062b_reference_catalog.sql"],
      ["0062a_reference_catalog.sql", "0062b_reference_catalog.sql"],
      ["0063a_cake_project_spec.sql", "0063_cake_project_spec.sql"],
      ["0064a_product_slices_rls.sql", "0064_product_slices_rls.sql"],
      ["0065_cms_home_blocks.sql", "0109_cms_home_blocks.sql"],
      ["0068_cms_design_warm_defaults.sql", "0110_cms_design_warm_defaults.sql"],
      ["0069_cms_atomic_home_reorder.sql", "0111_cms_atomic_home_reorder.sql"],
      ["0070_cms_reorder_write_serialization.sql", "0112_cms_reorder_write_serialization.sql"],
      ["0071_cms_home_section_composition.sql", "0113_cms_home_section_composition.sql"],
      ["0072_cms_public_section_configuration.sql", "0114_cms_public_section_configuration.sql"],
      ["0073_cms_home_section_default_order.sql", "0115_cms_home_section_default_order.sql"],
      ["0066_service_role_default_grants.sql", "0066a_service_role_default_grants.sql"],
      ["0067_repair_updated_at_triggers.sql", "0067a_repair_updated_at_triggers.sql"],
      ["0068_moderation_queue_schema_alignment.sql", "0102_moderation_queue_schema_alignment.sql"],
      ["0074_escrow_release_cancel_guard.sql", "0088_escrow_release_cancel_guard.sql"],
      ["0075_order_access_rls.sql", "0089_order_access_rls.sql"],
      ["0076_atomic_courier_assignment.sql", "0090_atomic_courier_assignment.sql"],
      ["0077_private_order_media_storage.sql", "0091_private_order_media_storage.sql"],
      ["0078_order_ready_photo_limit.sql", "0092_order_ready_photo_limit.sql"],
      ["0079_user_session_registry.sql", "0093_user_session_registry.sql"],
      ["0080_session_refresh_rotation.sql", "0094_session_refresh_rotation.sql"],
      ["0081_fix_assign_order_delivery_ambiguity.sql", "0095_fix_assign_order_delivery_ambiguity.sql"],
      ["0082_quote_project_media.sql", "0096_quote_project_media.sql"],
      ["0083_quote_acceptance_to_order.sql", "0097_quote_acceptance_to_order.sql"],
      ["0084_quote_customer_rejection.sql", "0098_quote_customer_rejection.sql"],
      ["0085_atomic_save_confectioner_quote.sql", "0099_atomic_save_confectioner_quote.sql"],
      ["0086_fix_quote_confectioner_identity.sql", "0100_fix_quote_confectioner_identity.sql"],
      ["0087_quote_media_private_bucket.sql", "0101_quote_media_private_bucket.sql"],
      ["0087_user_consent_events.sql", "0061a_user_consent_events.sql"],
      ["0087_restrict_public_analytics_and_trigger_rpcs.sql", "0117_restrict_public_analytics_and_trigger_rpcs.sql"],
      ["0108_restrict_public_analytics_and_trigger_rpcs.sql", "0117_restrict_public_analytics_and_trigger_rpcs.sql"],
      ["0109_restrict_public_analytics_and_trigger_rpcs.sql", "0117_restrict_public_analytics_and_trigger_rpcs.sql"],
      ["0088_reference_catalog.sql", "0062b_reference_catalog.sql"],
      ["0088_harden_yookassa_refund_rpc.sql", "0103_harden_yookassa_refund_rpc.sql"],
      ["0089_financial_ledger.sql", "0063a_financial_ledger.sql"],
      ["0089_enforce_single_active_account_session.sql", "0104_enforce_single_active_account_session.sql"],
      ["0089_abandoned_cart_delivery_tracking.sql", "0107_abandoned_cart_delivery_tracking.sql"],
      ["0090_supplier_procurement.sql", "0064a_supplier_procurement.sql"],
      ["0090_order_disputes_and_immutable_evidence.sql", "0105_order_disputes_and_immutable_evidence.sql"],
      ["0091_service_role_default_grants.sql", "0066a_service_role_default_grants.sql"],
      ["0091_order_dispute_messages.sql", "0106_order_dispute_messages.sql"],
      ["0092_repair_updated_at_triggers.sql", "0067a_repair_updated_at_triggers.sql"],
      ["0092_postgrest_maintenance_enum_compat.sql", "0108_postgrest_maintenance_enum_compat.sql"],
      ["0095_user_session_registry.sql", "0093_user_session_registry.sql"],
      ["0096_session_refresh_rotation.sql", "0094_session_refresh_rotation.sql"],
      ["0097_enforce_single_active_account_session.sql", "0104_enforce_single_active_account_session.sql"],
      ["0098_fix_assign_order_delivery_ambiguity.sql", "0095_fix_assign_order_delivery_ambiguity.sql"],
      ["0099_quote_project_media.sql", "0096_quote_project_media.sql"],
      ["0100_quote_acceptance_to_order.sql", "0097_quote_acceptance_to_order.sql"],
      ["0101_quote_customer_rejection.sql", "0098_quote_customer_rejection.sql"],
      ["0102_atomic_save_confectioner_quote.sql", "0099_atomic_save_confectioner_quote.sql"],
      ["0103_fix_quote_confectioner_identity.sql", "0100_fix_quote_confectioner_identity.sql"],
      ["0104_quote_media_private_bucket.sql", "0101_quote_media_private_bucket.sql"],
      ["0105_escrow_release_cancel_guard.sql", "0088_escrow_release_cancel_guard.sql"],
      ["0106_order_access_rls.sql", "0089_order_access_rls.sql"],
      ["0107_atomic_courier_assignment.sql", "0090_atomic_courier_assignment.sql"],
      ["0108_private_order_media_storage.sql", "0091_private_order_media_storage.sql"],
      ["0109_order_ready_photo_limit.sql", "0092_order_ready_photo_limit.sql"],
      ["0102_harden_yookassa_refund_rpc.sql", "0103_harden_yookassa_refund_rpc.sql"],
      ["0103_abandoned_cart_delivery_tracking.sql", "0107_abandoned_cart_delivery_tracking.sql"],
      ["0107_postgrest_maintenance_enum_compat.sql", "0108_postgrest_maintenance_enum_compat.sql"],
      ["0108_moderation_queue_schema_alignment.sql", "0102_moderation_queue_schema_alignment.sql"],
    ];
    for (const [legacyName, canonicalName] of migrationAliases) {
      if (!appliedFiles.has(legacyName) || appliedFiles.has(canonicalName) || !files.includes(canonicalName)) continue;
      await client.query(
        "INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
        [canonicalName]
      );
      appliedFiles.add(canonicalName);
      console.log(`  ↪ migration ledger alias: ${legacyName} → ${canonicalName}`);
    }

    // Z-v24: детекция дубликатов migration ID ДО применения любого SQL.
    // Конвенция проекта: вариантные файлы одного номера именуются ЧИСЛО+БУКВА
    // (0016, 0016b); два файла с одинаковым числовым префиксом и остатком,
    // начинающимся с «_» — конфликт дубликатов (инцидент Z-v24: 0062_cart_custom_items
    // + 0062_cart_sync_custom → взаимоисключающие CHECK → 500 на POST /api/cart).
    // Блокируем запуск ДО SQL — дубликаты не должны попадать в леджер/схему.
    const dupGroups = new Map();
    for (const f of files) {
      const m = f.match(/^(\d+)/);
      if (!m) continue;
      const rest = f.slice(m[1].length);
      if (!rest.startsWith("_")) continue; // вариантный суффикс вида 0016b — легален
      const key = m[1];
      if (!dupGroups.has(key)) dupGroups.set(key, []);
      dupGroups.get(key).push(f);
    }
    const duplicates = [...dupGroups.entries()].filter(([, fs]) => fs.length > 1);
    if (duplicates.length > 0) {
      for (const [num, fs] of duplicates) {
        console.error(`\n✖ ДУБЛИКАТ MIGRATION ID ${num}: ${fs.join(", ")}`);
      }
      console.error("  Применение прервано ДО SQL: дублирующиеся migration ID запрещены (Z-v24).");
      logStep("migrations", "FAIL", `дубликаты migration ID: ${duplicates.map(([num, fs]) => `${num} → ${fs.join(", ")}`).join("; ")}`);
      finishSession({ result: "FAIL", step: "migrations", exitCode: 1 });
      process.exit(1);
    }

    const pending = files.filter((f) => !appliedFiles.has(f));
    if (seedOnly && appliedFiles.size > 0) {
      console.log(`  (seed-only: ${appliedFiles.size} миграций уже применены — пропускаем)`);
    }
    let appliedCount = 0;
    let migrationsFailed = false;
    for (const file of pending) {
      if (appliedFiles.has(file)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitSqlStatements(sql);
      // Файлы, которые сами управляют транзакциями / добавляют enum-значения
      // (ALTER TYPE ADD VALUE нельзя использовать до коммита в той же tx) —
      // выполняем в autocommit, как это делал psql. Остальные — атомарно.
      const fileWantsAutocommit = /ALTER\s+TYPE[\s\S]{0,400}?ADD\s+VALUE/i.test(sql);
      if (fileWantsAutocommit) {
        // Нетранзакционный режим: ALTER TYPE ADD VALUE нельзя откатить в той же tx.
        // Частично применённый файл в этом режиме НЕ откатывается — повторный
        // запуск добирает остаток за счёт idempotent-skip уже применённых стейтментов.
        console.log(`  [autocommit] ${file} (нетранзакционные операции — см. комментарий в runner)`);
      }
      try {
        let res;
        if (fileWantsAutocommit) {
          res = await runStatements(client, statements, { label: file, mode: "migration", inTx: false });
        } else {
          await client.query("BEGIN");
          try {
            res = await runStatements(client, statements, { label: file, mode: "migration", inTx: true });
            await client.query("COMMIT");
          } catch (err2) {
            await client.query("ROLLBACK");
            throw err2;
          }
        }
        await client.query(`INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`, [file]);
        appliedCount++;
        console.log(`  ✔ ${file}: ${res.applied} stmts, ${res.skipped} idempotent-skip${res.warned ? `, ${res.warned} warns` : ""}`);
      } catch (err) {
        console.error(`\n✖ File: ${file}`);
        console.error(`  причина: ${err && err.message ? err.message : String(err)}`);
        logStep("migrations", "FAIL", `${file}: ${err && err.message ? err.message : String(err)}`);
        migrationsFailed = true;
        process.exitCode = 1;
        break;
      }
    }
    console.log(`  migrations: ${appliedCount} newly applied (${appliedFiles.size + appliedCount} total in ledger)`);
    if (migrationsFailed) {
      // Z-v24 fail-fast: схема неполна — fixups/demo-users/seeds зависят от схемы
      // и дадут ложные результаты. Не выполняем их, отдаём ненулевой exit code.
      console.error("\n✖ Миграция не применена — fixups/demo-users/seeds пропущены (fail-fast, Z-v24).");
      console.error("  БД в консистентном состоянии: упавший файл откачен целиком, в леджер не записан.");
      await client.end();
      finishSession({ result: "FAIL", step: "migrations", exitCode: 1 });
      process.exit(1);
    }
    logStep("migrations", "OK", `миграции применены: +${appliedCount} новых, в леджере ${appliedFiles.size + appliedCount} файлов`);

    // 6. Сиды (в одной транзакции на файл — маленькие и идемпотентные)
    // Локальные фиксы (после миграций): RLS-рекурсии и прочие vanilla-PG правки
    if (!seedOnly) {
      const fixupsPath = path.join(ROOT, "supabase", "compat", "0001_local_fixups.sql");
      if (existsSync(fixupsPath)) {
        console.log("\n─── Local fixups ───");
        const fixupSql = readFileSync(fixupsPath, "utf8");
        await client.query("BEGIN");
        try {
          const res = await runStatements(client, splitSqlStatements(fixupSql), { label: "0001_local_fixups.sql", mode: "migration", inTx: true });
          await client.query("COMMIT");
          console.log(`  \u2714 0001_local_fixups.sql: ${res.applied} stmts, ${res.skipped} idempotent-skip`);
        } catch (fixupErr) {
          try { await client.query("ROLLBACK"); } catch { /* noop */ }
          console.error(`  \u2716 fixups failed: ${String(fixupErr.message).slice(0, 220)}`);
          logStep("migrations", "WARN", `local fixups failed (нефатально, exitCode=1): ${String(fixupErr.message).slice(0, 220)}`);
          process.exitCode = 1;
        }
      }
    }

if (runDemoSeeds) {
// 7. Демо-пользователи — ДО сидов: seed_vitrine/0003_seed_inventory
//    джойнят profiles по email (confectioner@demo.ru и др.), поэтому на
//    ЧИСТОЙ БД без этой перестановки склад/витрина оставались пустыми
//    (сид молча вставлял 0 строк — JOIN не находил профиль).
//    Безопасно: ON CONFLICT (id) DO UPDATE у seed_confectioners.sql
//    не перезаписывает "userId" — линк демо-кондитера на c0 сохраняется.
logStep("seeds", "START", "демо-пользователи → сиды → price-history backfill");
await upsertDemoUsers(client);

console.log("\n─── Seeds ───");
    for (const seedFile of SEED_FILES) {
      if (!existsSync(seedFile)) {
        console.log(`  (missing: ${path.basename(seedFile)})`);
        continue;
      }
      // .mjs-сид: JS-модуль с export default async ({ client, ROOT }).
      // Модуль сам делает client.query; здесь — только обёртка BEGIN/COMMIT
      // и отлов ошибок (модуль НЕ должен открывать свою транзакцию).
      if (path.basename(seedFile).endsWith(".mjs")) {
        await client.query("BEGIN");
        try {
          const mod = await import(pathToFileURL(seedFile).href);
          if (typeof mod.default !== "function") {
            throw new Error("mjs seed must export default async function");
          }
          await mod.default({ client, ROOT });
          await client.query("COMMIT");
          console.log(`  ✔ ${path.basename(seedFile)}: mjs seed ok`);
        } catch (err) {
          try { await client.query("ROLLBACK"); } catch { /* noop */ }
          console.warn(`  ⚠ ${path.basename(seedFile)} aborted: ${String(err.message).slice(0, 140)}`);
          logStep("seeds", "WARN", `${path.basename(seedFile)} aborted: ${String(err.message).slice(0, 140)}`);
        }
        continue;
      }
      const sql = readFileSync(seedFile, "utf8");
      await client.query("BEGIN");
      try {
        const res = await runStatements(client, splitSqlStatements(sql), { label: path.basename(seedFile), mode: "seed", inTx: true });
        await client.query("COMMIT");
        console.log(`  ✔ ${path.basename(seedFile)}: ~${res.applied} statements ok, ${res.warned} warn, ${res.skipped} idempotent-skip`);
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* noop */ }
        console.warn(`  ⚠ ${path.basename(seedFile)} aborted: ${String(err.message).slice(0, 140)}`);
        logStep("seeds", "WARN", `seed ${path.basename(seedFile)} aborted: ${String(err.message).slice(0, 140)}`);
      }
    }

    // 7b. Post-seed backfill: initial-строки product_price_history для товаров,
    //     вставленных СИДАМИ ПОСЛЕ миграций (ZV33-7b FIX 1; идемпотентно).
    console.log("\n─── Post-seed price-history backfill ───");
    await backfillProductPriceHistory(client);
    logStep("seeds", "OK", "демо-пользователи, сиды и backfill выполнены (детали — в консоли)");
} else {
      console.log("\n─── Demo seeds skipped (SEED_MODE=none) ───");
    }

    // 8. env-ключи
    logStep("env-keys", "START", "запись недостающих ключей в .env.local (существующие не перезаписываются; значения секретов не логируются)");
    try {
      ensureEnvKeys();
      logStep("env-keys", "OK", ".env.local актуализирован (детали добавлений — в консоли)");
    } catch (err) {
      logStep("env-keys", "FAIL", String(err && err.message ? err.message : err));
      throw err;
    }

    // 9. Итог
    console.log("\n─── Summary ───");
    console.log(`  DATABASE_URL: ${maskUrl(DATABASE_URL)}`);
    console.log(`  Migrations ledger: ${(await client.query(`SELECT count(*)::int AS c FROM public.schema_migrations`)).rows[0].c} files`);
    if (runDemoSeeds) {
      console.log("\n  Demo credentials (password for all: Demo123!):");
      console.log("  ┌─────────────────────────┬──────────────────┐");
      for (const u of DEMO_USERS) {
        console.log(`  │ ${u.email.padEnd(23)} │ ${u.role.padEnd(16)} │`);
      }
      console.log("  └─────────────────────────┴──────────────────┘");
    } else {
      console.log("\n  Demo credentials: not created (SEED_MODE=none)");
    }
    console.log("\n  Next step: npm run dev");
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${ADV_LOCK_KEY})`);
    } catch { /* session end releases the lock anyway */ }
    await client.end().catch(() => {});
  }

  const setupExitCode = process.exitCode || 0;
  finishSession({
    result: setupExitCode === 0 ? "OK" : "DONE_WITH_WARNINGS",
    exitCode: setupExitCode,
  });
}

main().catch((err) => {
  logStep("setup", "FAIL", `необработанная ошибка: ${err && err.message ? err.message : err}`);
  finishSession({ result: "FAIL", exitCode: 1 });
  console.error(`✖ FATAL: ${err.message || err}`);
  process.exit(1);
});
