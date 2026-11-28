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
    file: "docker-compose.pg17-migration.yml",
    pattern: /supabase\/postgres:(\d+)\./g,
    what: "PG17 migration shadow image",
  },
  {
    file: "Dockerfile.supabase-runtime-poc",
    pattern: /FROM supabase\/postgres:(\d+)\./g,
    what: "single-container runtime image",
  },
  {
    file: "Dockerfile",
    pattern: /FROM .*postgres:(\d+)-alpine AS migrator/g,
    what: "application migration client image",
  },
  {
    file: "package.json",
    pattern: /"embedded-postgres"\s*:\s*"\^?(\d+)\./g,
    what: "embedded-postgres (db:setup)",
  },
];

// Запрещённые образы в ЛЮБЫХ compose/workflow файлах (major ≠ 17).
const SCAN_DIRS = [
  "docker-compose.supabase.yml",
  "docker-compose.pg17-migration.yml",
  "docker-compose.supabase-single-container.yml",
  "docker-compose.supabase-runtime-poc.yml",
  "docker-compose.yml",
  "docker-compose.dev.yml",
  ".github/workflows",
];

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

// 2. Сканирование compose/workflow: никаких postgres-образов с major ≠ 17.
const scanTargets = [];
for (const entry of SCAN_DIRS) {
  const abs = path.join(ROOT, entry);
  if (!existsSync(abs)) continue;
  if (abs.endsWith(".yml")) {
    scanTargets.push(abs);
  } else {
    for (const f of readdirSync(abs)) {
      if (f.endsWith(".yml") || f.endsWith(".yaml")) scanTargets.push(path.join(abs, f));
    }
  }
}
for (const file of scanTargets) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const m = line.match(/(?:image:\s*)["']?([^"'\n]*(?:postgres|pgvector)[^"'\n]*)/i);
    if (!m) return;
    const image = m[1].trim();
    const ver = image.match(/:(\d+)(?:\.|-\s|$|["']?)/);
    if (!ver) return; // тег без major (например, logflare) — вне гарда
    const major = Number(ver[1]);
    if (major !== TARGET_MAJOR) {
      fail(`${rel}:${idx + 1}: postgres-образ «${image}» major=${major} — ожидается ${TARGET_MAJOR}`);
    }
  });
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
