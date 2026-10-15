#!/usr/bin/env node
/**
 * meili-smoke.mjs — DEV-13 (TZ v4.0 §9, production-config gaps).
 *
 * Smoke-проверка Meilisearch по ЕДИНОМУ контракту env-переменных:
 *   MEILI_URL  — каноническое имя (читается src/lib/meilisearch.ts:33)
 *   MEILI_HOST — legacy-fallback (использован с WARNING; новых использований не заводить)
 *
 * Проверки:
 *   1. GET {url}/health → ожидается {"status":"available"}
 *   2. Search ping: POST {url}/indexes/products/search {"q":"","limit":1}
 *      200 ИЛИ 404 index_not_found — оба означают «сервис жив»
 *      (404 = индекс ещё не создан; 401 = MEILI_MASTER_KEY не задан/неверен)
 *
 * Печатает ТОЛЬКО статусы и HTTP-коды — НИКОГДА ключи/значения секретов.
 * Exit codes: 0 = обе проверки ок; 1 = smoke не прошёл.
 *
 * Запуск:
 *   MEILI_URL=http://localhost:7700 MEILI_MASTER_KEY=... node scripts/verify/meili-smoke.mjs
 * В контейнерной сети деплоя — http://meilisearch:7700 (это gate владельца Docker-хоста:
 * см. docs/evidence/release-gate/meili-env-unify-*.md). В песочнице без запущенного
 * Meilisearch скрипт честно завершается ошибкой соединения (environment-blocked).
 */
const MASTER_KEY_SET = Boolean(process.env.MEILI_MASTER_KEY);
const url = process.env.MEILI_URL || process.env.MEILI_HOST;

if (process.env.MEILI_URL && process.env.MEILI_HOST && process.env.MEILI_URL !== process.env.MEILI_HOST) {
  console.warn('WARNING: заданы и MEILI_URL, и MEILI_HOST — использую MEILI_URL (канон), MEILI_HOST устарел');
}
if (!process.env.MEILI_URL && process.env.MEILI_HOST) {
  console.warn('WARNING: MEILI_URL не задан, использую legacy MEILI_HOST — мигрируйте на MEILI_URL (контракт src/lib/meilisearch.ts)');
}

if (!url) {
  console.error('SMOKE FAIL: не задан MEILI_URL (legacy MEILI_HOST тоже пуст) — переменную контракта читать неоткуда');
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 5000;
async function fetchWithTimeout(target, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(target, {
      ...options,
      signal: controller.signal,
      // Ключ используется ТОЛЬКО в памяти запроса — никогда не печатается
      headers: {
        ...(MASTER_KEY_SET ? { Authorization: `Bearer ${process.env.MEILI_MASTER_KEY}` } : {}),
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

let exitCode = 0;

// --- 1. /health ---
try {
  const res = await fetchWithTimeout(`${url.replace(/\/$/, '')}/health`);
  const body = await res.json().catch(() => null);
  const status = body && typeof body === 'object' ? body.status : null;
  if (res.ok && status === 'available') {
    console.log(`health: PASS (HTTP ${res.status}, status=available)`);
  } else {
    console.log(`health: FAIL (HTTP ${res.status}, status=${status === null ? 'n/a' : status})`);
    exitCode = 1;
  }
} catch (err) {
  const reason = err && err.cause && err.cause.code ? err.cause.code : err.code || err.name;
  console.log(`health: FAIL (${reason}) — Meilisearch недоступен по ${url}`);
  console.log('search-ping: SKIPPED (health не прошёл)');
  console.log(`master-key: ${MASTER_KEY_SET ? 'set' : 'NOT set'}`);
  console.log('SMOKE FAIL');
  process.exit(1);
}

// --- 2. Search ping ---
try {
  const res = await fetchWithTimeout(`${url.replace(/\/$/, '')}/indexes/products/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: '', limit: 1 }),
  });
  const body = await res.json().catch(() => null);
  const errType = body && typeof body === 'object' ? body.type : null;
  if (res.ok) {
    console.log(`search-ping: PASS (HTTP ${res.status})`);
  } else if (res.status === 404 && errType === 'index_not_found') {
    console.log('search-ping: PASS (HTTP 404 index_not_found — сервис жив, индекс products ещё не создан)');
  } else if (res.status === 401) {
    console.log(`search-ping: FAIL (HTTP 401 — MEILI_MASTER_KEY ${MASTER_KEY_SET ? 'неверен' : 'не задан'})`);
    exitCode = 1;
  } else {
    console.log(`search-ping: FAIL (HTTP ${res.status}${errType ? `, type=${errType}` : ''})`);
    exitCode = 1;
  }
} catch (err) {
  const reason = err && err.cause && err.cause.code ? err.cause.code : err.code || err.name;
  console.log(`search-ping: FAIL (${reason})`);
  exitCode = 1;
}

console.log(`master-key: ${MASTER_KEY_SET ? 'set' : 'NOT set'}`);
console.log(exitCode === 0 ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(exitCode);
