// Z-v25 Этап 2.3 — Сценарий B: легаси-обновление (независимая проверка).
// Штатный runner (setup.mjs) выполняет upgrade БД, перемотанной в до-0080 состояние
// с артефактами зомби-миграции. Плюс: rescue-путь 0080, идемпотентность, NULL-handling.
// Синтетические данные только; рабочие БД не затрагиваются.
import pg from "pg";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ADMIN = "postgresql://postgres@127.0.0.1:54329/postgres";
const M080 = readFileSync("/home/z/my-project/supabase/migrations/0080_cart_remove_zombie_check.sql", "utf8");
const UID = "24725252-5252-4252-8252-5252525252ab";

const checks = [];
const t = (name, ok, detail = "") => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? " | " + detail : ""}`); };

async function admin() { const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); return c; }
async function freshDb(name) {
  const a = await admin();
  await a.query(`DROP DATABASE IF EXISTS ${name}`);
  await a.query(`CREATE DATABASE ${name}`);
  await a.end();
  const c = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:54329/${name}` });
  await c.connect();
  return c;
}
async function fullSetup(dbName) {
  execSync(`DATABASE_URL=postgresql://postgres@127.0.0.1:54329/${dbName} bun scripts/db/setup.mjs`,
    { cwd: "/home/z/my-project", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: `postgresql://postgres@127.0.0.1:54329/${dbName}` } });
}
const hasConstraint = async (c, n) => (await c.query(`SELECT 1 FROM pg_constraint WHERE conname=$1 AND conrelid='public.cart_items'::regclass`, [n])).rowCount > 0;
const hasColumn = async (c, n) => (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cart_items' AND column_name=$1`, [n])).rowCount > 0;

async function synthUser(c) {
  await c.query(`INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    VALUES ($1,'zv25-b@conditera.local','',now(),'{"synthetic":true}'::jsonb,now(),now()) ON CONFLICT (id) DO NOTHING`, [UID]);
  await c.query(`INSERT INTO public.profiles (id, email, name, is_verified, is_blocked, loyalty_level, bonus_balance)
    VALUES ($1,'zv25-b@conditera.local','ZV25 ScenarioB',true,false,'BRONZE',0) ON CONFLICT (id) DO NOTHING`, [UID]);
}
async function synthProduct(c, slug) {
  const r = await c.query(`INSERT INTO public.products (title, slug, description, price, status, confectioner_id, category_id, images, created_at, updated_at)
    VALUES ($2,$3,'synthetic',100000,'published',$1::uuid,(SELECT id FROM public.product_categories LIMIT 1),ARRAY[]::text[],now(),now()) RETURNING id::text`, [UID, slug, slug]);
  return r.rows[0].id;
}

// ================= B1: реалистичный легаси + ШТАТНЫЙ upgrade через setup.mjs =================
async function scenarioB1() {
  console.log("\n===== B1: легаси-БД (зомби-артефакты, леджер до-0080) → штатный setup.mjs → верификация =====");
  const db = "conditera_zv25_b_leg";
  const c = await freshDb(db);
  await fullSetup(db); // полная штатная установка (каноническая схема)
  // Перемотка в легаси: до-0080 леджер + зомби-артефакты
  await c.query(`DELETE FROM public.schema_migrations WHERE filename='0080_cart_remove_zombie_check.sql'`);
  await c.query(`ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS metadata jsonb`);
  await c.query(`ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_product_or_custom_check
    CHECK (product_id IS NOT NULL OR (metadata IS NOT NULL AND metadata ? 'custom'))`);
  await synthUser(c);
  const p1 = await synthProduct(c, "zv25-b1-a");
  const p2 = await synthProduct(c, "zv25-b1-b");

  // Легаси-данные: товарная строка; товарная строка зомби-эры с metadata-атрибутами
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, updated_at)
    VALUES ($1,'b1-r1',$2::uuid,1,NULL,NULL,NULL,now())`, [UID, p1]);
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, updated_at)
    VALUES ($1,'b1-r2',$2::uuid,2,NULL,NULL,'{"gift_wrap":true}'::jsonb,now())`, [UID, p2]);

  // Базлайн: custom-вставка заблокирована зомби-CHECK (воспроизведение P1 на уровне SQL)
  let blocked = null;
  try {
    await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, updated_at)
      VALUES ($1,'b1-pre',NULL,1,NULL,'{"weight":"1kg"}'::jsonb,now())`, [UID]);
  } catch (e) { blocked = e; }
  t("B1-pre: custom-вставка заблокирована зомби-CHECK (23514)", blocked && blocked.code === "23514" && blocked.constraint === "cart_items_product_or_custom_check",
    blocked ? `${blocked.code} ${blocked.constraint}` : "вставка неожиданно прошла");

  // ШТАТНЫЙ upgrade (setup.mjs: применит 0080 как pending)
  let setupRc = 0, setupOut = "";
  try { setupOut = execSync(`DATABASE_URL=postgresql://postgres@127.0.0.1:54329/${db} bun scripts/db/setup.mjs`,
    { cwd: "/home/z/my-project", stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `postgresql://postgres@127.0.0.1:54329/${db}` } }); }
  catch (e) { setupRc = e.status ?? 1; setupOut = String(e.stdout || "") + String(e.stderr || ""); }
  t("B1-upgrade: setup.mjs exit 0", setupRc === 0, setupRc !== 0 ? setupOut.slice(-400) : "");

  const led = await c.query(`SELECT 1 FROM public.schema_migrations WHERE filename='0080_cart_remove_zombie_check.sql'`);
  t("B1-upgrade: 0080 в леджере после штатного прогона", led.rowCount === 1);
  t("B1-post: зомби-CHECK удалён", !(await hasConstraint(c, "cart_items_product_or_custom_check")));
  t("B1-post: канонический kind_check сохранён", await hasConstraint(c, "cart_items_kind_check"));
  t("B1-post: metadata-колонка СОХРАНЕНА (товарная строка держит данные)", await hasColumn(c, "metadata"));

  const rows = await c.query(`SELECT client_ref, quantity, metadata, custom_config FROM public.cart_items WHERE user_id=$1 ORDER BY client_ref`, [UID]);
  const r1 = rows.rows.find(r => r.client_ref === "b1-r1");
  const r2 = rows.rows.find(r => r.client_ref === "b1-r2");
  t("B1-post: данные r1 целы (qty=1)", r1 && r1.quantity === 1 && r1.metadata === null);
  t("B1-post: данные r2 целы (qty=2, metadata не тронута)", r2 && r2.quantity === 2 && r2.metadata && r2.metadata.gift_wrap === true);

  // После фикса: custom-вставка работает; недопустимый вид (товар+custom_config) отклонён
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, updated_at)
    VALUES ($1,'b1-c2',NULL,1,NULL,'{"weight":"2kg"}'::jsonb,now())`, [UID]);
  t("B1-post: custom-вставка успешна (P1 устранён на уровне схемы)", true);
  let badKind = null;
  try {
    await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, updated_at)
      VALUES ($1,'b1-bad',$2::uuid,1,NULL,'{"weight":"1kg"}'::jsonb,now())`, [UID, p1]);
  } catch (e) { badKind = e; }
  t("B1-post: товар+custom_config отклонён kind_check", badKind && badKind.code === "23514" && badKind.constraint === "cart_items_kind_check",
    badKind ? `${badKind.code} ${badKind.constraint}` : "вставка неожиданно прошла");

  // Идемпотентность штатного раннера: повторный прогон
  let rc2 = 0;
  try { execSync(`DATABASE_URL=postgresql://postgres@127.0.0.1:54329/${db} bun scripts/db/setup.mjs`,
    { cwd: "/home/z/my-project", stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, DATABASE_URL: `postgresql://postgres@127.0.0.1:54329/${db}` } }); }
  catch { rc2 = 1; }
  t("B1-rerun: повторный setup.mjs exit 0 (идемпотентен)", rc2 === 0);
  const rowsAfter = await c.query(`SELECT count(*)::int AS n FROM public.cart_items WHERE user_id=$1`, [UID]);
  t("B1-rerun: данные целы после повторного прогона", rowsAfter.rows[0].n === 3, `rows=${rowsAfter.rows[0].n}`);
  await c.end();
}

