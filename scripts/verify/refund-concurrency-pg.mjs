/**
 * Реальная многосессионная проверка apply_yookassa_refund на PostgreSQL.
 *
 * Проверяет, что два разных refund_id, одновременно возвращающих по 600 ₽
 * из платежа 1 000 ₽, сериализуются блокировкой payments FOR UPDATE:
 * первый возврат фиксируется, второй после ожидания видит новый остаток
 * и отклоняется SQLSTATE 23514. В ledger остаётся ровно одно событие.
 *
 * Запуск после применения миграций:
 *   PGURL=postgresql://postgres@127.0.0.1:54329/conditera node scripts/verify/refund-concurrency-pg.mjs
 *
 * Скрипт создаёт и удаляет только собственные тестовые order/payment/refund rows.
 */

import { Client } from "pg";
import { randomUUID } from "node:crypto";

const PG_URL = process.env.PGURL || "postgresql://postgres@127.0.0.1:54329/conditera";
const customerId = process.env.REFUND_TEST_CUSTOMER_ID || "11111111-1111-4111-8111-111111111106";
const runId = randomUUID();
const orderNumber = `REFCONC-${Date.now()}-${runId.slice(0, 8)}`;
const providerPaymentId = `refund-concurrency-${runId}`;
const secondAppName = `refund-concurrency-${runId.slice(0, 20)}`;

const first = new Client({ connectionString: PG_URL, application_name: `refund-first-${runId.slice(0, 20)}` });
const second = new Client({ connectionString: PG_URL, application_name: secondAppName });
let orderId;
let paymentId;
let transactionOpen = false;

function assert(name, condition, detail = "") {
  if (!condition) throw new Error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  if (transactionOpen) {
    await first.query("ROLLBACK").catch(() => {});
    transactionOpen = false;
  }
  if (paymentId) {
    await first.query("DELETE FROM public.yookassa_refund_events WHERE payment_id = $1::uuid", [paymentId]).catch(() => {});
    await first.query("DELETE FROM public.payments WHERE id = $1::uuid", [paymentId]).catch(() => {});
  }
  if (orderId) {
    await first.query("DELETE FROM public.escrow_accounts WHERE order_id = $1::uuid", [orderId]).catch(() => {});
    await first.query("DELETE FROM public.orders WHERE id = $1::uuid", [orderId]).catch(() => {});
  }
}

async function main() {
  await first.connect();
  await second.connect();

  console.log("=== apply_yookassa_refund: PostgreSQL multi-session race ===");
  const order = await first.query(
    `INSERT INTO public.orders
       (number, user_id, subtotal, delivery_cost, discount, total,
        status, payment_status, payment_method, delivery_address, delivery_city,
        delivery_date, delivery_time_window, delivery_type, metadata, paid_at, confirmed_at)
     VALUES ($1, $2::uuid, 1000, 0, 0, 1000,
             'PENDING', 'escrow', 'card', 'Тест возврата', 'Москва',
             CURRENT_DATE + 2, '12:00-14:00', 'delivery',
             jsonb_build_object('test','refund-concurrency'), now(), now())
     RETURNING id::text`,
    [orderNumber, customerId]
  );
  orderId = order.rows[0].id;

  const payment = await first.query(
    `INSERT INTO public.payments (order_id, yookassa_payment_id, amount, status, currency)
     VALUES ($1::uuid, $2, 1000, 'succeeded', 'RUB')
     RETURNING id::text`,
    [orderId, providerPaymentId]
  );
  paymentId = payment.rows[0].id;
  console.log(`  Тестовый платёж создан: ${paymentId}`);

  // Первая сессия выполняет возврат внутри открытой транзакции и удерживает row lock.
  await first.query("BEGIN");
  transactionOpen = true;
  const firstResult = await first.query(
    "SELECT * FROM public.apply_yookassa_refund($1::uuid, $2::text, 60000)",
    [paymentId, `refund-a-${runId}`]
  );
  assert("первый возврат 600 ₽ принят", Number(firstResult.rows[0]?.total_refunded_kopecks) === 60000);

  // Вторая независимая сессия пытается вернуть ещё 600 ₽ из остатка 400 ₽.
  let secondSettled = false;
  const secondPromise = second.query(
    "SELECT * FROM public.apply_yookassa_refund($1::uuid, $2::text, 60000)",
    [paymentId, `refund-b-${runId}`]
  ).then(
    (value) => { secondSettled = true; return { ok: true, value }; },
    (error) => { secondSettled = true; return { ok: false, error }; }
  );

  // Не коммитим первую транзакцию, пока PostgreSQL явно не покажет,
  // что backend второй сессии заблокирован именно первой сессией.
  const firstPidResult = await first.query("SELECT pg_backend_pid()::int AS pid");
  const firstPid = firstPidResult.rows[0].pid;
  let blocked = false;
  for (let i = 0; i < 400; i++) {
    const wait = await first.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.application_name = $1
            AND a.state = 'active'
            AND $2::int = ANY(pg_blocking_pids(a.pid))
       ) AS blocked`,
      [secondAppName, firstPid]
    );
    if (wait.rows[0]?.blocked === true) {
      blocked = true;
      break;
    }
    if (secondSettled) break;
    await sleep(25);
  }
  if (!blocked && secondSettled) {
    const early = await secondPromise;
    assert(
      "вторая независимая сессия должна ждать блокировку первой",
      false,
      early.ok ? "запрос завершился до COMMIT первой транзакции" : `SQLSTATE ${early.error?.code}: ${early.error?.message}`
    );
  }
  assert("вторая независимая сессия заблокирована именно первой транзакцией", blocked);

  await first.query("COMMIT");
  transactionOpen = false;

  const secondResult = await secondPromise;
  assert(
    "второй возврат отклонён лимитом после снятия блокировки",
    !secondResult.ok && secondResult.error?.code === "23514",
    secondResult.ok ? "запрос неожиданно выполнен" : `SQLSTATE ${secondResult.error?.code}: ${secondResult.error?.message}`
  );

  const state = await first.query(
    "SELECT refund_amount, status FROM public.payments WHERE id = $1::uuid",
    [paymentId]
  );
  assert(
    "итоговая сумма не превышает платёж (600 ₽ из 1 000 ₽)",
    Number(state.rows[0]?.refund_amount) === 600 && state.rows[0]?.status === "succeeded",
    JSON.stringify(state.rows[0])
  );

  const events = await first.query(
    "SELECT count(*)::int AS n FROM public.yookassa_refund_events WHERE payment_id = $1::uuid",
    [paymentId]
  );
  assert("в ledger записано ровно одно refund event", events.rows[0]?.n === 1, `events=${events.rows[0]?.n}`);

  console.log("\n✅ PostgreSQL multi-session refund race: PASS");
}

main()
  .catch((error) => {
    console.error("\n❌ PostgreSQL multi-session refund race: FAIL");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await first.end().catch(() => {});
    await second.end().catch(() => {});
  });
