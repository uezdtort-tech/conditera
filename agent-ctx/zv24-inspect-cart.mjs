// Z-v24 temporary inspection script (disposable) — read-only catalog queries
const { Client } = require("pg");

const DB = process.argv[2] || "postgresql://postgres@127.0.0.1:54329/conditera_zv24_cart_clean_zv24a";

async function main() {
  const c = new Client({ connectionString: DB });
  await c.connect();

  console.log("=== CHECK constraints on cart_items ===");
  const ck = await c.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'public.cart_items'::regclass AND contype = 'c' ORDER BY conname`
  );
  for (const r of ck.rows) console.log("-", r.conname, ":", r.def);

  console.log("=== FK / other constraints ===");
  const fk = await c.query(
    `SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'public.cart_items'::regclass AND contype <> 'c' ORDER BY conname`
  );
  for (const r of fk.rows) console.log("-", r.conname, `(${r.contype})`, ":", r.def);

  console.log("=== columns ===");
  const cols = await c.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='cart_items' ORDER BY ordinal_position`
  );
  for (const r of cols.rows) console.log("-", r.column_name, r.data_type, "nullable=" + r.is_nullable);

  console.log("=== indexes ===");
  const ix = await c.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='cart_items' ORDER BY 1`
  );
  for (const r of ix.rows) console.log("-", r.indexname);

  console.log("=== triggers on cart_items ===");
  const tg = await c.query(
    `SELECT tgname FROM pg_trigger WHERE tgrelid='public.cart_items'::regclass AND NOT tgisinternal ORDER BY 1`
  );
  for (const r of tg.rows) console.log("-", r.tgname);
  if (tg.rows.length === 0) console.log("(none)");

  console.log("=== 0062 ledger entries ===");
  const lg = await c.query(
    `SELECT filename, applied_at FROM schema_migrations WHERE filename LIKE '0062%' ORDER BY filename`
  );
  for (const r of lg.rows) console.log("-", r.filename, r.applied_at.toISOString());

  console.log("=== any later migration referencing metadata/custom_config on cart_items ===");
  const mm = await c.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='cart_items' AND column_name IN ('metadata','custom_config','client_ref')`
  );
  console.log(mm.rows.map((r) => r.column_name).join(", ") || "(none)");

  await c.end();
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
