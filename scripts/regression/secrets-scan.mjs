#!/usr/bin/env node
/**
 * scripts/regression/secrets-scan.mjs — контент-сканер секретов (ZV31-011).
 *
 * Z-v32 Пакет B2: добавлены режимы --mode=quick|full по спеке release-gate:
 *   • quick — staged-файлы (git diff --cached --name-only) + изменённые в
 *     worktree (git status --porcelain добавления/модификации/ untracked),
 *     артефакты docs/operations/checks/** исключены;
 *   • full  — ВСЕ git-tracked текстовые файлы (git ls-files), капа размера
 *     2MB на файл, исключения бинарных/lock-файлов (*.lock, bun.lock,
 *     *.png/jpg/ico/pdf/woff*, .keep, каталоги images).
 *
 * Ноль внешних зависимостей; чистая логика паттернов — в
 * src/lib/regression/secrets-meta.ts (импортируется отсюда напрямую:
 * Node ≥22.18 исполняет .ts через strip-types, vitest — через transform).
 *
 * CLI:
 *   node scripts/regression/secrets-scan.mjs [--mode=quick|full]
 *                                            [--files <path>[,<path>...]]
 *                                            [--json <out>] [--staged]
 *
 *   default (без --mode) — quick: объединение
 *     (a) git diff --name-only HEAD ∪ git diff --cached --name-only ∪
 *         git status --porcelain (вкл. untracked);
 *     (b) фиксированный набор критичных конфигов (.env*, docker-compose*,
 *         Caddyfile). В quick записи, помеченные git check-ignore
 *         (gitignored .env* — не могут быть закоммичены по построению),
 *         выпадают: их находки — структурные ложные позитивы (ZV33-9b).
 *         Full-режим этим не затрагивается.
 *   --staged → только git diff --cached --name-only (pre-commit сценарий).
 *   Отсутствующие файлы пропускаются; запускать из корня репо.
 *
 * Placeholder-фильтр (НЕ утечка): пустые значения, токены-плейсхолдеры
 * (changeme/your_/example/...), ${VAR}/<var>/...-схемы, ЛИТЕРАЛЬНЫЕ значения
 * из АКТУАЛЬНЫХ env-шаблонов (.env.local.example / .env.production.example —
 * список строится из шаблонов; реальный .env.local для этого НЕ читается).
 *
 * Test-fixture исключение (только явное правило, не молчаливое): в
 * *.test.* / *.spec.* / __tests__ файлах значение подавляется ТОЛЬКО если
 * содержит test|fake|mock|example|fixture|dummy (см. secrets-meta.ts);
 * всё остальное — находка. Файльные исключения — scripts/regression/
 * secrets-allowlist.json: массив {path, line, reason}; line = 0 → весь
 * файл, каждая запись обязана иметь one-line обоснование.
 *
 * Гварды: только текст (binary sniff по NUL-байту); НИКОГДА не сканируются
 * node_modules, .next, .git, docs/operations/checks/** (артефакты
 * рантайма), db/*.db; в full — капа 2MB/файл и бинарные/lock-расширения.
 *
 * Дисциплина вывода: находка печатается ТОЛЬКО как
 *   {file}:{line} [{rule}] matched (value redacted, len={n})
 * — само значение нигде не появляется (ни в stdout, ни в --json).
 *
 * Отчёт: docs/operations/checks/secrets-scan-latest.json (или --json PATH):
 *   {mode, commit_sha, started_at, finished_at, scanned_files,
 *    findings: [{file, line, rule}], exclusions_applied, passed}.
 * В full-режиме копия отчёта пишется в docs/operations/checks/history/
 * (конвенция истории run-checks).
 *
 * Exit: 0 — чисто (или только allowlisted/fixture/шаблонные); 1 —
 * подтверждённая утечка. Краш сканера — необработанное исключение
 * (nonzero exit): SKIP никогда не маскируется под PASS.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  isAllowlisted,
  isExampleEnvPath,
  isTestFixturePath,
  normalizeSecretPath,
  scanLineForSecrets,
} from "../../src/lib/regression/secrets-meta.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWLIST_PATH = join(dirname(fileURLToPath(import.meta.url)), "secrets-allowlist.json");
const CHECKS_DIR = join(ROOT, "docs", "operations", "checks");
const DEFAULT_JSON_PATH = join(CHECKS_DIR, "secrets-scan-latest.json");
const HISTORY_DIR = join(CHECKS_DIR, "history");

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB (спека ZV31-011 B2, full-режим)
const BINARY_SNIFF_BYTES = 8192;
const SCHEMA_VERSION = 2;

/** Фиксированный набор критичных конфигов (сканируется и в quick). */
const FIXED_CONFIGS = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.example",
  ".env.local.example",
  "docker-compose.yml",
  "docker-compose.dev.yml",
  "Caddyfile",
];

