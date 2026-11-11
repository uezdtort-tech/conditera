// Z-v25 Этап 3.3 — Каталог RLS/SECURITY DEFINER (только чтение каталога рабочей БД)
import pg from "pg";
import { readFileSync } from "node:fs";

const url = readFileSync("/home/z/my-project/.env.local", "utf8")
  .split("\n").find(l => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length);
const c = new pg.Client({ connectionString: url });
await c.connect();

// 1. Таблицы без RLS (public, не служебные)
const noRls = await c.query(`
  SELECT t.tablename FROM pg_tables t
  WHERE t.schemaname='public' AND NOT t.rowsecurity
  ORDER BY t.tablename`);
const allTables = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
console.log(`=== ТАБЛИЦЫ БЕЗ RLS: ${noRls.rows.length} из ${allTables.rows.length} ===`);
console.log(noRls.rows.map(r => r.tablename).join(", "));

// 2. Политики USING(true)/WITH CHECK(true)
const wideOpen = await c.query(`
  SELECT schemaname, tablename, policyname, cmd, qual, with_check
  FROM pg_policies WHERE schemaname='public'
  AND (qual ~* 'true' OR with_check ~* 'true')`);
console.log(`\n=== ПОЛИТИКИ С 'true': ${wideOpen.rows.length} ===`);
for (const r of wideOpen.rows) {
  console.log(`${r.tablename}.${r.policyname} [${r.cmd}] qual=${(r.qual||'').slice(0,80)} with_check=${(r.with_check||'').slice(0,80)}`);
}

// 3. Таблицы с RLS, но БЕЗ политик (default-deny — ок для service-ролей, блокирует anon)
const withRls = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true`);
const polTables = await c.query(`SELECT DISTINCT tablename FROM pg_policies WHERE schemaname='public'`);
const rlsSet = new Set(withRls.rows.map(r => r.tablename));
const polSet = new Set(polTables.rows.map(r => r.tablename));
const noPolicies = [...rlsSet].filter(t => !polSet.has(t));
console.log(`\n=== RLS ВКЛЮЧЁН, НО ПОЛИТИК НЕТ (default-deny): ${noPolicies.length} ===`);
console.log(noPolicies.join(", "));

// 4. SECURITY DEFINER функции
const sd = await c.query(`
  SELECT p.proname, n.nspname, p.prosecdef, p.proconfig,
         pg_get_userbyid(p.proowner) AS owner,
         array_to_string(p.proacl, ',') AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
  ORDER BY p.proname`);
console.log(`\n=== SECURITY DEFINER ФУНКЦИЙ: ${sd.rows.length} ===`);
for (const r of sd.rows) {
  const sp = (r.proconfig || []).find(x => x.startsWith('search_path')) || 'search_path НЕ задан';
  console.log(`${r.proname} | owner=${r.owner} | ${sp} | acl=${r.acl || 'default(PUBLIC EXECUTE?)'}`);
}

// 5. Функции без search_path (риск search_path hijack) — только definer-и критичны
const noSp = sd.rows.filter(r => !(r.proconfig || []).some(x => x.startsWith('search_path')));
console.log(`\n=== SECURITY DEFINER БЕЗ search_path: ${noSp.length} (${noSp.map(r=>r.proname).join(", ")||"—"}) ===`);

// 6. cart_items: политики детально
const cartPol = await c.query(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='cart_items' AND schemaname='public'`);
console.log(`\n=== ПОЛИТИКИ cart_items ===`);
for (const r of cartPol.rows) console.log(`${r.policyname} [${r.cmd}] USING ${r.qual} WITH CHECK ${r.with_check}`);

// 8. orders: политики (выборочно, изоляция)
const ordPol = await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE qual LIKE '%auth%' OR qual LIKE '%uid%') AS with_uid FROM pg_policies WHERE tablename='orders' AND schemaname='public'`);
console.log(`\nПолитик orders: ${ordPol.rows[0].n}, с auth-условиями: ${ordPol.rows[0].with_uid}`);

await c.end();
