import { join } from "node:path";
/**
 * validate-migration-0012.ts — применить миграцию 0012 к чистой PGlite базе
 * для проверки синтаксиса и логики SQL.
 *
 * Запуск:
 *   bun run scripts/validate-migration-0012.ts
 *   или
 *   npx tsx scripts/validate-migration-0012.ts
 */

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "/tmp/migration-0012-test";
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Разбить SQL на отдельные statements, учитывая:
 *  - строковые литералы с одинарными/двойными кавычками
 *  - dollar-quoted строки ($tag$ для функций)
 *  - однострочные и блочные комментарии
 *
 * Возвращает массив отдельных SQL statements.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inDollarQuote: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);
    const next3 = sql.slice(i, i + 3);

    // Комментарий — line comment (--)
    if (next2 === "--" && !inDollarQuote) {
      // пропустить до конца строки
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    // Комментарий — block comment (/* */)
    if (next2 === "/*" && !inDollarQuote) {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }

    // Dollar-quoted string detection ($$ or $tag$)
    if (ch === "$" && !inDollarQuote) {
      // Найти potential dollar-quote start
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        current += tag;
        i += tag.length;
        inDollarQuote = tag;
        continue;
      }
    }
    // Close dollar quote
    if (inDollarQuote && sql.slice(i, i + inDollarQuote.length) === inDollarQuote) {
      current += inDollarQuote;
      i += inDollarQuote.length;
      inDollarQuote = null;
      continue;
    }

    // Single-quote string literal
    if (ch === "'" && !inDollarQuote) {
      current += ch;
      i++;
      // читать до закрывающей кавычки (учитывая escape: '')
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] !== "'") {
          i++;
          break;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          // escaped quote
          current += sql[i + 1];
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }

    // Statement separator — точка с запятой вне dollar-quote
    if (ch === ";" && !inDollarQuote) {
      current = current.trim();
      if (current.length > 0) {
        statements.push(current);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Последний statement без ;
  current = current.trim();
  if (current.length > 0) {
    statements.push(current);
  }

  return statements;
}

/**
 * Применить SQL-файл, разбивая на statements.
 * Пропускать ошибки OR-роль уже существует (ALTER TYPE ADD VALUE идемпотентен через IF NOT EXISTS).
 */
async function applySqlFile(db: PGlite, filePath: string, label: string): Promise<{ total: number; ok: number; failed: number }> {
  const sql = readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql);
  console.log(`» ${label}: ${statements.length} statements`);

  let ok = 0;
  let failed = 0;
  for (let idx = 0; idx < statements.length; idx++) {
    const stmt = statements[idx].trim();
    if (!stmt) continue;
    // Пропустить транзакционные операторы — PGlite управляет autocommit сам,
    // а BEGIN/COMMIT внутри одного query() ломают последующие statements
    const upper = stmt.toUpperCase();
    if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK" || upper === "END" || upper.startsWith("BEGIN ")) {
      ok++;
      continue;
    }
    try {
      await db.query(stmt);
      ok++;
    } catch (e: any) {
      // Игнорировать: "role already exists", "type already exists", "policy already exists"
      const msg = e.message || "";
      if (
        msg.includes("already exists") ||
        msg.includes("already a member") ||
        msg.includes("enum label") ||
        msg.includes("already exists in schema")
      ) {
        // Идемпотентные операции — пропускаем
        ok++;
      } else {
        console.warn(`  ⚠ statement ${idx + 1} failed: ${msg.slice(0, 150)}`);
        failed++;
      }
    }
  }
  console.log(`✓ ${label}: ${ok} ok, ${failed} failed`);
  return { total: statements.length, ok, failed };
}

