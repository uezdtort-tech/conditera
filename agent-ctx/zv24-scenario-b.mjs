// Z-v24 Stage 5 — Scenario B experiments (existing-DB upgrade safety)
// DBs: conditera_zv24_cart_simB (zombie applied + data), conditera_zv24_cart_simB2 (pre-zombie world)
// Synthetic data only. Working DBs untouched.
const { Client } = require("pg");
const { readFileSync } = require("node:fs");

const ADMIN = "postgresql://postgres@127.0.0.1:54329/postgres";
const M080 = readFileSync("agent-ctx/zv24-0080-draft.sql", "utf8");
const USER_ID = "24611111-1111-4111-8111-1111111111ab";

async function freshDb(name) {
  const a = new Client({ connectionString: ADMIN });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${name}`);
  await a.query(`CREATE DATABASE ${name}`);
  await a.end();
  const c = new Client({ connectionString: `postgresql://postgres@127.0.0.1:54329/${name}` });
  await c.connect();
  return c;
}

async function fullSetup(dbName) {
  const { execSync } = require("node:child_process");
  execSync(`DATABASE_URL=postgresql://postgres@127.0.0.1:54329/${dbName} bun scripts/db/setup.mjs`, {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function synthUser(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     VALUES ($1, 'zv24-simb@conditera.local', '', now(), '{"synthetic":true}'::jsonb, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID]
  );
  await c.query(
    `INSERT INTO public.profiles (id, email, name, is_verified, is_blocked, loyalty_level, bonus_balance)
     VALUES ($1, 'zv24-simb@conditera.local', 'ZV24 SimB', true, false, 'BRONZE', 0)
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID]
  );
}

async function synthProduct(c, slug) {
  const r = await c.query(
    `INSERT INTO public.products (title, slug, description, price, status, confectioner_id, category_id, images, created_at, updated_at)
     VALUES ($2, $3, 'synthetic', 100000, 'published', $1::uuid,
             (SELECT id FROM public.product_categories LIMIT 1), ARRAY[]::text[], now(), now())
     RETURNING id::text`,
    [USER_ID, slug, slug]
  );
  return r.rows[0].id;
}

const checks = [];
const t = (name, ok, detail = "") => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? " | " + detail : ""}`); };

async function hasConstraint(c, name) {
  const r = await c.query(`SELECT 1 FROM pg_constraint WHERE conname=$1 AND conrelid='public.cart_items'::regclass`, [name]);
  return r.rowCount > 0;
}
async function hasColumn(c, name) {
  const r = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cart_items' AND column_name=$1`, [name]);
  return r.rowCount > 0;
}

// ============ Scenario B1: DB where zombie WAS applied + existing data ============
async function scenarioB1() {
  console.log("\n===== B1: zombie-applied DB + data → apply 0080 → verify repair =====");
  const c = await freshDb("conditera_zv24_cart_simb1");
  await fullSetup("conditera_zv24_cart_simb1");
  await synthUser(c);
  const p1 = await synthProduct(c, "zv24-simb1-a");
  const p2 = await synthProduct(c, "zv24-simb1-b");

  // Existing rows: plain product row; product row with zombie-era metadata attrs
  await c.query(
    `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, notes, updated_at)
     VALUES ($1, 'b1-r1', $2::uuid, 1, NULL, NULL, NULL, NULL, now())`, [USER_ID, p1]);
  await c.query(
    `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, notes, updated_at)
     VALUES ($1, 'b1-r2', $2::uuid, 2, NULL, NULL, '{"gift_wrap":true}'::jsonb, NULL, now())`, [USER_ID, p2]);

  // Prove impossible-state claim: product NULL + custom_config NULL + metadata?'custom' violates kind_check
  try {
    await c.query(
      `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, notes, updated_at)
       VALUES ($1, 'b1-rx', NULL, 1, NULL, NULL, '{"custom":{}}'::jsonb, NULL, now())`, [USER_ID]);
    t("B1-x impossible row (product NULL, cc NULL, metadata?'custom')", false, "insert unexpectedly OK");
  } catch (e) {
    t("B1-x impossible row rejected by kind_check", e.code === "23514" && e.constraint === "cart_items_kind_check", `${e.code} ${e.constraint}`);
  }

  // Baseline: custom insert FAILS before 0080
  try {
    await c.query(
      `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
       VALUES ($1, 'b1-c1', NULL, 1, NULL, '{"weight":"1kg"}'::jsonb, NULL, now())`, [USER_ID]);
    t("B1-pre custom insert (before 0080)", false, "unexpectedly OK");
  } catch (e) {
    t("B1-pre custom insert blocked by zombie CHECK", e.code === "23514" && e.constraint === "cart_items_product_or_custom_check", `${e.code} ${e.constraint}`);
  }

  // Apply 0080
  await c.query(M080);
  t("B1-0080 applied", true);

  t("B1-post zombie CHECK dropped", !(await hasConstraint(c, "cart_items_product_or_custom_check")));
  t("B1-post canonical kind_check kept", await hasConstraint(c, "cart_items_kind_check"));
  t("B1-post metadata column KEPT (product row holds data)", await hasColumn(c, "metadata"));

  // Data integrity: both rows intact, metadata untouched on product row
  const rows = await c.query(`SELECT client_ref, quantity, metadata FROM public.cart_items WHERE user_id=$1 ORDER BY client_ref`, [USER_ID]);
  const r1 = rows.rows.find((r) => r.client_ref === "b1-r1");
  const r2 = rows.rows.find((r) => r.client_ref === "b1-r2");
  t("B1-post rows intact (r1)", r1 && r1.quantity === 1 && r1.metadata === null);
  t("B1-post rows intact (r2, metadata preserved)", r2 && r2.quantity === 2 && r2.metadata && r2.metadata.gift_wrap === true);

  // After fix: custom insert works; product insert works; invalid kind (both) rejected
  await c.query(
    `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
     VALUES ($1, 'b1-c2', NULL, 1, NULL, '{"weight":"2kg"}'::jsonb, NULL, now())`, [USER_ID]);
  t("B1-post custom insert OK", true);
  try {
    await c.query(
      `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
       VALUES ($1, 'b1-bad', $2::uuid, 1, NULL, '{"weight":"1kg"}'::jsonb, NULL, now())`, [USER_ID, p1]);
    t("B1-post product+custom_config rejected", false, "unexpectedly OK");
  } catch (e) {
    t("B1-post product+custom_config rejected by kind_check", e.code === "23514" && e.constraint === "cart_items_kind_check", `${e.code} ${e.constraint}`);
  }
  await c.end();
}

// ============ Scenario B2: same DB, apply 0080 AGAIN (idempotency) ============
async function scenarioB2() {
  console.log("\n===== B2: re-run 0080 (idempotency) =====");
  const c = new Client({ connectionString: "postgresql://postgres@127.0.0.1:54329/conditera_zv24_cart_simb1" });
  await c.connect();
  await c.query(M080);
  t("B2 second run no error", true);
  t("B2 zombie CHECK still absent", !(await hasConstraint(c, "cart_items_product_or_custom_check")));
  const rows = await c.query(`SELECT count(*)::int AS n FROM public.cart_items WHERE user_id=$1`, [USER_ID]);
  t("B2 data intact after re-run", rows.rows[0].n === 3, `rows=${rows.rows[0].n}`);
  await c.end();
}

// ============ Scenario B3: pre-zombie world (fresh post-fix schema) → 0080 no-op ============
async function scenarioB3() {
  console.log("\n===== B3: pre-zombie world → 0080 full no-op =====");
  const c = await freshDb("conditera_zv24_cart_simb3");
  await fullSetup("conditera_zv24_cart_simb3");
  // Simulate world where zombie never applied: remove its two objects
  await c.query(`ALTER TABLE public.cart_items DROP CONSTRAINT IF EXISTS cart_items_product_or_custom_check`);
  await c.query(`ALTER TABLE public.cart_items DROP COLUMN IF EXISTS metadata`);
  await synthUser(c);
  const p1 = await synthProduct(c, "zv24-simb3-a");
  await c.query(
    `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
     VALUES ($1, 'b3-r1', $2::uuid, 1, NULL, NULL, NULL, now())`, [USER_ID, p1]);

  await c.query(M080);
  t("B3 0080 applied without error", true);
  t("B3 canonical kind_check present", await hasConstraint(c, "cart_items_kind_check"));
  t("B3 metadata still absent", !(await hasColumn(c, "metadata")));
  await c.query(
    `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
     VALUES ($1, 'b3-c1', NULL, 1, NULL, '{"weight":"3kg"}'::jsonb, NULL, now())`, [USER_ID]);
  t("B3 custom insert OK", true);
  const rows = await c.query(`SELECT count(*)::int AS n FROM public.cart_items WHERE user_id=$1`, [USER_ID]);
  t("B3 rows intact", rows.rows[0].n === 2);
  await c.end();
}

(async () => {
  await scenarioB1();
  await scenarioB2();
  await scenarioB3();
  const failed = checks.filter((x) => !x.ok);
  console.log(`\n=== Scenario B summary: ${checks.length - failed.length}/${checks.length} PASS ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e.message); console.error(e.stack ? String(e.stack).split("\n").slice(0, 6).join("\n") : ""); process.exit(1); });
