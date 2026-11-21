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
const ESCROW_GUARD_SQL = readFileSync(join(here, "../supabase/migrations/0074_escrow_release_cancel_guard.sql"), "utf8");
const ORDER_ACCESS_SQL = readFileSync(join(here, "../supabase/migrations/0075_order_access_rls.sql"), "utf8");
const COURIER_ASSIGNMENT_SQL = readFileSync(join(here, "../supabase/migrations/0076_atomic_courier_assignment.sql"), "utf8");

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
      status TEXT NOT NULL DEFAULT 'PENDING',
      user_id UUID,
      delivery_type TEXT DEFAULT 'delivery',
      delivery_address TEXT,
      delivery_cost INTEGER DEFAULT 0,
      delivery_date DATE,
      delivery_time TEXT,
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

  // Применяем исходную финансовую миграцию и production guard 0074.
  await db.exec(SQL);
  ok("миграция 0037 применена без ошибок");
  await db.exec(ESCROW_GUARD_SQL);
  ok("миграция 0074: отменённые/возвращённые заказы защищены, завершённые остаются выплачиваемыми");

  // Минимальная схема для production RLS migration 0075.
  await db.exec(`
    CREATE TYPE public.user_role AS ENUM ('ADMIN', 'SUPER_ADMIN', 'COURIER', 'SUPPORT', 'CUSTOMER', 'CONFECTIONER');
    CREATE TABLE public.user_roles (user_id UUID NOT NULL, role public.user_role NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE);
    CREATE TABLE public.support_tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID, assigned_to UUID);
    CREATE TABLE public.order_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES public.orders(id));
    CREATE TABLE public.payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES public.orders(id));
    CREATE TABLE public.deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES public.orders(id),
      courier_id UUID,
      status TEXT NOT NULL DEFAULT 'assigned',
      address TEXT NOT NULL,
      estimated_time TIMESTAMPTZ,
      cost INTEGER NOT NULL DEFAULT 0,
      courier_earnings INTEGER DEFAULT 0,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
      $ SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID $;
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders, public.order_items, public.payments TO authenticated;
    GRANT SELECT ON public.user_roles, public.support_tickets TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY deliveries_select_own ON public.deliveries
      FOR SELECT USING (auth.uid() = courier_id);
  `);
  await db.exec(ORDER_ACCESS_SQL);
  ok("миграция 0075: ограничен доступ к заказам и запрещены прямые записи клиентов");
  await db.exec(COURIER_ASSIGNMENT_SQL);
  ok("миграция 0076: атомарное назначение курьера через deliveries");

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

  // 4b. Отменённый заказ не должен быть клеймен или начислен в эскроу.
  const cancelledOrder = await db.query<{ id: string }>(
    `INSERT INTO public.orders (confectioner_id, payment_status, status)
     VALUES ('u1', 'escrow', 'CANCELLED') RETURNING id::text`
  );
  const balanceBeforeCancelled = (await db.query<{ balance: number }>(
    `SELECT balance FROM public.confectioners WHERE id='conf_test'`
  )).rows[0].balance;
  const cancelledRelease = await db.query<{ release_escrow_order: number }>(
    `SELECT release_escrow_order($1::uuid, 'conf_test', 500)`,
    [cancelledOrder.rows[0].id]
  );
  const cancelledAfter = await db.query<{ payment_status: string; escrow_released_at: Date | null }>(
    `SELECT payment_status, escrow_released_at FROM public.orders WHERE id=$1::uuid`,
    [cancelledOrder.rows[0].id]
  );
  const balanceAfterCancelled = (await db.query<{ balance: number }>(
    `SELECT balance FROM public.confectioners WHERE id='conf_test'`
  )).rows[0].balance;
  cancelledRelease.rows[0].release_escrow_order === 0 &&
    cancelledAfter.rows[0].payment_status === "escrow" &&
    cancelledAfter.rows[0].escrow_released_at === null &&
    balanceAfterCancelled === balanceBeforeCancelled
    ? ok("отменённый заказ: release → 0, эскроу и баланс не изменены")
    : fail("отменённый заказ ошибочно релизован/начислен");

  // Успешно завершённый заказ должен оставаться eligible для выплаты.
  const completedOrder = await db.query<{ id: string }>(
    `INSERT INTO public.orders (confectioner_id, payment_status, status)
     VALUES ('u1', 'escrow', 'COMPLETED') RETURNING id::text`
  );
  const balanceBeforeCompleted = (await db.query<{ balance: number }>(
    `SELECT balance FROM public.confectioners WHERE id='conf_test'`
  )).rows[0].balance;
  const completedRelease = await db.query<{ release_escrow_order: number }>(
    `SELECT release_escrow_order($1::uuid, 'conf_test', 200)`,
    [completedOrder.rows[0].id]
  );
  const completedAfter = await db.query<{ payment_status: string; escrow_released_at: Date | null }>(
    `SELECT payment_status, escrow_released_at FROM public.orders WHERE id=$1::uuid`,
    [completedOrder.rows[0].id]
  );
  const balanceAfterCompleted = (await db.query<{ balance: number }>(
    `SELECT balance FROM public.confectioners WHERE id='conf_test'`
  )).rows[0].balance;
  completedRelease.rows[0].release_escrow_order === 1 &&
    completedAfter.rows[0].payment_status === "released" &&
    completedAfter.rows[0].escrow_released_at !== null &&
    balanceAfterCompleted === balanceBeforeCompleted + 200
    ? ok("завершённый заказ: release → 1, кондитер получает выплату")
    : fail("завершённый заказ ошибочно исключён из выплаты");

  // Возвращённый заказ, как и отменённый, не должен выплачиваться.
  const refundedOrder = await db.query<{ id: string }>(
    `INSERT INTO public.orders (confectioner_id, payment_status, status)
     VALUES ('u1', 'escrow', 'REFUNDED') RETURNING id::text`
  );
  const balanceBeforeRefunded = (await db.query<{ balance: number }>(
    `SELECT balance FROM public.confectioners WHERE id='conf_test'`
  )).rows[0].balance;
  const refundedRelease = await db.query<{ release_escrow_order: number }>(
    `SELECT release_escrow_order($1::uuid, 'conf_test', 500)`,
    [refundedOrder.rows[0].id]
  );
  const balanceAfterRefunded = (await db.query<{ balance: number }>(
    `SELECT balance FROM public.confectioners WHERE id='conf_test'`
  )).rows[0].balance;
  refundedRelease.rows[0].release_escrow_order === 0 && balanceAfterRefunded === balanceBeforeRefunded
    ? ok("возвращённый заказ: release → 0, баланс не изменён")
    : fail("возвращённый заказ ошибочно релизован");

  // 4c. RLS 0075: courier/support/customer/admin видят только разрешённые заказы.
  const ids = {
    buyer: "11111111-1111-4111-8111-111111111201",
    otherBuyer: "11111111-1111-4111-8111-111111111202",
    confectioner: "11111111-1111-4111-8111-111111111203",
    courier: "11111111-1111-4111-8111-111111111204",
    otherCourier: "11111111-1111-4111-8111-111111111205",
    support: "11111111-1111-4111-8111-111111111206",
    admin: "11111111-1111-4111-8111-111111111207",
  };
  const accessOrders = await db.query<{ id: string }>(
    `INSERT INTO public.orders (user_id, confectioner_id, status, payment_status, delivery_type, delivery_address, delivery_cost)
     VALUES
       ($1::uuid, 'conf_test', 'IN_DELIVERY', 'escrow', 'delivery', 'Test Courier Street 1', 500),
       ($2::uuid, 'conf_test', 'PENDING', 'pending', 'delivery', 'Test Support Street 2', 500)
     RETURNING id::text`,
    [ids.buyer, ids.otherBuyer]
  );
  const courierOrderId = accessOrders.rows[0].id;
  const supportOrderId = accessOrders.rows[1].id;
  await db.query(
    `INSERT INTO public.user_roles (user_id, role) VALUES
      ($1::uuid, 'COURIER'), ($2::uuid, 'COURIER'), ($3::uuid, 'SUPPORT'), ($4::uuid, 'ADMIN')`,
    [ids.courier, ids.otherCourier, ids.support, ids.admin]
  );
  await db.query(
    `INSERT INTO public.support_tickets (order_id, assigned_to) VALUES ($1::uuid, $2::uuid)`,
    [supportOrderId, ids.support]
  );
  const firstAssignment = await db.query<{ delivery_id: string; created: boolean }>(
    `SELECT delivery_id::text, created FROM public.assign_order_delivery($1::uuid, $2::uuid)`,
    [courierOrderId, ids.courier]
  );
  firstAssignment.rows[0].created
    ? ok("первое назначение курьера создаёт delivery")
    : fail("первое назначение курьера не создало delivery");
  const repeatedAssignment = await db.query<{ delivery_id: string; created: boolean }>(
    `SELECT delivery_id::text, created FROM public.assign_order_delivery($1::uuid, $2::uuid)`,
    [courierOrderId, ids.courier]
  );
  !repeatedAssignment.rows[0].created && repeatedAssignment.rows[0].delivery_id === firstAssignment.rows[0].delivery_id
    ? ok("повторное назначение того же курьера идемпотентно")
    : fail("повторное назначение создало дубль");
  const otherCourierBlocked = await db.query(
    `SELECT * FROM public.assign_order_delivery($1::uuid, $2::uuid)`,
    [courierOrderId, ids.otherCourier]
  ).then(() => false).catch((e: Error) => e.message.includes("ORDER_ALREADY_ASSIGNED"));
  otherCourierBlocked ? ok("второй курьер не может забрать уже назначенный заказ") : fail("один заказ назначен двум курьерам");

  await db.query(
    `INSERT INTO public.order_items (order_id) VALUES ($1::uuid), ($2::uuid)`,
    [courierOrderId, supportOrderId]
  );

  async function visibleOrders(userId: string): Promise<number> {
    await db.query("SET ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
    const count = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.orders WHERE id = ANY($1::uuid[])",
      [[courierOrderId, supportOrderId]]
    );
    await db.query("RESET ROLE");
    return Number(count.rows[0].n);
  }
  async function visibleItems(userId: string): Promise<number> {
    await db.query("SET ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
    const count = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.order_items WHERE order_id = ANY($1::uuid[])",
      [[courierOrderId, supportOrderId]]
    );
    await db.query("RESET ROLE");
    return Number(count.rows[0].n);
  }

  const courierVisible = await visibleOrders(ids.courier);
  courierVisible === 1 ? ok("курьер видит только назначенный ему заказ") : fail(`курьер видит ${courierVisible} заказов вместо 1`);
  const courierItemsVisible = await visibleItems(ids.courier);
  courierItemsVisible === 1 ? ok("курьер видит позиции только назначенного заказа") : fail(`курьер видит ${courierItemsVisible} позиций вместо 1`);
  const unassignedCourierVisible = await visibleOrders(ids.otherCourier);
  unassignedCourierVisible === 0 ? ok("курьер без назначения не видит чужие заказы") : fail(`неназначенный курьер видит ${unassignedCourierVisible} заказов`);
  const supportVisible = await visibleOrders(ids.support);
  supportVisible === 1 ? ok("поддержка видит только заказ с назначенным тикетом") : fail(`поддержка видит ${supportVisible} заказов вместо 1`);
  const buyerVisible = await visibleOrders(ids.buyer);
  buyerVisible === 1 ? ok("покупатель видит только собственный заказ") : fail(`покупатель видит ${buyerVisible} заказов вместо 1`);
  const adminVisible = await visibleOrders(ids.admin);
  adminVisible === 2 ? ok("администратор видит оба тестовых заказа") : fail(`администратор видит ${adminVisible} заказов вместо 2`);

  await db.query("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids.buyer]);
  const directOrderWriteBlocked = await db.query(
    `UPDATE public.orders SET status='COMPLETED' WHERE id=$1::uuid`,
    [courierOrderId]
  ).then(() => false).catch((e: Error) => /permission denied/.test(e.message));
  await db.query("RESET ROLE");
  directOrderWriteBlocked ? ok("authenticated не может менять статус собственного заказа напрямую") : fail("прямая запись в orders не запрещена");

  await db.query("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids.buyer]);
  const directOrderInsertBlocked = await db.query(
    `INSERT INTO public.orders (user_id, status, payment_status)
     VALUES ($1::uuid, 'PENDING', 'pending')`,
    [ids.buyer]
  ).then(() => false).catch((e: Error) => /permission denied/.test(e.message));
  await db.query("RESET ROLE");
  directOrderInsertBlocked ? ok("authenticated не может создавать заказ в обход checkout") : fail("прямое создание заказа не запрещено");

  await db.query("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids.courier]);
  const directDeliveryWriteBlocked = await db.query(
    `UPDATE public.deliveries SET courier_earnings = 999999 WHERE order_id=$1::uuid`,
    [courierOrderId]
  ).then(() => false).catch((e: Error) => /permission denied/.test(e.message));
  await db.query("RESET ROLE");
  directDeliveryWriteBlocked ? ok("курьер не может менять назначение/заработок доставки напрямую") : fail("прямая запись в deliveries не запрещена");

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

  // 6. Идемпотентность: повторное применение обеих миграций
  await db.exec(SQL);
  await db.exec(ESCROW_GUARD_SQL);
  await db.exec(ORDER_ACCESS_SQL);
  await db.exec(COURIER_ASSIGNMENT_SQL);
  ok("повторное применение 0037 + 0074 + 0075 + 0076 — идемпотентно");

  console.log(`\n${failed === 0 ? "✅ ИТОГ: 0037 валидна" : `❌ ИТОГ: проваленных проверок — ${failed}`}`);
  await db.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-payout-0037-pglite failed:", e);
  process.exit(1);
});
