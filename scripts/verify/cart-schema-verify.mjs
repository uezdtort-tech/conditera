#!/usr/bin/env bun
/**
 * cart-schema-verify.mjs — Z-v24 регрессионная защита контракта корзины.
 *
 * Что проверяет (на изолированной disposable-БД, PostgreSQL 17):
 *   1. Уникальность migration ID (правило: одинаковый числовой префикс + оба
 *      остатка с «_» = конфликт; вариантные 0016b легальны).
 *   2. Зомби-артефакты 0062_cart_custom_items отсутствуют (CHECK
 *      cart_items_product_or_custom_check, колонка metadata).
 *   3. Канонические объекты на месте (0062_cart_sync_custom: kind_check,
 *      custom_config, client_ref, uq_cart_user_client_ref).
 *   4. Поведение схемы: товарная позиция OK; custom-позиция OK (дкфект Z-v24
 *      давал здесь SQLSTATE 23514 → HTTP 500 на POST /api/cart); invalid-виды
 *      (обе колонки / ни одной) отклонены kind_check; quantity <= 0 отклонён.
 *   5. Миграция 0080 в леджере (repair-путь для существующих БД).
 *
 * Запуск: DATABASE_URL=postgresql://... bun scripts/verify/cart-schema-verify.mjs
 * DB создаётся скриптом (conditera_zv24_cartverify_<suffix>), в конце удаляется.
 */
import { Client } from "pg";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

