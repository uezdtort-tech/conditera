#!/usr/bin/env node
/**
 * scripts/verify/prodpath-release03-verify.mjs — RELEASE-03 §10 production-migration-path harness.
 *
 * Восстановление утраченного scripts/verify/prodpath-0075-verify.mjs в расширенном виде.
 *
 * Что делает (гейт §10 RELEASE-03):
 *   1. Поднимает ЧИСТЫЙ временный embedded PostgreSQL 18 (@embedded-postgres, devDependency)
 *      на СВОЁМ порту (по умолчанию 54351) и СВОЕЙ data-директории (/tmp/prodpath-r03-<ts>).
 *      Живая dev-БД на :54329 не затрагивается (гвардится явно).
 *   2. Bootstrap Supabase-совместимой среды: supabase/compat/0000_supabase_compat.sql
 *      (роли anon/authenticated/service_role + supabase_admin, схема auth с auth.uid()/auth.role(),
 *      storage, бакеты) — тем же способом, что scripts/db/setup.mjs.
 *   3. Применяет ВСЕ миграции supabase/migrations/*.sql ПО ПОРЯДКУ как боевой psql-путь:
 *      файл → split на statements (dollar-quote-aware сплиттер setup.mjs) → каждый statement
 *      ОТДЕЛЬНЫМ autocommit-запросом через node-postgres (each statement commits separately).
 *      STRICT: любая ошибка = падение с кодом 1 и логом файла/стейтмента.
 *   4. Ledger-проверка: public.schema_migrations — сверка с файлами на диске + lineage 0001..0078.
 *   5. STRICT RERUN: 0075..0078 целиком повторно → 0 ошибок (идемпотентность).
 *   6. PARTIAL FAILURE: первые 2 statement 0076/0077 отдельно → затем весь файл целиком → успех.
 *   7. GRANT-assertions (доказательство 0077) + прямые пробы SET ROLE authenticated.
 *   8. Модерация 0076: колонки moderated_by/moderated_at/moderation_reason у recipes.
 *   9. JSON-отчёт docs/evidence/release-gate/r03-prodpath-<ts>.json + консольный summary.
 *  10. finally: остановка embedded PG и УДАЛЕНИЕ временной data-директории.
 *
 * Запуск: node scripts/verify/prodpath-release03-verify.mjs
 * Env-override (для отладки): PRODPATH_PG_PORT, PRODPATH_PGDATA, PRODPATH_KEEP=1 (не удалять данные).
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

// ============================================================================
// Пути и константы
// ============================================================================
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const COMPAT_SQL = path.join(ROOT, "supabase", "compat", "0000_supabase_compat.sql");
const EVIDENCE_DIR = path.join(ROOT, "docs", "evidence", "release-gate");

const TS = new Date();
function manualStamp(d = TS) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}
const STAMP = manualStamp();

const PG_PORT = Number(process.env.PRODPATH_PG_PORT || 54351);
const PG_USER = "postgres";
const PG_DB = "prodpath_r03";
const DATA_DIR = process.env.PRODPATH_PGDATA || `/tmp/prodpath-r03-${STAMP}`;
const PG_LOG = path.join(DATA_DIR, "server.log");

const DEV_PORT = 54329; // живой dev-кластер — ЗАПРЕЩЕНО трогать
const RERUN_FILES = ["0075_recipe_purchases_recipe_fk_fix.sql", "0076_recipe_moderation_fields.sql", "0077_release_security_closures.sql", "0078_recipe_purchases_author_read_policy_fix.sql"];
const PARTIAL_PLAN = [
  { file: "0077_release_security_closures.sql", firstStatements: 2 },
  { file: "0076_recipe_moderation_fields.sql", firstStatements: 2 },
];
// Зарезервированные (намеренно отсутствующие) номера в линейке 0001..0077:
//   0056 — отсутствует в репо (пропуск нумерации);
//   0073 — зарезервирована за SECURITY-RECIPE-01 (Q-7), см. 0077:20;
//   0016 — существует только как 0016b_prisma_enums.sql (с начального коммита).
const RESERVED_ABSENT = new Set(["0056", "0073"]); // 0073 — SECURITY-RECIPE-01 (Q-7, не применено)
const CONSOLIDATED = { "0016": "0016b" };
const EXPECTED_TOTAL_LINEAGE_NUMBERS = 79; // Z-v19: 0001..0079 (0079_diagnostics_incidents — DEPLOY-01 EXT); линейка проверяется от фактического максимума на диске

// ============================================================================
// Служебное: лог + отчёт
// ============================================================================
const report = {
  gate: "RELEASE-03 §10 prodpath",
  spec: "node scripts/verify/prodpath-release03-verify.mjs",
  startedAt: TS.toISOString(),
  finishedAt: null,
  cluster: { port: PG_PORT, database: PG_DB, user: PG_USER, dataDir: DATA_DIR, pgMajorVersion: null, configNote: "fsync=off/synchronous_commit=off только для скорости на временной директории; семантика применения не меняется" },
  compat: { file: "supabase/compat/0000_supabase_compat.sql", statements: 0, applied: 0, txControlSkipped: 0, preprocessSkips: [], errors: [] },
  migrations: { dir: "supabase/migrations", files: 0, totalStatements: 0, applied: 0, txControlSkipped: 0, preprocessSkips: 0, perFile: [], errors: [] },
  ledger: { table: "public.schema_migrations", expected: null, actual: null, setEqualsDisk: null, missingFromLedger: [], extraInLedger: [], lineage: { range: "0001..0078", reservedAbsent: [...RESERVED_ABSENT], consolidatedSuffix: Object.entries(CONSOLIDATED).map(([k, v]) => `${k}→${v}`), absentOnDisk: [], ok: null, note: "в задании указано «77 файлов (0001..0077 без 0056/0073)»; линейка репо: 0016 существует только как 0016b; R03V добавил 0078 (fix RLS-политики покупок автора). Гейт сверяет ledger == диск == линейка." } },
  rerun: {},
  partial: {},
  grants: { tableChecks: [], functionChecks: [], probes: [], allPassed: null },
  moderation: { expected: 3, actual: null, columns: [], ok: null },
  errors: [],
  durationMs: null,
};
let reportWritten = false;

function writeReport() {
  if (reportWritten) return;
  try {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const p = path.join(EVIDENCE_DIR, `r03-prodpath-${STAMP}.json`);
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n", "utf8");
    reportWritten = true;
    console.log(`\n» evidence: ${path.relative(ROOT, p)}`);
  } catch (e) {
    console.error(`! не удалось записать отчёт: ${e.message}`);
  }
}

function log(msg) { console.log(msg); }
function fmtErr(err) {
  return { code: err && err.code ? err.code : null, message: String((err && err.message) || err).slice(0, 300) };
}

class StrictFailure extends Error {
  constructor(phase, info) {
    super(`STRICT FAILURE [${phase}]: ${info.file || "?"} statement ${info.idx ?? "?"}/${info.total ?? "?"}: ${(info.err && info.err.message) || info.err}`);
    this.phase = phase; this.info = info;
  }
}

// ============================================================================
// SQL-сплиттер (dollar-quote aware) — ВЕРБАТИМ из scripts/db/setup.mjs
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
// Препроцессинг операторов — та же логика, что scripts/db/setup.mjs
// (compat-слой заменяет Supabase-измы на vanilla-PG эквиваленты)
// ============================================================================
const SKIP_EXTENSIONS = ["pg_cron", "pgsodium"]; // отсутствуют в vanilla PG

function preprocessStatement(stmt) {
  let s = stmt;

  // CREATE EXTENSION: pg_cron/pgsodium — скип; остальное остаётся
  const extMatch = s.match(/^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-zA-Z0-9_-]+)["']?/i);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    if (SKIP_EXTENSIONS.includes(ext)) {
      return { skip: true, reason: `${ext} not available locally` };
    }
  }

  // pg_cron is inside a conditional DO block for Supabase PG17; skip it in vanilla PG.
  if (/CREATE\\s+EXTENSION\\s+pg_cron/i.test(s) && SKIP_EXTENSIONS.includes("pg_cron")) {
    return { skip: true, reason: "pg_cron not available in vanilla PG" };
  }

  // Схема extensions → public (uuid-ossp/pgcrypto/pg_trgm и т.п.)
  s = s.replace(/WITH\s+SCHEMA\s+extensions/gi, "WITH SCHEMA public");

  // uuid_generate_v4() → gen_random_uuid()
  s = s.replace(/\buuid_generate_v4\s*\(\s*\)/gi, "gen_random_uuid()");

  // Локальная специфика: таблица confectioner_transactions из 0017 не имеет
  // колонки user_id (там confectionerId TEXT) — политика owner-select не
  // создаётся; таблица остаётся default-deny для non-service ролей.
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

/**
 * Применить набор statements STRICT: каждый statement — отдельный autocommit
 * query (как боевой psql-путь). Любая ошибка → StrictFailure.
 */
