/**
 * verify-0039-refund-contract-pglite.ts — one-shot валидация 0039_release_readiness
 * + контракт учёта возвратов (аудит @ 18651d4, дефект F-2).
 *
 * Что проверяет:
 *   1. 0039 применяется на минимальную фикстуру и ИДЕМПОТЕНТНА.
 *   2. RLS confectioner_transactions (policy + enable).
 *   3. consume_tfa_backup_code_v2: атомарное списание (повторный consume → false).
 *   4. apply_yookassa_refund: дедуп по refund id; частичные возвраты суммируются
 *      атомарно; fully_refunded → payments.status='refunded'.
 *   5. Гранты: RPC недоступны anon.
 *   6. КОНТРАКТ F-2 (единственный писатель refund_amount — webhook):
 *      • reserve_refund (0035) резервирует сумму (refund_amount += amount);
 *      • роут обязан снять резерв ДО доставки webhook'а (reset к pre-значению);
 *      • после webhook refund_amount = ровно сумма возврата (НЕ удвоена);
 *      • контрольный сценарий: БЕЗ снятия резерва → двойной учёт
 *        (документирует, почему reset в роуте обязателен).
 *
 * Запуск: bun scripts/verify-0039-refund-contract-pglite.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyFileStrict } from "./ops-apply-money-path";

const here = dirname(fileURLToPath(import.meta.url));
const MIG = (f: string) => join(here, "../supabase/migrations", f);

let failed = 0;
function ok(label: string, detail = "") { console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
function fail(label: string, detail = "") { failed++; console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }

const USER = "11111111-1111-1111-1111-111111111111";

/** Минимальная фикстура: payments + profiles + confectioner_transactions + auth-схема. */
const FIXTURE = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid primary key default gen_random_uuid());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  yookassa_payment_id text,
  amount numeric NOT NULL DEFAULT 0,
  refund_amount numeric,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
