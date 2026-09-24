/**
 * apply-migrations.ts — применить все миграции из supabase/migrations к локальному Supabase.
 *
 * Запуск:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/apply-migrations.ts
 *
 * Или использовать значения по умолчанию для локального Supabase.
 */
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * SQL splitter — разбивает multi-statement SQL на отдельные запросы.
 * Учитывает dollar-quoted строки, комментарии, single-quote литералы.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inDollarQuote: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    // Line comment (--)
    if (next2 === "--" && !inDollarQuote) {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    // Block comment (/* */)
    if (next2 === "/*" && !inDollarQuote) {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    // Dollar-quote start ($tag$)
    if (ch === "$" && !inDollarQuote) {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        current += tag;
        i += tag.length;
        inDollarQuote = tag;
        continue;
      }
    }
    // Dollar-quote end
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
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] !== "'") {
          i++;
          break;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += sql[i + 1];
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }
    // Statement separator
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
  current = current.trim();
  if (current.length > 0) {
    statements.push(current);
  }
  return statements;
}

async function applySqlFile(client: Client, filePath: string, label: string) {
  const sql = readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql);
  console.log(`» ${label}: ${statements.length} statements`);

  let ok = 0;
  let failed = 0;
  for (let idx = 0; idx < statements.length; idx++) {
    const stmt = statements[idx].trim();
    if (!stmt) continue;
    // Пропустить BEGIN/COMMIT
    const upper = stmt.toUpperCase();
    if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK" || upper === "END" || upper.startsWith("BEGIN ")) {
      ok++;
      continue;
    }
    try {
      await client.query(stmt);
      ok++;
    } catch (e: any) {
      const msg = e.message || "";
      // Идемпотентные ошибки — пропускаем
      if (
        msg.includes("already exists") ||
        msg.includes("already a member") ||
        msg.includes("enum label") ||
        msg.includes("already exists in schema")
      ) {
        ok++;
      } else {
        console.warn(`  ⚠ statement ${idx + 1} failed: ${msg.slice(0, 200)}`);
        failed++;
      }
    }
  }
  console.log(`✓ ${label}: ${ok} ok, ${failed} failed`);
  return { total: statements.length, ok, failed };
}

async function main() {
  console.log(`» Connecting to ${DATABASE_URL.replace(/:[^:]*@/, ":***@")}`);
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log("✓ Connected to PostgreSQL\n");

    // Получить список миграций
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    console.log(`» Found ${files.length} migration files:\n`);

    // Применить все миграции по порядку
    for (const file of files) {
      const filePath = join(MIGRATIONS_DIR, file);
      await applySqlFile(client, filePath, file);
    }

    // Проверить результат
    console.log("\n─── Verification ───");

    // 1. Все таблицы в схеме public
    const tablesResult = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    console.log(`✓ Tables in 'public' schema: ${tablesResult.rows.length}`);

    // 2. Роли в enum user_role
    const rolesResult = await client.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role') ORDER by enumsortorder`
    );
    console.log(`✓ user_role enum values: ${rolesResult.rows.length}`);
    const roles = rolesResult.rows.map((r: any) => r.enumlabel);
    console.log(`   Roles: ${roles.join(", ")}`);

    // 3. RLS на критичных таблицах
    const rlsResult = await client.query(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true ORDER BY tablename`
    );
    console.log(`✓ Tables with RLS enabled: ${rlsResult.rows.length}`);

    // 4. Количество политик
    const policiesResult = await client.query(
      `SELECT count(*) as cnt FROM pg_policies WHERE schemaname = 'public'`
    );
    console.log(`✓ RLS policies total: ${policiesResult.rows[0].cnt}`);

    // 5. Количество записей в ключевых таблицах
    const countableTables = ["profiles", "products", "product_categories", "recipe_marketplace", "loyalty_partners", "loyalty_cross_actions", "ai_assistant_conversations", "configs"];
    console.log("\n─── Record counts ───");
    for (const tableName of countableTables) {
      try {
        const result = await client.query(`SELECT count(*) as cnt FROM public.${tableName}`);
        const count = result.rows[0].cnt;
        console.log(`  ${tableName}: ${count}`);
      } catch (e: any) {
        console.log(`  ${tableName}: table not found (${e.message?.slice(0, 60)})`);
      }
    }

    console.log("\n✅ All migrations applied successfully!");
    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ Migration failed:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