/**
 * Env-шаблоны — источник списка легальных placeholder-значений.
 * РЕАЛЬНЫЙ .env.local / .env.production для этого НЕ читается никогда.
 */
const TEMPLATE_FILES = [".env.local.example", ".env.production.example"];

/** Пути, которые сканер не открывает никогда (оба режима). */
const EXCLUDED_PATHS = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)\.git(\/|$)/,
  /^docs\/operations\/checks\//,
  /^db\/[^/]*\.db$/,
];

/**
 * Расширения/имена, пропускаемые в full-режиме (спека: binary/lockfile
 * exclusions). Бинарный sniff всё равно второй линией защиты.
 */
const FULL_SKIP_NAME_RE =
  /(?:\.lock$|^bun\.lock$|\.png$|\.jpe?g$|\.gif$|\.ico$|\.webp$|\.avif$|\.pdf$|\.woff2?$|\.ttf$|\.eot$|\.mp4$|\.webm$|\.mp3$|\.wav$|\.zip$|\.gz$|\.tgz$|\.tar$|\.7z$|\.keep$|\.ds_store$)/i;

/** Каталоги изображений/ассетов (спека: «images dir»). */
const FULL_SKIP_DIR_RE = /(?:^|\/)(?:images|img|icons?|logos?|screenshots?|assets|public\/icons)\//i;

function dirnameFromImportMeta() {
  return fileURLToPath(new URL(".", import.meta.url));
}

// ===== CLI =====

function parseArgs(argv) {
  const out = { mode: null, files: [], json: null, staged: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value === "quick" || value === "full") out.mode = value;
      else console.warn(`(secrets-scan) unknown --mode="${value}", falling back to quick`);
    } else if (arg === "--staged") {
      out.staged = true;
    } else if (arg === "--json" || arg.startsWith("--json=")) {
      const value = arg.includes("=") ? arg.slice("--json=".length) : argv[++i];
      if (value) out.json = value;
    } else if (arg === "--files" || arg.startsWith("--files=")) {
      const value = arg.includes("=") ? arg.slice("--files=".length) : argv[++i];
      if (value) {
        for (const piece of String(value).split(",")) {
          const p = piece.trim();
          if (p) out.files.push(normalizeSecretPath(p));
        }
      }
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.warn(`(secrets-scan) unknown arg ignored: ${arg}`);
    }
  }
  if (!out.mode) out.mode = out.staged ? "staged" : out.files.length > 0 ? "files" : "quick";
  return out;
}

function printUsage() {
  console.log(
    "usage: node scripts/regression/secrets-scan.mjs [--mode=quick|full] [--files <path>[,<path>...]] [--json <out>] [--staged]"
  );
}

// ===== Git helpers (best-effort) =====

const GIT_SPAWN_OPTS = { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };

function gitLines(args) {
  const res = spawnSync("git", args, GIT_SPAWN_OPTS);
  if (res.error || res.status !== 0) return [];
  return String(res.stdout || "")
    .split(/\r?\n/)
    .map((l) => normalizeSecretPath(l.trim()))
    .filter(Boolean);
}

function resolveCommitSha() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], GIT_SPAWN_OPTS);
  return res.error || res.status !== 0 ? "unknown" : String(res.stdout || "").trim() || "unknown";
}

/**
 * isGitIgnored(relPath) — git check-ignore из корня репо, результат
 * кэшируется по пути (ZV33-9b). Используется ТОЛЬКО в quick при
 * разворачивании фиксированного набора: gitignored-файл не может попасть
 * в репозиторий, сканировать его — структурный ложный позитив.
 * Fail-safe: при ошибке git (spawn/статус ≠ 0/1) файл считается НЕ
 * игнорированным (сканируем) — ложный позитив лучше слепого пропуска.
 */
const GIT_IGNORE_CACHE = new Map();

function isGitIgnored(relPath) {
  const cached = GIT_IGNORE_CACHE.get(relPath);
  if (cached !== undefined) return cached;
  const res = spawnSync("git", ["check-ignore", "-q", "--", relPath], GIT_SPAWN_OPTS);
  // exit 0 → ignored; 1 → не ignored; ошибка spawn/128 → fail-safe: сканируем.
  const ignored = !res.error && res.status === 0;
  GIT_IGNORE_CACHE.set(relPath, ignored);
  return ignored;
}

/**
 * collectChangedOrStagedFiles — quick-режим: staged (git diff --cached
 * --name-only) ∪ worktree-changed (git diff --name-only HEAD + git status
 * --porcelain добавления/модификации/untracked). Удалённые файлы физически
 * отсутствуют и отсеются existsSync-фильтром.
 */
