#!/usr/bin/env node
/**
 * scripts/deploy-local.mjs — предпусковая проверка локального развёртывания
 * проекта «Conditera» (plain Node ≥ 20, без внешних зависимостей).
 *
 *   node scripts/deploy-local.mjs           — проверка (режим по умолчанию)
 *   node scripts/deploy-local.mjs --check   — ТО ЖЕ САМОЕ (флаг совместимости)
 *   bun run deploy:local                    — то же через package.json
 *
 * Шаги (каждый пишется в журнал через scripts/lib/agent-log.mjs):
 *   env    — наличие .env.local и обязательных ключей DATABASE_URL,
 *            JWT_SECRET, JWT_REFRESH_SECRET. Значения НЕ печатаются и НЕ
 *            логируются — только факт наличия и длина (≥ 16 = норма);
 *            отсутствие файла/ключа = FAIL.
 *   db     — статус embedded PostgreSQL: `node scripts/db/runtime.mjs status`
 *            (запущен = OK; нет кластера/остановлен = WARN; ошибка выполнения
 *            команды = FAIL).
 *   server — GET http://127.0.0.1:3000/api/health с таймаутом 3 с
 *            (не отвечает = WARN «dev-сервер не запущен» — это НЕ ошибка;
 *            ответил, но status != ok = WARN; status=ok = OK).
 *   git    — HEAD (git rev-parse) и число изменённых файлов (INFO).
 *
 * Гарантии:
 *   - скрипт НИЧЕГО не меняет и ничего не запускает/не останавливает:
 *     dev-сервер и БД не трогаются, миграции/seed/drop не выполняются
 *     (только чтение состояния);
 *   - каждый шаг дополнительно дописывается в logs/agent/deployment-YYYY-MM-DD.log
 *     и deployment-YYYY-MM-DD.jsonl (append-only; ошибки журналирования
 *     не влияют на проверку);
 *   - exit code: 0 — нет FAIL; 1 — есть хотя бы один FAIL (WARN не влияют).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { finishSession, initAgentLogSession, logStep } from "./lib/agent-log.mjs";

const require = createRequire(import.meta.url);
// <project>/scripts/deploy-local.mjs → <project>
const ROOT = path.resolve(path.dirname(require.resolve("./deploy-local.mjs")), "..");

const ENV_LOCAL = path.join(ROOT, ".env.local");
const REQUIRED_KEYS = ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET"];
const MIN_SECRET_LENGTH = 16;
const HEALTH_URL = "http://127.0.0.1:3000/api/health";
const HEALTH_TIMEOUT_MS = 3000;
const RUNTIME_STATUS_TIMEOUT_MS = 30000;

const isCheckMode = process.argv.includes("--check");

// Журнал агента (append-only, fail-safe). Порядок шагов всегда одинаков:
// env → db → server → git; режим по умолчанию и --check ведут себя одинаково.
const SESSION = initAgentLogSession({
  run: `deploy-local${isCheckMode ? " --check" : ""}`,
  reason: "предпусковая проверка локального развёртывания (env → db → server → git)",
});

// ============================================================================
// Шаг 1 — env: .env.local и обязательные ключи (значения НЕ печатаются)
// ============================================================================

/** Крошечный парсер key=value (та же схема, что в scripts/db/setup.mjs). */
function parseEnvKeys(file) {
  const keys = new Map();
  if (!existsSync(file)) return keys;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!keys.has(key)) keys.set(key, value);
  }
  return keys;
}

