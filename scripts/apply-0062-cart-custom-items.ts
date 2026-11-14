/**
 * apply-0062-cart-custom-items.ts — одноразовое применение миграции 0062
 * (паттерн scripts/ops-apply-money-path.ts: файл = одна транзакция, маркеры,
 * ledger public.schema_migrations).
 *
 * Запуск: DATABASE_URL=postgresql://postgres@127.0.0.1:54329/conditera bun scripts/apply-0062-cart-custom-items.ts
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:54329/conditera";
const FILE = "0062_cart_custom_items.sql";

const MARKERS: Array<[string, string]> = [
  ["col cart_items.metadata", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cart_items' AND column_name='metadata'"],
  ["product_id nullable", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cart_items' AND column_name='product_id' AND is_nullable='YES'"],
  ["check cart_items_product_or_custom_check", "SELECT 1 FROM pg_constraint WHERE conname='cart_items_product_or_custom_check' AND conrelid='public.cart_items'::regclass"],
];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const already = await client.query(
    `SELECT 1 FROM public.schema_migrations WHERE filename = $1`,
    [FILE]
  );
  if (already.rowCount && already.rowCount > 0) {
    console.log(`[0062] ${FILE} уже в ledger — пропускаем применение (проверяем маркеры)`);
  } else {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
      await client.query(
        `INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
        [FILE]
      );
      console.log(`[0062] ${FILE}: применена, ledger обновлён`);
    } catch (err: any) {
      await client.query("ROLLBACK");
      console.error(`[0062] apply failed: ${err.message}`);
      process.exitCode = 1;
      await client.end();
      return;
    }
  }

  // Маркеры (проверка результата)
  let ok = true;
  for (const [label, q] of MARKERS) {
    const res = await client.query(q);
    const found = (res.rowCount ?? 0) > 0;
    console.log(`  ${found ? "✓" : "✗"} ${label}`);
    if (!found) ok = false;
  }
  const ledgerCount = await client.query(
    `SELECT count(*)::int AS c FROM public.schema_migrations`
  );
  console.log(`  ledger files: ${ledgerCount.rows[0].c}`);
  await client.end();
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