function collectChangedOrStagedFiles() {
  const set = new Set();
  for (const p of gitLines(["diff", "--cached", "--name-only"])) set.add(p);
  for (const p of gitLines(["diff", "--name-only", "HEAD"])) set.add(p);

  // status --porcelain: XY<space><path> — парсим БЕЗ trim (ведущий X/Y —
  // статус-колонки, trim съел бы префикс и сместил срез).
  const res = spawnSync("git", ["status", "--porcelain"], GIT_SPAWN_OPTS);
  const statusOut = res.error || res.status !== 0 ? "" : String(res.stdout || "");
  for (const raw of statusOut.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let p = raw.length > 3 ? raw.slice(3) : raw.trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p.includes(" -> ")) p = p.split(" -> ").pop() || "";
    if (p) set.add(normalizeSecretPath(p));
  }
  // Фиксированный набор (ZV33-9b): gitignored-записи (.env/.env.local/
  // .env.production под .gitignore `.env*`) выпадают — они не могут
  // попасть в коммит; трекаемые конфиги (шаблоны, compose, Caddyfile)
  // остаются в сканировании.
  for (const p of FIXED_CONFIGS) {
    if (isGitIgnored(p)) continue;
    set.add(p);
  }
  return Array.from(set);
}

/** collectTrackedFiles — full-режим: ВСЕ git-tracked файлы (git ls-files). */
function collectTrackedFiles() {
  return gitLines(["ls-files"]);
}

// ===== Allowlist =====

function loadAllowlist() {
  try {
    if (!existsSync(ALLOWLIST_PATH)) return [];
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e) =>
          e &&
          typeof e.path === "string" &&
          typeof e.reason === "string" &&
          e.reason.trim().length > 0 && // каждая запись — с обоснованием
          Number.isFinite(Number(e.line))
      )
      .map((e) => ({ path: normalizeSecretPath(e.path), line: Number(e.line), reason: e.reason }));
  } catch (err) {
    console.warn(
      `(secrets-scan) allowlist unreadable, scanning WITHOUT it: ${
        err instanceof Error ? err.message : err
      }`
    );
    return [];
  }
}

// ===== Template placeholder values (ZV31-011 B2) =====

/**
 * buildTemplatePlaceholderValues — литеральные значения из АКТУАЛЬНЫХ
 * env-шаблонов (.env.local.example / .env.production.example). Реальный
 * .env.local не читается. Возвращает Set строк в lowercase.
 */
function buildTemplatePlaceholderValues() {
  const values = new Set();
  for (const rel of TEMPLATE_FILES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      // KEY=VALUE (в т.ч. закомментированные варианты: #   KEY=VALUE)
      const m = /^\s*#?\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      let value = m[1].replace(/^["']|["']$/g, "");
      if (!value) continue;
      values.add(value.toLowerCase());
      // Для url-с-креденшелами также добавить сегмент пароля
      // (url-credentials capture = пароль, а не весь URL).
      const urlMatch = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:]+:([^@\s/]+)@/i.exec(value);
      if (urlMatch) values.add(urlMatch[1].toLowerCase());
    }
  }
  return Array.from(values);
}

// ===== File filters =====

function isExcludedPath(p) {
  return EXCLUDED_PATHS.some((re) => re.test(p));
}

function fullModeSkip(relPath) {
  const name = relPath.split("/").pop() || relPath;
  if (FULL_SKIP_NAME_RE.test(name)) return true;
  if (FULL_SKIP_DIR_RE.test(relPath)) return true;
  return false;
}

/** Binary sniff: NUL-байт в первых 8KB → считаем бинарным. */
function looksBinary(buf) {
  const probe = buf.subarray(0, BINARY_SNIFF_BYTES);
  return probe.includes(0);
}

// ===== Main =====

