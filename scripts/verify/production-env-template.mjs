#!/usr/bin/env node
/**
 * production-env-template.mjs — DEV-12 (TZ v4.0 §9, production-config gaps).
 *
 * Сверяет контракт обязательных переменных между:
 *   1. docker-compose.yml        — fail-fast интерполяции ${NAME:?...} / ${NAME:?}
 *   2. .env.production.example   — шаблон, из которого создаётся .env.production
 *
 * Логика:
 *   - Базовое сканирование интерполяций: /\$\{([A-Z0-9_]+)::?/g (спец-оператор
 *     после двоеточия). Required-вариант определяется по символу '?', идущему
 *     сразу за двоеточием (compose: ${VAR:?error} / ${VAR:?} — обязательная,
 *     ${VAR:-default} — с дефолтом, НЕ обязательная).
 *   - Ключи шаблона: строки вида NAME=... (комментарии и пустые строки игнорируются).
 *
 * Печатает ТОЛЬКО имена отсутствующих переменных — НИКОГДА значения.
 * Exit codes: 0 = все обязательные имена присутствуют в шаблоне; 1 = есть отсутствующие.
 *
 * Запуск: node scripts/verify/production-env-template.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const composeName = 'docker-compose.yml';
const templateName = '.env.production.example';
const composePath = path.join(root, composeName);
const templatePath = path.join(root, templateName);

let compose;
let template;
try {
  compose = readFileSync(composePath, 'utf8');
} catch {
  console.error(`FATAL: не найден ${composeName}`);
  process.exit(1);
}
try {
  template = readFileSync(templatePath, 'utf8');
} catch {
  console.error(`FATAL: не найден ${templateName}`);
  process.exit(1);
}

// --- 1. Обязательные интерполяции из compose ---
const INTERP_RE = /\$\{([A-Z0-9_]+)::?/g;
const required = new Set();
for (const m of compose.matchAll(INTERP_RE)) {
  const after = compose.slice(m.index + m[0].length, m.index + m[0].length + 1);
  if (after === '?') required.add(m[1]);
}
const requiredSorted = [...required].sort();

// --- 2. Ключи шаблона .env.production.example ---
const templateKeys = new Set();
for (const line of template.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
  if (m) templateKeys.add(m[1]);
}

// --- 3. Сверка: печатаем ТОЛЬКО имена (не значения) ---
console.log(`[compose]  ${composeName}: ${requiredSorted.length} required var(s): ${requiredSorted.join(', ')}`);
console.log(`[template] ${templateName}: ${templateKeys.size} key(s)`);
const missing = requiredSorted.filter((name) => !templateKeys.has(name));
if (missing.length > 0) {
  console.log(`MISSING (${missing.length}) — отсутствуют в ${templateName}:`);
  for (const name of missing) console.log(`  ${name}`);
  process.exit(1);
}
console.log('OK: контракт выполнен — все required-переменные присутствуют в шаблоне');
process.exit(0);