function checkEnvStep() {
  logStep("env", "START", `проверка .env.local и ключей: ${REQUIRED_KEYS.join(", ")} (значения не печатаются — только наличие и длина ≥ ${MIN_SECRET_LENGTH})`);

  if (!existsSync(ENV_LOCAL)) {
    const msg = ".env.local ОТСУТСТВУЕТ — локальное окружение не инициализировано (запустите node scripts/db/setup.mjs)";
    logStep("env", "FAIL", msg);
    return { status: "FAIL", msg };
  }

  const keys = parseEnvKeys(ENV_LOCAL);
  const keyFacts = [];
  const missing = [];
  const tooShort = [];
  for (const key of REQUIRED_KEYS) {
    const value = keys.get(key);
    const present = typeof value === "string" && value.length > 0;
    if (!present) {
      missing.push(key);
      keyFacts.push(`${key}: ОТСУТСТВУЕТ`);
      continue;
    }
    keyFacts.push(`${key}: есть (длина ${value.length}${value.length >= MIN_SECRET_LENGTH ? ", ≥16" : ", <16!"})`);
    if (value.length < MIN_SECRET_LENGTH) tooShort.push(key);
  }

  const factText = `.env.local: ${keys.size} ключей всего; ${keyFacts.join("; ")}`;
  if (missing.length > 0) {
    const msg = `${factText}; отсутствуют обязательные ключи: ${missing.join(", ")}`;
    logStep("env", "FAIL", msg);
    return { status: "FAIL", msg };
  }
  if (tooShort.length > 0) {
    const msg = `${factText}; подозрительно короткие секреты (<${MIN_SECRET_LENGTH}): ${tooShort.join(", ")}`;
    logStep("env", "WARN", msg);
    return { status: "WARN", msg };
  }
  logStep("env", "OK", factText);
  return { status: "OK", msg: factText };
}

// ============================================================================
// Шаг 2 — db: статус embedded PostgreSQL через scripts/db/runtime.mjs status
// ============================================================================