// ================= B2: rescue-путь 0080 (зомби-эра: metadata?'custom' → custom_config) =================
async function scenarioB2() {
  console.log("\n===== B2: rescue-путь 0080 (экзотическое зомби-состояние, прямое применение 0080) =====");
  const db = "conditera_zv25_b_rescue";
  const c = await freshDb(db);
  await fullSetup(db);
  // Конструирование зомби-эры: снять kind_check (иначе состояние невозможно), добавить зомби-CHECK + metadata
  await c.query(`ALTER TABLE public.cart_items DROP CONSTRAINT cart_items_kind_check`);
  await c.query(`ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS metadata jsonb`);
  await c.query(`ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_product_or_custom_check
    CHECK (product_id IS NOT NULL OR (metadata IS NOT NULL AND metadata ? 'custom'))`);
  await synthUser(c);
  // Зомби-эра custom-строки (product NULL, custom_config NULL, metadata с custom) — данные к спасению
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, updated_at)
    VALUES ($1,'b2-z1',NULL,3,NULL,NULL,'{"custom":{"weight":"1.5kg"},"title":"Legacy тортик","price":250000}'::jsonb,now())`, [UID]);
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, updated_at)
    VALUES ($1,'b2-z2',NULL,1,NULL,NULL,'{"custom":{"weight":"2kg"},"title":"Legacy второй","price":300000}'::jsonb,now())`, [UID]);
  // NULL-handling: товарная строка с metadata NULL — не должна пострадать
  const p1 = await synthProduct(c, "zv25-b2-a");
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, updated_at)
    VALUES ($1,'b2-p1',$2::uuid,1,NULL,NULL,NULL,now())`, [UID, p1]);

  // Отрицательная проверка порядка: UPDATE до снятия зомби-CHECK обязан падать (23514)
  let orderErr = null;
  try {
    await c.query(`UPDATE public.cart_items SET custom_config = metadata, metadata = NULL
      WHERE product_id IS NULL AND custom_config IS NULL AND metadata IS NOT NULL AND metadata ? 'custom'`);
  } catch (e) { orderErr = e; }
  t("B2-order: UPDATE-спасение при живом зомби-CHECK отклонено (порядок в 0080 критичен)",
    orderErr && orderErr.code === "23514", orderErr ? `${orderErr.code} ${orderErr.constraint}` : "UPDATE неожиданно прошёл");

  // Применяем 0080 (DROP CHECK до UPDATE — порядок внутри файла)
  await c.query(M080);
  t("B2-0080: применён без ошибки", true);
  t("B2-post: зомби-CHECK удалён", !(await hasConstraint(c, "cart_items_product_or_custom_check")));
  t("B2-post: metadata-колонка удалена (после спасения пуста)", !(await hasColumn(c, "metadata")));

  const z1 = (await c.query(`SELECT * FROM public.cart_items WHERE client_ref='b2-z1'`)).rows[0];
  const z2 = (await c.query(`SELECT * FROM public.cart_items WHERE client_ref='b2-z2'`)).rows[0];
  const p1row = (await c.query(`SELECT * FROM public.cart_items WHERE client_ref='b2-p1'`)).rows[0];
  t("B2-post: z1 спасена ПОЛНОСТЬЮ (custom_config = старый metadata)", z1 && z1.custom_config && z1.custom_config.title === "Legacy тортик" && z1.custom_config.custom && z1.custom_config.custom.weight === "1.5kg" && z1.quantity === 3);
  t("B2-post: z2 спасена ПОЛНОСТЬЮ", z2 && z2.custom_config && z2.custom_config.custom && z2.custom_config.custom.weight === "2kg" && z2.quantity === 1);
  t("B2-post: товарная строка p1 цела (qty=1, custom_config NULL)", p1row && p1row.quantity === 1 && p1row.custom_config === null);

  // Канонический kind_check был снят для конструирования — возвращаем и проверяем совместимость спасённых строк
  await c.query(`ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_kind_check CHECK (
    (product_id IS NOT NULL AND custom_config IS NULL) OR (product_id IS NULL AND custom_config IS NOT NULL))`);
  t("B2-post: канонический kind_check принят спасёнными строками (строки каноничны после rescue)", true);
  await c.end();
}

// ================= B3: чистая схема → 0080 полный no-op + двойное применение =================
async function scenarioB3() {
  console.log("\n===== B3: чистая установка → 0080 no-op, повторное применение идемпотентно =====");
  const db = "conditera_zv25_b_noop";
  const c = await freshDb(db);
  await fullSetup(db);
  await synthUser(c);
  const p1 = await synthProduct(c, "zv25-b3-a");
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, updated_at)
    VALUES ($1,'b3-r1',$2::uuid,1,NULL,NULL,now())`, [UID, p1]);
  // Убираем 0080 из леджера и применяем файл напрямую (имитация «пришёл позже»)
  await c.query(`DELETE FROM public.schema_migrations WHERE filename='0080_cart_remove_zombie_check.sql'`);
  await c.query(M080);
  await c.query(M080); // второй раз подряд
  t("B3: двойное применение 0080 без ошибки", true);
  t("B3: kind_check на месте", await hasConstraint(c, "cart_items_kind_check"));
  t("B3: metadata отсутствует (не воскресла)", !(await hasColumn(c, "metadata")));
  await c.query(`INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, updated_at)
    VALUES ($1,'b3-c1',NULL,2,NULL,'{"weight":"3kg"}'::jsonb,now())`, [UID]);
  const n = (await c.query(`SELECT count(*)::int AS n FROM public.cart_items WHERE user_id=$1`, [UID])).rows[0].n;
  t("B3: custom-вставка работает, данные целы (2 строки)", n === 2, `rows=${n}`);
  await c.end();
}

(async () => {
  await scenarioB1();
  await scenarioB2();
  await scenarioB3();
  const failed = checks.filter(x => !x.ok);
  console.log(`\n=== SCENARIO B SUMMARY: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
