#!/usr/bin/env node
/**
 * scripts/regression/run-checks.mjs — единый regression-runner (Task Z31-3-a).
 *
 * Запускает quality-проверки (typecheck / eslint / vitest /
 * route-error-coverage) последовательно, персистит результат в
 * docs/operations/checks/{latest.json,history/,failures/} и регистрирует
 * сбои как диагностические события (через scripts/regression/
 * register-failure.mjs — best-effort, fail-open).
 *
 * CLI:
 *   node scripts/regression/run-checks.mjs [--mode=quick|full] [--json-out=PATH]
 *
 * Exit code: 0 — нет сбоев (skipped не считается сбоем); 1 — есть сбои.
 * Никакой симуляции успеха: exit code строго отражает результат проверок.
 *
 * Plain Node ESM: только node:* импорты + ./lib/meta.mjs (никаких @/...).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  classifyExit,
  computeFileFingerprint,
  errorCodeForCheck,
  extractVitestFailures,
  filterChangedSources,
  severityForCheck,
  tail,
} from "./lib/meta.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKS_DIR = join(ROOT, "docs", "operations", "checks");
const LATEST_PATH = join(CHECKS_DIR, "latest.json");
const HISTORY_DIR = join(CHECKS_DIR, "history");
const FAILURES_DIR = join(CHECKS_DIR, "failures");

const MAX_BUFFER = 64 * 1024 * 1024; // 64MB
const OUTPUT_TAIL_MAX = 8000;
const SCHEMA_VERSION = 1;

/** Тест runner-библиотеки, подключаемый при изменении scripts/regression/. */
const RUNNER_META_TEST = "src/lib/regression/meta.test.ts";
const ROUTE_COVERAGE_SCRIPT = "scripts/verify/route-error-coverage.mjs";
const SECRETS_SCAN_SCRIPT = "scripts/regression/secrets-scan.mjs";
// ZV31-011 (B2): отчёт сканера — docs/operations/checks/secrets-scan-latest.json
const SECRETS_JSON_REL = "docs/operations/checks/secrets-scan-latest.json";

// ===== CLI =====

function parseArgs(argv) {
  let mode = "quick";
  let jsonOut = null;
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value === "quick" || value === "full") mode = value;
      else console.warn(`(run-checks) unknown --mode="${value}", falling back to "quick"`);
    } else if (arg.startsWith("--json-out=")) {
      const value = arg.slice("--json-out=".length);
      jsonOut = value || null;
    }
  }
  return { mode, jsonOut };
}

// ===== Git helpers (best-effort, fallback "unknown") =====

function git(args) {
  const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER });
  if (res.error || res.status !== 0) return null;
  const out = String(res.stdout || "").trim();
  return out || null;
}

function resolveCommit() {
  return git(["rev-parse", "HEAD"]) || "unknown";
}

function resolveBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
}

/**
 * collectChangedFiles — объединяет `git status --porcelain` (вкл. untracked)
 * и `git diff --name-only HEAD` (staged+unstaged) в уникальный список путей.
 */
function collectChangedFiles() {
  const merged = new Set();

  const status = git(["status", "--porcelain"]);
  if (status) {
    for (const line of status.split(/\r?\n/)) {
      if (!line.trim()) continue;
      // Формат porcelain v1: XY<space><path>; переименования: "R  old -> new"
      let p = line.length > 3 ? line.slice(3) : line.trim();
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      if (p.includes(" -> ")) p = p.split(" -> ").pop() || "";
      if (p) merged.add(p.replace(/\\/g, "/"));
    }
  }

  const diff = git(["diff", "--name-only", "HEAD"]);
  if (diff) {
    for (const line of diff.split(/\r?\n/)) {
      const p = line.trim();
      if (p) merged.add(p.replace(/\\/g, "/"));
    }
  }

  // Удалённые/переименованные файлы (D/R-old) физически отсутствуют на диске —
  // их нельзя подавать в eslint/vitest (фантомные пути дают ложные FAIL,
  // Z-v31 очистка: eslint падал на _quarantine/... и prisma.config.ts).
  return Array.from(merged).filter((p) => existsSync(join(ROOT, p)));
}

