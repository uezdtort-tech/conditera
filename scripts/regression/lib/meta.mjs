/**
 * scripts/regression/lib/meta.mjs — чистые хелперы единого regression-runner
 * (Task Z31-3-a).
 *
 * Plain Node ESM: без внешних зависимостей и без @/ импортов, чтобы модуль
 * можно было импортировать и из node-скриптов (run-checks.mjs), и из
 * vitest-тестов (src/lib/regression/meta.test.ts).
 */

import { createHash } from "node:crypto";

/** Максимум символов нормализованного текста отпечатка. */
export const FINGERPRINT_TEXT_MAX = 300;

/** Максимальное число извлекаемых упавших тестов vitest. */
export const VITEST_FAILURES_MAX = 50;

/**
 * normalizeForFingerprint(s) — нормализация произвольного текста для
 * стабильного отпечатка: lower-case, UUID → <uuid>, hex-последовательности
 * ≥16 символов → <hex>, числа ≥4 знаков → <num>, схлопывание пробелов,
 * trim, обрезка до 300 символов.
 *
 * @param {string|undefined|null} s — исходный текст (ошибка/сообщение).
 * @returns {string} нормализованный текст (≤300 символов).
 */
export function normalizeForFingerprint(s) {
  let out = String(s ?? "");
  out = out.toLowerCase();
  // 1. UUID (8-4-4-4-12 hex) — ДО hex/num, чтобы сегменты UUID не съелись
  //    правилами <hex>/<num>.
  out = out.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    "<uuid>"
  );
  // 2. hex-последовательности ≥16 символов (sha-хэши, длинные id).
  out = out.replace(/[0-9a-f]{16,}/g, "<hex>");
  // 3. числа ≥4 знаков (тайминги, счётчики, внутренние id).
  out = out.replace(/[0-9]{4,}/g, "<num>");
  // 4. схлопнуть пробелы, trim, cap.
  out = out.replace(/\s+/g, " ").trim();
  return out.slice(0, FINGERPRINT_TEXT_MAX);
}

/**
 * computeFileFingerprint(parts) — короткий детерминированный отпечаток
 * (sha256 от parts.join("|"), hex, первые 40 символов). Достаточно длинный,
 * чтобы служить именем файла failure-записи, и короткий — чтобы быть
 * удобным requestId.
 *
 * @param {string[]} parts — части отпечатка (например, [check, error_code]).
 * @returns {string} 40 hex-символов.
 */
export function computeFileFingerprint(parts) {
  const input = Array.isArray(parts) ? parts.join("|") : String(parts ?? "");
  return createHash("sha256").update(input).digest("hex").slice(0, 40);
}

/** Проверки, сбой которых — severity "error" (бизнес-критичный контур). */
const ERROR_SEVERITY_CHECKS = new Set([
  "typecheck",
  "vitest",
  "route-error-coverage",
  "build",
]);

/**
 * severityForCheck(name) — какая severity диагностического события
 * соответствует сбою проверки.
 *
 * @param {string} name — имя проверки (typecheck/vitest/eslint/...).
 * @returns {"error"|"warning"|"info"}
 */
export function severityForCheck(name) {
  const n = String(name ?? "").toLowerCase();
  if (ERROR_SEVERITY_CHECKS.has(n)) return "error";
  if (n === "eslint") return "warning";
  return "info";
}

/**
 * errorCodeForCheck(name) — стабильный error_code диагностического события:
 * `regression_<name>_failed`, где name нормализован (lower-case,
 * не-буквоцифровые символы → "_").
 *
 * @param {string} name — имя проверки.
 * @returns {string} например "regression_route_error_coverage_failed".
 */
export function errorCodeForCheck(name) {
  const clean = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return `regression_${clean}_failed`;
}

/**
 * classifyExit(name, code) — классификация кода завершения проверки.
 *
 * @param {string} name — имя проверки (зарезервировано для расширений).
 * @param {number|null} code — exit code процесса (null при сигнале).
 * @returns {{passed: boolean}}
 */
export function classifyExit(name, code) {
  return { passed: code === 0 };
}

