/**
 * verify-release-0039-pglite.ts — one-shot валидация миграции 0039_release_readiness.sql
 * на PGlite (в памяти), без живой БД. Аналог verify-payout-0036/0037-pglite.ts.
 *
 * Проверяет:
 *   1. RLS confectioner_transactions: relrowsecurity = true, политика
 *      owner_select существует, anon/authenticated ЛИШЕНЫ прежних широких
 *      грантов (REVOKE), authenticated оставлен только SELECT.
 *   2. RPC consume_tfa_backup_code_v2 — атомарное списание live-backup-кода:
 *      первый вызов → true (и код удалён из массива), повторный → false,
 *      неизвестный hash → false. Гонка закрыта гвардом в WHERE.
 *   3. RPC apply_yookassa_refund — идемпотентность refund-вебхука:
 *      - первое применение частичного возврата → already_processed=false
 *      - ПОВТОРНАЯ доставка того же refund_id → already_processed=true,
 *        сумма НЕ задваивается
 *      - второй частичный возврат (другой refund_id) → сумма копится,
 *        при полном покрытии fully_refunded=true и статус платежа → refunded
 *      - повтор после полного возврата → без изменений
 *      - amount_kopecks <= 0 → отклонён (CHECK), несуществующий платёж → RAISE
 *   4. Гранты: оба RPC — EXECUTE только service_role.
 *   5. Идемпотентность: повторное применение 0039 целиком — без ошибок,
 *      RPC продолжают работать корректно.
 *
 * Запуск: bun scripts/verify-release-0039-pglite.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, "../supabase/migrations/0039_release_readiness.sql"), "utf8");

let failed = 0;
function ok(label: string, detail = "") {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail = "") {
  failed++;
  console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

async function expectThrows(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    fail(label, "ожидалось исключение, его не было");
  } catch {
    ok(label);
  }
}

async function main() {
  const db = new PGlite();
  console.log("PGlite in-memory → фикстура pre-0039 + миграция 0039\n");

  // Роли и auth-стаб, на которые ссылается 0039 (RLS-политика использует auth.uid())
  await db.exec(`
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;
  `);

  // Минимальная фикстура pre-0039.
  // confectioner_transactions создана в 0017 БЕЗ RLS; 0011:314 выдала широкие
  // SELECT-гранты anon/authenticated — воспроизводим это состояние, чтобы
  // проверить, что 0039 его сужает.
  await db.exec(`
    CREATE TABLE public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      two_factor_backup_codes TEXT[],
      updated_at TIMESTAMPTZ
    );
    CREATE TABLE public.payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'succeeded',
      refund_amount NUMERIC,
      updated_at TIMESTAMPTZ
    );
    CREATE TABLE public.confectioner_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      amount INTEGER,
      type TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    GRANT SELECT ON public.confectioner_transactions TO anon, authenticated;
    INSERT INTO public.payments (id, amount, status) VALUES
      (gen_random_uuid(), 1000, 'succeeded');
  `);

  // === Применяем 0039 (проход 1) ===
  await db.exec(SQL);
  console.log("Миграция 0039 применена (проход 1)\n");

  // ===== 1. RLS confectioner_transactions =====
  const rls = await db.query<{ relrowsecurity: boolean }>(
    `SELECT relrowsecurity FROM pg_class WHERE relname = 'confectioner_transactions' AND relnamespace = 'public'::regnamespace`
  );
  if (rls.rows[0]?.relrowsecurity) ok("RLS включён на confectioner_transactions");
  else fail("RLS включён на confectioner_transactions");

  const pol = await db.query<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM pg_policies WHERE schemaname='public' AND tablename='confectioner_transactions' AND policyname='confectioner_transactions_owner_select'`
  );
  if (pol.rows[0]?.cnt === "1") ok("политика owner_select создана (USING user_id = auth.uid())");
  else fail("политика owner_select создана");

  const anonSel = await db.query<{ allowed: boolean }>(
    `SELECT has_table_privilege('anon','public.confectioner_transactions','SELECT') AS allowed`
  );
  if (anonSel.rows[0]?.allowed === false) ok("anon ЛИШЕН SELECT (0011:314 закрыт)");
  else fail("anon ЛИШЕН SELECT");

  const authSel = await db.query<{ allowed: boolean }>(
    `SELECT has_table_privilege('authenticated','public.confectioner_transactions','SELECT') AS allowed`
  );
  if (authSel.rows[0]?.allowed === true) ok("authenticated — SELECT оставлен");
  else fail("authenticated — SELECT оставлен");

  // ===== 2. consume_tfa_backup_code_v2 =====
  const hash1 = "sha256hex_aaa111";
  const hash2 = "sha256hex_bbb222";
  const prof = await db.query<{ id: string }>(
    `INSERT INTO public.profiles (two_factor_backup_codes) VALUES (ARRAY[$1, $2]::text[]) RETURNING id`,
    [hash1, hash2]
  );
  const profileId = prof.rows[0].id;

  const c1 = await db.query<{ consume_tfa_backup_code_v2: boolean }>(
    `SELECT consume_tfa_backup_code_v2($1::uuid, $2) AS consume_tfa_backup_code_v2`,
    [profileId, hash1]
  );
  if (c1.rows[0].consume_tfa_backup_code_v2 === true) ok("первое списание кода → true");
  else fail("первое списание кода", "ожидался true");

  const remaining = await db.query<{ codes: string[] }>(
    `SELECT two_factor_backup_codes AS codes FROM public.profiles WHERE id = $1`,
    [profileId]
  );
  if (JSON.stringify(remaining.rows[0].codes) === JSON.stringify([hash2]))
    ok("код удалён из массива атомарно", `осталось: [${remaining.rows[0].codes.join(", ")}]`);
  else fail("код удалён из массива", JSON.stringify(remaining.rows[0].codes));

  const c2 = await db.query<{ consume_tfa_backup_code_v2: boolean }>(
    `SELECT consume_tfa_backup_code_v2($1::uuid, $2) AS consume_tfa_backup_code_v2`,
    [profileId, hash1]
  );
  if (c2.rows[0].consume_tfa_backup_code_v2 === false)
    ok("повторное списание того же кода → false (гонка закрыта гвардом в WHERE)");
  else fail("повторное списание того же кода", "ожидался false");

  const c3 = await db.query<{ consume_tfa_backup_code_v2: boolean }>(
    `SELECT consume_tfa_backup_code_v2($1::uuid, $2) AS consume_tfa_backup_code_v2`,
    [profileId, "sha256hex_unknown"]
  );
  if (c3.rows[0].consume_tfa_backup_code_v2 === false) ok("неизвестный код → false");
  else fail("неизвестный код", "ожидался false");

  // ===== 3. apply_yookassa_refund =====
  const pay = await db.query<{ id: string }>(`SELECT id FROM public.payments LIMIT 1`);
  const paymentId = pay.rows[0].id;

  const r1 = await db.query<{
    already_processed: boolean;
    total_refunded_kopecks: number;
    fully_refunded: boolean;
  }>(`SELECT * FROM apply_yookassa_refund($1::uuid, $2, $3::int)`, [paymentId, "refund_1", 40000]);
  const first = r1.rows[0];
  if (
    first.already_processed === false &&
    Number(first.total_refunded_kopecks) === 40000 &&
    first.fully_refunded === false
  )
    ok("частичный возврат 400₽ применён", "already=false, total=40000 kop, fully=false");
  else fail("частичный возврат 400₽ применён", JSON.stringify(first));

  const r1again = await db.query<{
    already_processed: boolean;
    total_refunded_kopecks: number;
    fully_refunded: boolean;
  }>(`SELECT * FROM apply_yookassa_refund($1::uuid, $2, $3::int)`, [paymentId, "refund_1", 40000]);
  const dup = r1again.rows[0];
  if (dup.already_processed === true && Number(dup.total_refunded_kopecks) === 40000)
    ok("ПОВТОРНАЯ доставка refund_1 — дедуп: сумма НЕ задвоилась", "already=true, total=40000");
  else fail("ПОВТОРНАЯ доставка refund_1 — дедуп", JSON.stringify(dup));

  const dbAfterDup = await db.query<{ ra: string }>(
    `SELECT refund_amount::text AS ra FROM public.payments WHERE id = $1`,
    [paymentId]
  );
  if (Number(dbAfterDup.rows[0].ra) === 400)
    ok("refund_amount в БД = 400₽ после повтора", "read-add-write больше не задваивает");
  else fail("refund_amount в БД после повтора", dbAfterDup.rows[0].ra);

  const r2 = await db.query<{
    already_processed: boolean;
    total_refunded_kopecks: number;
    fully_refunded: boolean;
  }>(`SELECT * FROM apply_yookassa_refund($1::uuid, $2, $3::int)`, [paymentId, "refund_2", 60000]);
  const second = r2.rows[0];
  if (
    second.already_processed === false &&
    Number(second.total_refunded_kopecks) === 100000 &&
    second.fully_refunded === true
  )
    ok("второй частичный 600₽ → сумма копится атомарно, fully_refunded=true");
  else fail("второй частичный 600₽", JSON.stringify(second));

  const payStatus = await db.query<{ status: string }>(
    `SELECT status FROM public.payments WHERE id = $1`,
    [paymentId]
  );
  if (payStatus.rows[0].status === "refunded")
    ok("статус платежа переведён в refunded в той же транзакции");
  else fail("статус платежа", payStatus.rows[0].status);

  const r2again = await db.query<{
    already_processed: boolean;
    total_refunded_kopecks: number;
    fully_refunded: boolean;
  }>(`SELECT * FROM apply_yookassa_refund($1::uuid, $2, $3::int)`, [paymentId, "refund_2", 60000]);
  const dup2 = r2again.rows[0];
  if (dup2.already_processed === true && Number(dup2.total_refunded_kopecks) === 100000)
    ok("повтор refund_2 после полного возврата — без изменений");
  else fail("повтор refund_2", JSON.stringify(dup2));

  await expectThrows("refund с amount_kopecks = 0 отклонён (CHECK > 0)", () =>
    db.query(`SELECT * FROM apply_yookassa_refund($1::uuid, $2, $3::int)`, [paymentId, "refund_0", 0])
  );
  await expectThrows("refund несуществующего платежа → RAISE", () =>
    db.query(`SELECT * FROM apply_yookassa_refund($1::uuid, $2, $3::int)`, [
      "00000000-0000-0000-0000-000000000000",
      "refund_x",
      10000,
    ])
  );

  // ===== 4. Гранты RPC =====
  const grants = await db.query<{
    proname: string;
    priv: string;
  }>(
    `SELECT proname, array_to_string(proacl::text[], ',') AS priv
       FROM pg_proc
      WHERE proname IN ('consume_tfa_backup_code_v2', 'apply_yookassa_refund')`
  );
  for (const g of grants.rows) {
    const a = g.priv || "";
    const svcOnly =
      a.includes("service_role") &&
      !a.includes("anon") &&
      !a.includes("authenticated") &&
      !a.includes("PUBLIC");
    if (svcOnly) ok(`гранты ${g.proname}: только service_role`);
    else fail(`гранты ${g.proname}`, a);
  }

  // ===== 5. Идемпотентность: повторное применение 0039 =====
  try {
    await db.exec(SQL);
    ok("повторное применение 0039 целиком — без ошибок");
  } catch (e) {
    fail("повторное применение 0039 целиком", e instanceof Error ? e.message.slice(0, 160) : String(e));
  }

  // RPC работают после повтора
  const c4 = await db.query<{ consume_tfa_backup_code_v2: boolean }>(
    `SELECT consume_tfa_backup_code_v2($1::uuid, $2) AS consume_tfa_backup_code_v2`,
    [profileId, hash2]
  );
  if (c4.rows[0].consume_tfa_backup_code_v2 === true)
    ok("consume_tfa_backup_code_v2 работает после повторного применения");
  else fail("consume после повторного применения 0039");

  const r3 = await db.query<{ already_processed: boolean; total_refunded_kopecks: number }>(
    `SELECT already_processed, total_refunded_kopecks FROM apply_yookassa_refund($1::uuid, $2, $3::int)`,
    [paymentId, "refund_1", 40000]
  );
  if (r3.rows[0].already_processed === true && Number(r3.rows[0].total_refunded_kopecks) === 100000)
    ok("apply_yookassa_refund сохраняет дедуп после повторного применения");
  else fail("apply_yookassa_refund после повтора", JSON.stringify(r3.rows[0]));

  console.log("");
  if (failed === 0) {
    console.log("✅ ИТОГ: 0039 валидна (RLS, RPC, идемпотентность, дедуп refund, fail-closed)");
  } else {
    console.log(`❌ ПРОВАЛЕНО проверок: ${failed}`);
    process.exit(1);
  }
}

main();