function main() {
  const startedAt = new Date().toISOString();
  const opts = parseArgs(process.argv.slice(2));
  const mode = opts.mode;
  const allowlist = loadAllowlist();
  const templateValues = buildTemplatePlaceholderValues();

  const candidates =
    mode === "full"
      ? collectTrackedFiles()
      : mode === "quick"
        ? collectChangedOrStagedFiles()
        : mode === "staged"
          ? gitLines(["diff", "--cached", "--name-only"])
          : opts.files;

  const scanned = [];
  const scannedTestFiles = [];
  let skippedMissing = 0;
  let skippedBinary = 0;
  let skippedSize = 0;
  let skippedPathExcluded = 0;
  const findings = []; // подтверждённые (НЕ allowlisted), БЕЗ значений
  const allowlistedHits = []; // подавленные: {path, line, rule, reason}
  const byRule = {};

  for (const relPathRaw of candidates) {
    const relPath = normalizeSecretPath(relPathRaw);
    if (isExcludedPath(relPath)) {
      skippedPathExcluded += 1;
      continue;
    }
    if (mode === "full" && fullModeSkip(relPath)) {
      skippedPathExcluded += 1;
      continue;
    }
    const abs = join(ROOT, relPath);
    if (!existsSync(abs)) {
      skippedMissing += 1;
      continue;
    }
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      skippedMissing += 1;
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES) {
      skippedSize += 1;
      continue;
    }
    let buf;
    try {
      buf = readFileSync(abs);
    } catch (err) {
      console.warn(
        `(secrets-scan) unreadable file skipped: ${relPath} (${
          err instanceof Error ? err.message : err
        })`
      );
      continue;
    }
    if (looksBinary(buf)) {
      skippedBinary += 1;
      continue;
    }
    scanned.push(relPath);

    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/);
    const isExampleFile = isExampleEnvPath(relPath);
    const isFixture = isTestFixturePath(relPath);
    if (isFixture) scannedTestFiles.push(relPath);

    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const lineMatches = scanLineForSecrets(lines[i], {
        isExampleFile,
        isTestFixture: isFixture,
        templateValues,
      });
      for (const m of lineMatches) {
        if (isAllowlisted(relPath, lineNo, allowlist)) {
          const entry = allowlist.find(
            (e) =>
              normalizeSecretPath(e.path) === normalizeSecretPath(relPath) &&
              (e.line === 0 || e.line === lineNo)
          );
          allowlistedHits.push({
            path: relPath,
            line: lineNo,
            rule: m.category,
            reason: entry ? entry.reason : "allowlisted",
          });
          continue;
        }
        findings.push({
          file: relPath,
          line: lineNo,
          rule: m.category,
          value_length: m.valueLength,
        });
        byRule[m.category] = (byRule[m.category] || 0) + 1;
        // Redacted output: НИКОГДА не печатаем значение/фрагмент строки
        console.log(`${relPath}:${lineNo} [${m.category}] matched (value redacted, len=${m.valueLength})`);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const commitSha = resolveCommitSha();
  const exitOk = findings.length === 0;

  const report = {
    schema_version: SCHEMA_VERSION,
    mode,
    commit_sha: commitSha,
    started_at: startedAt,
    finished_at: finishedAt,
    scanned_files: scanned.length,
    scanned_files_list: scanned,
    findings, // [{file, line, rule, value_length}] — БЕЗ значений
    exclusions_applied: {
      allowlisted: allowlistedHits,
      test_fixture_files: scannedTestFiles.length,
      template_env_files: TEMPLATE_FILES.filter((f) => existsSync(join(ROOT, f))),
      skipped: {
        missing: skippedMissing,
        binary: skippedBinary,
        size_limit: skippedSize,
        path_excluded: skippedPathExcluded,
      },
    },
    passed: exitOk,
  };

  // Summary (только счётчики и file:line:rule — значений нет)
  console.log(
    `(secrets-scan) mode=${mode} commit=${commitSha.slice(0, 7)} files_scanned=${scanned.length} findings=${findings.length} allowlisted=${allowlistedHits.length} skipped(missing=${skippedMissing},binary=${skippedBinary},size=${skippedSize},path=${skippedPathExcluded}) template_values=${templateValues.length}`
  );
  if (Object.keys(byRule).length > 0) {
    const parts = Object.entries(byRule).map(([c, n]) => `${c}=${n}`);
    console.log(`(secrets-scan) by_rule: ${parts.join(", ")}`);
  }
  console.log(`(secrets-scan) RESULT: ${exitOk ? "CLEAN" : "LEAK_DETECTED"}`);

  // Отчёт: --json PATH или дефолт docs/operations/checks/secrets-scan-latest.json
  const jsonPath = opts.json ? join(ROOT, opts.json) : DEFAULT_JSON_PATH;
  try {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(
      `(secrets-scan) failed to write --json ${jsonPath}: ${
        err instanceof Error ? err.message : err
      }`
    );
  }

  // Persistence: full-режим дополнительно пишет history-запись (конвенция run-checks)
  if (mode === "full") {
    try {
      mkdirSync(HISTORY_DIR, { recursive: true });
      const historyName = `${finishedAt.replace(/:/g, "-")}-secrets-scan-${commitSha.slice(0, 7)}.json`;
      writeFileSync(join(HISTORY_DIR, historyName), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } catch (err) {
      console.warn(
        `(secrets-scan) failed to write history entry: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  process.exitCode = exitOk ? 0 : 1;
}

try {
  main();
} catch (err) {
  // Краш сканера — это FAIL (nonzero), не skip: gate не должен маскировать
  // сломанный сканер как «пройдено».
  console.error(
    `(secrets-scan) CRASH: ${err instanceof Error ? (err.stack || err.message) : String(err)}`
  );
  process.exitCode = 1;
}