/**
 * tail(text, max) — последние max символов строки ("" для null/undefined).
 * Используется для output_tail в JSON-отчётах.
 *
 * @param {string|undefined|null} text
 * @param {number} [max=8000]
 * @returns {string}
 */
export function tail(text, max = 8000) {
  if (text === null || text === undefined) return "";
  const s = String(text);
  if (!Number.isFinite(max) || max <= 0) return "";
  return s.length > max ? s.slice(-max) : s;
}

/**
 * Строка с маркером провала: " FAIL ...", "FAIL ...", "✗ ...", "× ...".
 * (Спека задавала "/^ (FAIL|✗|×)\s+(.+)$/" — допускаем 0+ ведущих пробелов
 * для устойчивости к разным репортерам; один ведущий пробел по-прежнему
 * матчится.)
 */
const FAIL_MARKER_LINE = /^[ \t]*(?:FAIL|✗|×)[ \t]+(.+)$/;

/**
 * Строка vitest-репортера со стрелкой: "FAIL <file> › <chain>".
 */
const FAIL_ARROW_LINE = /FAIL[ \t]+\S+[ \t]+›[ \t]+(.+)/;

/**
 * extractVitestFailures(output) — извлечение имён упавших тестов из вывода
 * vitest. Поддерживает:
 *   • dot/default reporter: " FAIL  src/x.test.ts > suite > test"
 *     → полная цепочка после "<file> > " ("suite > test");
 *   • аналогичный формат с "›" ("FAIL <file> › suite › test");
 *   • легаси-строки ("FAIL src/x.test.ts") и маркеры "✗"/"×".
 * Возвращает уникальные имена (до 50), [] если совпадений нет.
 *
 * @param {string|undefined|null} output — комбинированный stdout+stderr.
 * @returns {string[]}
 */
export function extractVitestFailures(output) {
  if (output === null || output === undefined) return [];
  const text = String(output);
  if (!text.trim()) return [];

  const seen = new Set();
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    if (result.length >= VITEST_FAILURES_MAX) break;

    const arrow = FAIL_ARROW_LINE.exec(line);
    const marker = FAIL_MARKER_LINE.exec(line);
    let raw = null;
    let fromMarker = false;
    if (arrow) {
      raw = arrow[1]; // файл уже отрезан регэкспом
    } else if (marker) {
      raw = marker[1];
      fromMarker = true;
    }
    if (!raw) continue;

    let name = raw.trim();
    if (!name) continue;

    // Линии из marker-регэкспа начинаются с пути файла: "src/x.test.ts >
    // suite > test" → полная цепочка теста после "<file> > ". Для arrow-
    // совпадений файл уже отрезан — повторно первый сегмент не отрываем.
    if (fromMarker) {
      if (name.includes(" > ")) {
        const segments = name.split(" > ");
        if (segments.length > 1) name = segments.slice(1).join(" > ");
      } else if (name.includes(" › ")) {
        const segments = name.split(" › ");
        if (segments.length > 1) name = segments.slice(1).join(" › ");
      }
    }

    name = name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

const SOURCE_EXT = /\.(ts|tsx)$/;
const TEST_FILE = /\.test\.[^/]*$/;
const NODE_MODULES_DIR = /(^|\/)node_modules\//;
const NEXT_BUILD_DIR = /(^|\/)\.next\//;

/**
 * filterChangedSources(changedFiles) — из списка изменённых файлов оставить
 * только исходники (.ts/.tsx), исключая тест-файлы (*.test.*), node_modules
 * и .next; дедупликация с сохранением порядка.
 *
 * @param {string[]} changedFiles — пути (относительные, POSIX-разделители).
 * @returns {string[]}
 */
export function filterChangedSources(changedFiles) {
  if (!Array.isArray(changedFiles)) return [];
  const seen = new Set();
  const out = [];
  for (const f of changedFiles) {
    if (typeof f !== "string" || !f) continue;
    if (!SOURCE_EXT.test(f)) continue;
    if (TEST_FILE.test(f)) continue;
    if (NODE_MODULES_DIR.test(f)) continue;
    if (NEXT_BUILD_DIR.test(f)) continue;
    if (seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}
