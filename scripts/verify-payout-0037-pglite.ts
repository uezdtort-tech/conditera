/**
 * verify-payout-0037-pglite.ts — one-shot валидация миграции 0037_payout_linkage.sql
 * на PGlite (в памяти), без живой БД.
 *
 * Проверяет:
 *   1. orders.payout_request_id — колонка + partial index
 *   2. payout_requests_status_check — CHECK (NOT VALID): легаси-строки живут,
 *      новые невалидные статусы отклоняются
 *   3. RPC consume_tfa_backup_code — атомарное списание: второй вызов → false,
 *      неизвестный/пустой hash → false
 *   4. RPC release_escrow_order — claim+начисление: повторный вызов → 0 (без
 *      двойного начисления), negative payout → RAISE, неизвестный кондитер →
 *      RAISE и claim заказа ОТКАТЫВАЕТСЯ (атомарность транзакции)
 *   5. Гранты: оба RPC — EXECUTE только service_role
 *   6. Идемпотентность: повторное применение 0037 без ошибок
 *
 * Запуск: bun scripts/verify-payout-0037-pglite.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, "../supabase/migrations/0037_payout_linkage.sql"), "utf8");

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
  console.log("PGlite in-memory → применяем фикстуру + 0037\n");

  // Роли, на которые ссылается 0037 (в PGlite их нет)
  await db.exec(`
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
  `);

  // Минимальная фикстура pre-0037 (payout_reserved_at — состояние после 0036;
  // payout_request_id 0037 создаёт САМА — в фикстуре его нет намеренно)
  await db.exec(`
    CREATE TABLE public.confectioners (
      id TEXT PRIMARY KEY,
      balance INTEGER,
      "totalEarnings" INTEGER
    );
    CREATE TABLE public.orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      confectioner_id TEXT,
      payment_status TEXT,
      escrow_released_at TIMESTAMPTZ,
      payout_reserved_at TIMESTAMPTZ,
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
    CREATE TABLE public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tfa_backup_codes TEXT[],
      updated_at TIMESTAMPTZ
    );
    INSERT INTO public.confectioners VALUES ('conf_test', 1000, 5000);
    INSERT INTO public.orders (id, confectioner_id, payment_status) VALUES
      (gen_random_uuid(), 'u1', 'escrow'),
      (gen_random_uuid(), 'u1', 'escrow');
    -- легаси-строка с невалидным статусом (NOT VALID не должна её отвергнуть)
    INSERT INTO public.payout_requests (user_id, amount, status) VALUES
      (gen_random_uuid(), 100, 'legacy_bogus');
    INSERT INTO public.profiles (tfa_backup_codes) VALUES
      (ARRAY['hash_a', 'hash_b']);
  `);

  // Применяем 0037 целиком
  await db.exec(SQL);
  ok("миграция 0037 применена без ошибок");

  // 1. Колонка + индекс
  const col = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders' AND column_name='payout_request_id'`
  );
  col.rows.length === 1 ? ok("orders.payout_request_id создана") : fail("колонка payout_request_id отсутствует");

  const idx = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_payout_request'`
  );
  idx.rows.length === 1 ? ok("partial index idx_orders_payout_request создан") : fail("индекс отсутствует");

  // 2. CHECK статуса: легаси-строка жива (NOT VALID), новая bogus отклоняется
  const legacy = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.payout_requests WHERE status='legacy_bogus'`
  );
  Number(legacy.rows[0].n) === 1
    ? ok("NOT VALID: легаси-строка с legacy_bogus не тронута")
    : fail("легаси-строка исчезла/изменена — NOT VALID нарушен");

  const badStatus = await db
    .query(`INSERT INTO public.payout_requests (user_id, amount, status) VALUES (gen_random_uuid(), 1, 'bogus')`)
    .then(() => false)
    .catch((e: Error) => /payout_requests_status_check|check constraint/.test(e.message));
  badStatus ? ok("INSERT bogus-статуса отклонён CHECK'ем") : fail("CHECK статуса не сработал");

  const goodStatus = await db
    .query(`INSERT INTO public.payout_requests (user_id, amount, status) VALUES (gen_random_uuid(), 1, 'pending')`)
    .then(() => true)
    .catch(() => false);
  goodStatus ? ok("INSERT 'pending' проходит") : fail("валидный статус отклонён");

  // 3. consume_tfa_backup_code
  const userId = (await db.query<{ id: string }>(`SELECT id FROM public.profiles LIMIT 1`)).rows[0].id;
  const c1 = await db.query<{ consume_tfa_backup_code: boolean }>(
    `SELECT consume_tfa_backup_code($1, 'hash_a')`, [userId]
  );
  c1.rows[0].consume_tfa_backup_code === true ? ok("первый consume hash_a → true") : fail("первый consume не сработал");

  const c2 = await db.query<{ consume_tfa_backup_code: boolean }>(
    `SELECT consume_tfa_backup_code($1, 'hash_a')`, [userId]
  );
  c2.rows[0].consume_tfa_backup_code === false
    ? ok("повторный consume hash_a → false (гонка закрыта: код уже списан)")
    : fail("повторный consume вернул true — гонка НЕ закрыта!");

  const c3 = await db.query<{ consume_tfa_backup_code: boolean }>(
    `SELECT consume_tfa_backup_code($1, 'hash_unknown')`, [userId]
  );
  c3.rows[0].consume_tfa_backup_code === false ? ok("неизвестный hash → false") : fail("неизвестный hash принят");

  const c4 = await db.query<{ consume_tfa_backup_code: boolean }>(
    `SELECT consume_tfa_backup_code($1, '')`, [userId]
  );
  c4.rows[0].consume_tfa_backup_code === false ? ok("пустой hash → false") : fail("пустой hash принят");

  const remaining = await db.query<{ tfa_backup_codes: string[] }>(
    `SELECT tfa_backup_codes FROM public.profiles WHERE id=$1`, [userId]
  );
  JSON.stringify(remaining.rows[0].tfa_backup_codes) === JSON.stringify(["hash_b"])
    ? ok("массив кодов после списания: [hash_b]")
    : fail(`неожиданный остаток: ${JSON.stringify(remaining.rows[0].tfa_backup_codes)}`);

  // 4. release_escrow_order — атомарный claim + начисление
  const balBefore = (await db.query<{ balance: number }>(`SELECT balance FROM public.confectioners WHERE id='conf_test'`)).rows[0].balance;

  const ord1 = (await db.query<{ id: string }>(`SELECT id FROM public.orders ORDER BY id LIMIT 1`)).rows[0].id;
  const ord2 = (await db.query<{ id: string }>(`SELECT id FROM public.orders ORDER BY id OFFSET 1 LIMIT 1`)).rows[0].id;

  const r1 = await db.query<{ release_escrow_order: number }>(
    `SELECT release_escrow_order($1::uuid, 'conf_test', 300)`, [ord1]
  );
  r1.rows[0].release_escrow_order === 1 ? ok("первый release → 1 (claim+начисление)") : fail("первый release не сработал");

  const balAfter = (await db.query<{ balance: number }>(`SELECT balance FROM public.confectioners WHERE id='conf_test'`)).rows[0].balance;
  balAfter === balBefore + 300 ? ok(`баланс ${balBefore}+300=${balAfter}`) : fail(`баланс ${balBefore}→${balAfter}, ожидался +300`);

  const r2 = await db.query<{ release_escrow_order: number }>(
    `SELECT release_escrow_order($1::uuid, 'conf_test', 300)`, [ord1]
  );
  const balAfter2 = (await db.query<{ balance: number }>(`SELECT balance FROM public.confectioners WHERE id='conf_test'`)).rows[0].balance;
  r2.rows[0].release_escrow_order === 0 && balAfter2 === balAfter
    ? ok("повторный release → 0, баланс не изменился (двойное начисление невозможно)")
    : fail(`повторный release: ${JSON.stringify(r2.rows[0])}, баланс ${balAfter}→${balAfter2}`);

  const r3 = await db
    .query(`SELECT release_escrow_order($1::uuid, 'conf_test', -5)`, [ord2])
    .then(() => false)
    .catch((e: Error) => /payout must be >= 0/.test(e.message));
  r3 ? ok("negative payout → RAISE «payout must be >= 0»") : fail("negative payout принят");

  // АТОМАРНОСТЬ: неизвестный кондитер → RAISE, но claim заказа должен откатиться
  const ord2StatusBefore = (await db.query<{ payment_status: string }>(`SELECT payment_status FROM public.orders WHERE id=$1::uuid`, [ord2])).rows[0].payment_status;
  const r4 = await db
    .query(`SELECT release_escrow_order($1::uuid, 'conf_missing', 100)`, [ord2])
    .then(() => false)
    .catch((e: Error) => /confectioner not found/.test(e.message));
  const ord2StatusAfter = (await db.query<{ payment_status: string }>(`SELECT payment_status FROM public.orders WHERE id=$1::uuid`, [ord2])).rows[0].payment_status;
  r4 && ord2StatusBefore === "escrow" && ord2StatusAfter === "escrow"
    ? ok("атомарность: RAISE при неизвестном кондитере откатил claim (заказ остался escrow)")
    : fail(`атомарность нарушена: r4=${r4}, статус ${ord2StatusBefore}→${ord2StatusAfter}`);

  // 5. Гранты: только service_role
  for (const fn of ["release_escrow_order", "consume_tfa_backup_code"]) {
    const acl = await db.query<{ proacl: string[] | null }>(
      `SELECT proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [fn]
    );
    if (acl.rows.length === 0) {
      fail(`${fn}: не найдена после применения 0037`);
      continue;
    }
    const a = JSON.stringify(acl.rows[0]?.proacl ?? []);
    const svcOnly = a.includes("service_role") && !a.includes("anon") && !a.includes("authenticated") && !a.includes("PUBLIC");
    svcOnly ? ok(`${fn}: EXECUTE только service_role`) : fail(`${fn}: ACL не только service_role — ${a}`);
  }

  // 6. Идемпотентность: повторное применение
  await db.exec(SQL);
  ok("повторное применение 0037 — идемпотентно");

  console.log(`\n${failed === 0 ? "✅ ИТОГ: 0037 валидна" : `❌ ИТОГ: проваленных проверок — ${failed}`}`);
  await db.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-payout-0037-pglite failed:", e);
  process.exit(1);
});
