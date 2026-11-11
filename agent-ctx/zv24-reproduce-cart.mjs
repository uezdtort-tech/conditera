// Z-v24 reproduction: P1 "violates check constraint" on custom cart item insert
// Isolated DB only (conditera_zv24_cart_clean_zv24a). Synthetic data exclusively.
const { Client } = require("pg");

const DB = "postgresql://postgres@127.0.0.1:54329/conditera_zv24_cart_clean_zv24a";
const USER_ID = "24611111-1111-4111-8111-1111111111ab"; // synthetic uuid v4-shaped, zv24 marker

async function main() {
  const c = new Client({ connectionString: DB });
  await c.connect();
  const results = [];
  const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? " | " + detail : ""}`); };

  // 0. Synthetic user (auth.users + profiles) — synthetic only
  await c.query(
    `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     VALUES ($1, 'zv24-repro@conditera.local', '', now(), '{"synthetic":true}'::jsonb, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID]
  );
  await c.query(
    `INSERT INTO public.profiles (id, email, name, is_verified, is_blocked, loyalty_level, bonus_balance)
     VALUES ($1, 'zv24-repro@conditera.local', 'ZV24 Repro', true, false, 'BRONZE', 0)
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID]
  );

  // Synthetic published product
  const prod = await c.query(
    `INSERT INTO public.products (title, slug, description, price, status, confectioner_id, category_id, images, created_at, updated_at)
     VALUES ('ZV24 Repro Cake', 'zv24-repro-cake', 'synthetic', 100000, 'published',
             $1::uuid,
             (SELECT id FROM public.product_categories LIMIT 1), ARRAY[]::text[], now(), now())
     RETURNING id::text`,
    [USER_ID]
  );
  const productId = prod.rows[0].id;
  console.log("synthetic product:", productId);

  // R1: standard product insert (exactly the API POST payload shape)
  try {
    await c.query(
      `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
       VALUES ($1, 'zv24-r1', $2, 2, NULL, NULL, NULL, now())`,
      [USER_ID, productId]
    );
    t("R1 standard product insert", true);
  } catch (e) { t("R1 standard product insert", false, `${e.code} ${e.message}`); }

  // R2: custom item insert (exactly what POST /api/cart writes for builder cakes)
  try {
    await c.query(
      `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
       VALUES ($1, 'zv24-r2', NULL, 1, NULL, '{"weight":"1kg","fillings":[]}'::jsonb, NULL, now())`,
      [USER_ID]
    );
    t("R2 custom item insert (custom_config, no metadata)", true, "NO ERROR — bug not reproduced");
  } catch (e) {
    t("R2 custom item insert", true, `REPRODUCED: SQLSTATE=${e.code} constraint=${e.constraint} table=${e.table} :: ${e.message}`);
    globalThis.reproduced = { code: e.code, constraint: e.constraint, table: e.table, message: e.message };
  }

  // R3: update quantity of standard row
  try {
    const u = await c.query(
      `UPDATE public.cart_items SET quantity = 3, updated_at = now() WHERE user_id=$1 AND client_ref='zv24-r1' RETURNING quantity`,
      [USER_ID]
    );
    t("R3 quantity update", u.rowCount === 1 && u.rows[0].quantity === 3);
  } catch (e) { t("R3 quantity update", false, e.message); }

  // R4: duplicate client_ref (race path → 23505)
  try {
    await c.query(
      `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
       VALUES ($1, 'zv24-r1', $2, 1, NULL, NULL, NULL, now())`,
      [USER_ID, productId]
    );
    t("R4 duplicate client_ref", false, "expected 23505, got insert OK");
  } catch (e) {
    t("R4 duplicate client_ref → 23505", e.code === "23505", `SQLSTATE=${e.code}`);
  }

  // R5: delete row
  try {
    const d = await c.query(`DELETE FROM public.cart_items WHERE user_id=$1 AND client_ref='zv24-r1' RETURNING 1`, [USER_ID]);
    t("R5 delete row", d.rowCount === 1);
  } catch (e) { t("R5 delete row", false, e.message); }

  // R6: custom row WITH metadata?'custom' AND custom_config (would satisfy both) — proves exclusivity
  try {
    await c.query(
      `INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, metadata, notes, updated_at)
       VALUES ($1, 'zv24-r6', NULL, 1, NULL, '{"weight":"1kg"}'::jsonb, '{"custom":true}'::jsonb, NULL, now())`,
      [USER_ID]
    );
    t("R6 custom row satisfying BOTH checks", true, "only possible if metadata also written — app never does this");
    await c.query(`DELETE FROM public.cart_items WHERE user_id=$1 AND client_ref='zv24-r6'`, [USER_ID]);
  } catch (e) { t("R6 custom row satisfying BOTH checks", false, `${e.code} ${e.message}`); }

  // Cleanup synthetic rows (keep DB for further stages; final drop happens at the end of Z-v24)
  await c.query(`DELETE FROM public.cart_items WHERE user_id=$1`, [USER_ID]);
  await c.query(`DELETE FROM public.products WHERE id=$1`, [productId]);
  await c.query(`DELETE FROM public.profiles WHERE id=$1`, [USER_ID]);
  await c.query(`DELETE FROM auth.users WHERE id=$1`, [USER_ID]);

  console.log("\nREPRODUCED:", globalThis.reproduced ? JSON.stringify(globalThis.reproduced) : "no");
  await c.end();
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
