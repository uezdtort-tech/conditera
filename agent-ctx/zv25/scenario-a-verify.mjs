// Z-v25 Этап 2.3 — Сценарий A: чистая установка (независимая проверка).
// Использование: node agent-ctx/zv25/scenario-a-verify.mjs <dbname>
// Проверяет фактический каталог PG после штатного setup.mjs.
import pg from "pg";

const dbName = process.argv[2];
if (!dbName) { console.error("usage: scenario-a-verify.mjs <db>"); process.exit(2); }
const CONN = `postgresql://postgres@127.0.0.1:54329/${dbName}`;

const c = new pg.Client({ connectionString: CONN });
await c.connect();

const results = [];
const t = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? " | " + detail : ""}`);
};

// 1. Дубликаты migration ID в файловой системе vs ledger
const { readdirSync } = await import("node:fs");
const files = readdirSync("/home/z/my-project/supabase/migrations").filter(f => f.endsWith(".sql"));
const ids = files.map(f => f.match(/^(\d+)_/)?.[1]).filter(Boolean);
const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
t("A1: нет дублирующихся migration ID в дереве", dupIds.length === 0, dupIds.join(",") || `${files.length} files`);

const ledger = await c.query(`SELECT filename FROM public.schema_migrations ORDER BY filename`);
const ledgerSet = new Set(ledger.rows.map(r => r.filename));
const missingInLedger = files.filter(f => !ledgerSet.has(f));
const extraInLedger = [...ledgerSet].filter(f => !files.includes(f));
t("A2: все файлы в schema_migrations (ledger полон)", missingInLedger.length === 0 && extraInLedger.length === 0,
  `ledger=${ledgerSet.size}, missing=${missingInLedger.join(",") || "none"}, extra=${extraInLedger.join(",") || "none"}`);

// 2. cart_items: колонки
const cols = await c.query(`
  SELECT column_name, is_nullable, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cart_items' ORDER BY ordinal_position`);
const colNames = cols.rows.map(r => r.column_name);
t("A3: cart_items имеет custom_config + client_ref", colNames.includes("custom_config") && colNames.includes("client_ref"), colNames.join(","));
t("A4: cart_items НЕ имеет metadata (артефакт зомби удалён)", !colNames.includes("metadata"), colNames.includes("metadata") ? "METADATA PRESENT" : "");

// 3. Constraints на cart_items
const cons = await c.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid='public.cart_items'::regclass ORDER BY conname`);
const conMap = Object.fromEntries(cons.rows.map(r => [r.conname, r.def]));
const norm = (s) => (s || "").replace(/[\s()]+/g, " ").trim();
t("A5: cart_items_kind_check существует и корректен",
  !!conMap["cart_items_kind_check"] && /product_id IS NOT NULL AND custom_config IS NULL/.test(norm(conMap["cart_items_kind_check"])),
  conMap["cart_items_kind_check"] || "MISSING");
t("A6: зомби-ограничение cart_items_product_or_custom_check ОТСУТСТВУЕТ", !conMap["cart_items_product_or_custom_check"],
  conMap["cart_items_product_or_custom_check"] ? "ZOMBIE PRESENT" : "");

// 4. product_id nullable
const pid = cols.rows.find(r => r.column_name === "product_id");
t("A7: product_id nullable (custom-позиции возможны)", pid && pid.is_nullable === "YES", pid ? pid.is_nullable : "no column");

// 5. Индексы
const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='cart_items' ORDER BY indexname`);
const idxNames = idx.rows.map(r => r.indexname);
t("A8: индексы uq_cart_user_client_ref + idx_cart_user_updated",
  idxNames.includes("uq_cart_user_client_ref") && idxNames.includes("idx_cart_user_updated"), idxNames.join(","));

// 6. RLS на cart_items
const rls = await c.query(`SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='cart_items'`);
t("A9: RLS включён на cart_items", rls.rows[0]?.rowsecurity === true, String(rls.rows[0]?.rowsecurity));
const pol = await c.query(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='cart_items'`);
t("A10: политики RLS cart_items присутствуют", pol.rowCount > 0, `${pol.rowCount} политик: ${pol.rows.map(p => p.policyname).join(", ")}`);

// 7. Общая сводка: таблицы, функции, триггеры
const tables = await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`);
const funcs = await c.query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`);
const trigs = await c.query(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`);
console.log(`INFO: таблиц=${tables.rows[0].n}, функций public=${funcs.rows[0].n}, триггеров=${trigs.rows[0].n}`);
t("A11: схема существенно заполнена (таблиц >= 40)", tables.rows[0].n >= 40, `таблиц=${tables.rows[0].n}`);

// 8. Критические таблицы
const crit = ["profiles", "products", "orders", "order_items", "cart_items", "recipe_marketplace", "schema_migrations"];
for (const tbl of crit) {
  const ex = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tbl]);
  t(`A12: таблица ${tbl} существует`, ex.rowCount === 1);
}

const failed = results.filter(r => !r.ok);
console.log(`\nSCENARIO A RESULT: ${results.length - failed.length}/${results.length} PASS${failed.length ? " — FAILURES PRESENT" : " — ALL PASS"}`);
await c.end();
process.exit(failed.length ? 1 : 0);
