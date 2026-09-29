/**
 * verify-ops-0034-0037-pglite.ts — смок ОПС-ранбука на PGlite (в памяти):
 * минимальная фикстура pre-0034 → применяем 0034→0035→0036→0037 СТРОГО в
 * порядке, тем же applyFileStrict, что и на живой БД → маркеры → повторный
 * полный прогон (идемпотентность: ноль ошибок).
 *
 * Запуск: bun scripts/verify-ops-0034-0037-pglite.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyFileStrict, checkMarkers, splitSqlStatements } from "./ops-apply-money-path";

const here = dirname(fileURLToPath(import.meta.url));
const MIG = (f: string) => join(here, "../supabase/migrations", f);

let failed = 0;
function ok(label: string, detail = "") { console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
function fail(label: string, detail = "") { failed++; console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }

/** Минимальный пререквизит: состояние live-БД ДО 0034 (по аудиту: колонок
 *  payment_status и пр. нет; есть базовые таблицы 0002/0009/0017 + enum). */
const FIXTURE = `
CREATE TYPE payment_status AS ENUM ('pending','waiting_for_capture','succeeded','escrow','released','cancelled','refunded');
CREATE TABLE public.confectioners (
  id TEXT PRIMARY KEY,
  "userId" TEXT,
  "businessName" TEXT,
  balance INTEGER,
  "totalEarnings" INTEGER
);
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT,
  confectioner_id TEXT,
  status TEXT,
  total NUMERIC DEFAULT 0,
  subtotal NUMERIC DEFAULT 0,
  delivery_cost NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
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
CREATE TABLE public.refunds (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC NOT NULL DEFAULT 0);
CREATE TABLE public.payouts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC NOT NULL DEFAULT 0, fee_amount NUMERIC DEFAULT 0, net_amount NUMERIC DEFAULT 0);
CREATE TABLE public.order_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID, unit_price NUMERIC DEFAULT 0, total NUMERIC DEFAULT 0);
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
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tfa_backup_codes TEXT[],
  updated_at TIMESTAMPTZ
);
CREATE TABLE public.user_roles (
  user_id UUID,
  role TEXT,
  is_active BOOLEAN DEFAULT true
);
-- deduct_conference_balance — с 0013 (уже на живой БД до окна 0034–0037;
-- тело 1:1 из 0013, включая FOR UPDATE и insufficient-check)
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
    RAISE EXCEPTION 'insufficient balance: has %, needs %', v_current, p_amount;
  END IF;
  UPDATE public.confectioners
     SET balance = v_current - p_amount
   WHERE id = p_confectioner_id
  RETURNING balance INTO v_new_balance;
  RETURN v_new_balance;
END
$fix$;
`;

async function runSequence(db: PGlite, label: string): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const files = [
    "0034_money_path_identity.sql",
    "0035_payment_integrity.sql",
    "0036_payout_integrity.sql",
    "0037_payout_linkage.sql",
  ];
  for (const f of files) {
    try {
      await applyFileStrict(db, MIG(f), f);
      await checkMarkers(db, f);
      if (failed > 0) fail(`маркеры после ${f} — см. выше`);
    } catch (e: any) {
      fail(`${f}: ${(e.message || e).slice(0, 200)}`);
      return;
    }
  }
}

async function main(): Promise<void> {
  const db = new PGlite();
  console.log("PGlite in-memory → фикстура pre-0034 → ОПС-последовательность 0034→0037\n");

  await db.exec(`
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    -- схема auth живого Supabase (RLS-политики 0036 используют auth.uid())
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;
  `);
  await db.exec(FIXTURE);
  ok("фикстура pre-0034 развёрнута");

  // 1. Полный прогон ранбука
  await runSequence(db, "Прогон 1: применение 0034→0035→0036→0037");
  if (failed === 0) ok("последовательность применена, все маркеры");

  // 2. Семантическая проба: RPC работают на конечной схеме
  try {
    await db.exec(`INSERT INTO public.confectioners (id, balance) VALUES ('conf_smoke', 1000)`);
    const r = await db.query(`SELECT public.deduct_confectioner_balance('conf_smoke', 300) as nb`);
    if (Number(r.rows[0]?.nb) === 700) ok("deduct_confectioner_balance: 1000−300=700");
    else fail(`deduct вернул ${r.rows[0]?.nb}, ожидалось 700`);
    const a = await db.query(`SELECT public.add_confectioner_balance('conf_smoke', 50) as nb`);
    if (Number(a.rows[0]?.nb) === 750) ok("add_confectioner_balance: 700+50=750");
    else fail(`add вернул ${a.rows[0]?.nb}, ожидалось 750`);
    const rel = await db.query(
      `INSERT INTO public.orders (confectioner_id, payment_status) VALUES ('conf_smoke', 'escrow') RETURNING id`
    );
    const oid = rel.rows[0].id;
    const esc = await db.query(`SELECT public.release_escrow_order('${oid}', 'conf_smoke', 100) as r`);
    if (Number(esc.rows[0]?.r) === 1) ok("release_escrow_order: claim+начисление → 1 (баланс 850)");
    else fail(`release вернул ${esc.rows[0]?.r}`);
    const bal = await db.query(`SELECT balance FROM public.confectioners WHERE id='conf_smoke'`);
    if (Number(bal.rows[0]?.balance) === 850) ok("итоговый баланс 850 ✓");
    else fail(`баланс ${bal.rows[0]?.balance}, ожидалось 850`);
    const again = await db.query(`SELECT public.release_escrow_order('${oid}', 'conf_smoke', 100) as r`);
    if (Number(again.rows[0]?.r) === 0) ok("повторный release → 0 (CAS, без двойного начисления)");
    else fail(`повторный release вернул ${again.rows[0]?.r}, ожидался 0`);
  } catch (e: any) {
    fail(`семантическая проба: ${(e.message || e).slice(0, 200)}`);
  }

  // 3. Идемпотентность: второй полный прогон — ноль ошибок
  const before = failed;
  await runSequence(db, "Прогон 2 (идемпотентность): повтор 0034→0037");
  if (failed === before) ok("повторный прогон без ошибок (идемпотентность подтверждена)");
  else fail("повторный прогон дал новые ошибки");

  // 4. Сплиттер: вложенные dollar-quotes не ломаются (0037 DO-блоки)
  const s = splitSqlStatements("DO $a$ BEGIN PERFORM 1; -- $b$ не конец\n END $a$; SELECT 1;");
  if (s.length === 2) ok("сплиттер: вложенные $-теги и комментарии внутри DO — корректно");
  else fail(`сплиттер дал ${s.length} statements, ожидалось 2`);

  console.log(failed === 0 ? "\n✅ ОПС-ранбук смок-проверен: последовательность, маркеры, RPC, идемпотентность" : `\n❌ ПРОВАЛОВ: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
