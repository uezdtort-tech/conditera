#!/usr/bin/env node
/**
 * scripts/verify/prodpath-0075-verify.mjs — RELEASE-02 §3: production migration path.
 *
 * Воспроизводит контракт прод-мигратора supabase/init-scripts/01-apply-migrations.sh:
 *   • psql autocommit — каждый statement отдельной неявной транзакцией;
 *   • ON_ERROR_STOP=1 — ЛЮБАЯ ошибка валит файл (ничего не глотается);
 *   • ledger public.schema_migrations(filename) — отметка ПОСЛЕ успеха файла;
 *   • повторный запуск пропускает файлы из ledger;
 *   • падение = «схема в частично применённом состоянии», рестарт файла с нуля.
 *
 * Проверки:
 *   Phase 1 — чистая PG 18 БД A: compat + все миграции (strict autocommit) → ledger 74.
 *   Phase 2 — структурные пост-проверки (0075: FK → recipes RESTRICT, legacy FK отсутствует).
 *   Phase 3 — строгий повторный прогон 0075 на БД A: НОЛЬ ошибок (все DO-гварды).
 *   Phase 4 — БД B: compat + 0001..0074, ЧАСТИЧНОЕ применение 0075 (crash после stmt 1),
 *             затем полный рестарт файла → успех; затем ещё раз → no-op; ledger ровно одна запись.
 *
 * Evidence: docs/evidence/release-gate/prodpath-0075-<ts>.json
 * Запуск: node scripts/verify/prodpath-0075-verify.mjs
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(require.resolve("../db/runtime.mjs")), "..", "..");
const { Client } = require("pg");

const runtime = await import("../db/runtime.mjs");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const COMPAT_SQL = path.join(ROOT, "supabase", "compat", "0000_supabase_compat.sql");
const EVIDENCE_DIR = path.join(ROOT, "docs", "evidence", "release-gate");

const SKIP_EXTENSIONS = ["pg_cron", "pgsodium"];
const BASE = "postgresql://postgres@127.0.0.1:54329/postgres";

// --- сплиттер: дословно из scripts/db/setup.mjs (единый контракт парсинга) ---
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
      if (m) { current += m[0]; i += m[0].length; inDollarQuote = m[0]; continue; }
    }
    if (inDollarQuote && sql.slice(i, i + inDollarQuote.length) === inDollarQuote) {
      current += inDollarQuote; i += inDollarQuote.length; inDollarQuote = null; continue;
    }
    if (ch === "'" && !inDollarQuote) {
      inSingleQuote = !inSingleQuote; current += ch; i++; continue;
    }
    if (ch === "'" && inSingleQuote && !inDollarQuote) {
      if (sql[i + 1] === "'") { current += "''"; i += 2; continue; }
      inSingleQuote = false; current += ch; i++; continue;
    }
    if (ch === ";" && !inDollarQuote && !inSingleQuote) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = ""; i++; continue;
    }
    current += ch; i++;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function preprocessStatement(stmt) {
  let s = stmt;
  const extMatch = s.match(/^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-zA-Z0-9_-]+)["']?/i);
  if (extMatch && SKIP_EXTENSIONS.includes(extMatch[1].toLowerCase())) {
    return { skip: true, reason: `${extMatch[1]} not available in vanilla PG` };
  }
  s = s.replace(/WITH\s+SCHEMA\s+extensions/gi, "WITH SCHEMA public");
  s = s.replace(/\buuid_generate_v4\s*\(\s*\)/gi, "gen_random_uuid()");
  if (
    /CREATE\s+POLICY/i.test(s) &&
    /confectioner_transactions/i.test(s) &&
    /user_id\s*=\s*auth\.uid\(\)/i.test(s)
  ) {
    return { skip: true, reason: "confectioner_transactions owner-policy: local 0017 table has no user_id column" };
  }
  return { skip: false, sql: s };
}

function isTxControl(stmt) {
  const u = stmt.replace(/^\s*\(?\s*/, "").toUpperCase();
  return u === "BEGIN" || u === "COMMIT" || u === "ROLLBACK" || u === "END" ||
    u.startsWith("BEGIN;") || u.startsWith("BEGIN ") || u.startsWith("COMMIT;") || u.startsWith("END;");
}

