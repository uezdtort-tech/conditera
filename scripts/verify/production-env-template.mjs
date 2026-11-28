#!/usr/bin/env node
/**
 * production-env-template.mjs — DEV-12 (TZ v4.0 §9, production-config gaps).
 *
 * Сверяет контракт обязательных переменных между:
 *   1. docker-compose.yml и Supabase overlays — fail-fast интерполяции ${NAME:?...} / ${NAME:?}
 *   2. .env.production.example — шаблон, из которого создаётся .env.production
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
const composeNames = [
  'docker-compose.yml',
  'docker-compose.supabase.yml',
  'docker-compose.supabase-single-container.yml',
];
const templateName = '.env.production.example';
const templatePath = path.join(root, templateName);

let composeFiles;
let template;
try {
  composeFiles = composeNames.map((name) => ({ name, content: readFileSync(path.join(root, name), 'utf8') }));
} catch (error) {
  console.error(`FATAL: не удалось прочитать один из Compose-файлов: ${error.message}`);
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
const requiredByFile = new Map();
for (const file of composeFiles) {
  const required = new Set();
  for (const m of file.content.matchAll(INTERP_RE)) {
    const after = file.content.slice(m.index + m[0].length, m.index + m[0].length + 1);
    if (after === '?') required.add(m[1]);
  }
  requiredByFile.set(file.name, required);
}
const requiredSorted = [...new Set([...requiredByFile.values()].flatMap((set) => [...set]))].sort();

// --- 2. Ключи шаблона .env.production.example ---
const templateKeys = new Set();
for (const line of template.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
  if (m) templateKeys.add(m[1]);
}

// --- 3. Сверка: печатаем ТОЛЬКО имена (не значения) ---
for (const [name, required] of requiredByFile) {
  console.log(`[compose]  ${name}: ${required.size} required var(s)`);
}
console.log(`[template] ${templateName}: ${templateKeys.size} key(s)`);
const missing = requiredSorted.filter((name) => !templateKeys.has(name));
if (missing.length > 0) {
  console.log(`MISSING (${missing.length}) — отсутствуют в ${templateName}:`);
  for (const name of missing) console.log(`  ${name}`);
  process.exit(1);
}
console.log('OK: контракт выполнен — все required-переменные присутствуют в шаблоне');
process.exit(0);
