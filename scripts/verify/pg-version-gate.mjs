#!/usr/bin/env node
/**
 * scripts/verify/pg-version-gate.mjs — гард ЕДИНОЙ целевой версии PostgreSQL 17.
 *
 * Урок первого прогона PG17 (2026-11-22): в проекте разъехались реальные пути
 * запуска/проверки БД — единый Supabase Runtime на PG17, сценарный CI на PG15,
 * локальный db:setup на embedded PG18. Сведено на PG17; этот скрипт не даёт
 * расхождению вернуться: любой образ/зависимость PostgreSQL с major ≠ 17 в
 * контролируемых файлах = FAIL с ненулевым кодом выхода.
 *
 * Контролируемые файлы:
 *   - docker-compose*.yml          (образы supabase/postgres, postgres:*)
 *   - .github/workflows/*.yml      (services.postgres.image)
 *   - package.json                 (embedded-postgres devDependency)
 *
 * Легальные исключения (только инструментальные, не целевые БД):
 *   - psycopg2/или client-либы — не сканируются;
 *   - строки вида "postgres:XX" в комментариях-истории — запрещены и они:
 *     гард требует, чтобы упоминаний чужих major в целевых местах не было.
 *
 * Запуск: node scripts/verify/pg-version-gate.mjs
 * В CI:   шаг "PG version gate" внутри jobs.migrations-pg17.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(require.resolve("./pg-version-gate.mjs")), "..", "..");

const TARGET_MAJOR = 17;

// Целевые якоря: в этих файлах точная версия ОБЯЗАТЕЛЬНА (найдём её явно).
const ANCHORS = [
  {
    file: "docker-compose.supabase.yml",
    pattern: /supabase\/postgres:(\d+)\./g,
    what: "образ Supabase-стека",
  },
  {
    file: "package.json",
    pattern: /"embedded-postgres"\s*:\s*"\^?(\d+)\./g,
    what: "embedded-postgres (db:setup)",
  },
];

// Сканируем ВСЕ Compose-файлы в корне, включая новые migration/runtime overlays.
// CI workflow может намеренно запускать PG15/PG18 как одноразовый источник дампа;
// это не runtime Compose и проверяется отдельными миграционными тестами.
const COMPOSE_FILE_RE = /^(?:docker-)?compose(?:\.[^.]+)*\.ya?ml$/i;

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✖ ${msg}`);
};
const ok = (msg) => console.log(`  ✔ ${msg}`);

console.log(`\n─── PG version gate (target: PostgreSQL ${TARGET_MAJOR}) ───`);

// 1. Якоря: точные версии обязаны присутствовать и быть 17.
for (const anchor of ANCHORS) {
  const abs = path.join(ROOT, anchor.file);
  if (!existsSync(abs)) {
    fail(`${anchor.file}: файл не найден`);
    continue;
  }
  const text = readFileSync(abs, "utf8");
  const matches = [...text.matchAll(anchor.pattern)];
  if (matches.length === 0) {
    fail(`${anchor.file}: не найден якорь «${anchor.what}» (паттерн ${anchor.pattern})`);
    continue;
  }
  const majors = matches.map((m) => Number(m[1]));
  if (majors.some((major) => major !== TARGET_MAJOR)) {
    fail(`${anchor.file}: ${anchor.what} на major=${majors.join(",")} — ожидается ${TARGET_MAJOR}`);
  } else {
    ok(`${anchor.file}: ${anchor.what} = PG${majors[0]}`);
  }
}

// 2. Сканирование ВСЕХ Compose-файлов: любой PostgreSQL image major ≠ 17 — FAIL.
const scanTargets = readdirSync(ROOT)
  .filter((name) => COMPOSE_FILE_RE.test(name))
  .map((name) => path.join(ROOT, name));
if (scanTargets.length === 0) fail("В корне не найдены Compose-файлы для проверки.");

for (const file of scanTargets) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const m = line.match(/^\s*image:\s*["']?([^"'#\s]+)["']?/i);
    if (!m || !/(?:^|\\/)(?:postgres|pgvector)(?:[:/]|$)/i.test(m[1])) return;
    const image = m[1].trim();
    const tag = image.slice(image.lastIndexOf(":") + 1);
    const ver = tag.match(/^(\d+)(?:\.|$|-)/);
    if (!ver) {
      fail(`${rel}:${idx + 1}: PostgreSQL-образ «${image}» не закреплён явным major-тегом`);
      return;
    }
    const major = Number(ver[1]);
    if (major !== TARGET_MAJOR) {
      fail(`${rel}:${idx + 1}: postgres-образ «${image}» major=${major} — ожидается ${TARGET_MAJOR}`);
    }
  });
}

// 2a. Проверяем физический volume: PG17 не должен открывать каталог PG15.
const supabaseCompose = readFileSync(path.join(ROOT, "docker-compose.supabase.yml"), "utf8");
const dbService = supabaseCompose.match(/^  supabase-db:\s*\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:\s*$|^volumes:)/m)?.[1] || "";
if (!dbService) {
  fail("docker-compose.supabase.yml: сервис supabase-db не найден.");
} else {
  if (!/image:\s*supabase\/postgres:17\./.test(dbService)) {
    fail("docker-compose.supabase.yml: supabase-db должен использовать Supabase PostgreSQL 17.");
  }
  if (!/-\s*supabase_db_data_v17:\/var\/lib\/postgresql\/data\b/.test(dbService)) {
    fail("docker-compose.supabase.yml: PG17 должен использовать отдельный volume supabase_db_data_v17.");
  }
  if (/-\s*supabase_db_data:\/var\/lib\/postgresql\/data\b/.test(dbService)) {
    fail("docker-compose.supabase.yml: запрещено подключать старый PG15 volume к PG17.");
  }
  if (!/^  supabase_db_data_v17:\s*$/m.test(supabaseCompose)) {
    fail("docker-compose.supabase.yml: volume supabase_db_data_v17 не объявлен.");
  }
}
// 3. Embedded PG17: пакет @embedded-postgres/linux-x64 резолвится и это 17.x.
try {
  // exports-политика пакета разрешает только ./dist — package.json резолвим
  // прямым путём (как это делает scripts/db/runtime.mjs).
  const pkgDir = path.join(ROOT, "node_modules", "@embedded-postgres", "linux-x64");
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const major = Number(String(pkg.version).split(".")[0]);
    if (major !== TARGET_MAJOR) {
      fail(`node_modules/@embedded-postgres/linux-x64: ${pkg.version} — ожидается 17.x (пересобрать: npm install)`);
    } else {
      ok(`embedded binaries: @embedded-postgres/linux-x64 ${pkg.version} (PG${major})`);
    }
  } else {
    ok("embedded binaries: не установлены локально (проверен только якорь package.json)");
  }
} catch {
  ok("embedded binaries: не установлены локально (проверен только якорь package.json)");
}

if (failures > 0) {
  console.error(`\n✖ PG version gate: ${failures} расхождение(й) — все пути запуска/проверки БД должны быть на PG${TARGET_MAJOR}`);
  process.exit(1);
}
console.log(`\n✔ PG version gate: все контролируемые пути на PG${TARGET_MAJOR}\n`);