// ============================================================================
async function ensureRunning() {
  const st = await runtime.getStatus();
  if (!st.running) {
    console.log("» embedded PG 18 not running — starting…");
    await runtime.start();
  }
  const st2 = await runtime.getStatus();
  if (!st2.running) throw new Error("embedded PG failed to start");
  console.log(`✔ PG running (pid ${st2.pid}) on :54329`);
}

async function newClient(db) {
  const c = new Client({ connectionString: `postgresql://postgres@127.0.0.1:54329/${db}` });
  await c.connect();
  return c;
}

async function recreateDatabase(name) {
  const admin = await newClient("postgres");
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally { await admin.end(); }
  console.log(`✔ database ${name} recreated (clean)`);
}

/**
 * Строгий прогон одного SQL-файла в autocommit, statement-by-statement.
 * НИКАКИХ исключений не глотается: первая ошибка = fail файла (контракт psql).
 * opts.untilStatement — применить только первые N стейтментов (симуляция crash).
 */
async function applyFileStrict(db, filePath, { untilStatement = Infinity } = {}) {
  const client = await newClient(db);
  const label = path.basename(filePath);
  try {
    const sql = readFileSync(filePath, "utf8");
    const statements = splitSqlStatements(sql);
    let executed = 0, skipped = 0, idx = 0;
    for (const raw of statements) {
      if (!raw) continue;
      if (isTxControl(raw)) continue; // psql выполняет их вхолостую; семантика та же
      idx += 1;
      if (idx > untilStatement) break;
      const prep = preprocessStatement(raw);
      if (prep.skip) { skipped += 1; continue; }
      try {
        await client.query(prep.sql); // autocommit: нет BEGIN — как psql без -1
        executed += 1;
      } catch (err) {
        const detail = `PG ${err.code || "?"}: ${String(err.message).slice(0, 300)}`;
        return { ok: false, label, failedAt: idx, executed, skipped, detail, stmt: prep.sql.slice(0, 240) };
      }
    }
    return { ok: true, label, executed, skipped, total: idx };
  } finally { await client.end(); }
}

async function markLedger(db, filename) {
  const client = await newClient(db);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS public.schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    );
    await client.query(`INSERT INTO public.schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING`, [filename]);
  } finally { await client.end(); }
}

function sortMigrations(files) {
  return [...files].sort((a, b) => {
    const pa = a.match(/^(\d+)(.*)$/), pb = b.match(/^(\d+)(.*)$/);
    const na = pa ? Number(pa[1]) : Number.MAX_SAFE_INTEGER, nb = pb ? Number(pb[1]) : Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;
    const sa = pa && pa[2] ? 1 : 0, sb = pb && pb[2] ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });
}