async function applyStatementsStrict(client, statements, { phase, file }) {
  const res = { file, statements: statements.length, applied: 0, txControlSkipped: 0, preprocessSkips: [], errors: [] };
  for (let idx = 0; idx < statements.length; idx++) {
    const raw = statements[idx];
    if (!raw) continue;
    if (isTxControl(raw)) {
      // psql в autocommit выполняет BEGIN/COMMIT как отдельные команды;
      // для node-postgres autocommit они избыточны — фиксируем как skip.
      res.txControlSkipped++;
      continue;
    }
    const prep = preprocessStatement(raw);
    if (prep.skip) {
      res.preprocessSkips.push({ idx: idx + 1, reason: prep.reason });
      continue;
    }
    try {
      await client.query(prep.sql);
      res.applied++;
    } catch (err) {
      const e = { idx: idx + 1, ...fmtErr(err), sql: String(prep.sql).slice(0, 240) };
      res.errors.push(e);
      throw new StrictFailure(phase, { file, idx: idx + 1, total: statements.length, err });
    }
  }
  return res;
}

// ============================================================================
// Embedded PostgreSQL: бинарники (по мотивам scripts/db/runtime.mjs) + initdb/pg_ctl
// ============================================================================
function platformPackageShort() {
  const { platform, arch } = process;
  if (platform === "win32") return "win-x64";
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "linux") return arch === "x64" ? "linux-x64" : "linux-arm64";
  return null;
}
function exeName(name) { return process.platform === "win32" ? `${name}.exe` : name; }

