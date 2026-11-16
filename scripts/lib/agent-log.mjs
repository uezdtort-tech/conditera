#!/usr/bin/env node
/**
 * scripts/lib/agent-log.mjs — автоматический журнал работы агента
 * при локальном развёртывании проекта «Conditera».
 *
 * Назначение: скрипты развёртывания (scripts/db/setup.mjs,
 * scripts/deploy-local.mjs) при каждом запуске ДОПИСЫВАЮТ (append-only)
 * протокол своих шагов в ДВА файла:
 *   logs/agent/deployment-YYYY-MM-DD.log    — человекочитаемый журнал;
 *   logs/agent/deployment-YYYY-MM-DD.jsonl  — машиночитаемые JSON-строки
 *       {ts, level, step, status, details}.
 *
 * Принципы:
 *  - НОЛЬ внешних зависимостей (только node:*);
 *  - append-only: файлы только дописываются, никогда не перезаписываются;
 *  - fail-safe: любая ошибка журналирования НЕ роняет вызывающий код
 *    (try/catch + console.warn);
 *  - секреты в журнал НЕ писать — ответственность вызывающего: логгер
 *    записывает только то, что ему явно передали (вызывающие передают
 *    лишь факт наличия/длину секретов, никогда значения).
 *
 * Экспорт:
 *   initAgentLogSession({ run, reason }) — шапка сессии: ISO-время, host, pid,
 *       версия node, cwd, git HEAD/branch (через `git -C <root> rev-parse`,
 *       best-effort). Возвращает { logFile, jsonlFile, meta } | null.
 *   logStep(step, status, details?)      — запись шага; status ∈
 *       START|OK|WARN|FAIL|INFO; уровни: START/INFO/OK → INFO, WARN → WARN,
 *       FAIL → ERROR.
 *   finishSession(summary)               — завершающая запись со сводкой
 *       (повторный вызов / вызов без открытой сессии — no-op).
 *
 * Имя файла — календарная дата UTC (YYYY-MM-DD); все времена — ISO-8601 UTC.
 * Корень репозитория определяется относительно самого модуля (scripts/../).
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// <project>/scripts/lib/agent-log.mjs → <project> (тот же приём, что в
// scripts/db/runtime.mjs — работает и на Windows, в отличие от fileURLToPath)
const ROOT = path.resolve(path.dirname(require.resolve("./agent-log.mjs")), "..", "..");
const LOG_DIR = path.join(ROOT, "logs", "agent");

/** status → уровень записи (JSONL/human). Неизвестный статус → INFO. */
const STATUS_LEVEL = {
  START: "INFO",
  OK: "INFO",
  INFO: "INFO",
  WARN: "WARN",
  FAIL: "ERROR",
};

let sessionStarted = false;  // initAgentLogSession была вызвана
let sessionFinished = false; // finishSession была вызвана (повторы — no-op)

function isoNow() {
  return new Date().toISOString();
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10); // UTC-дата → имя файла
}

/** Пути сегодняшних (UTC) лог-файлов. */
function computeLogPaths() {
  const day = dateStamp();
  return {
    logFile: path.join(LOG_DIR, `deployment-${day}.log`),
    jsonlFile: path.join(LOG_DIR, `deployment-${day}.jsonl`),
  };
}

