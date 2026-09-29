/**
 * ops-apply-money-path.ts — ОПС-РАНБУК: применить 0034–0037 на живую БД ОДНИМ окном.
 *
 * Строгий режим (в отличие от apply-migrations.ts, который тянет ВСЕ миграции
 * и глотает «already exists»):
 *   • только 4 миграции money-path, строго в порядке 0034 → 0035 → 0036 → 0037;
 *   • каждая миграция — в транзакции BEGIN…COMMIT: любая ошибка откатывает
 *     ФАЙЛ ЦЕЛИКОМ и останавливает весь прогон (exit 1) — не оставляет
 *     полуприменённого состояния;
 *   • НЕТ blanket-пропуска ошибок: миграции написаны идемпотентно
 *     (IF NOT EXISTS / CREATE OR REPLACE / DO-блоки), чистый повтор даёт
 *     НОЛЬ ошибок. «already exists» = сломан сплиттер или файл изменён —
 *     разбираться, не глотать;
 *   • маркеры после каждого файла: объект реально существует в БД;
 *   • pre-flight: версия PG, наличие таблиц-пререквизитов, что уже применено.
 *
 * Запуск (машина владельца, где живая БД доступна):
 *   DATABASE_URL=postgresql://postgres:PASS@HOST:5432/postgres \
 *     npx tsx scripts/ops-apply-money-path.ts
 *   # + авто-прогон verify-money-path: добавить флаг --verify
 *
 * ПЕРЕД ЗАПУСКОМ (рекомендация, не выполняется скриптом):
 *   pg_dump "$DATABASE_URL" --schema-only > backup-schema-$(date +%F-%H%M).sql
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Порядок ЖЁСТКО зафиксирован: 0034 создаёт колонки/чексуммы, 0035 — reserve_refund,
 *  0036 — payout_reserved_at + RPC + RLS, 0037 — payout_request_id + RPC (0038+ — PAY-2, вне окна). */
const FILES = [
  "0034_money_path_identity.sql",
  "0035_payment_integrity.sql",
  "0036_payout_integrity.sql",
  "0037_payout_linkage.sql",
] as const;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const AUTO_VERIFY = process.argv.includes("--verify");

let aborted = false;

function note(msg: string) { console.log(msg); }
function okLabel(label: string, detail = "") { console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
function failLabel(label: string, detail = "") { aborted = true; console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }

interface Queryable { query(sql: string): Promise<{ rows: any[]; rowCount: number | null }>; }

/** SQL splitter — dollar-quotes (включая вложенные разные теги), комментарии, литералы. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inDollarQuote: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    if (next2 === "--" && !inDollarQuote) {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (next2 === "/*" && !inDollarQuote) {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (ch === "$" && !inDollarQuote) {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        current += m[0];
        i += m[0].length;
        inDollarQuote = m[0];
        continue;
      }
    }
    if (inDollarQuote && sql.slice(i, i + inDollarQuote.length) === inDollarQuote) {
      current += inDollarQuote;
      i += inDollarQuote.length;
      inDollarQuote = null;
      continue;
    }
    if (ch === "'" && !inDollarQuote) {
      current += ch;
      i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] !== "'") { i++; break; }
        if (sql[i] === "'" && sql[i + 1] === "'") { current += sql[i + 1]; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (ch === ";" && !inDollarQuote) {
      const s = current.trim();
      if (s) statements.push(s);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** Применить один файл строго: BEGIN → statements → COMMIT; ошибка → ROLLBACK + throw. */
export async function applyFileStrict(db: Queryable, filePath: string, label: string): Promise<number> {
  const sql = readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql)
    .map((s) => s.trim())
    .filter((s) => {
      const u = s.toUpperCase();
      return s.length > 0 && u !== "BEGIN" && u !== "COMMIT" && u !== "END" && u !== "ROLLBACK" && !u.startsWith("BEGIN;");
    });

  console.log(`\n» ${label}: ${statements.length} statements, транзакция`);
  await db.query("BEGIN");
  try {
    for (let idx = 0; idx < statements.length; idx++) {
      try {
        await db.query(statements[idx]);
      } catch (e: any) {
        throw new Error(`statement ${idx + 1}/${statements.length}: ${(e.message || String(e)).slice(0, 300)}`);
      }
    }
    await db.query("COMMIT");
    console.log(`  ✓ COMMIT ${label}`);
    return statements.length;
  } catch (e: any) {
    await db.query("ROLLBACK");
    console.log(`  ✗ ROLLBACK ${label}: ${e.message}`);
    throw e;
  }
}