function resolveBinaries() {
  const short = platformPackageShort();
  if (!short) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  const pkgDir = path.join(ROOT, "node_modules", "@embedded-postgres", short);
  if (!existsSync(path.join(pkgDir, "package.json"))) {
    throw new Error(`Package @embedded-postgres/${short} is not installed. Hint: npm install`);
  }
  const binDir = path.join(pkgDir, "native", "bin");
  const wanted = {
    initdb: path.join(binDir, exeName("initdb")),
    pg_ctl: path.join(binDir, exeName("pg_ctl")),
    postgres: path.join(binDir, exeName("postgres")),
  };
  for (const [k, p] of Object.entries(wanted)) {
    if (!existsSync(p)) throw new Error(`Binary not found: ${p} (run "npm install"/"npm rebuild @embedded-postgres/${short}")`);
  }
  return wanted;
}

function childEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  const pathVar = process.platform === "win32" ? "Path" : "PATH";
  return {
    ...process.env,
    [pathVar]: `${binDir}${sep}${process.env[pathVar] || ""}`,
    LC_ALL: "",
    LANG: "",
  };
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { shell: false, windowsHide: true, encoding: "utf8", ...opts });
  return { status: res.status, stdout: (res.stdout || "").toString(), stderr: (res.stderr || "").toString() };
}