/** git-метаданные репозитория (best-effort: нет git / не репозиторий → null). */
function gitMeta() {
  const run = (args) => {
    try {
      const res = spawnSync("git", ["-C", ROOT, ...args], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
      if (res.status === 0 && res.stdout) return res.stdout.trim();
    } catch { /* git недоступен — не критично */ }
    return null;
  };
  return {
    head: run(["rev-parse", "HEAD"]),
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
  };
}

/** Текстовое представление details для человекочитаемого журнала. */
function detailsToText(details) {
  if (details === undefined || details === null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

/** Единственный разрешённый способ «упасть» — предупреждение в консоль. */
function warnWriteFailure(err) {
  try {
    console.warn(`[agent-log] запись в журнал не удалась: ${err && err.message ? err.message : err}`);
  } catch { /* даже console.warn не критичен */ }
}

/**
 * Дописать ОДНУ запись в оба файла (append). НИКОГДА не бросает:
 * все ошибки fs/JSON перехватываются и сводятся к console.warn.
 *
 * @param {object} rec
 * @param {string} rec.step    имя шага (например "env", "pg", "session")
 * @param {string} rec.status  START|OK|WARN|FAIL|INFO
 * @param {string} rec.level   INFO|WARN|ERROR
 * @param {*}      [rec.details] строка или JSON-сериализуемый объект
 * @param {string} [rec.humanExtra] дополнительный многострочный блок ТОЛЬКО
 *        в человекочитаемый .log (шапка/подвал сессии)
 */
function appendRecord({ step, status, level, details, humanExtra }) {
  const ts = isoNow();
  const { logFile, jsonlFile } = computeLogPaths();
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const detailText = detailsToText(details);
    appendFileSync(
      logFile,
      `${ts} ${level.padEnd(5)} [${step}] ${status}${detailText ? ` — ${detailText}` : ""}\n`,
      "utf8"
    );
    if (humanExtra) appendFileSync(logFile, humanExtra, "utf8");

    let jsonLine;
    try {
      jsonLine = JSON.stringify({
        ts,
        level,
        step,
        status,
        details: details === undefined ? null : details,
      });
    } catch {
      // циклические/несериализуемые details — не роняем журнал
      jsonLine = JSON.stringify({ ts, level, step, status, details: detailsToText(details) });
    }
    appendFileSync(jsonlFile, `${jsonLine}\n`, "utf8");
  } catch (err) {
    warnWriteFailure(err);
  }
  return { ts, logFile, jsonlFile };
}

/**
 * Открыть сессию журналирования: дописать шапку в оба файла.
 * Полностью fail-safe: при любых ошибках возвращает null и предупреждает.
 *
 * @param {{ run?: string, reason?: string }} [opts]
 */
export function initAgentLogSession({ run, reason } = {}) {
  try {
    sessionStarted = true;
    sessionFinished = false;
    const startedAt = isoNow();
    const git = gitMeta();
    const meta = {
      run: run || "unknown",
      reason: reason || "",
      host: os.hostname(),
      pid: process.pid,
      node: process.version,
      cwd: process.cwd(),
      gitHead: git.head,
      gitBranch: git.branch,
    };
    const { logFile, jsonlFile } = computeLogPaths();
    const block = [
      "  ── сессия журналирования развёртывания (append-only) ──────",
      `  time:   ${startedAt}`,
      `  run:    ${meta.run}`,
      reason ? `  reason: ${reason}` : null,
      `  host:   ${meta.host}   pid: ${meta.pid}   node: ${meta.node}`,
      `  cwd:    ${meta.cwd}`,
      `  git:    ${git.head ? `${git.branch || "?"} @ ${git.head}` : "недоступно (git отсутствует или это не репозиторий)"}`,
      `  files:  ${path.relative(ROOT, logFile)} + ${path.relative(ROOT, jsonlFile)}`,
      "  ────────────────────────────────────────────────────────────",
      "",
    ]
      .filter((line) => line !== null)
      .join("\n") + "\n";
    appendRecord({ step: "session", status: "START", level: "INFO", details: meta, humanExtra: block });
    return { logFile, jsonlFile, meta };
  } catch (err) {
    warnWriteFailure(err);
    return null;
  }
}

/**
 * Записать один шаг. status ∈ START|OK|WARN|FAIL|INFO
 * (неизвестный статус записывается с уровнем INFO). Никогда не бросает.
 *
 * @param {string} step    имя шага, например "env" | "pg" | "migrations" | "seeds" | "env-keys"
 * @param {string} status  START|OK|WARN|FAIL|INFO
 * @param {*}      [details] строка или объект (в .jsonl попадает как есть)
 */
export function logStep(step, status, details) {
  const level = STATUS_LEVEL[status] || "INFO";
  return appendRecord({
    step: String(step || "step"),
    status: STATUS_LEVEL[status] ? status : "INFO",
    level,
    details,
  });
}

/**
 * Завершить сессию: дописать сводку в оба файла.
 * Вызов без открытой сессии или повторный вызов — no-op. Никогда не бросает.
 *
 * @param {*} [summary] строка или объект (result, exitCode, статусы шагов…)
 */
export function finishSession(summary) {
  if (!sessionStarted || sessionFinished) return;
  sessionFinished = true;
  try {
    const finishedAt = isoNow();
    const summaryText = detailsToText(summary);
    const block = [
      "  ── сессия журналирования завершена ────────────────────────",
      `  time:    ${finishedAt}`,
      summary !== undefined ? `  summary: ${summaryText}` : "  summary: (не передана)",
      "  ────────────────────────────────────────────────────────────",
      "",
    ].join("\n") + "\n";
    appendRecord({ step: "session", status: "INFO", level: "INFO", details: summary, humanExtra: block });
  } catch (err) {
    warnWriteFailure(err);
  }
}

/** Пути текущих (сегодняшних, UTC) лог-файлов — для вывода в консоль. */
export function getAgentLogPaths() {
  return computeLogPaths();
}

/** Каталог журналов (logs/agent относительно корня репозитория). */
export { LOG_DIR, ROOT as AGENT_LOG_ROOT };