const ADMIN_URL = process.env.ZV24_ADMIN_URL || "postgresql://postgres@127.0.0.1:54329/postgres";
const ADMIN_DB = (new URL(ADMIN_URL).pathname || "/postgres").replace(/^\//, "") || "postgres";
const VERIFY_DB = `conditera_zv24_cartverify_${Date.now().toString(36)}`;
const DB_URL = ADMIN_URL.replace(new RegExp(`/${ADMIN_DB}(\\?|$)`), `/${VERIFY_DB}$1`);

let failed = 0;
const t = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` | ${detail}` : ""}`);
};

function checkDuplicateIds() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const groups = new Map();
  for (const f of files) {
    const m = f.match(/^(\d+)/);
    if (!m) continue;
    const rest = f.slice(m[1].length);
    if (!rest.startsWith("_")) continue; // 0016b-стиль легален
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push(f);
  }
  const dups = [...groups.entries()].filter(([, fs]) => fs.length > 1);
  t("migration IDs уникальны (дубликатов вида 0062_a/0062_b нет)", dups.length === 0,
    dups.length ? dups.map(([n, fs]) => `${n}: ${fs.join(",")}`).join("; ") : `${files.length} файлов`);
  return dups.length === 0;
}

async function main() {
  console.log(`cart-schema-verify → disposable БД ${VERIFY_DB}`);

  // 0. Статика: уникальность ID в дереве миграций
  console.log("\n─── Миграции: статика ───");
  const idsOk = checkDuplicateIds();

  // 1. Полная установка на чистой БД
  console.log("\n─── Полная установка (db:setup) ──");
  {
    const a = new Client({ connectionString: ADMIN_URL });
    await a.connect();
    const exists = await a.query("SELECT 1 FROM pg_database WHERE datname=$1", [VERIFY_DB]);
    if (exists.rowCount > 0) await a.query(`DROP DATABASE ${VERIFY_DB}`);
    await a.query(`CREATE DATABASE ${VERIFY_DB}`);
    await a.end();
  }
  let setupOut = "";
  try {
    setupOut = execSync(`DATABASE_URL="${DB_URL}" bun scripts/db/setup.mjs`, {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    t("db:setup на чистой БД — exit 0", true);
  } catch (e) {
    t("db:setup на чистой БД — exit 0", false, String(e.stderr || e.message).slice(-300));
  }
  const ledgerFiles = (setupOut.match(/(\d+) total in ledger/) || [])[1];
  t("все миграции в леджере", !!ledgerFiles && Number(ledgerFiles) > 0, `total=${ledgerFiles}`);
  t("в установке нет 0062_cart_custom_items", !setupOut.includes("0062_cart_custom_items"));
  t("0080_cart_remove_zombie_check применён", setupOut.includes("0080_cart_remove_zombie_check"));

  // 2. Каталог схемы
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  console.log("\n─── Схема cart_items (каталоги PG) ───");
  {
    const ck = await c.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='public.cart_items'::regclass AND contype='c' ORDER BY 1`);
    const names = ck.rows.map((r) => r.conname);
    t("канонический cart_items_kind_check присутствует", names.includes("cart_items_kind_check"), names.join(", "));
    t("канонический cart_items_quantity_check присутствует", names.includes("cart_items_quantity_check"));
    t("зомби cart_items_product_or_custom_check ОТСУТСТВУЕТ", !names.includes("cart_items_product_or_custom_check"));
    const cols = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='cart_items'`);
    const colNames = cols.rows.map((r) => r.column_name);
    t("custom_config присутствует", colNames.includes("custom_config"));
    t("client_ref присутствует", colNames.includes("client_ref"));
    t("зомби-колонка metadata ОТСУТСТВУЕТ", !colNames.includes("metadata"));
    const ix = await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='cart_items'`);
    const ixNames = ix.rows.map((r) => r.indexname);
    t("uq_cart_user_client_ref присутствует", ixNames.includes("uq_cart_user_client_ref"));
    t("idx_cart_user_updated присутствует", ixNames.includes("idx_cart_user_updated"));
    const led = await c.query(`SELECT 1 FROM schema_migrations WHERE filename='0080_cart_remove_zombie_check.sql'`);
    t("0080 в леджере миграций", led.rowCount === 1);
  }

  // 3. Поведение схемы на синтетических данных
  console.log("\n─── Поведение (синтетические данные) ───");
  const U = "24622222-2222-4222-8222-2222222222ab";
  await c.query(
    `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     VALUES ($1, 'zv24-cartverify@conditera.local', '', now(), '{"synthetic":true}'::jsonb, now(), now())
     ON CONFLICT (id) DO NOTHING`, [U]);
  await c.query(
    `INSERT INTO public.profiles (id, email, name, is_verified, is_blocked, loyalty_level, bonus_balance)
     VALUES ($1, 'zv24-cartverify@conditera.local', 'ZV24 CartVerify', true, false, 'BRONZE', 0)
     ON CONFLICT (id) DO NOTHING`, [U]);
  const prod = await c.query(
    `INSERT INTO public.products (title, slug, description, price, status, confectioner_id, category_id, images, created_at, updated_at)
     VALUES ('ZV24 Verify Cake', 'zv24-verify-cake', 'synthetic', 100000, 'published', $1::uuid,
             (SELECT id FROM public.product_categories LIMIT 1), ARRAY[]::text[], now(), now())
     RETURNING id::text`, [U]);
  const P = prod.rows[0].id;

  const insertRow = (clientRef, productId, qty, custom) => c.query(
    `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
     VALUES ($1, $2, $3, $4, NULL, $5, NULL, now())`, [U, clientRef, productId, qty, custom]);

  try { await insertRow("v-product", P, 2, null); t("товарная позиция вставляется", true); }
  catch (e) { t("товарная позиция вставляется", false, `${e.code} ${e.message}`); }

  try { await insertRow("v-custom", null, 1, '{"weight":"1kg","fillings":[]}'); t("custom-позиция вставляется (раньше: 23514 → HTTP 500)", true); }
  catch (e) { t("custom-позиция вставляется", false, `РЕГРЕССИЯ: ${e.code} ${e.constraint} ${e.message}`); }

  try { await insertRow("v-both", P, 1, '{"weight":"1kg"}'); t("товар+custom_config отклонён kind_check", false, "вставился неожиданно"); }
  catch (e) { t("товар+custom_config отклонён kind_check", e.code === "23514" && e.constraint === "cart_items_kind_check", `${e.code} ${e.constraint}`); }

  try { await insertRow("v-none", null, 1, null); t("ни товара ни custom отклонён kind_check", false, "вставился неожиданно"); }
  catch (e) { t("ни товара ни custom отклонён kind_check", e.code === "23514" && e.constraint === "cart_items_kind_check", `${e.code} ${e.constraint}`); }

  try { await insertRow("v-zero", P, 0, null); t("quantity=0 отклонён quantity_check", false, "вставился неожиданно"); }
  catch (e) { t("quantity=0 отклонён quantity_check", e.code === "23514" && e.constraint === "cart_items_quantity_check", `${e.code} ${e.constraint}`); }

  try { await insertRow("v-product", P, 3, null); t("повторный client_ref отклонён uq_cart_user_client_ref (API обрабатывает 23505 как update)", false, "вставился неожиданно"); }
  catch (e) { t("повторный client_ref отклонён uq_cart_user_client_ref", e.code === "23505", `${e.code}`); }

  const up = await c.query(
    `UPDATE public.cart_items SET quantity=5, updated_at=now() WHERE user_id=$1 AND client_ref='v-product' RETURNING quantity`, [U]);
  t("изменение количества работает", up.rowCount === 1 && up.rows[0].quantity === 5);

  const del = await c.query(`DELETE FROM public.cart_items WHERE user_id=$1 RETURNING 1`, [U]);
  t("удаление позиций работает", del.rowCount >= 2, `deleted=${del.rowCount}`);

  await c.end();

  // 4. Очистка disposable-БД
  {
    const a = new Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`DROP DATABASE ${VERIFY_DB}`);
    await a.end();
    console.log(`\n(disposable БД ${VERIFY_DB} удалена)`);
  }

  console.log(`\n=== cart-schema-verify: ${failed === 0 && idsOk ? "PASS" : "FAIL"} ===`);
  process.exit(failed === 0 && idsOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL:", e.message);
  try {
    const a = new Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await a.end();
  } catch { /* best effort */ }
  process.exit(1);
});