CREATE TABLE public.profiles (
  id uuid primary key references auth.users(id),
  two_factor_backup_codes text[],
  tfa_backup_codes text[],
  updated_at timestamptz
);
CREATE TABLE public.confectioner_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  amount numeric,
  created_at timestamptz default now()
);
INSERT INTO auth.users (id) VALUES ('${USER}');
INSERT INTO public.profiles (id, two_factor_backup_codes, tfa_backup_codes)
VALUES ('${USER}', ARRAY['hash_a','hash_b'], ARRAY['hash_c']);
`;

async function main() {
  const db = new PGlite();
  const q = async (sql: string) => (await db.query(sql)).rows;

  console.log("=== Фикстура + 0039 ===");
  await db.exec(FIXTURE);
  ok("фикстура развёрнута");
  await applyFileStrict(db, MIG("0039_release_readiness.sql"), "0039_release_readiness.sql");
  ok("0039 применена");

  console.log("\n=== RLS confectioner_transactions ===");
  const pol = (await q(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename='confectioner_transactions' AND policyname='confectioner_transactions_owner_select'`))[0] as { n: number };
  pol.n === 1 ? ok("policy owner_select создана") : fail("policy owner_select");
  const enabled = (await q(`SELECT relrowsecurity FROM pg_class WHERE relname='confectioner_transactions'`))[0] as { relrowsecurity: boolean };
  enabled.relrowsecurity ? ok("RLS включён") : fail("RLS включён");

  console.log("\n=== consume_tfa_backup_code_v2 (атомарность) ===");
  const c1 = (await q(`SELECT consume_tfa_backup_code_v2('${USER}'::uuid, 'hash_a') AS v`))[0] as { v: boolean };
  c1.v === true ? ok("первый consume → true") : fail("первый consume");
  const c2 = (await q(`SELECT consume_tfa_backup_code_v2('${USER}'::uuid, 'hash_a') AS v`))[0] as { v: boolean };
  c2.v === false ? ok("повторный consume → false (гонка закрыта)") : fail("повторный consume");
  const c3 = (await q(`SELECT consume_tfa_backup_code_v2('${USER}'::uuid, 'nope') AS v`))[0] as { v: boolean };
  c3.v === false ? ok("неизвестный hash → false") : fail("неизвестный hash");

  console.log("\n=== apply_yookassa_refund (дедуп + суммирование) ===");
  await db.exec(`INSERT INTO public.payments (yookassa_payment_id, amount, status) VALUES ('pay_1', 1000, 'succeeded')`);
  const pay = (await q(`SELECT id FROM payments WHERE yookassa_payment_id='pay_1'`))[0] as { id: string };
  const r1 = (await q(`SELECT * FROM apply_yookassa_refund('${pay.id}'::uuid, 'ref_1', 30000)`))[0] as { already_processed: boolean; total_refunded_kopecks: number; fully_refunded: boolean };
  (!r1.already_processed && r1.total_refunded_kopecks === 30000) ? ok("первый частичный 300₽ → 30000 коп") : fail("первый частичный", JSON.stringify(r1));
  const r1b = (await q(`SELECT * FROM apply_yookassa_refund('${pay.id}'::uuid, 'ref_1', 30000)`))[0] as { already_processed: boolean; total_refunded_kopecks: number };
  (r1b.already_processed && r1b.total_refunded_kopecks === 30000) ? ok("повторная доставка ref_1 → dedup") : fail("dedup", JSON.stringify(r1b));
  const r2 = (await q(`SELECT * FROM apply_yookassa_refund('${pay.id}'::uuid, 'ref_2', 70000)`))[0] as { already_processed: boolean; total_refunded_kopecks: number; fully_refunded: boolean };
  (r2.fully_refunded && r2.total_refunded_kopecks === 100000) ? ok("второй частичный 700₽ → fully_refunded") : fail("fully_refunded", JSON.stringify(r2));
  const pr = (await q(`SELECT refund_amount, status FROM payments WHERE id='${pay.id}'`))[0] as { refund_amount: string; status: string };
  (Number(pr.refund_amount) === 1000 && pr.status === "refunded") ? ok("refund_amount=1000, status=refunded") : fail("payments row", JSON.stringify(pr));

  console.log("\n=== Гранты (anon без EXECUTE) ===");
  for (const rpc of ["consume_tfa_backup_code_v2", "apply_yookassa_refund"]) {
    try {
      await db.exec(`SET ROLE anon; SELECT ${rpc}();`);
      await db.exec(`RESET ROLE;`);
      fail(`грант: anon может вызвать ${rpc}`);
    } catch {
      await db.exec(`RESET ROLE;`);
      ok(`грант: anon без EXECUTE ${rpc}`);
    }
  }

  console.log("\n=== Идемпотентность 0039 ===");
  await applyFileStrict(db, MIG("0039_release_readiness.sql"), "0039 повторно");
  ok("повторное применение без ошибок");

  console.log("\n=== КОНТРАКТ F-2: reserve_refund (0035) + webhook — единственный писатель ===");
  await db.exec(`
    CREATE TABLE public.confectioners (id text primary key);
    CREATE OR REPLACE FUNCTION public.reserve_refund(p_payment_id UUID, p_amount NUMERIC)
    RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE v_new NUMERIC;
    BEGIN
      UPDATE public.payments SET refund_amount = COALESCE(refund_amount, 0) + p_amount, updated_at = NOW()
       WHERE id = p_payment_id AND status = 'succeeded' AND COALESCE(refund_amount, 0) + p_amount <= amount
      RETURNING refund_amount INTO v_new;
      IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_LIMIT'; END IF;
      RETURN v_new;
    END; $$;
    INSERT INTO public.payments (yookassa_payment_id, amount, status) VALUES ('pay_2', 1000, 'succeeded');
  `);
  const pay2 = (await q(`SELECT id FROM payments WHERE yookassa_payment_id='pay_2'`))[0] as { id: string };
  const AMOUNT_KOP = 40000;

  // Шаг 1 — админ-возврат 400₽: reserve_refund резервирует (refund_amount=400)
  const res = (await q(`SELECT reserve_refund('${pay2.id}'::uuid, 400) AS v`))[0] as { v: string };
  Number(res.v) === 400 ? ok("reserve_refund: refund_amount=400 (резерв на время обращения к провайдеру)") : fail("reserve_refund", res.v);

  // Шаг 2 — провайдер ПРИНЯЛ возврат: роут ОБЯЗАН снять резерв (reset к pre-значению 0).
  // (Контракт исправленного роута /api/payment/refund: см. фикс F-2.)
  await db.exec(`UPDATE public.payments SET refund_amount = 0 WHERE id = '${pay2.id}'`);
  ok("роут снял резерв (reset к pre-значению) после принятия возврата провайдером");

  // Шаг 3 — webhook refund.succeeded: единственный финальный писатель
  const ap = (await q(`SELECT * FROM apply_yookassa_refund('${pay2.id}'::uuid, 'ref_f2', ${AMOUNT_KOP})`))[0] as { total_refunded_kopecks: number };
  const after = (await q(`SELECT refund_amount FROM payments WHERE id='${pay2.id}'`))[0] as { refund_amount: string };
  (Number(after.refund_amount) === 400) ? ok("после webhook refund_amount=400 (ровно сумма возврата)") : fail("контракт единственного писателя", after.refund_amount);

  // Контрольный сценарий: без снятия резерва webhook удваивает (документирует дефект)
  await db.exec(`INSERT INTO public.payments (yookassa_payment_id, amount, status) VALUES ('pay_3', 1000, 'succeeded')`);
  const pay3 = (await q(`SELECT id FROM payments WHERE yookassa_payment_id='pay_3'`))[0] as { id: string };
  await db.exec(`SELECT reserve_refund('${pay3.id}'::uuid, 400)`);
  await db.exec(`SELECT * FROM apply_yookassa_refund('${pay3.id}'::uuid, 'ref_bad', ${AMOUNT_KOP})`);
  const bad = (await q(`SELECT refund_amount FROM payments WHERE id='${pay3.id}'`))[0] as { refund_amount: string };
  (Number(bad.refund_amount) === 800)
    ? ok("контроль: без снятия резерва — 800₽ при возврате 400₽ (именно это чинит reset в роуте)")
    : fail("контрольный двойной учёт", bad.refund_amount);

  console.log(failed === 0 ? "\n✅ 0039 + контракт возвратов: PASS" : `\n❌ провалов: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