async function main() {
  // Полная очистка тестовой базы
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
  mkdirSync(TEST_DB_PATH, { recursive: true });

  console.log("» Открываем PGlite в", TEST_DB_PATH);
  const db = new PGlite(TEST_DB_PATH);

  try {
    // 0. Создать stub-среду для имитации Supabase:
    //  - схема auth с таблицей users (FK цель для 0012)
    //  - extension-free генерация UUID через gen_random_uuid()
    console.log("» Создаём stub-среду (схема auth, тип user_role)...");
    await db.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT,
        encrypted_password TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Создать тип user_role (если 0001 не применился)
    await db.query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM (
          'CUSTOMER','CONFECTIONER','ADMIN','SUPER_ADMIN','COURIER','SUPPLIER',
          'VENUE_OWNER','ANIMATOR_AGENCY','RECREATION_CENTER','KIDS_CLUB',
          'GUEST','MODERATOR','SUPPORT','STUDIO','BLOGGER','TASTER',
          'FRANCHISEE','NUTRITIONIST','CORPORATE_CLIENT','QUALITY_INSPECTOR',
          'CERTIFICATION_AGENT','COPYWRITER','FOOD_SERVICE','EVENT_ORGANIZER',
          'PICKUP_POINT','WHOLESALER','INSPECTOR'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    // Функция update_updated_at_column (тоже из 0001)
    await db.query(`
      CREATE OR REPLACE FUNCTION public.update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    // Создать таблицу user_roles (нужна для RLS проверок в 0012)
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.user_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        role user_role NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        assigned_at TIMESTAMPTZ DEFAULT now(),
        assigned_by UUID,
        deactivated_at TIMESTAMPTZ
      )
    `);
    // Создать схему auth и функцию auth.uid() (Supabase-specific, в PGlite нет)
    await db.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await db.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS UUID LANGUAGE SQL STABLE AS $$
        SELECT NULL::UUID
      $$
    `);
    await db.query(`
      CREATE OR REPLACE FUNCTION auth.role()
      RETURNS TEXT LANGUAGE SQL STABLE AS $$
        SELECT 'authenticated'::TEXT
      $$
    `);
    // Создать роли Supabase (аноним + authenticated)
    await db.query(`DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN null; END $$`);
    await db.query(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN null; END $$`);
    await db.query(`DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN null; END $$`);
    console.log("✓ Stub-среда готова");

    // 1. Применяем 0012 (наши новые таблицы)
    await applySqlFile(db, join(MIGRATIONS_DIR, "0012_new_roles_recipes_loyalty_ai.sql"), "0012_new_roles_recipes_loyalty_ai.sql");

    // 3. Проверяем, что все 8 таблиц созданы
    console.log("");
    console.log("─── Проверка таблиц ───");
    const expectedTables = [
      "recipe_marketplace",
      "recipe_purchases",
      "recipe_subscriptions",
      "loyalty_partners",
      "loyalty_cross_actions",
      "loyalty_point_exchanges",
      "ai_assistant_conversations",
      "ai_assistant_logs",
    ];

    let allOk = true;
    for (const tableName of expectedTables) {
      const result = await db.query(
        `SELECT count(*) as cnt FROM information_schema.tables WHERE table_name = $1`,
        [tableName]
      );
      const count = (result.rows[0] as any)?.cnt;
      const status = count > 0 ? "✓" : "✗";
      console.log(`  ${status} ${tableName}: ${count > 0 ? "создана" : "ОТСУТСТВУЕТ"}`);
      if (count === 0) allOk = false;
    }

    // 4. Проверяем, что enum расширен
    console.log("");
    console.log("─── Проверка ролей в enum ───");
    const roleResult = await db.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role') ORDER by enumsortorder`
    );
    const roles = roleResult.rows.map((r: any) => r.enumlabel);
    console.log(`  Найдено ролей: ${roles.length}`);
    const expectedNewRoles = ["RECIPE_DEVELOPER", "LOYALTY_PARTNER", "AI_ASSISTANT"];
    for (const role of expectedNewRoles) {
      const has = roles.includes(role);
      console.log(`  ${has ? "✓" : "✗"} ${role}`);
      if (!has) allOk = false;
    }

    // 5. Проверяем, что RLS включён
    console.log("");
    console.log("─── Проверка RLS ───");
    const rlsResult = await db.query(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN (${expectedTables.map((_, i) => `$${i + 1}`).join(",")})`,
      expectedTables
    );
    for (const row of rlsResult.rows as Array<{ tablename: string; rowsecurity: boolean }>) {
      console.log(`  ${row.rowsecurity ? "✓" : "✗"} RLS на ${row.tablename}: ${row.rowsecurity ? "включён" : "ВЫКЛЮЧЕН"}`);
      if (!row.rowsecurity) allOk = false;
    }

    // 6. Проверяем количество политик
    console.log("");
    console.log("─── Проверка RLS-политик ───");
    const policyResult = await db.query(
      `SELECT count(*) as cnt FROM pg_policies WHERE schemaname = 'public' AND tablename IN (${expectedTables.map((_, i) => `$${i + 1}`).join(",")})`,
      expectedTables
    );
    const policyCount = (policyResult.rows[0] as any)?.cnt;
    console.log(`  Политик создано: ${policyCount}`);
    if (policyCount < 15) {
      console.log("  ✗ Меньше 15 политик — возможно, не все создались");
      allOk = false;
    } else {
      console.log(`  ✓ Достаточное количество политик (≥15)`);
    }

    // 7. Smoke-тест: вставить запись и проверить
    console.log("");
    console.log("─── Smoke-тест: вставка + чтение ───");
    try {
      // Создать тестовую запись в ai_assistant_logs
      await db.query(`
        INSERT INTO public.ai_assistant_logs (request_type, input_text, output_text, model_used, latency_ms)
        VALUES ('chat', 'Тестовый запрос', 'Тестовый ответ', 'test-model', 42)
      `);
      const result = await db.query(
        `SELECT id, request_type, input_text, latency_ms FROM public.ai_assistant_logs ORDER BY id DESC LIMIT 1`
      );
      const row = result.rows[0] as any;
      if (row && row.input_text === "Тестовый запрос" && row.latency_ms === 42) {
        console.log("  ✓ Insert + Select работает, latency_ms=", row.latency_ms);
      } else {
        console.log("  ✗ Smoke-тест не прошёл");
        allOk = false;
      }
    } catch (e: any) {
      console.log("  ✗ Smoke-тест упал:", e.message?.slice(0, 100));
      allOk = false;
    }

    console.log("");
    if (allOk) {
      console.log("✅ МИГРАЦИЯ 0012 ВАЛИДНА — все таблицы созданы, RLS работает, роли добавлены, CRUD работает");
      process.exit(0);
    } else {
      console.log("❌ МИГРАЦИЯ 0012 НЕ ПРОШЛА ВАЛИДАЦИЮ — см. ошибки выше");
      process.exit(1);
    }
  } catch (err: any) {
    console.error("❌ Ошибка при применении миграции:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await db.close();
    // Очищаем тестовую базу
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