// ===== Check plan =====

/**
 * collectCandidateTests — кандидатные тест-файлы для изменённых исходников:
 *   • <file без ext>.test.ts;
 *   • <dir>/<basename без ext>.test.ts (второе правило из спеки);
 * плюс src/lib/regression/meta.test.ts, если менялся runner (scripts/regression/).
 */
function collectCandidateTests(changedSources, runnerLibChanged) {
  const tests = new Set();
  for (const file of changedSources) {
    const candidates = [
      file.replace(/\.(ts|tsx)$/, ".test.ts"),
      join(dirname(file), `${basename(file).replace(/\.(ts|tsx)$/, "")}.test.ts`),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const abs = join(ROOT, candidate);
      if (existsSync(abs)) tests.add(candidate.replace(/\\/g, "/"));
    }
  }
  if (runnerLibChanged && existsSync(join(ROOT, RUNNER_META_TEST))) {
    tests.add(RUNNER_META_TEST);
  }
  return Array.from(tests);
}

/**
 * buildCheckPlan — список проверок для режима. Skipped-проверки выражаются
 * элементом {name, skipped: true, note}.
 */
function buildCheckPlan(mode, changedSources, runnerLibChanged) {
  const plan = [];

  // Always: typecheck — bunx tsc gets OOM-killed in this sandbox (exit 137);
  // run tsc directly under node with an explicit heap cap instead.
  plan.push({
    name: "typecheck",
    cmd: "node",
    args: ["--max-old-space-size=1536", "node_modules/typescript/bin/tsc", "--noEmit"],
    cwd: ROOT,
    timeoutMs: 600_000,
  });

  if (mode === "quick") {
    // eslint — только изменённые исходники
    if (changedSources.length > 0) {
      plan.push({
        name: "eslint",
        cmd: "bunx",
        args: ["eslint", "--no-warn-ignored", ...changedSources.slice(0, 50)],
        cwd: ROOT,
        timeoutMs: 300_000,
      });
    } else {
      plan.push({ name: "eslint", skipped: true, note: "no changed sources" });
    }

    // vitest — кандидатные тесты изменённых исходников
    const tests = collectCandidateTests(changedSources, runnerLibChanged);
    if (tests.length > 0) {
      plan.push({
        name: "vitest",
        cmd: "bunx",
        args: ["vitest", "run", ...tests.slice(0, 30)],
        cwd: ROOT,
        timeoutMs: 600_000,
      });
    } else {
      plan.push({
        name: "vitest",
        skipped: true,
        note: "no candidate test files for changed sources",
      });
    }

    // secrets-scan — ZV31-011 (B2): в quick сканируем changed/staged
    // (быстрый контент-скан диффа; full-режим сканирует весь tracked tree)
    if (existsSync(join(ROOT, SECRETS_SCAN_SCRIPT))) {
      plan.push({
        name: "secrets-scan",
        cmd: "node",
        // --disable-warning: .ts-модуль без "type":"module" даёт безвредный
        // MODULE_TYPELESS warning при strip-types — шум в gate-артефактах не нужен.
        args: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SECRETS_SCAN_SCRIPT, "--mode=quick", "--json", SECRETS_JSON_REL],
        cwd: ROOT,
        timeoutMs: 120_000,
      });
    } else {
      plan.push({
        name: "secrets-scan",
        skipped: true,
        note: `script missing (${SECRETS_SCAN_SCRIPT})`,
      });
    }
    return plan;
  }

  // full mode
  plan.push({
    name: "eslint",
    cmd: "bunx",
    args: ["eslint", "--no-warn-ignored", "."],
    cwd: ROOT,
    timeoutMs: 600_000,
  });
  plan.push({
    name: "vitest",
    cmd: "bunx",
    args: ["vitest", "run"],
    cwd: ROOT,
    timeoutMs: 900_000,
  });
  if (existsSync(join(ROOT, ROUTE_COVERAGE_SCRIPT))) {
    plan.push({
      name: "route-error-coverage",
      cmd: "node",
      args: [ROUTE_COVERAGE_SCRIPT],
      cwd: ROOT,
      timeoutMs: 120_000,
    });
  } else {
    plan.push({
      name: "route-error-coverage",
      skipped: true,
      note: `script missing (${ROUTE_COVERAGE_SCRIPT})`,
    });
  }

  // ZV31-011: контент-скан секретов в release gate. QUICK — changed/staged,
  // FULL — весь tracked tree (git ls-files) с капой 2MB/файл. Выход сканера —
  // строгий exit code; stdout уже redacted (значения не печатаются),
  // поэтому output_tail безопасен. Краш сканера — FAIL (не skip).
  // Отчёт — docs/operations/checks/secrets-scan-latest.json (+history в full).
  if (existsSync(join(ROOT, SECRETS_SCAN_SCRIPT))) {
    plan.push({
      name: "secrets-scan",
      cmd: "node",
      args: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SECRETS_SCAN_SCRIPT, "--mode=full", "--json", SECRETS_JSON_REL],
      cwd: ROOT,
      timeoutMs: 120_000,
    });
  } else {
    plan.push({
      name: "secrets-scan",
      skipped: true,
      note: `script missing (${SECRETS_SCAN_SCRIPT})`,
    });
  }
  return plan;
}

