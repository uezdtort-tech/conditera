/**
 * verify-payout-0036-pglite.ts — one-shot валидация миграции 0036_payout_integrity.sql
 * на PGlite (в памяти), без живой БД.
 *
 * Проверяет:
 *   1. orders.payout_reserved_at — колонка + partial index
 *   2. RPC add_confectioner_balance: инкремент, отказ при amount<=0/неизвестном id
 *   3. Гранты: money/bonus RPC — EXECUTE только service_role
 *   4. RLS payouts_update_admin — без INSPECTOR
 *   5. CAS-семантика резерва: второй CAS-апдейт того же заказа → 0 строк (P0-1)
 *   6. Идемпотентность: повторное применение 0036 без ошибок
 *
 * Запуск: bun scripts/verify-payout-0036-pglite.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, "../supabase/migrations/0036_payout_integrity.sql"), "utf8");

let failed = 0;
function ok(label: string, detail = "") {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail = "") {
  failed++;
  console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const db = new PGlite();
  console.log("PGlite in-memory → применяем фикстуру + 0036\n");

  // Роли, на которые ссылается 0036 (в PGlite их нет)
  await db.exec(`
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    -- Заглушка Supabase auth.uid() для RLS-политики фикстуры
    CREATE SCHEMA auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  `);

  // Минимальная фикстура (живая схема: 0017 camelCase для confectioners —
  // но «balance» совпадает в обеих схемах; orders — money-колонки 0034)
  await db.exec(`
    CREATE TABLE public.confectioners (id TEXT PRIMARY KEY, balance INTEGER);
    CREATE TABLE public.orders (
      id TEXT PRIMARY KEY,
      confectioner_id TEXT,
      payment_status TEXT,
      payout_transferred_at TIMESTAMPTZ
    );
    CREATE TABLE public.payout_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      amount INTEGER,
      status TEXT,
      method TEXT,
      metadata JSONB,
      processed_by UUID
    );
    CREATE TABLE public.user_roles (user_id UUID, role TEXT, is_active BOOLEAN);
    ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
    -- старая политика 0009 (с INSPECTOR) — 0036 должна её заменить
    CREATE POLICY payouts_update_admin ON public.payout_requests
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
                AND ur.role IN ('ADMIN','SUPER_ADMIN','INSPECTOR') AND ur.is_active)
      );
    INSERT INTO public.confectioners VALUES ('conf_test', 1000);
    INSERT INTO public.orders VALUES
      ('ord1', 'u1', 'released', NULL),
      ('ord2', 'u1', 'released', NULL);
  `);

  // Применяем 0036 целиком
  await db.exec(SQL);
  ok("миграция 0036 применена без ошибок");

  // 1. Колонка + индекс
  const col = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders' AND column_name='payout_reserved_at'`
  );
  col.rows.length === 1 ? ok("orders.payout_reserved_at создана") : fail("колонка payout_reserved_at отсутствует");

  const idx = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_payout_reserved'`
  );
  idx.rows.length === 1 ? ok("partial index idx_orders_payout_reserved создан") : fail("индекс отсутствует");

  // 2. RPC add_confectioner_balance
  const inc = await db.query<{ add_confectioner_balance: number }>(
    `SELECT add_confectioner_balance('conf_test', 500)`
  );
  Number(inc.rows[0].add_confectioner_balance) === 1500
    ? ok("add_confectioner_balance: 1000+500 → 1500")
    : fail(`add_confectioner_balance вернул ${JSON.stringify(inc.rows[0])}`);

  const zero = await db
    .query(`SELECT add_confectioner_balance('conf_test', 0)`)
    .then(() => false)
    .catch((e: Error) => /must be positive/.test(e.message));
  zero ? ok("add_confectioner_balance(0) → ошибка «must be positive»") : fail("p_amount=0 не отклонён");

  const missing = await db
    .query(`SELECT add_confectioner_balance('conf_missing', 100)`)
    .then(() => false)
    .catch((e: Error) => /not found/.test(e.message));
  missing ? ok("add_confectioner_balance(неизвестный id) → ошибка «not found»") : fail("неизвестный id не отклонён");

  // 3. Гранты: только service_role
  for (const fn of ["add_confectioner_balance", "deduct_confectioner_balance", "add_bonus_balance", "deduct_bonus_balance"]) {
    const acl = await db.query<{ proacl: string[] | null }>(
      `SELECT proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [fn]
    );
    if (acl.rows.length === 0) {
      // Функция отсутствует в фикстуре (0013 не применялась) — 0036 корректно
      // пропускает отсутствующие; на живой БД проверяет verify-money-path §1/§7b/§7c
      ok(`${fn}: отсутствует в фикстуре — гранты 0036 применятся к ней на живой БД`);
      continue;
    }
    const a = JSON.stringify(acl.rows[0]?.proacl ?? []);
    const svcOnly = a.includes("service_role") && !a.includes("anon") && !a.includes("authenticated");
    svcOnly ? ok(`${fn}: EXECUTE только service_role`) : fail(`${fn}: ACL не только service_role — ${a}`);
  }

  // 4. RLS: без INSPECTOR
  const pol = await db.query<{ qual: string }>(
    `SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='payout_requests' AND policyname='payouts_update_admin'`
  );
  if (pol.rows.length === 1 && !pol.rows[0].qual.includes("INSPECTOR")) {
    ok("payouts_update_admin заменена: без INSPECTOR");
  } else {
    fail(`payouts_update_admin неверна: ${JSON.stringify(pol.rows[0]?.qual)}`);
  }

  // 5. CAS-семантика резерва (P0-1)
  const cas1 = await db.query<{ id: string }>(
    `UPDATE public.orders SET payout_reserved_at = now()
      WHERE id='ord1' AND payment_status='released'
        AND payout_transferred_at IS NULL AND payout_reserved_at IS NULL
      RETURNING id`
  );
  cas1.rows.length === 1 ? ok("CAS-резерв ord1: 1 строка") : fail("первый CAS не сработал");
  const cas2 = await db.query<{ id: string }>(
    `UPDATE public.orders SET payout_reserved_at = now()
      WHERE id='ord1' AND payment_status='released'
        AND payout_transferred_at IS NULL AND payout_reserved_at IS NULL
      RETURNING id`
  );
  cas2.rows.length === 0
    ? ok("повторный CAS ord1 → 0 строк (двойной резерв невозможен)")
    : fail("повторный CAS захватил заказ ещё раз!");

  // 6. Идемпотентность: повторное применение
  await db.exec(SQL);
  ok("повторное применение 0036 — идемпотентно");

  console.log(`\n${failed === 0 ? "✅ ИТОГ: 0036 валидна" : `❌ ИТОГ: проваленных проверок — ${failed}`}`);
  await db.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-payout-0036-pglite failed:", e);
  process.exit(1);
});