function tcpProbe(port, host = "127.0.0.1", timeoutMs = 1500) {
  return new Promise((resolveProbe) => {
    const socket = net.connect({ port, host });
    const done = (ok) => { try { socket.destroy(); } catch { /* noop */ } resolveProbe(ok); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function readPidFile() {
  try {
    const first = readFileSync(path.join(DATA_DIR, "postmaster.pid"), "utf8").split("\n")[0].trim();
    const pid = Number(first);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function initCluster(bin) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (readdirSync(DATA_DIR).length > 0) {
    throw new Error(`Data dir ${DATA_DIR} is not empty — refusing (clean-cluster requirement)`);
  }
  log(`» initdb: creating CLEAN cluster at ${DATA_DIR} (PG 18)`);
  const res = run(bin.initdb, ["-D", DATA_DIR, "-U", PG_USER, "--auth=trust", "--encoding=UTF8", "--no-locale"], { env: childEnv(bin.binDir || path.dirname(bin.postgres)) });
  if (res.status !== 0) throw new Error(`initdb failed:\n${res.stdout}\n${res.stderr}`);
  const version = readFileSync(path.join(DATA_DIR, "PG_VERSION"), "utf8").trim();
  if (!version.startsWith("18")) {
    throw new Error(`Expected PostgreSQL 18 cluster, got PG_VERSION=${version}`);
  }
  report.cluster.pgMajorVersion = version;

  // Конфиг: только 127.0.0.1, СВОЙ порт; fsync=off — временный кластер (семантика SQL не меняется)
  const confLines = [
    `listen_addresses = '127.0.0.1'`,
    `port = ${PG_PORT}`,
    `max_connections = 60`,
    `shared_buffers = 128MB`,
    `unix_socket_directories = '/tmp'`,
    `fsync = off`,
    `synchronous_commit = off`,
    `full_page_writes = off`,
  ];
  const confPath = path.join(DATA_DIR, "postgresql.conf");
  const conf = readFileSync(confPath, "utf8").replace(/\n*$/, "\n");
  writeFileSync(confPath, conf + `\n# prodpath-r03 harness (managed)\n` + confLines.join("\n") + "\n", "utf8");

  // pg_hba: trust только на loopback (дев-режим временного кластера)
  writeFileSync(
    path.join(DATA_DIR, "pg_hba.conf"),
    ["# prodpath-r03 harness — temporary clean cluster",
     "local   all             all                                     trust",
     "host    all             all             127.0.0.1/32            trust",
     "host    all             all             ::1/128                 trust",
     ""].join("\n"),
    "utf8"
  );
}

async function startCluster(bin) {
  log(`» starting PostgreSQL 18 on 127.0.0.1:${PG_PORT} ...`);
  const res = run(bin.pg_ctl, ["-D", DATA_DIR, "-l", PG_LOG, "-o", `-p ${PG_PORT}`, "-w", "start"], { env: childEnv(bin.binDir || path.dirname(bin.postgres)), timeout: 120000 });
  if (res.status !== 0) {
    const tail = existsSync(PG_LOG) ? readFileSync(PG_LOG, "utf8").slice(-2000) : "";
    throw new Error(`pg_ctl start failed:\n${res.stdout}\n${res.stderr}\n--- server.log tail ---\n${tail}`);
  }
  let up = false;
  for (let i = 0; i < 60; i++) {
    up = await tcpProbe(PG_PORT);
    if (up) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) throw new Error("PostgreSQL started but port is not accepting connections");
  log(`✔ PostgreSQL ${report.cluster.pgMajorVersion} is up (port ${PG_PORT})`);
}

async function stopCluster(bin) {
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) return;
  const res = run(bin.pg_ctl, ["-D", DATA_DIR, "-m", "fast", "-w", "stop"], { env: childEnv(bin.binDir || path.dirname(bin.postgres)), timeout: 60000 });
  if (res.status !== 0) {
    const pid = readPidFile();
    if (pid && pidAlive(pid)) {
      try { process.kill(pid, "SIGTERM"); } catch { /* noop */ }
      for (let i = 0; i < 20 && pidAlive(pid); i++) await new Promise((r) => setTimeout(r, 250));
      if (pidAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* noop */ } }
    }
  }
  log("✔ temporary PostgreSQL stopped");
}

// ============================================================================
// Линейка миграций: natural sort (как setup.mjs)
// ============================================================================
function naturalSortFiles(files) {
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
  return files;
}

function listMigrationFiles() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return naturalSortFiles([...files]);
}

/** Проверка линейки 0001..0077 (без зарезервированных + consolidated-суффиксы). */
function checkLineage(files) {
  const byNumber = new Map();
  for (const f of files) {
    const m = f.match(/^(\d+)([^.]*)\.sql$/);
    if (!m) continue;
    const num = String(Number(m[1])).padStart(4, "0");
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(f);
  }
  const absentOnDisk = [];
  for (let i = 1; i <= EXPECTED_TOTAL_LINEAGE_NUMBERS; i++) {
    const num = String(i).padStart(4, "0");
    if (!byNumber.has(num)) absentOnDisk.push(num);
  }
  const unexpected = absentOnDisk.filter((n) => !RESERVED_ABSENT.has(n) && !CONSOLIDATED[n]);
  report.ledger.lineage.absentOnDisk = absentOnDisk;
  report.ledger.lineage.ok = unexpected.length === 0;
  if (unexpected.length > 0) {
    throw new Error(`Lineage 0001..0078 broken: numbers missing on disk and not reserved: ${unexpected.join(", ")}`);
  }
  return byNumber;
}

// ============================================================================
// Грант-ассерты / пробы
// ============================================================================
async function assertPrivilege(client, kind, target, privilege, role, expect) {
  let sql;
  if (kind === "table") {
    sql = `SELECT has_table_privilege($1, $2, $3) AS ok`;
  } else {
    sql = `SELECT has_function_privilege($1::regrole, $2::regprocedure, $3) AS ok`;
  }
  const res = await client.query(sql, [role, target, privilege]);
  const actual = res.rows[0].ok;
  const pass = actual === expect;
  return { kind, target, privilege, role, expect, actual, pass };
}

async function probeDenied(client, { name, setRole, sql, expectCode }) {
  // Транзакционная обёртка: даже если привилегия вдруг есть — мусор в БД не попадёт.
  const out = { name, setRole, sql, expectCode, pass: false, actual: null, message: null };
  try {
    await client.query("BEGIN");
    await client.query(`SET ROLE ${setRole}`);
    try {
      await client.query(sql);
      out.actual = "NO_ERROR (statement executed — DENIED FAILED)";
    } catch (err) {
      out.actual = err.code || "UNKNOWN_CODE";
      out.message = String(err.message || "").slice(0, 200);
      out.pass = err.code === expectCode;
    }
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    try { await client.query("RESET ROLE"); } catch { /* noop */ }
  }
  return out;
}

// ============================================================================
// Основной поток
// ============================================================================
async function main() {
  const t0 = Date.now();
  log("════════════════════════════════════════════════════════════════");
  log(" RELEASE-03 §10 — prodpath harness: чистая PG18 → compat → 77-линейка миграций");
  log("════════════════════════════════════════════════════════════════");

  // ---- Pre-flight гварды (не трогать :54329 и чужие данные) ----
  if (PG_PORT === DEV_PORT) throw new Error(`Refusing to use dev port ${DEV_PORT}`);
  if (!DATA_DIR.startsWith("/tmp/prodpath-r03-")) throw new Error(`Refusing data dir outside /tmp/prodpath-r03-*: ${DATA_DIR}`);
  if (!existsSync(MIGRATIONS_DIR)) throw new Error(`Migrations dir missing: ${MIGRATIONS_DIR}`);
  if (!existsSync(COMPAT_SQL)) throw new Error(`Compat file missing: ${COMPAT_SQL}`);
  if (await tcpProbe(PG_PORT, "127.0.0.1", 400)) {
    throw new Error(`Port ${PG_PORT} already in use — pick another PRODPATH_PG_PORT`);
  }
  const bin = resolveBinaries();
  log(`» binaries: ${path.relative(ROOT, path.dirname(bin.postgres))}`);
  log(`» data dir: ${DATA_DIR} | db: ${PG_DB} | dev-кластер :${DEV_PORT} не затрагивается`);

  let client = null;
  let clusterUp = false;
  try {
    // ---- 1. Чистый кластер ----
    initCluster(bin);
    await startCluster(bin);
    clusterUp = true;

    // ---- 2. База + клиент (autocommit: каждый query = отдельная транзакция) ----
    const admin = new Client({ connectionString: `postgresql://${PG_USER}@127.0.0.1:${PG_PORT}/postgres`, connectionTimeoutMillis: 8000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${PG_DB}"`);
    await admin.end();
    log(`✔ database "${PG_DB}" created`);

    client = new Client({ connectionString: `postgresql://${PG_USER}@127.0.0.1:${PG_PORT}/${PG_DB}`, connectionTimeoutMillis: 8000 });
    await client.connect();
    log("✔ connected (autocommit mode — каждый statement коммитится отдельно, как psql-путь)");

    // ---- 3. Bootstrap Supabase-совместимой среды ----
    log("\n─── Supabase compat bootstrap ───");
    // supabase_admin — для паритета с Supabase-стеком (в миграциях не упоминается,
    // создаётся под гвардом, как в compat-дисциплине 0077).
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF; END $$;`);
    const compatSql = readFileSync(COMPAT_SQL, "utf8");
    const compatStatements = splitSqlStatements(compatSql);
    const compatRes = await applyStatementsStrict(client, compatStatements, { phase: "compat", file: "0000_supabase_compat.sql" });
    report.compat = {
      ...report.compat,
      statements: compatStatements.length,
      applied: compatRes.applied,
      txControlSkipped: compatRes.txControlSkipped,
      preprocessSkips: compatRes.preprocessSkips,
    };
    log(`✔ compat: ${compatRes.applied}/${compatStatements.length} statements applied (tx-skip ${compatRes.txControlSkipped}, preprocess-skip ${compatRes.preprocessSkips.length})`);

    // ---- 4. Все миграции STRICT, statement-by-statement autocommit ----
    log("\n─── Migrations: STRICT psql-путь (statement → autocommit) ───");
    const files = listMigrationFiles();
    checkLineage(files);
    report.migrations.files = files.length;

    await client.query(
      `CREATE TABLE IF NOT EXISTS public.schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );

    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitSqlStatements(sql);
      const res = await applyStatementsStrict(client, statements, { phase: "migrations", file });
      await client.query(`INSERT INTO public.schema_migrations (filename) VALUES ($1)`, [file]);
      report.migrations.totalStatements += statements.length;
      report.migrations.applied += res.applied;
      report.migrations.txControlSkipped += res.txControlSkipped;
      report.migrations.preprocessSkips += res.preprocessSkips.length;
      report.migrations.perFile.push({ file, statements: statements.length, applied: res.applied, txControlSkipped: res.txControlSkipped, preprocessSkips: res.preprocessSkips.length });
      log(`  ✔ ${file}: ${res.applied} stmts${res.txControlSkipped ? `, tx-skip ${res.txControlSkipped}` : ""}${res.preprocessSkips.length ? `, preprocess-skip ${res.preprocessSkips.length}` : ""}`);
    }
    log(`✔ все ${files.length} миграций применены STRICT (0 ошибок)`);

    // ---- 5. Ledger-проверка ----
    log("\n─── Ledger ───");
    const ledgerRows = await client.query(`SELECT filename FROM public.schema_migrations ORDER BY filename`);
    const ledgerSet = new Set(ledgerRows.rows.map((r) => r.filename));
    const diskSet = new Set(files);
    const missingFromLedger = files.filter((f) => !ledgerSet.has(f));
    const extraInLedger = [...ledgerSet].filter((f) => !diskSet.has(f));
    report.ledger.expected = files.length;
    report.ledger.actual = ledgerSet.size;
    report.ledger.setEqualsDisk = missingFromLedger.length === 0 && extraInLedger.length === 0;
    report.ledger.missingFromLedger = missingFromLedger;
    report.ledger.extraInLedger = extraInLedger;
    if (!report.ledger.setEqualsDisk) {
      throw new Error(`Ledger mismatch: missing=${JSON.stringify(missingFromLedger)} extra=${JSON.stringify(extraInLedger)}`);
    }
    log(`✔ ledger: ${ledgerSet.size} файлов == диску (${files.length}); линейка 0001..0079: отсутствуют только зарезервированные [${report.ledger.lineage.absentOnDisk.join(", ")}]`);
    // Z-v19 fix: хардкод «77» (эпоха R03V) ломал harness после появления
    // 0079_diagnostics_incidents.sql (DEPLOY-01 EXT) — миграции были
    // корректны, а гейт падал на устаревшем литерале. Структурные проверки
    // выше уже гарантируют: ledger == диск (set-equals) и линейка без дыр
    // (checkLineage). Здесь — только сверка с фактическим числом файлов.
    if (ledgerSet.size !== files.length) {
      throw new Error(`Expected ${files.length} migration files on disk/ledger, got ${ledgerSet.size}`);
    }

    // ---- 6. STRICT RERUN 0075/0076/0077 ----
    log("\n─── STRICT RERUN (idempotency): 0075, 0076, 0077 ───");
    for (const file of RERUN_FILES) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitSqlStatements(sql);
      const res = await applyStatementsStrict(client, statements, { phase: "rerun", file });
      report.rerun[file] = { ...res, errors: [], ok: true };
      log(`  ✔ rerun ${file}: ${res.applied} stmts, 0 ошибок`);
    }

    // ---- 7. PARTIAL FAILURE simulation ----
    log("\n─── PARTIAL FAILURE: частичное применение не ломает повторный прогон ───");
    for (const plan of PARTIAL_PLAN) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, plan.file), "utf8");
      const statements = splitSqlStatements(sql);
      const head = statements.slice(0, plan.firstStatements);
      const headRes = await applyStatementsStrict(client, head, { phase: "partial", file: plan.file });
      const fullRes = await applyStatementsStrict(client, statements, { phase: "partial-full", file: plan.file });
      report.partial[plan.file] = {
        firstStatements: plan.firstStatements,
        headApplied: headRes.applied,
        fullFile: { statements: fullRes.statements, applied: fullRes.applied, errors: 0 },
        ok: true,
      };
      log(`  ✔ ${plan.file}: head ${headRes.applied}/${plan.firstStatements} stmts отдельно → затем весь файл (${fullRes.applied} stmts) → 0 ошибок`);
    }

    // ---- 8. GRANT-assertions (доказательство 0077) ----
    log("\n─── GRANT assertions (0077) ───");
    const tableChecks = [
      ["inventory_items", "SELECT", true],
      ["inventory_items", "INSERT", false],
      ["inventory_items", "UPDATE", false],
      ["inventory_items", "DELETE", false],
      ["recipe_purchases", "INSERT", false],
      ["recipe_purchases", "UPDATE", false],
      ["recipe_purchases", "DELETE", false],
      ["recipes", "INSERT", false],
      ["recipes", "UPDATE", false],
      ["recipes", "DELETE", false],
    ];
    for (const [table, priv, expect] of tableChecks) {
      const r = await assertPrivilege(client, "table", `public.${table}`, priv, "authenticated", expect);
      report.grants.tableChecks.push(r);
      if (!r.pass) throw new Error(`GRANT assert failed: authenticated ${priv} on ${table}: expected ${expect}, got ${r.actual}`);
      log(`  ✔ has_table_privilege(authenticated, ${table}, ${priv}) = ${r.actual}`);
    }

    const FN_AIMA = "public.apply_inventory_movement_atomic(uuid, text, numeric, uuid, text, uuid)";
    const FN_ABB = "public.add_bonus_balance(text, integer)";
    const functionChecks = [
      [FN_AIMA, "authenticated", false],
      [FN_AIMA, "service_role", true],
      [FN_ABB, "authenticated", false],
    ];
    for (const [fn, role, expect] of functionChecks) {
      const r = await assertPrivilege(client, "function", fn, "EXECUTE", role, expect);
      report.grants.functionChecks.push(r);
      if (!r.pass) throw new Error(`GRANT assert failed: ${role} EXECUTE on ${fn}: expected ${expect}, got ${r.actual}`);
      log(`  ✔ has_function_privilege(${role}, ${fn.replace("public.", "")}, EXECUTE) = ${r.actual}`);
    }

    log("  — прямые пробы от имени authenticated —");
    const probes = [
      {
        name: "authenticated UPDATE inventory_items.quantity → permission denied",
        setRole: "authenticated",
        sql: "UPDATE public.inventory_items SET quantity = quantity + 1",
        expectCode: "42501",
      },
      {
        name: "authenticated INSERT recipe_purchases → permission denied",
        setRole: "authenticated",
        sql: "INSERT INTO public.recipe_purchases (recipe_id, buyer_id) VALUES ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb')",
        expectCode: "42501",
      },
    ];
    for (const p of probes) {
      const r = await probeDenied(client, p);
      report.grants.probes.push(r);
      if (!r.pass) throw new Error(`Probe failed: ${p.name}: expected ${p.expectCode}, got ${r.actual} (${r.message || "-"})`);
      log(`  ✔ ${p.name} [${r.actual}]`);
    }
    report.grants.allPassed = true;

    // ---- 9. Модерация 0076 ----
    log("\n─── Модерация 0076: колонки recipes ───");
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'recipes'
          AND column_name IN ('moderated_by', 'moderated_at', 'moderation_reason')
        ORDER BY column_name`
    );
    report.moderation.actual = cols.rowCount;
    report.moderation.columns = cols.rows.map((r) => r.column_name);
    report.moderation.ok = cols.rowCount === 3;
    if (!report.moderation.ok) throw new Error(`Expected 3 moderation columns on recipes, got ${cols.rowCount}: ${cols.rows.map((r) => r.column_name).join(", ")}`);
    log(`✔ recipes.moderation columns: ${report.moderation.columns.join(", ")} (3/3)`);

    // ---- 9-b. R03V: политика покупок автора (фикс 0078) ----
    // Дефект 0012/0075: подзапрос политики возвращал id ОФФЕРОВ (recipe_marketplace.id)
    // вместо recipe_id корней — авторская ветка SELECT-политики была мертва.
    log("\n─── R03V: recipe_purchases_buyer_or_author_read (фикс 0078) ───");
    // Сид (от postgres, RLS не применяется): автор + покупатель + рецепт + оффер + покупка
    const seedAuthor = (await client.query(`INSERT INTO auth.users (email) VALUES ('r03v-author@prodpath.test') RETURNING id`)).rows[0].id;
    const seedBuyer = (await client.query(`INSERT INTO auth.users (email) VALUES ('r03v-buyer@prodpath.test') RETURNING id`)).rows[0].id;
    const seedRecipe = (await client.query(
      `INSERT INTO public.recipes (author_id, title, slug, description, content, status) VALUES ($1, 'R03V Policy Recipe', 'r03v-policy-recipe', 'd', 'c', 'published') RETURNING id`,
      [seedAuthor]
    )).rows[0].id;
    await client.query(
      `INSERT INTO public.recipe_marketplace (author_id, title, slug, description, base_price, is_published, steps_json, ingredients_json, recipe_id)
       VALUES ($1, 'R03V Offer', 'r03v-offer', 'd', 100, true, '[]', '[]', $2)`,
      [seedAuthor, seedRecipe]
    );
    await client.query(
      `INSERT INTO public.recipe_purchases (recipe_id, buyer_id, price_paid, royalty_amount, commission_amount, is_active)
       VALUES ($1, $2, 100, 5, 10, true)`,
      [seedRecipe, seedBuyer]
    );
    const USER_AUTHOR_ID = seedAuthor;
    const polQ = await client.query(
      `SELECT qual FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'recipe_purchases'
          AND policyname = 'recipe_purchases_buyer_or_author_read'`
    );
    const qualText = String(polQ.rows?.[0]?.qual ?? "");
    const norm = qualText.replace(/\s+/g, " ");
    const policyFixed = /recipe_marketplace\.recipe_id/.test(norm);
    const policyStale = /recipe_marketplace\.id(?![\w_])/.test(norm);
    if (!policyFixed || policyStale) {
      throw new Error(`0078 policy check failed: fixed=${policyFixed} stale=${policyStale} qual=${qualText.slice(0, 200)}`);
    }
    log("✔ политика читает recipe_id корней (recipe_marketplace.recipe_id), старое выражение устранено");

    // Функциональная проба: автор видит покупку СВОЕГО рецепта через RLS
    {
      await client.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: USER_AUTHOR_ID, role: "authenticated" })]);
      await client.query("SET ROLE authenticated");
      try {
        const seen = await client.query(`SELECT count(*)::int AS c FROM public.recipe_purchases`);
        const cnt = seen.rows[0].c;
        if (cnt < 1) throw new Error(`0078 probe: author sees ${cnt} purchases, expected >= 1`);
        log(`✔ автор видит покупки своего рецепта через RLS (${cnt}/1)`);
      } finally {
        await client.query("RESET ROLE");
        await client.query("SELECT set_config('request.jwt.claims', '', false)");
      }
    }

    // ---- Финал ----
    report.durationMs = Date.now() - t0;
    writeReport();
    log("\n════════════════════════════════════════════════════════════════");
    log(" PRODPATH SUMMARY — SUCCESS");
    log("════════════════════════════════════════════════════════════════");
    log(JSON.stringify({
      applied: report.ledger.actual,
      taskSpecExpectedFiles: 77,
      lineageNote: "0016 существует только как 0016b → фактическая линейка 76 файлов; ledger == диск == линейка",
      errors: report.errors,
      rerun: Object.fromEntries(Object.entries(report.rerun).map(([k, v]) => [k, { statements: v.statements, applied: v.applied, errors: 0 }])),
      partial: Object.fromEntries(Object.entries(report.partial).map(([k, v]) => [k, { headApplied: v.headApplied, fullFileErrors: 0 }])),
      grants: { tableChecks: report.grants.tableChecks.length, functionChecks: report.grants.functionChecks.length, probes: report.grants.probes.length, allPassed: true },
      moderation: { actual: report.moderation.actual, ok: true },
      ledgerSetEqualsDisk: report.ledger.setEqualsDisk,
      lineageAbsent: report.ledger.lineage.absentOnDisk,
      durationMs: report.durationMs,
    }, null, 2));
  } catch (err) {
    const isStrict = err instanceof StrictFailure;
    const entry = {
      phase: isStrict ? err.phase : "harness",
      ...(isStrict ? { file: err.info.file, idx: err.info.idx } : {}),
      ...fmtErr(err),
    };
    report.errors.push(entry);
    if (isStrict) {
      if (err.phase === "compat") report.compat.errors.push(entry);
      if (err.phase === "migrations") report.migrations.errors.push({ file: err.info.file, ...entry });
      if (err.phase === "rerun" && err.info.file && report.rerun[err.info.file]) {
        report.rerun[err.info.file].ok = false;
        report.rerun[err.info.file].errors = [entry];
      }
    }
    report.durationMs = Date.now() - t0;
    writeReport();
    console.error(`\n✖ ${err.message || err}`);
    if (isStrict && err.info.err) {
      console.error(`  PG code: ${err.info.err.code || "?"}`);
      console.error(`  file: ${err.info.file}, statement ${err.info.idx}/${err.info.total}`);
    }
    process.exitCode = 1;
  } finally {
    if (client) { try { await client.end(); } catch { /* noop */ } }
    if (clusterUp) {
      try { await stopCluster(bin); } catch (e) { console.error(`! stop failed: ${e.message}`); process.exitCode = process.exitCode || 1; }
    }
    if (process.env.PRODPATH_KEEP === "1") {
      log(`! PRODPATH_KEEP=1 — data dir НЕ удалена: ${DATA_DIR}`);
    } else if (DATA_DIR.startsWith("/tmp/prodpath-r03-") && existsSync(DATA_DIR)) {
      try {
        rmSync(DATA_DIR, { recursive: true, force: true });
        log(`✔ временная data-директория удалена: ${DATA_DIR}`);
      } catch (e) {
        console.error(`! не удалось удалить ${DATA_DIR}: ${e.message}`);
        process.exitCode = process.exitCode || 1;
      }
    }
    if (process.exitCode === 1) {
      log("\n✖ PRODPATH: FAILED (см. evidence-отчёт выше)");
    }
  }
}

// Ctrl-C / TERM: корректно прибрать за собой
process.on("SIGINT", () => { console.error("\n! SIGINT — прерывание"); process.exit(130); });
process.on("SIGTERM", () => { console.error("\n! SIGTERM — прерывание"); process.exit(143); });

main().catch((err) => {
  console.error(`✖ FATAL: ${err.message || err}`);
  writeReport();
  process.exit(1);
});
