/**
 * verify-ops-full-window-pglite.ts — ПОЛНОЕ P0-окно 0034→0060 на PGlite.
 *
 * Цель: снять риск «STOP посреди apply на живой БД» — доказать, что вся
 * последовательность файлов применяется чисто (каждый файл = транзакция,
 * applyFileStrict из канонического движка), маркеры на месте, повторный
 * полный прогон идемпотентен, ключевые RPC работают.
 *
 * Фикстура = минимальное состояние live-БД ДО 0034 (по аудиту) + таблицы,
 * на которые опираются 0040–0060 (profiles.notify_prefs, inventory_items,
 * chat_*, notifications, video_feed_items, service_products, recipes и пр.).
 *
 * ВАЖНО: это schema/regression-тест, НЕ доказательство состояния production.
 * Живая БД проверяется scripts/verify-money-path.ts + scripts/verify/*.
 *
 * Запуск: bun scripts/verify-ops-full-window-pglite.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyFileStrict } from "./ops-apply-money-path";

const here = dirname(fileURLToPath(import.meta.url));
const MIG = (f: string) => join(here, "../supabase/migrations", f);

let failed = 0;
function ok(label: string, detail = "") { console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
function fail(label: string, detail = "") { failed++; console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }

/** Полное окно в файловой нумерации. 0038/0056 не существуют — не заполнять. */
const WINDOW = [
  "0034_money_path_identity.sql",
  "0035_payment_integrity.sql",
  "0036_payout_integrity.sql",
  "0037_payout_linkage.sql",
  "0039_release_readiness.sql",
  "0040_local_runtime.sql",
  "0041_refund_idempotency.sql",
  "0042_profile_notify_prefs.sql",
  "0043_additive_schema_alignment.sql",
  "0044_user_challenges_claim.sql",
  "0045_fix_bonus_balance_rpc_uuid_text.sql",
  "0046_inventory_movements.sql",
  "0047_chat_support_indexes.sql",
  "0048_inventory_atomic_movement.sql",
  "0049_inventory_write_off_idempotency.sql",
  "0050_hot_path_indexes.sql",
  "0051_hot_query_indexes.sql",
  "0052_product_card_media.sql",
  "0053_ops_center.sql",
  "0054_order_lifecycle_capacity.sql",
  "0055_business_scale.sql",
  "0057_order_reviews.sql",
  "0058_chat_channels_order_unique.sql",
  "0059_notification_prefs_columns.sql",
  "0060_p11_hardening_integrity.sql",
];

/** Минимальный пререквизит pre-0034 + зависимости 0040–0060 (только колонки,
 *  на которые migrations ссылаются; всё остальное — ADD COLUMN IF NOT EXISTS). */