function checkDbStep() {
  logStep("db", "START", "статус embedded PostgreSQL: node scripts/db/runtime.mjs status");

  let res;
  try {
    res = spawnSync(process.execPath, [path.join(ROOT, "scripts", "db", "runtime.mjs"), "status"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: RUNTIME_STATUS_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (err) {
    const msg = `ошибка выполнения runtime.mjs status: ${err && err.message ? err.message : err}`;
    logStep("db", "FAIL", msg);
    return { status: "FAIL", msg };
  }
  if (res.error || res.status === null || res.status === undefined) {
    const msg = `ошибка выполнения runtime.mjs status: ${res.error && res.error.message ? res.error.message : "spawn failed"}`;
    logStep("db", "FAIL", msg);
    return { status: "FAIL", msg };
  }

  const out = `${res.stdout || ""}${res.stderr || ""}`.trim();
  const firstLine = out.split("\n").find((l) => l.trim()) || "(пустой вывод)";

  if (out.includes("RUNNING")) {
    logStep("db", "OK", firstLine);
    return { status: "OK", msg: firstLine };
  }
  if (out.includes("NOT INITIALIZED")) {
    const msg = `${firstLine} — embedded-кластер не создан (WARN: npm run db:start или node scripts/db/setup.mjs)`;
    logStep("db", "WARN", msg);
    return { status: "WARN", msg };
  }
  if (out.includes("STOPPED")) {
    const msg = `${firstLine} — кластер есть, но PostgreSQL остановлен (WARN: npm run db:start)`;
    logStep("db", "WARN", msg);
    return { status: "WARN", msg };
  }
  const msg = `неопознанный статус PostgreSQL: ${firstLine}`;
  logStep("db", "WARN", msg);
  return { status: "WARN", msg };
}

// ============================================================================
// Шаг 3 — server: GET /api/health с таймаутом 3 с (WARN, если не запущен)
// ============================================================================

async function checkServerStep() {
  logStep("server", "START", `GET ${HEALTH_URL} (таймаут ${HEALTH_TIMEOUT_MS} мс; сам сервер не запускается и не останавливается)`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch { /* тело не JSON — трактуем как health != ok */ }
    const topStatus = body && typeof body === "object" ? body.status : undefined;

    if (res.ok && topStatus === "ok") {
      const dbPart = body && body.database ? `, database=${body.database}` : "";
      const msg = `dev-сервер отвечает: HTTP ${res.status}, status=ok${dbPart}`;
      logStep("server", "OK", msg);
      return { status: "OK", msg };
    }
    const msg = `health != ok: HTTP ${res.status}, status=${topStatus === undefined ? "(статуса нет в ответе)" : topStatus}`;
    logStep("server", "WARN", msg);
    return { status: "WARN", msg };
  } catch (err) {
    const cause = err && err.name === "AbortError"
      ? `таймаут ${HEALTH_TIMEOUT_MS} мс`
      : (err && err.message ? err.message : "соединение не установлено");
    const msg = `dev-сервер не запущен (или не отвечает: ${cause}) — это НЕ ошибка проверки; сервер сам не запускается`;
    logStep("server", "WARN", msg);
    return { status: "WARN", msg };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Шаг 4 — git: HEAD и число изменённых файлов (INFO)
// ============================================================================

function gitRun(args) {
  try {
    const res = spawnSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (res.status === 0) return (res.stdout || "").trim();
  } catch { /* git недоступен — не критично */ }
  return null;
}

function checkGitStep() {
  logStep("git", "START", "HEAD (git rev-parse) и число изменённых файлов (git status --porcelain)");
  const head = gitRun(["rev-parse", "HEAD"]);
  const branch = gitRun(["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = gitRun(["status", "--porcelain"]);
  const changed = porcelain ? porcelain.split("\n").filter((l) => l.trim()).length : 0;
  const details = {
    head: head || "недоступно",
    branch: branch || "недоступно",
    changedFiles: porcelain === null ? "недоступно (git не ответил)" : changed,
  };
  logStep("git", "INFO", details);
  const msg = `${details.branch} @ ${String(details.head).slice(0, 12)}; изменённых файлов: ${details.changedFiles}`;
  return { status: "INFO", msg };
}

// ============================================================================
// Основной поток: сводка + exit code (0 — нет FAIL, 1 — есть FAIL)
// ============================================================================

async function main() {
  const sessionInfo = SESSION ? `${path.relative(ROOT, SESSION.logFile)} + ${path.relative(ROOT, SESSION.jsonlFile)}` : "недоступен (ошибка записи — проверка продолжается)";
  console.log(`» Conditera deploy-local: предпусковая проверка локального развёртывания${isCheckMode ? " (--check)" : ""}`);
  console.log(`» журнал: ${sessionInfo} (append-only)`);
  console.log("");

  const results = [];
  results.push(["env", checkEnvStep()]);
  results.push(["db", checkDbStep()]);
  results.push(["server", await checkServerStep()]);
  results.push(["git", checkGitStep()]);

  console.log("─── Сводка ───");
  for (const [step, r] of results) {
    console.log(`  ${r.status.padEnd(5)} ${step.padEnd(7)} ${r.msg}`);
  }
  const fails = results.filter(([, r]) => r.status === "FAIL").length;
  const warns = results.filter(([, r]) => r.status === "WARN").length;
  console.log("");
  console.log(
    `  Итог: FAIL=${fails}, WARN=${warns}` +
      (fails > 0
        ? " — есть критические проблемы, exit 1"
        : warns > 0
          ? " — критических проблем нет (WARN не влияют на exit code), exit 0"
          : " — всё в порядке, exit 0")
  );

  finishSession({
    result: fails > 0 ? "FAIL" : "OK",
    exitCode: fails > 0 ? 1 : 0,
    steps: Object.fromEntries(results.map(([step, r]) => [step, r.status])),
    failCount: fails,
    warnCount: warns,
  });

  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  logStep("deploy-local", "FAIL", `неожиданная ошибка: ${err && err.message ? err.message : err}`);
  finishSession({ result: "FAIL", exitCode: 1 });
  console.error(`✖ FATAL: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