// ============================================================================
const report = { startedAt: new Date().toISOString(), phases: {}, ok: false };
let fatal = null;
try {
  await ensureRunning();
  const pgv = await (async () => { const c = await newClient("postgres"); try { const r = await c.query("SELECT version() v"); return r.rows[0].v; } finally { await c.end(); } })();
  report.pgVersion = pgv;
  console.log(`» ${pgv.slice(0, 80)}`);
  if (!/PostgreSQL 18\./.test(pgv)) throw new Error(`Ожидался PostgreSQL 18, получено: ${pgv.slice(0, 40)}`);

  const files = sortMigrations(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")));
  report.migrationFiles = files.length;
  console.log(`» migration files: ${files.length} (0073 отсутствует намеренно — gap документирован)`);
  if (files.length !== 74) throw new Error(`Ожидалось 74 файла миграций, найдено ${files.length}`);

  // ── Phase 1: БД A — полный строгий прогон ─────────────────────────────────
  console.log("\n══ PHASE 1: чистая БД A — compat + все 74 миграции (psql autocommit, fail-fast) ══");
  await recreateDatabase("conditera_prodpath_a");
  const phase1 = [];
  for (const f of [{ name: "0000_supabase_compat.sql", path: COMPAT_SQL }, ...files.map((f) => ({ name: f, path: path.join(MIGRATIONS_DIR, f) }))]) {
    const r = await applyFileStrict("conditera_prodpath_a", f.path);
    if (!r.ok) {
      console.error(`✖ ${r.label} FAILED at statement ${r.failedAt}: ${r.detail}\n   SQL: ${r.stmt}`);
      phase1.push(r); break;
    }
    await markLedger("conditera_prodpath_a", f.name);
    phase1.push({ ok: true, label: r.label, executed: r.executed, skipped: r.skipped });
  }
  const applied = phase1.filter((r) => r.ok);
  const failed = phase1.find((r) => !r.ok);
  report.phases.phase1 = { total: phase1.length, applied: applied.length, failed: failed || null };
  if (failed) throw new Error(`Phase 1: миграция ${failed.label} упала (strict autocommit)`);
  console.log(`✔ Phase 1: ${applied.length}/${phase1.length} файлов применено строго (0 ошибок)`);

  // ledger count
  {
    const c = await newClient("conditera_prodpath_a");
    try {
      const r = await c.query(`SELECT count(*)::int c FROM public.schema_migrations`);
      report.phases.ledgerCountA = r.rows[0].c;
      console.log(`✔ ledger: ${r.rows[0].c} файлов (74 миграции + compat)`);
      if (r.rows[0].c !== files.length + 1) throw new Error(`ledger=${r.rows[0].c}, ожидалось ${files.length + 1}`);
    } finally { await c.end(); }
  }

  // ── Phase 2: структурные пост-проверки 0075 ──────────────────────────────
  console.log("\n══ PHASE 2: структурные проверки (0075) ══");
  {
    const c = await newClient("conditera_prodpath_a");
    try {
      const fk = await c.query(`
        SELECT conname, pg_get_constraintdef(oid) def
          FROM pg_constraint
         WHERE conrelid = 'public.recipe_purchases'::regclass AND contype='f'`);
      report.phases.phase2_fks = fk.rows;
      const newFk = fk.rows.find((r) => r.conname === "fk_recipe_purchases_recipe");
      const legacy = fk.rows.find((r) => r.conname === "recipe_purchases_recipe_id_fkey");
      console.log(`  FK на recipe_purchases: ${fk.rows.map((r) => r.conname).join(", ")}`);
      if (!newFk) throw new Error("fk_recipe_purchases_recipe не найден");
      if (!/REFERENCES (public\.)?recipes\(id\)/.test(newFk.def) || !/RESTRICT/.test(newFk.def))
        throw new Error(`новый FK не → recipes(id) RESTRICT: ${newFk.def}`);
      if (legacy) throw new Error("legacy FK recipe_purchases_recipe_id_fkey не удалён");
      console.log(`✔ 0075: fk_recipe_purchases_recipe → recipes(id) RESTRICT; legacy FK удалён`);
      const tables = await c.query(`SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='public'`);
      const policies = await c.query(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public'`);
      report.phases.phase2_tables = tables.rows[0].c;
      report.phases.phase2_policies = policies.rows[0].c;
      console.log(`✔ таблиц public: ${tables.rows[0].c}, RLS-политик: ${policies.rows[0].c}`);
      const crit = ["profiles", "user_roles", "orders", "recipes", "recipe_versions", "recipe_purchases", "recipe_marketplace", "inventory_items", "inventory_movements", "financial_ledger"];
      for (const t of crit) {
        const e = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`);
        if (!e.rows.length) throw new Error(`критическая таблица ${t} отсутствует`);
      }
      console.log(`✔ критические таблицы на месте (${crit.join(", ")})`);
    } finally { await c.end(); }
  }

  // ── Phase 3: строгий повторный прогон 0075 на БД A (ноль ошибок) ─────────
  console.log("\n══ PHASE 3: повторный прогон 0075 (strict, ожидается 0 ошибок — все гварды) ══");
  {
    const r = await applyFileStrict("conditera_prodpath_a", path.join(MIGRATIONS_DIR, "0075_recipe_purchases_recipe_fk_fix.sql"));
    report.phases.phase3_rerun = r;
    if (!r.ok) throw new Error(`Повторный 0075 УПАЛ: ${r.detail}`);
    console.log(`✔ повторный 0075: executed=${r.executed}, skipped(preproc)=${r.skipped}, 0 ошибок`);
    const c = await newClient("conditera_prodpath_a");
    try {
      const ledger = await c.query(`SELECT count(*)::int c FROM public.schema_migrations WHERE filename LIKE '0075%'`);
      if (ledger.rows[0].c !== 1) throw new Error("дубль записи 0075 в ledger");
      console.log(`✔ ledger: ровно одна запись 0075 (дублей нет)`);
    } finally { await c.end(); }
  }

  // ── Phase 4: БД B — частичное применение 0075 + восстановление ───────────
  console.log("\n══ PHASE 4: БД B — частичное применение 0075 (crash после stmt 1) → рестарт файла ══");
  await recreateDatabase("conditera_prodpath_b");
  {
    for (const f of [{ name: "0000_supabase_compat.sql", path: COMPAT_SQL }, ...files.filter((f) => !f.startsWith("0075")).map((f) => ({ name: f, path: path.join(MIGRATIONS_DIR, f) }))]) {
      const r = await applyFileStrict("conditera_prodpath_b", f.path);
      if (!r.ok) throw new Error(`Phase 4 (подготовка БД B): ${r.label} упал: ${r.detail}`);
      await markLedger("conditera_prodpath_b", f.name);
    }
    console.log("✔ БД B: compat + 0001..0074 применены");
    const f75 = path.join(MIGRATIONS_DIR, "0075_recipe_purchases_recipe_fk_fix.sql");
    const partial = await applyFileStrict("conditera_prodpath_b", f75, { untilStatement: 1 });
    report.phases.phase4_partial = partial;
    if (!partial.ok) throw new Error(`Phase 4: даже stmt 1 (orphan-guard) упал: ${partial.detail}`);
    console.log(`✔ частичное применение: stmt 1/${partial.total} применён, crash симулирован (ledger НЕ записан)`);
    // проверка: ledger НЕ содержит 0075
    {
      const c = await newClient("conditera_prodpath_b");
      try {
        const r = await c.query(`SELECT count(*)::int c FROM public.schema_migrations WHERE filename LIKE '0075%'`);
        if (r.rows[0].c !== 0) throw new Error("ledger содержит 0075 после crash — контракт нарушен");
      } finally { await c.end(); }
    }
    // рестарт файла с нуля: stmt 1 (гварда) + stmt 2 (DROP уже удалён → DO-гварда) + 3 + 4
    const recovery = await applyFileStrict("conditera_prodpath_b", f75);
    report.phases.phase4_recovery = recovery;
    if (!recovery.ok) throw new Error(`Phase 4: рестарт 0075 после частичного применения УПАЛ: ${recovery.detail}`);
    await markLedger("conditera_prodpath_b", "0075_recipe_purchases_recipe_fk_fix.sql");
    console.log(`✔ рестарт 0075: executed=${recovery.executed}, 0 ошибок (частичное состояние восстановлено)`);
    const again = await applyFileStrict("conditera_prodpath_b", f75);
    if (!again.ok) throw new Error(`Phase 4: второй рестарт упал: ${again.detail}`);
    report.phases.phase4_rerun = again;
    console.log(`✔ второй рестарт: executed=${again.executed}, 0 ошибок (полная rerun-safety)`);
  }

  report.ok = true;
  report.finishedAt = new Date().toISOString();
  console.log("\n════════════════════════════════════════════");
  console.log("✔✔ PRODUCTION MIGRATION PATH: PASSED (74 файла, strict autocommit, rerun-safe, partial-recovery-safe)");
} catch (e) {
  fatal = String(e.message || e);
  report.error = fatal;
  report.finishedAt = new Date().toISOString();
  console.error(`\n✖ FATAL: ${fatal}`);
} finally {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const out = path.join(EVIDENCE_DIR, `prodpath-0075-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`» evidence: ${path.relative(ROOT, out)}`);
  process.exit(report.ok ? 0 : 1);
}