const FIXTURE = `
-- Расширения живого Supabase: uuid-ossp и pgcrypto предустановлены,
-- btree_gist доступен (trusted) — нужен 0054 для EXCLUDE-констрейнта.
-- ВНИМАНИЕ: имя "uuid-ossp" — с дефисом, как в стандартном Postgres.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- Роли Supabase (м granting 0034–0060 ссылаются на anon/authenticated/service_role)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY);
-- auth.uid() — ядро Supabase (стаб-извлечение claim из current_setting)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE
AS $au$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $au$;
CREATE TYPE payment_status AS ENUM ('pending','waiting_for_capture','succeeded','escrow','released','cancelled','refunded');
CREATE TABLE public.confectioners (
  id TEXT PRIMARY KEY,
  "userId" TEXT,
  "businessName" TEXT,
  balance INTEGER,
  "totalEarnings" INTEGER
);
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confectioner_id UUID,
  status TEXT DEFAULT 'published',
  reviews_count INTEGER DEFAULT 0,
  price INTEGER DEFAULT 0,
  weight_grams INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.recipes (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT,
  confectioner_id TEXT,
  user_id UUID,
  status TEXT,
  total NUMERIC DEFAULT 0,
  subtotal NUMERIC DEFAULT 0,
  delivery_cost NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID,
  yookassa_payment_id TEXT,
  status TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  refund_amount NUMERIC
);
CREATE TABLE public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID,
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT,
  initiated_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  reserve_amount NUMERIC
);
CREATE TABLE public.payouts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC NOT NULL DEFAULT 0, fee_amount NUMERIC DEFAULT 0, net_amount NUMERIC DEFAULT 0);
CREATE TABLE public.order_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID, product_id UUID, product_title TEXT, product_slug TEXT, unit_price NUMERIC DEFAULT 0, total NUMERIC DEFAULT 0);
CREATE TABLE public.reviews (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID, user_id UUID, rating INTEGER, comment TEXT, status TEXT DEFAULT 'published', is_approved BOOLEAN DEFAULT false, helpful_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.escrow_accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), held_amount NUMERIC DEFAULT 0);
CREATE TABLE public.payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  method TEXT,
  metadata JSONB,
  processed_by UUID
);
CREATE TABLE public.confectioner_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confectioner_id TEXT,
  user_id UUID,
  amount INTEGER DEFAULT 0,
  type TEXT,
  description TEXT,
  order_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tfa_backup_codes TEXT[],
  updated_at TIMESTAMPTZ,
  bonus_balance INTEGER DEFAULT 0,
  notify_prefs JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE public.user_roles (user_id UUID, role TEXT, is_active BOOLEAN DEFAULT true);
CREATE TABLE public.fillings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
CREATE TABLE public.chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT,
  last_message_at TIMESTAMPTZ,
  support_ticket_id UUID,
  order_id UUID,
  deleted_at TIMESTAMPTZ
);
-- Триггерная функция базовой схемы (до 0034) — 0052 вешает её на product_media
CREATE OR REPLACE FUNCTION public.handle_marketplace_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $tf$ BEGIN NEW.updated_at = now(); RETURN NEW; END $tf$;
CREATE TABLE public.chat_channel_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.chat_rooms (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.operator_escalations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.order_fraud_logs (id TEXT PRIMARY KEY, "ipHash" TEXT DEFAULT '', order_id UUID, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.chat_messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reply_to_id UUID, idempotency_key TEXT);
CREATE TABLE public.user_challenges (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID);
CREATE TABLE public.loyalty_transactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID, type TEXT);
CREATE TABLE public.lesson_enrollments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lesson_id UUID, user_id UUID);
CREATE TABLE public.product_reviews (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), helpful_count INTEGER DEFAULT 0, status TEXT DEFAULT 'approved', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, channel TEXT, metadata JSONB DEFAULT '{}'::jsonb);
CREATE TABLE public.notification_preferences (user_id UUID PRIMARY KEY);
CREATE TABLE public.video_feed_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "rating" NUMERIC DEFAULT 0, "createdAt" TIMESTAMPTZ DEFAULT now(), status TEXT DEFAULT 'active');
CREATE TABLE public.service_products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ DEFAULT now(), is_active BOOLEAN DEFAULT true);
CREATE TABLE public.inventory_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), quantity NUMERIC NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now());
-- Сиды для живых RPC-проверок (0045 bonus, 0048 inventory)
INSERT INTO public.profiles (id) VALUES (gen_random_uuid());
INSERT INTO public.inventory_items (id, quantity) VALUES (gen_random_uuid(), 0);
-- deduct_conference_balance — с 0013 (уже на живой БД до окна 0034–0037)
CREATE OR REPLACE FUNCTION public.deduct_confectioner_balance(
  p_confectioner_id TEXT,
  p_amount INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $fix$
DECLARE
  v_new_balance INTEGER;
  v_current INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'deduct amount must be positive';
  END IF;
  SELECT COALESCE(balance, 0) INTO v_current
    FROM public.confectioners
   WHERE id = p_confectioner_id
   FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'confectioner not found: %', p_confectioner_id;
  END IF;
  IF v_current < p_amount THEN
    RAISE EXCEPTION 'insufficient balance: has %, needs %', p_amount, p_amount;
  END IF;
  UPDATE public.confectioners
     SET balance = v_current - p_amount
   WHERE id = p_confectioner_id
  RETURNING balance INTO v_new_balance;
  RETURN v_new_balance;
END
$fix$;
`;

