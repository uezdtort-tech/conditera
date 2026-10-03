#!/usr/bin/env node
/**
 * scripts/db/setup.mjs — полная подготовка локальной БД «Conditera».
 *
 *   npm run db:setup            — полный прогон: embedded PG (если нужно) →
 *                                 compat → миграции → сиды → демо-юзеры → env-ключи
 *   npm run db:seed             — (флаг --seed-only) только сиды + демо-юзеры +
 *                                 env-ключи; миграции применяются только если их ещё нет
 *
 * Plain Node (без bun и Unix-shell), работает на Windows/macOS/Linux.
 * PostgreSQL: встроенный (@embedded-postgres) или свой — через DATABASE_URL.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";

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
} catch { /* некритично */ }

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

  // 3.2. Схема extensions → public (uuid-ossp/pgcrypto/pg_trgm и т.п.)
  s = s.replace(/WITH\s+SCHEMA\s+extensions/gi, "WITH SCHEMA public");

  // 3.3. uuid_generate_v4() → gen_random_uuid()
  s = s.replace(/\buuid_generate_v4\s*\(\s*\)/gi, "gen_random_uuid()");

  // 3.4. 0039: политика confectioner_transactions_owner_select сравнивает
  // user_id = auth.uid(), но локальная таблица (0017) колонки user_id не имеет
  // (там confectionerId TEXT). Скипаем политику: таблица остаётся default-deny
  // для anon/authenticated (цель 0039 — закрыть широкий GRANT 0011:314),
  // service_role (BYPASSRLS) сохраняет полный доступ.
  if (
    /CREATE\s+POLICY/i.test(s) &&
    /confectioner_transactions/i.test(s) &&
    /user_id\s*=\s*auth\.uid\(\)/i.test(s)
  ) {
    return {
      skip: true,
      reason:
        "confectioner_transactions owner-policy: local table has no user_id column (0017 uses confectionerId TEXT); table stays default-deny for non-service roles",
    };
  }

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
    }
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

  const jwtSecret = crypto.randomBytes(48).toString("hex");
  const jwtRefresh = crypto.randomBytes(48).toString("hex");
  const additions = [];
  const add = (key, value) => {
    if (present.has(key)) {
      const currentVal = lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1) || "";
      console.log(`  = ${key}: ${maskSecret(currentVal)} (kept)`);
      return;
    }
    additions.push(`${key}=${value}`);
    console.log(`  + ${key}: ${maskSecret(value)}`);
  };

  add("DATABASE_URL", DATABASE_URL);
  add("JWT_SECRET", jwtSecret);
  add("JWT_REFRESH_SECRET", jwtRefresh);
  add("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  add("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:3000");
  const effectiveSecret = present.has("JWT_SECRET")
    ? lines.find((l) => l.startsWith("JWT_SECRET="))?.slice("JWT_SECRET=".length) || jwtSecret
    : jwtSecret;
  add("SUPABASE_SERVICE_ROLE_KEY", generateSupabaseJwt("service_role", effectiveSecret));
  add("NEXT_PUBLIC_SUPABASE_ANON_KEY", generateSupabaseJwt("anon", effectiveSecret));

  if (additions.length > 0) {
    let content = existing;
    if (!content) {
      content = [
        "# Generated by scripts/db/setup.mjs (npm run db:setup) — локальный рантайм Conditera.",
        "# PostgreSQL + собственные JWT вместо Supabase-стека. НЕ коммитить.",
        "",
      ].join("\n");
    } else if (!content.endsWith("\n")) {
      content += "\n";
    }
    writeFileSync(ENV_LOCAL, content + additions.join("\n") + "\n", "utf8");
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
  console.log(`» DATABASE_URL: ${maskUrl(DATABASE_URL)} (${databaseUrlSource})`);

  // 2. Доступность БД (+ автостарт embedded)
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

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log("✔ connected to PostgreSQL");

  try {
    // 4. Compat-слой (идемпотентен)
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

    const pending = files.filter((f) => !appliedFiles.has(f));
    if (seedOnly && appliedFiles.size > 0) {
      console.log(`  (seed-only: ${appliedFiles.size} миграций уже применены — пропускаем)`);
    }
    let appliedCount = 0;
    for (const file of pending) {
      if (appliedFiles.has(file)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitSqlStatements(sql);
      // Файлы, которые сами управляют транзакциями / добавляют enum-значения
      // (ALTER TYPE ADD VALUE нельзя использовать до коммита в той же tx) —
      // выполняем в autocommit, как это делал psql. Остальные — атомарно.
      const fileWantsAutocommit = /ALTER\s+TYPE[\s\S]{0,400}?ADD\s+VALUE/i.test(sql);
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
        process.exitCode = 1;
        break;
      }
    }
    console.log(`  migrations: ${appliedCount} newly applied (${appliedFiles.size + appliedCount} total in ledger)`);

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
          process.exitCode = 1;
        }
      }
    }

console.log("\n─── Seeds ───");
    for (const seedFile of SEED_FILES) {
      if (!existsSync(seedFile)) {
        console.log(`  (missing: ${path.basename(seedFile)})`);
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
      }
    }

    // 7. Демо-пользователи
    await upsertDemoUsers(client);

    // 8. env-ключи
    ensureEnvKeys();

    // 9. Итог
    console.log("\n─── Summary ───");
    console.log(`  DATABASE_URL: ${maskUrl(DATABASE_URL)}`);
    console.log(`  Migrations ledger: ${(await client.query(`SELECT count(*)::int AS c FROM public.schema_migrations`)).rows[0].c} files`);
    console.log("\n  Demo credentials (password for all: Demo123!):");
    console.log("  ┌─────────────────────────┬──────────────────┐");
    for (const u of DEMO_USERS) {
      console.log(`  │ ${u.email.padEnd(23)} │ ${u.role.padEnd(16)} │`);
    }
    console.log("  └─────────────────────────┴──────────────────┘");
    console.log("\n  Next step: npm run dev");
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`✖ FATAL: ${err.message || err}`);
  process.exit(1);
});
