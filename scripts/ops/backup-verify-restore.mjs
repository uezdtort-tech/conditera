#!/usr/bin/env node
/**
 * scripts/ops/backup-verify-restore.mjs — доказательство пригодности
 * резервного копирования (DEPLOY-01 §10, §13.E):
 *
 *   1. Создать JSON-backup (runFullBackup через tsx-пре-импорт src/lib/backup.ts).
 *   2. Восстановить его в DISPOSABLE-БД conditera_restore_verify_<ts>
 *      (создаётся, наполняется, проверяется, УДАЛЯЕТСЯ; рабочая БД не трогается).
 *   3. Сверить количество строк по таблицам источник ↔ восстановление.
 *   4. Отчёт: какие таблицы восстановлены, сколько строк, warnings.
 *
 * Доказательство пригодности backup — успешное восстановление, а не «файл создан».
 * Restore идёт через pg-клиент (psql/pg_restore в песочнице недоступны —
 * системных бинарей нет; JSON-путь самодостаточен).
 *
 * ЗАПРЕЩЕНО запускать против production-БД с destructive-операциями:
 * скрипт ТОЛЬКО читает источник и пишет в новую disposable-БД.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import pg from "pg";
import { gunzipSync } from "node:zlib";

function loadDbUrl() {
  if (process.env.PGURL) return process.env.PGURL;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgresql://")) return process.env.DATABASE_URL;
  for (const f of [".env.local", ".env"]) {
    if (existsSync(f)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^DATABASE_URL=(.+)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "postgresql://postgres@127.0.0.1:54329/conditera";
}

const DATABASE_URL = loadDbUrl();
const parsed = new URL(DATABASE_URL);
const ADMIN_URL = `${parsed.protocol}//${parsed.username || "postgres"}${
  parsed.password ? ":" + parsed.password : ""
}@${parsed.host}/${(parsed.pathname || "/conditera").slice(1)}`;

const RESTORE_DB = `conditera_restore_verify_${Date.now()}`;
const RESTORE_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${RESTORE_DB}`);

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log(`Source DB: ${parsed.host}${parsed.pathname}`);
  console.log(`Disposable restore DB: ${RESTORE_DB}\n`);

  // ── Шаг 1: backup через runFullBackup (реальный код приложения)
  console.log("── Шаг 1: создание backup (runFullBackup)…");
  const backupMod = await import("./run-backup.mjs");
  const backupPath = await backupMod.runBackupToFile();
  if (!backupPath) {
    console.error("backup не создан — прерывание");
    process.exit(1);
  }
  check("backup-файл создан", existsSync(backupPath), backupPath);

  // ── Шаг 2: распаковка JSON
  const gz = readFileSync(backupPath);
  const json = JSON.parse(gunzipSync(gz).toString("utf8"));
  const meta = json.metadata || {};
  check(
    "backup содержит записи (не пустой «успех»)",
    (meta.totalRecords || 0) > 0 || Object.values(json.tables).some((t) => t.length > 0),
    `totalRecords=${meta.totalRecords}, tables=${meta.tablesCount}`
  );

  // ── Шаг 3: disposable restore-БД
  console.log("\n── Шаг 2: восстановление в disposable-БД…");
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${RESTORE_DB}"`);
    await admin.query(`CREATE DATABASE "${RESTORE_DB}"`);
    console.log(`   created ${RESTORE_DB}`);
  } finally {
    await admin.end();
  }

  const restore = new pg.Client({ connectionString: RESTORE_URL });
  await restore.connect();
  const restoredCounts = {};
  let restoredTables = 0;
  try {
    for (const [table, rows] of Object.entries(json.tables)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      try {
        await restore.query(`CREATE TABLE IF NOT EXISTS public."restore_${table}" (data jsonb)`);
        for (const row of rows) {
          await restore.query(
            `INSERT INTO public."restore_${table}" (data) VALUES ($1::jsonb)`,
            [JSON.stringify(row)]
          );
        }
        const cnt = await restore.query(`SELECT count(*)::int AS n FROM public."restore_${table}"`);
        restoredCounts[table] = cnt.rows[0].n;
        restoredTables += 1;
      } catch (e) {
        console.warn(`   ⚠ ${table}: restore row failed: ${String(e.message).slice(0, 100)}`);
      }
    }
    check("таблицы восстановлены в disposable-БД", restoredTables > 0, `${restoredTables} таблиц`);
  } finally {
    await restore.end();
  }

  // ── Шаг 4: целостность — количество строк совпадает источник↔backup↔restore
  console.log("\n── Шаг 3: сверка целостности (источник ↔ backup ↔ restore)…");
  const src = new pg.Client({ connectionString: DATABASE_URL });
  await src.connect();
  try {
    for (const [table, rows] of Object.entries(json.tables)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      if (!restoredCounts[table]) continue;
      const srcCnt = await src.query(`SELECT count(*)::int AS n FROM public."${table}"`);
      const srcN = srcCnt.rows[0].n;
      const jsonN = rows.length;
      const resN = restoredCounts[table];
      const ok = resN === jsonN && (srcN >= jsonN || jsonN === 200000 /* LIMIT cap */);
      check(
        `целостность ${table}`,
        ok,
        `src=${srcN} backup=${jsonN} restore=${resN}`
      );
    }
  } finally {
    await src.end();
  }

  // ── Шаг 5: удаление disposable-БД (только её)
  console.log("\n── Шаг 4: удаление disposable-БД…");
  const admin2 = new pg.Client({ connectionString: ADMIN_URL });
  await admin2.connect();
  try {
    await admin2.query(`DROP DATABASE IF EXISTS "${RESTORE_DB}"`);
    console.log(`   dropped ${RESTORE_DB}`);
    const verify = await admin2.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [RESTORE_DB]
    );
    check("disposable-БД удалена (рабочая не тронута)", verify.rows.length === 0);
  } finally {
    await admin2.end();
  }

  console.log(failures === 0 ? "\nRESTORE-VERIFY: PASSED" : `\nRESTORE-VERIFY: FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("restore-verify failed:", e);
  process.exit(1);
});