/** Финальные маркеры (подмножество ключевых объектов всего окна). */
const FINAL_MARKERS: Array<[string, string]> = [
  ["0034 orders.payment_status", "SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_status'"],
  ["0035 fn reserve_refund", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reserve_refund'"],
  ["0036 fn add_confectioner_balance", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='add_confectioner_balance'"],
  ["0037 fn release_escrow_order", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='release_escrow_order'"],
  ["0039 table yookassa_refund_events", "SELECT 1 FROM information_schema.tables WHERE table_name='yookassa_refund_events'"],
  ["0041 refunds.idempotency_key", "SELECT 1 FROM information_schema.columns WHERE table_name='refunds' AND column_name='idempotency_key'"],
  ["0046 table inventory_movements", "SELECT 1 FROM information_schema.tables WHERE table_name='inventory_movements'"],
  ["0048 fn apply_inventory_movement_atomic", "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='apply_inventory_movement_atomic'"],
  ["0052 table product_media", "SELECT 1 FROM information_schema.tables WHERE table_name='product_media'"],
  ["0053 table domain_events", "SELECT 1 FROM information_schema.tables WHERE table_name='domain_events'"],
  ["0054 table capacity_reservations", "SELECT 1 FROM information_schema.tables WHERE table_name='capacity_reservations'"],
  ["0055 confectioners.business_scale", "SELECT 1 FROM information_schema.columns WHERE table_name='confectioners' AND column_name='business_scale'"],
  ["0058 uq_chat_channels_order_id", "SELECT 1 FROM pg_indexes WHERE indexname='uq_chat_channels_order_id'"],
  ["0060 uq_orders_idempotency", "SELECT 1 FROM pg_indexes WHERE indexname='uq_orders_idempotency'"],
  ["0060 uq_domain_events_dedup", "SELECT 1 FROM pg_indexes WHERE indexname='uq_domain_events_dedup'"],
  ["0060 uq_product_reviews_order", "SELECT 1 FROM pg_indexes WHERE indexname='uq_product_reviews_order'"],
  ["0060 uq_notifications_dedup", "SELECT 1 FROM pg_indexes WHERE indexname='uq_notifications_dedup'"],
];

async function runWindow(db: PGlite, label: string): Promise<boolean> {
  console.log(`\n=== ${label} ===`);
  let clean = true;
  for (const f of WINDOW) {
    try {
      await applyFileStrict(db, MIG(f), f);
    } catch (e) {
      clean = false;
      fail(`${f}: ${(e as Error).message.slice(0, 220)}`);
    }
  }
  return clean;
}

async function main() {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto, btree_gist } });
  console.log("Полное P0-окно 0034→0060 на PGlite (in-memory)");

  await db.exec(FIXTURE);
  ok("фикстура pre-0034 (+зависимости 0040–0060) создана");

  const first = await runWindow(db, "ПРОГОН 1: строго 0034→0060");
  if (first) ok("первый прогон: все 25 файлов COMMIT");

  for (const [label, sql] of FINAL_MARKERS) {
    const r = await db.query(sql);
    if ((r.rowCount ?? 0) > 0) ok(`маркер: ${label}`);
    else fail(`маркер: ${label} НЕ найден`);
  }

  // Ключевые RPC живьём
  try {
    const prof = await db.query<{ id: string }>("SELECT id FROM public.profiles LIMIT 1");
    const pid = prof.rows[0].id;
    await db.query("SELECT public.add_bonus_balance($1::text, 150)", [pid]);
    await db.query("SELECT public.deduct_bonus_balance($1::text, 50)", [pid]);
    const bal = await db.query<{ bonus_balance: number }>("SELECT bonus_balance FROM public.profiles WHERE id=$1", [pid]);
    if (Number(bal.rows[0].bonus_balance) === 100) ok("RPC 0045: add 150 − deduct 50 = 100 bonus_balance");
    else fail(`RPC 0045: баланс ${bal.rows[0].bonus_balance}, ожидался 100`);
  } catch (e) {
    fail(`RPC 0045: ${(e as Error).message.slice(0, 160)}`);
  }

  try {
    const item = await db.query<{ id: string }>("SELECT id FROM public.inventory_items LIMIT 1");
    const iid = item.rows[0].id;
    const prof = await db.query<{ id: string }>("SELECT id FROM public.profiles LIMIT 1");
    // Сигнатура 0048: (p_item_id uuid, p_type text, p_quantity numeric, p_actor uuid, p_reason?, p_order_id?)
    const r1 = await db.query<{ ok: boolean; new_qty: number }>(
      "SELECT * FROM public.apply_inventory_movement_atomic($1::uuid, 'IN'::text, 50::numeric, $2::uuid, 'smoke'::text, NULL::uuid)", [iid, prof.rows[0].id]);
    if (Number(r1.rows[0].new_qty) === 50) ok("RPC 0048: IN 50 → qty=50");
    else fail(`RPC 0048 IN: ${JSON.stringify(r1.rows[0])}`);
    const r2 = await db.query<{ ok: boolean; new_qty: number }>(
      "SELECT * FROM public.apply_inventory_movement_atomic($1::uuid, 'OUT'::text, 20::numeric, $2::uuid, 'smoke'::text, NULL::uuid)", [iid, prof.rows[0].id]);
    if (Number(r2.rows[0].new_qty) === 30) ok("RPC 0048: OUT 20 → qty=30");
    else fail(`RPC 0048 OUT: ${JSON.stringify(r2.rows[0])}`);
    const r3 = await db.query<{ ok: boolean; error: string }>(
      "SELECT * FROM public.apply_inventory_movement_atomic($1::uuid, 'OUT'::text, 999::numeric, $2::uuid, 'smoke'::text, NULL::uuid)", [iid, prof.rows[0].id]);
    if (r3.rows[0].ok === false) ok("RPC 0048: OUT 999 корректно отклонён (insufficient)");
    else fail(`RPC 0048 OVER: ${JSON.stringify(r3.rows[0])}`);
  } catch (e) {
    fail(`RPC 0048: ${(e as Error).message.slice(0, 160)}`);
  }

  const second = await runWindow(db, "ПРОГОН 2 (идемпотентность): повтор всего окна");
  if (second) ok("повторный полный прогон без ошибок (идемпотентность подтверждена)");
  else fail("повторный прогон упал — в окне есть неидемпотентный statement");

  console.log(failed === 0
    ? "\n✅ ПОЛНОЕ ОКНО 0034→0060: apply, маркеры, RPC, идемпотентность — PASS"
    : `\n❌ ПОЛНОЕ ОКНО: провалено проверок — ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
