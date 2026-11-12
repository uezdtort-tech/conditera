#!/usr/bin/env node
/**
 * scripts/regression/secrets-scan.mjs — контент-сканер секретов (ZV31-011,
 * Z-v32 Пакет B1). Ноль внешних зависимостей; чистая логика паттернов —
 * в src/lib/regression/secrets-meta.ts (импортируется отсюда напрямую:
 * Node ≥22.18 исполняет .ts через strip-types, vitest — через свой transform).
 *
 * CLI:
 *   node scripts/regression/secrets-scan.mjs [--files <path>[,<path>...]]
 *                                            [--json <out>] [--staged]
 *
 * Выбор файлов (default): объединение
 *   (a) git diff --name-only HEAD  ∪  git diff --cached --name-only;
 *   (b) фиксированный набор критичных конфигов: .env, .env.local,
 *       .env.production, .env.production.example, .env.local.example,
 *       docker-compose.yml, docker-compose.dev.yml, Caddyfile.
 *   --staged: только git diff --cached --name-only (pre-commit сценарий).
 *   Отсутствующие файлы пропускаются; запускать из корня репо (cwd).
 *
 * Гварты: только текст ≤512KB (binary sniff по NUL-байту), НИКОГДА не
 * сканируются node_modules, .next, .git, docs/operations/checks/**
 * (артефакты рантайма), db/*.db.
 *
 * Allowlist: scripts/regression/secrets-allowlist.json — массив
 * {path, line, reason} для явных safe-fixture (line = 0 → весь файл).
 * Комбинация path+line подавляется целиком.
 *
 * Дисциплина вывода: находка печатается ТОЛЬКО как
 *   {file}:{line} [CATEGORY] matched (value redacted, len={n})
 * — само значение нигде не появляется (ни в stdout, ни в --json).
 *
 * Exit: 0 — чисто (или только allowlisted); 1 — подтверждённая утечка.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  isAllowlisted,
  isExampleEnvPath,
  normalizeSecretPath,
  scanLineForSecrets,
} from "../../src/lib/regression/secrets-meta.ts";

const ROOT = process.cwd();
const ALLOWLIST_PATH = join(
  dirnameFromImportMeta(),
  "secrets-allowlist.json"
);
const MAX_FILE_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 8192;
const SCHEMA_VERSION = 1;

/** Фиксированный набор критичных конфигов (спека ZV31-011). */
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

/** Пути, которые сканер не открывает никогда. */
const EXCLUDED = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)\.git(\/|$)/,
  /^docs\/operations\/checks\//,
  /^db\/[^/]*\.db$/,
];

function dirnameFromImportMeta() {
  // import.meta.url → <root>/scripts/regression/
  return fileURLToPath(new URL(".", import.meta.url));
}

// ===== CLI =====

function parseArgs(argv) {
  const out = { files: [], json: null, staged: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--staged") {
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
  return out;
}

function printUsage() {
  console.log(
    "usage: node scripts/regression/secrets-scan.mjs [--files <path>[,<path>...]] [--json <out>] [--staged]"
  );
}

// ===== Git helpers (best-effort) =====

function gitLines(args) {
  const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (res.error || res.status !== 0) return [];
  return String(res.stdout || "")
    .split(/\r?\n/)
    .map((l) => normalizeSecretPath(l.trim()))
    .filter(Boolean);
}

function collectFiles(opts) {
  const set = new Set();
  if (opts.staged) {
    for (const p of gitLines(["diff", "--cached", "--name-only"])) set.add(p);
  } else if (opts.files.length > 0) {
    for (const p of opts.files) set.add(p);
  } else {
    // (a) изменённые: diff против HEAD (вкл. staged) + staged-список
    for (const p of gitLines(["diff", "--name-only", "HEAD"])) set.add(p);
    for (const p of gitLines(["diff", "--cached", "--name-only"])) set.add(p);
    // (b) фиксированный набор критичных конфигов
    for (const p of FIXED_CONFIGS) set.add(p);
  }
  return Array.from(set);
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
          Number.isFinite(Number(e.line)) &&
          typeof e.reason === "string"
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

// ===== File filters =====

function isExcludedPath(p) {
  return EXCLUDED.some((re) => re.test(p));
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
  const mode = opts.staged ? "staged" : opts.files.length > 0 ? "files" : "changed+configs";
  const allowlist = loadAllowlist();

  const candidates = collectFiles(opts);
  const scanned = [];
  let skippedMissing = 0;
  let skippedBinary = 0;
  let skippedSize = 0;
  const findings = []; // подтверждённые (НЕ allowlisted), БЕЗ значений
  const allowlistedHits = []; // подавленные: {path, line, category, reason}
  const byCategory = {};

  for (const relPath of candidates) {
    if (isExcludedPath(relPath)) continue;
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

    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const lineMatches = scanLineForSecrets(lines[i], { isExampleFile });
      for (const m of lineMatches) {
        if (isAllowlisted(relPath, lineNo, allowlist)) {
          const entry = allowlist.find(
            (e) => normalizeSecretPath(e.path) === normalizeSecretPath(relPath) && (e.line === 0 || e.line === lineNo)
          );
          allowlistedHits.push({
            path: relPath,
            line: lineNo,
            category: m.category,
            reason: entry ? entry.reason : "allowlisted",
          });
          continue;
        }
        findings.push({
          path: relPath,
          line: lineNo,
          category: m.category,
          value_length: m.valueLength,
        });
        byCategory[m.category] = (byCategory[m.category] || 0) + 1;
        // Redacted output: НИКОГДА не печатаем значение/фрагмент строки
        console.log(
          `${relPath}:${lineNo} [${m.category}] matched (value redacted, len=${m.valueLength})`
        );
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const exitOk = findings.length === 0;

  // Summary (только счётчики — значений нет)
  console.log(
    `(secrets-scan) mode=${mode} files_scanned=${scanned.length} findings=${findings.length} allowlisted=${allowlistedHits.length} skipped(missing=${skippedMissing},binary=${skippedBinary},size=${skippedSize})`
  );
  if (Object.keys(byCategory).length > 0) {
    const parts = Object.entries(byCategory).map(([c, n]) => `${c}=${n}`);
    console.log(`(secrets-scan) by_category: ${parts.join(", ")}`);
  }
  console.log(`(secrets-scan) RESULT: ${exitOk ? "CLEAN" : "LEAK_DETECTED"}`);

  if (opts.json) {
    const report = {
      schema_version: SCHEMA_VERSION,
      mode,
      started_at: startedAt,
      finished_at: finishedAt,
      files_scanned: scanned.length,
      files_skipped: {
        missing: skippedMissing,
        binary: skippedBinary,
        size_limit: skippedSize,
      },
      findings_count: findings.length,
      allowlisted_count: allowlistedHits.length,
      by_category: byCategory,
      // Метаданные находок БЕЗ значений и без содержимого строк
      findings,
      allowlisted: allowlistedHits,
      exit_ok: exitOk,
    };
    try {
      writeFileSync(opts.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } catch (err) {
      console.warn(
        `(secrets-scan) failed to write --json ${opts.json}: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  process.exitCode = exitOk ? 0 : 1;
}

main();
