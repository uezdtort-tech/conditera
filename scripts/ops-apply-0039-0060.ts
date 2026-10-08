/**
 * ops-apply-0039-0060.ts — продолжение канонического apply-окна 0034–0037
 * до полного P0-окна 0039→0060 (пропуски 0038/0056 — НОРМА, не заполнять).
 *
 * Реюз: applyFileStrict из scripts/ops-apply-money-path.ts (тот же строгий
 * порядок: файл = одна транзакция, падение = ROLLBACK файла, повтор безопасен).
 * После COMMIT каждого файла — маркеры (ключевые объекты) как в checkMarkers.
 *
 * ЗАПРЕЩЕНО: перенумерация, заполнение пропусков, "починка" ledger.
 *
 * Запуск на сервере (после backup!):
 *   DATABASE_URL=postgresql://... npx tsx scripts/ops-apply-0039-0060.ts
 *
 * Exit codes: 0 — окно применено, маркеры на месте; 1 — прервано (разбирать лог).
 */
import { Client } from "pg";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyFileStrict } from "./ops-apply-money-path";

const here = dirname(fileURLToPath(import.meta.url));

/** Порядок ЖЁСТКО зафиксирован файловой нумерацией. 0038 и 0056 не существуют. */
const FILES: Array<{ file: string; markers: Array<[string, string]> }> = [
  { file: "0039_release_readiness.sql", markers: [
    ["table yookassa_refund_events", "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='yookassa_refund_events'"],
    ["fn apply_yookassa_refund", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='apply_yookassa_refund'"],
  ]},
  { file: "0040_local_runtime.sql", markers: [
    ["col orders.delivery_time", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='delivery_time'"],
    ["col orders.payment_method", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payment_method'"],
  ]},
  { file: "0041_refund_idempotency.sql", markers: [
    ["col refunds.idempotency_key", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='refunds' AND column_name='idempotency_key'"],
    ["idx uq_refunds_user_idempotency", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_refunds_user_idempotency'"],
  ]},
  { file: "0042_profile_notify_prefs.sql", markers: [
    ["idx idx_profiles_notify_prefs", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_profiles_notify_prefs'"],
  ]},
  { file: "0043_additive_schema_alignment.sql", markers: [
    ["col fillings.category", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fillings' AND column_name='category'"],
  ]},
  { file: "0044_user_challenges_claim.sql", markers: [
    ["idx idx_user_challenges_open", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_user_challenges_open'"],
  ]},
  { file: "0045_fix_bonus_balance_rpc_uuid_text.sql", markers: [
    ["fn add_bonus_balance", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='add_bonus_balance'"],
    ["fn deduct_bonus_balance", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='deduct_bonus_balance'"],
  ]},
  { file: "0046_inventory_movements.sql", markers: [
    ["table inventory_movements", "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='inventory_movements'"],
  ]},
  { file: "0047_chat_support_indexes.sql", markers: [
    ["idx idx_channels_support_ticket", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_channels_support_ticket'"],
  ]},
  { file: "0048_inventory_atomic_movement.sql", markers: [
    ["fn apply_inventory_movement_atomic", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='apply_inventory_movement_atomic'"],
  ]},
  { file: "0049_inventory_write_off_idempotency.sql", markers: [
    ["table inventory_write_offs", "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='inventory_write_offs'"],
  ]},
  { file: "0050_hot_path_indexes.sql", markers: [
    ["idx idx_loyalty_tx_order_type", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_loyalty_tx_order_type'"],
  ]},
  { file: "0051_hot_query_indexes.sql", markers: [
    ["idx idx_products_status_reviews", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_products_status_reviews'"],
  ]},
  { file: "0052_product_card_media.sql", markers: [
    ["table product_media", "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='product_media'"],
    ["fn fn_product_media_limit", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_product_media_limit'"],
  ]},
  { file: "0053_ops_center.sql", markers: [
    ["table domain_events", "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='domain_events'"],
  ]},
  { file: "0054_order_lifecycle_capacity.sql", markers: [
    ["table confectioner_capacity", "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='confectioner_capacity'"],
    ["table capacity_reservations", "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='capacity_reservations'"],
    ["excl excl_capacity_reservations_overlap", "SELECT 1 FROM pg_constraint WHERE conname='excl_capacity_reservations_overlap'"],
  ]},
  { file: "0055_business_scale.sql", markers: [
    ["col confectioners.business_scale", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='confectioners' AND column_name='business_scale'"],
  ]},
  { file: "0057_order_reviews.sql", markers: [
    ["idx idx_reviews_order", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_reviews_order'"],
  ]},
  { file: "0058_chat_channels_order_unique.sql", markers: [
    ["idx uq_chat_channels_order_id", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_chat_channels_order_id'"],
  ]},
  { file: "0059_notification_prefs_columns.sql", markers: [
    ["col notification_preferences.payment_updates", "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_preferences' AND column_name='payment_updates'"],
  ]},
  { file: "0060_p11_hardening_integrity.sql", markers: [
    ["idx uq_orders_idempotency", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_orders_idempotency'"],
    ["idx uq_domain_events_dedup", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_domain_events_dedup'"],
    ["idx uq_product_reviews_order", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_product_reviews_order'"],
    ["idx uq_fillings_name", "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_fillings_name'"],
  ]},
];

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let aborted = false;
const okLabel = (l: string, d = "") => console.log(`  ✓ ${l}${d ? ` — ${d}` : ""}`);
const failLabel = (l: string, d = "") => { aborted = true; console.log(`  ✗ FAIL ${l}${d ? ` — ${d}` : ""}`); };

async function checkFileMarkers(db: Client, file: string, markers: Array<[string, string]>): Promise<void> {
  for (const [label, sql] of markers) {
    const r = await db.query(sql);
    if ((r.rowCount ?? 0) > 0) okLabel(`маркер ${file.slice(0, 4)}: ${label}`);
    else failLabel(`маркер ${file.slice(0, 4)}: ${label} НЕ найден`);
  }
}

async function main(): Promise<void> {
  console.log(`ops-apply-0039-0060 → ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    let total = 0;
    for (const { file, markers } of FILES) {
      const n = await applyFileStrict(db, join(here, "../supabase/migrations", file), file);
      total += n;
      await checkFileMarkers(db, file, markers);
      if (aborted) break;
    }
    if (aborted) {
      console.log("\n❌ Прогон остановлен на маркере — НЕ деплоить money/payout-код до разбора.");
      process.exit(1);
    }
    console.log(`\n✅ ${FILES.length} миграций (0039→0060) применены (${total} statements), все маркеры на месте.`);
    console.log("Следующий шаг (DoD): DATABASE_URL=... npx tsx scripts/verify-money-path.ts");
    process.exit(0);
  } catch (e: any) {
    console.error(`\n❌ ОПЕРАЦИЯ ПРЕРВАНА: ${e.message}`);
    console.error("БД в консистентном состоянии (последний файл откачен целиком). Повтор безопасен.");
    process.exit(1);
  } finally {
    await db.end();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
