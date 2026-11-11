#!/usr/bin/env bun
/**
 * scripts/regression/register-failure.mjs — регистрация pending failure-
 * записей (docs/operations/checks/failures/*.json) в единой диагностике
 * (app_error_events + инцидентная агрегация) через
 * @/lib/diagnostics/event-store.
 *
 * Вызывается из scripts/regression/run-checks.mjs (best-effort), но может
 * запускаться и вручную для повторной регистрации pending-записей
 * (уже зарегистрированные — с registered_at — пропускаются).
 *
 * Fail-open: ЛЮБОЙ сбой (нет файлов, недоступна БД, сбой импорта) →
 * console.warn + process.exitCode = 2; вызвавший runner не ломается,
 * pending-записи остаются на диске. Каждая запись обёрнута в try/catch —
 * одна плохая запись не останавливает остальные.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAILURES_DIR = join(ROOT, "docs", "operations", "checks", "failures");

/** Окно ожидания немедленного flush диагностической очереди. */
const FLUSH_WAIT_MS = 1500;

async function main() {
  let files = [];
  try {
    files = readdirSync(FAILURES_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    // Каталога нет — значит pending-записей нет (runner их ещё не создал)
    console.log("(register-failure) no failures directory — nothing to register");
    return;
  }
  if (files.length === 0) {
    console.log("(register-failure) no pending failure records");
    return;
  }

  // Динамический импорт: сбой разрешения алиаса/зависимости не должен
  // падать на этапе парсинга модуля (fail-open).
  const { storeErrorEvent, triggerImmediateFlush } = await import(
    "@/lib/diagnostics/event-store"
  );

  const registered = []; // [{ path, record }]
  let hadErrors = false;

  for (const name of files) {
    const path = join(FAILURES_DIR, name);
    try {
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (!record || typeof record !== "object") continue;
      if (record.registered_at) continue; // уже зарегистрирована ранее

      const failingTests = Array.isArray(record.failing_tests)
        ? record.failing_tests
        : [];
      const outputTail = typeof record.output_tail === "string" ? record.output_tail : "";

      storeErrorEvent({
        component: "infrastructure",
        severity: record.severity,
        errorCode: record.error_code,
        message: record.message,
        source: "cron",
        requestId: record.fingerprint,
        metadata: {
          check: record.check,
          mode: record.mode,
          commit_sha: record.commit_sha,
          branch: record.branch,
          failing_tests: failingTests.slice(0, 10),
          previous_success: record.previous_success,
          output_tail: outputTail.slice(0, 2000),
        },
      });
      registered.push({ path, record });
    } catch (err) {
      // Одна плохая запись не должна останавливать остальные
      hadErrors = true;
      console.warn(
        `(register-failure) skipped record ${name}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  if (registered.length === 0) {
    console.log("(register-failure) 0 failure record(s) registered");
    if (hadErrors) process.exitCode = 2;
    return;
  }

  // Немедленная попытка flush + окно на асинхронную запись в БД
  // (канал event-store — fire-and-forget: сбой БД здесь не бросает,
  // события локально консоль-логируются, pending-записи остаются на диске).
  try {
    triggerImmediateFlush();
  } catch {
    // flush сам обрабатывает свои сбои
  }
  await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

  const registeredAt = new Date().toISOString();
  for (const { path, record } of registered) {
    try {
      record.registered_at = registeredAt;
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    } catch (err) {
      hadErrors = true;
      console.warn(
        `(register-failure) failed to mark ${path}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.log(`(register-failure) registered ${registered.length} failure record(s)`);
  if (hadErrors) process.exitCode = 2;
}

main().catch((err) => {
  // Fail-open: любая ошибка верхнего уровня → warn + exitCode 2
  console.warn(
    `(register-failure) DB registration skipped or failed (fail-open): ${
      err instanceof Error ? err.message : err
    }`
  );
  process.exitCode = 2;
});