// ===== Execution =====

/**
 * runCheck — последовательный запуск одной проверки через spawnSync.
 * exit_code: null при сигнале/спавн-ошибке → -1.
 */
function runCheck(check) {
  const startedAt = Date.now();
  const res = spawnSync(check.cmd, check.args, {
    cwd: check.cwd || ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: check.timeoutMs,
  });
  const durationMs = Date.now() - startedAt;

  const exitCode = res.status === null ? -1 : res.status;
  let output = `${res.stdout || ""}${res.stderr || ""}`;
  if (res.error) output += `\n${res.error.message}`;
  const { passed } = classifyExit(check.name, exitCode);

  const entry = {
    name: check.name,
    cmd_line: `${check.cmd} ${check.args.join(" ")}`,
    skipped: false,
    exit_code: exitCode,
    duration_ms: durationMs,
    passed,
    output_tail: tail(output, OUTPUT_TAIL_MAX),
  };
  return { entry, rawOutput: output };
}

/**
 * readPreviousLatest — предыдущий latest.json (читается ДО перезаписи,
 * в начале работы runner'а) для previous_success в failure-записях.
 */
function readPreviousLatest() {
  try {
    if (!existsSync(LATEST_PATH)) return null;
    const parsed = JSON.parse(readFileSync(LATEST_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function previousSuccessFor(prevLatest, checkName) {
  if (!prevLatest || !Array.isArray(prevLatest.checks)) return null;
  const entry = prevLatest.checks.find((c) => c && c.name === checkName);
  if (!entry || entry.passed !== true) return null;
  return {
    commit_sha: prevLatest.commit_sha ?? "unknown",
    finished_at: prevLatest.finished_at ?? null,
  };
}

// ===== Main =====

function main() {
  const { mode, jsonOut } = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const commitSha = resolveCommit();
  const branch = resolveBranch();
  const sha7 = commitSha.slice(0, 7);

  // previous latest.json — в память ДО любых записей
  const prevLatest = readPreviousLatest();

  // Изменённые файлы: сырой список (для детекта изменений runner-библиотеки)
  // и отфильтрованный (для eslint/vitest в quick-режиме).
  const rawChanged = mode === "quick" ? collectChangedFiles() : [];
  const changedSources = mode === "quick" ? filterChangedSources(rawChanged) : [];
  const runnerLibChanged = rawChanged.some((p) => p.startsWith("scripts/regression/"));

  console.log(
    `(run-checks) mode=${mode} commit=${sha7} branch=${branch} changed_sources=${changedSources.length}`
  );

  const plan = buildCheckPlan(mode, changedSources, runnerLibChanged);

  // Последовательный запуск
  const checks = [];
  const rawOutputs = new Map();
  for (const check of plan) {
    if (check.skipped) {
      checks.push({
        name: check.name,
        cmd_line: null,
        skipped: true,
        note: check.note,
        exit_code: null,
        duration_ms: 0,
        passed: false,
        output_tail: "",
      });
      continue;
    }
    console.log(`(run-checks) running ${check.name}: ${check.cmd} ${check.args.join(" ")}`);
    const { entry, rawOutput } = runCheck(check);
    checks.push(entry);
    rawOutputs.set(check.name, rawOutput);
  }

  const finishedAt = new Date().toISOString();
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => !c.skipped && c.passed === true).length,
    failed: checks.filter((c) => !c.skipped && c.passed === false).length,
    skipped: checks.filter((c) => c.skipped).length,
  };

  const result = {
    schema_version: SCHEMA_VERSION,
    mode,
    started_at: startedAt,
    finished_at: finishedAt,
    commit_sha: commitSha,
    branch,
    environment: process.env.NODE_ENV || "development",
    node_version: process.version,
    checks,
    summary,
  };

  // Персист результата
  mkdirSync(HISTORY_DIR, { recursive: true });
  mkdirSync(FAILURES_DIR, { recursive: true });

  const resultJson = `${JSON.stringify(result, null, 2)}\n`;
  try {
    writeFileSync(LATEST_PATH, resultJson, "utf8");
    const historyName = `${finishedAt.replace(/:/g, "-")}-${mode}-${sha7}.json`;
    writeFileSync(join(HISTORY_DIR, historyName), resultJson, "utf8");
  } catch (err) {
    console.warn(
      `(run-checks) failed to persist check reports: ${err instanceof Error ? err.message : err}`
    );
  }

  if (jsonOut) {
    try {
      writeFileSync(jsonOut, resultJson, "utf8");
    } catch (err) {
      console.warn(
        `(run-checks) failed to write --json-out=${jsonOut}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // Failure-записи (passed === false и не skipped)
  const failureRecords = [];
  for (const entry of checks) {
    if (entry.skipped || entry.passed !== false) continue;
    const errorCode = errorCodeForCheck(entry.name);
    const rawOutput = rawOutputs.get(entry.name) || "";
    const record = {
      fingerprint: computeFileFingerprint([entry.name, errorCode]),
      check: entry.name,
      severity: severityForCheck(entry.name),
      error_code: errorCode,
      message: `Regression check "${entry.name}" failed (${mode} mode) at commit ${sha7}`,
      component: "infrastructure",
      source: "cron",
      commit_sha: commitSha,
      branch,
      mode,
      detected_at: finishedAt,
      failing_tests: entry.name === "vitest" ? extractVitestFailures(rawOutput) : [],
      previous_success: previousSuccessFor(prevLatest, entry.name),
      output_tail: entry.output_tail,
    };
    failureRecords.push(record);
    try {
      writeFileSync(join(FAILURES_DIR, `${record.fingerprint}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    } catch (err) {
      console.warn(
        `(run-checks) failed to persist failure record for ${entry.name}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // Регистрация в diagnostics — best-effort, НИКОГДА не влияет на exit code
  if (failureRecords.length > 0) {
    try {
      const reg = spawnSync("bun", ["scripts/regression/register-failure.mjs"], {
        cwd: ROOT,
        timeout: 60_000,
        stdio: "inherit",
      });
      if (reg.error || reg.status === null || reg.status !== 0) {
        console.warn(
          "(register-failure) DB registration skipped or failed — pending record kept in docs/operations/checks/failures/"
        );
      }
    } catch (err) {
      console.warn(
        "(register-failure) DB registration skipped or failed — pending record kept in docs/operations/checks/failures/",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Human summary
  for (const entry of checks) {
    if (entry.skipped) {
      console.log(`SKIP ${entry.name} (${entry.duration_ms} ms) — ${entry.note || "skipped"}`);
    } else if (entry.passed) {
      console.log(`PASS ${entry.name} (${entry.duration_ms} ms)`);
    } else {
      console.log(`FAIL ${entry.name} (${entry.duration_ms} ms)`);
    }
  }
  if (summary.failed > 0) {
    console.log(`RESULT: FAILED (${summary.failed} check(s))`);
    process.exitCode = 1;
  } else {
    console.log("RESULT: PASSED");
    process.exitCode = 0;
  }
}

main();