/** Маркеры применения: объект должен существовать после своего файла. */
export async function checkMarkers(db: Queryable, file: string): Promise<void> {
  const has = async (sql: string): Promise<boolean> => (await db.query(sql)).rowCount! > 0;
  switch (file) {
    case "0034_money_path_identity.sql": {
      const cols = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='orders'
            AND column_name IN ('payment_status','escrow_released_at','payout_transferred_at','tariff_snapshot','commission_rate_snapshot')`
      );
      if (cols.rowCount === 5) okLabel("маркер 0034: 5 колонок orders на месте");
      else failLabel(`маркер 0034: найдено ${cols.rowCount}/5 колонок orders`);
      break;
    }
    case "0035_payment_integrity.sql": {
      if (await has(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reserve_refund'`))
        okLabel("маркер 0035: reserve_refund существует");
      else failLabel("маркер 0035: reserve_refund НЕ найден");
      break;
    }
    case "0036_payout_integrity.sql": {
      const col = await has(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payout_reserved_at'`
      );
      const fn = await has(
        `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='add_confectioner_balance'`
      );
      if (col && fn) okLabel("маркер 0036: payout_reserved_at + add_confectioner_balance");
      else failLabel(`маркер 0036: колонка=${col}, RPC=${fn}`);
      break;
    }
    case "0037_payout_linkage.sql": {
      const col = await has(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payout_request_id'`
      );
      const fnRelease = await has(
        `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='release_escrow_order'`
      );
      const fnConsume = await has(
        `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='consume_tfa_backup_code'`
      );
      if (col && fnRelease && fnConsume) okLabel("маркер 0037: payout_request_id + release_escrow_order + consume_tfa_backup_code");
      else failLabel(`маркер 0037: колонка=${col}, release=${fnRelease}, consume=${fnConsume}`);
      break;
    }
  }
}

async function preflight(db: Queryable): Promise<void> {
  console.log("─── Pre-flight ───");
  const ver = await db.query("SELECT version() as v");
  console.log(`  PG: ${(ver.rows[0]?.v || "?").split(",")[0]}`);

  const tables = ["orders", "payments", "refunds", "payouts", "payout_requests", "confectioners", "profiles", "user_roles"];
  const missing: string[] = [];
  for (const t of tables) {
    const r = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`
    );
    if (r.rowCount === 0) missing.push(t);
  }
  if (missing.length) failLabel(`пререквизиты отсутствуют: ${missing.join(", ")}`);
  else okLabel("все таблицы-пререквизиты на месте");

  // Что уже применено (идемпотентный повтор покажет «уже есть»)
  const applied = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders'
        AND column_name IN ('payment_status','escrow_released_at','payout_transferred_at','tariff_snapshot','commission_rate_snapshot','payout_reserved_at','payout_request_id')`
  );
  console.log(`  уже есть в orders (money-path колонки): ${applied.rows.map((r) => r.column_name).join(", ") || "ничего"}`);
}

async function main(): Promise<void> {
  console.log(`ops-apply-money-path → ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  note(`\nРЕКОМЕНДАЦИЯ: перед прогоном снять дамп схемы:\n  pg_dump "${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}" --schema-only > backup-schema-$(date +%F-%H%M).sql\n`);

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  try {
    await preflight(db);
    if (aborted) {
      console.log("\nABORT: pre-flight не пройден — схема-пререквизиты не соответствуют ожиданиям.");
      process.exit(1);
    }

    let total = 0;
    for (const file of FILES) {
      const n = await applyFileStrict(db, join(here, "../supabase/migrations", file), file);
      total += n;
      await checkMarkers(db, file);
      if (aborted) break;
    }

    if (aborted) {
      console.log("\n❌ Прогон остановлен на маркере — НЕ деплоить payout-код до разбора.");
      process.exit(1);
    }

    console.log(`\n✅ ${FILES.length} миграций применены (${total} statements), все маркеры на месте.`);
    console.log("Следующий шаг (DoD): DATABASE_URL=... npx tsx scripts/verify-money-path.ts");
    if (AUTO_VERIFY) {
      const { spawnSync } = await import("node:child_process");
      console.log("\n─── verify-money-path (--verify) ───");
      const r = spawnSync("npx", ["tsx", join(here, "verify-money-path.ts")], {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL },
      });
      process.exit(r.status === 0 ? 0 : 1);
    }
    process.exit(0);
  } catch (e: any) {
    console.error(`\n❌ ОПЕРАЦИЯ ПРЕРВАНА: ${e.message}`);
    console.error("БД в консистентном состоянии (последний файл откачен целиком). Повтор безопасен.");
    process.exit(1);
  } finally {
    await db.end();
  }
}

// main() — только при прямом запуске (импорт applyFileStrict/checkMarkers
// из PGlite-смока не должен триггерить попытку коннекта к БД)
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
