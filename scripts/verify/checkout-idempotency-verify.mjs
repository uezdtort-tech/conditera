/**
 * checkout-idempotency-verify.mjs — U-07 fix (Release Gate v4.1): живой прогон
 * контракта идемпотентности checkout против dev-стека :3000.
 *
 * ЧТО ПРОВЕРЯЕТ (сервер НЕ менялся — контракт фиксируется как есть):
 *   A. replay: два ПОСЛЕДОВАТЕЛЬНЫХ POST /api/checkout с ОДНИМ Idempotency-Key
 *      → 200 оба, ОДИН orderId (второй — idempotentReplay:true), в БД ровно
 *      1 заказ с этим ключом. Это же сценарий «потерянный ответ»: первый запрос
 *      дошёл, ответ потерян → повтор с тем же ключом возвращает тот же заказ.
 *   B. opt-in контракт (без ключа): два одинаковых POST БЕЗ ключа → 200 оба,
 *      ДВА разных заказа (задокументированное поведение — finding #2 U-07;
 *      сервер оставлен лояльным, дубли-защита — обязанность клиента).
 *   C. гонка: 4 ПАРАЛЛЕЛЬНЫХ POST с одним ключом → все 200, один orderId,
 *      в БД ровно 1 заказ (select-before-insert + уникальный индекс 0060
 *      uq_orders_idempotency (user_id, metadata->>'idempotency_key')).
 *   D. потерянный ответ/таймаут: POST с ключом уходит, ответ сознательно
 *      НЕ читается (имитация обрыва/таймаута ПОСЛЕ обработки сервером) →
 *      retry с тем же ключом → 200, в БД ровно 1 заказ с этим ключом, retry
 *      возвращает ЕГО orderId (replay), не новый.
 *
 * ГИГИЕНА: synthetic-данные (ключи с префиксом u07fix-<run>, заказы
 * customer@demo.ru), cleanup в finally при любом исходе: payments →
 * order_items → domain_events/notifications → orders (+ product_reviews на
 * всякий случай), в т.ч. по ключам (ловит заказ, созданный оборванным запросом).
 *
 * Запуск: node scripts/verify/checkout-idempotency-verify.mjs  (exit 0 = PASS)
 *         [dev-сервер :3000 и PG 127.0.0.1:54329 должны работать]
 */

import { Client } from "pg";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const PG_URL = process.env.PGURL || "postgresql://postgres@127.0.0.1:54329/conditera";
const PASSWORD = "Demo123!";
const CUSTOMER_USER_ID = "11111111-1111-4111-8111-111111111106"; // customer@demo.ru
let PRODUCT_ID = ""; // demo product with a seeded recipe
let originalProductionTimeHours;
let confectionerId = "";
let originalCapacityConfig = null;
let deliveryDateFixture = "";

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✖ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
function section(title) {
  console.log(`\n─── ${title} ───`);
}

const rand = () => Math.floor(Math.random() * 1e9).toString(36);
const RUN_TAG = `u07fix-${rand()}`;
const VERIFY_AUTH_IP = process.env.VERIFY_TEST_IP || "10.250.250.250";
const IDEM_KEYS = [`${RUN_TAG}-a`, `${RUN_TAG}-c`, `${RUN_TAG}-d`];
const collectedOrderIds = [];


// Rate limit checkout: 5/min на IP → каждая секция <= 4 POST со своим IP.
const sectionIp = () =>
  `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function api(method, path, { token, body, headers: extraHeaders, signal, ip } = {}) {
  const headers = { "x-real-ip": ip || sectionIp(), ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const r = await fetch(`${BASE}/api/csrf-token`, { headers: { "x-real-ip": headers["x-real-ip"] } });
    const j = await r.json();
    const sc = r.headers.getSetCookie().find((c) => c.startsWith("csrf_token="));
    const cv = sc ? sc.split(";")[0].split("=").slice(1).join("=") : j.token;
    headers["x-csrf-token"] = j.token;
    headers.Cookie = `csrf_token=${cv}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 150) };
  }
  return { status: res.status, json };
}

async function login(email) {
  const res = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD }, ip: VERIFY_AUTH_IP });
  if (res.status !== 200 || !res.json?.accessToken) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
  }
  return res.json.accessToken;
}

const client = new Client({ connectionString: PG_URL });

function checkoutBody() {
  const deliveryDate = deliveryDateFixture;
  if (!deliveryDate) throw new Error("checkout capacity fixture did not choose a delivery date");
  // Используем опубликованный demo-продукт с recipe_id и заполненными
  // recipe_ingredients из seed-ops-center. Custom-конструктор в production
  // намеренно не оплачивается без отдельной согласованной спецификации.
  return {
    cartItems: [{ product_id: PRODUCT_ID, quantity: 1 }],
    deliveryCity: "Москва",
    deliveryAddress: "ул. Идемпотентности, 1, кв 1",
    deliveryType: "delivery",
    deliveryDate,
    customerName: "U07 Fix Verify",
    customerPhone: "+7 900 000-07-07",
    paymentMethod: "card",
  };
}
async function countOrdersByKey(key) {
  const r = await client.query(
    `SELECT count(*)::int AS n, COALESCE(array_agg(id::text), '{}') AS ids
       FROM public.orders
      WHERE user_id = $1::uuid AND metadata->>'idempotency_key' = $2`,
    [CUSTOMER_USER_ID, key]
  );
  return { n: r.rows[0].n, ids: r.rows[0].ids };
}

async function main() {
  await client.connect();
  const productFixture = await client.query(
    `SELECT id::text, production_time_hours, confectioner_id::text
       FROM public.products
      WHERE slug = 'svadebnyy-tort-yagodnyy-barhat'
        AND recipe_id IS NOT NULL
        AND status = 'published'
      LIMIT 1`
  );
  if (productFixture.rowCount !== 1) {
    throw new Error("production-ready demo product with recipe was not seeded");
  }
  PRODUCT_ID = productFixture.rows[0].id;
  originalProductionTimeHours = productFixture.rows[0].production_time_hours;
  confectionerId = productFixture.rows[0].confectioner_id;
  if (!confectionerId) throw new Error("demo product has no assigned confectioner");

  // The test validates checkout idempotency, not a particular confectioner's
  // production calendar. Isolate a free day and a wide temporary work window,
  // then restore the exact previous capacity configuration in cleanup.
  const capacityBefore = await client.query(
    `SELECT user_id::text, workday_start_minute, workday_end_minute,
            daily_capacity_minutes, packaging_minutes, quality_check_minutes,
            handoff_buffer_minutes, delivery_buffer_minutes, is_active
       FROM public.confectioner_capacity WHERE user_id = $1::uuid`,
    [confectionerId]
  );
  originalCapacityConfig = capacityBefore.rows[0] ?? null;
  if (originalCapacityConfig) {
    await client.query(
      `UPDATE public.confectioner_capacity
          SET workday_start_minute = 0, workday_end_minute = 1439,
              daily_capacity_minutes = 1439, is_active = true
        WHERE user_id = $1::uuid`,
      [confectionerId]
    );
  } else {
    await client.query(
      `INSERT INTO public.confectioner_capacity
         (user_id, workday_start_minute, workday_end_minute, daily_capacity_minutes, is_active)
       VALUES ($1::uuid, 0, 1439, 1439, true)`,
      [confectionerId]
    );
  }
  const freeDay = await client.query(
    `SELECT to_char(day::date, 'YYYY-MM-DD') AS date
       FROM generate_series(CURRENT_DATE + 2, CURRENT_DATE + 30, interval '1 day') AS day
      WHERE NOT EXISTS (
        SELECT 1 FROM public.capacity_reservations r
         WHERE r.confectioner_id = $1::uuid
           AND r.reserved_date = day::date
           AND r.status IN ('reserved', 'confirmed')
      )
      ORDER BY day
      LIMIT 1`,
    [confectionerId]
  );
  if (!freeDay.rows[0]?.date) throw new Error("no free demo confectioner capacity day in the next 30 days");
  deliveryDateFixture = freeDay.rows[0].date;
  // This test exercises checkout idempotency, not long-horizon production planning.
  // Keep the temporary demo product within one normal workday and restore its
  // original production duration in cleanup.
  await client.query(
    "UPDATE public.products SET production_time_hours = 1 WHERE id = $1::uuid",
    [PRODUCT_ID]
  );
  const customer = await login("customer@demo.ru");
  assert("логин customer@demo.ru", Boolean(customer));

  const body = checkoutBody();
  console.log(`\n  fixture: synthetic checkout (${RUN_TAG}), product=${PRODUCT_ID}, очистка в finally`);

  // === A. REPLAY: тот же ключ → тот же заказ («потерянный ответ» — то же самое) ===
  section("A. Replay: два POST с одним Idempotency-Key (последовательно)");
  const a1 = await api("POST", "/api/checkout", {
    token: customer,
    body,
    headers: { "Idempotency-Key": `${RUN_TAG}-a` },
  });
  assert("A1 create → 200", a1.status === 200, `got ${a1.status} ${JSON.stringify(a1.json).slice(0, 140)}`);
  const a2 = await api("POST", "/api/checkout", {
    token: customer,
    body,
    headers: { "Idempotency-Key": `${RUN_TAG}-a` },
  });
  assert("A2 retry (тот же ключ) → 200", a2.status === 200, `got ${a2.status} ${JSON.stringify(a2.json).slice(0, 140)}`);
  assert(
    "A: retry вернул ТОТ ЖЕ orderId (не дубль)",
    Boolean(a1.json?.orderId) && a1.json.orderId === a2.json.orderId,
    `${a1.json?.orderId} vs ${a2.json?.orderId}`
  );
  assert("A: replay помечен idempotentReplay:true", a2.json?.idempotentReplay === true);
  if (a1.json?.orderId) collectedOrderIds.push(a1.json.orderId);
  const dbA = await countOrdersByKey(`${RUN_TAG}-a`);
  assert("A: в БД ровно 1 заказ с этим ключом", dbA.n === 1, `n=${dbA.n}`);
  console.log(`  ids: A orderId=${a1.json?.orderId}`);

  // === B. БЕЗ КЛЮЧА: документируем текущий opt-in контракт (finding #2 U-07) ===
  section("B. Без Idempotency-Key — текущий opt-in контракт (finding U-07 #2)");
  const b1 = await api("POST", "/api/checkout", { token: customer, body });
  const b2 = await api("POST", "/api/checkout", { token: customer, body });
  assert("B1 (без ключа) → 200", b1.status === 200, `got ${b1.status}`);
  assert("B2 (без ключа) → 200", b2.status === 200, `got ${b2.status}`);
  assert(
    "B: два РАЗНЫХ заказа (дубли-защита = обязанность клиента, сервер лоялен)",
    Boolean(b1.json?.orderId) && Boolean(b2.json?.orderId) && b1.json.orderId !== b2.json.orderId,
    `${b1.json?.orderId} vs ${b2.json?.orderId}`
  );
  if (b1.json?.orderId) collectedOrderIds.push(b1.json.orderId);
  if (b2.json?.orderId) collectedOrderIds.push(b2.json.orderId);
  console.log(`  ids: B без ключа → ${b1.json?.orderId} и ${b2.json?.orderId}`);

  // === C. ГОНКА: 4 параллельных POST с одним ключом → ровно 1 заказ ===
  section("C. Гонка: 4 параллельных POST с одним Idempotency-Key (индекс 0060)");
  const keyC = `${RUN_TAG}-c`;
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      api("POST", "/api/checkout", { token: customer, body, headers: { "Idempotency-Key": keyC } })
    )
  );
  const statuses = responses.map((r) => r.status);
  const orderIds = [...new Set(responses.map((r) => r.json?.orderId).filter(Boolean))];
  assert("C: все 4 ответа → 200 (гонка не даёт 5xx/4xx)", statuses.every((s) => s === 200), `statuses=${statuses.join(",")}`);
  assert("C: все ответы вернули ОДИН orderId", orderIds.length === 1, `ids=${orderIds.join(",")}`);
  const dbC = await countOrdersByKey(keyC);
  assert("C: в БД ровно 1 заказ с этим ключом", dbC.n === 1, `n=${dbC.n}`);
  if (orderIds[0]) collectedOrderIds.push(orderIds[0]);
  console.log(`  ids: C (4× параллельно, ключ ${keyC}) → ${orderIds.join(", ")}`);

  // === D. ПОТЕРЯННЫЙ ОТВЕТ: запрос дошёл и обработался, ответ потерян → retry ===
  section("D. Lost response: POST отправлен, ответ потерян → retry с тем же ключом");
  const keyD = `${RUN_TAG}-d`;
  // Детерминированная сильная форма: запрос ушёл, ответ сознательно НЕ читаем
  // (имитация обрыва/таймаута ПОСЛЕ того, как сервер создал заказ). Ждём,
  // пока заказ появится в БД (сервер обработал «потерянный» запрос), затем
  // retry с тем же ключом обязан вернуть replay ЭТОГО заказа — не новый.
  const lostResponse = api("POST", "/api/checkout", {
    token: customer,
    body,
    headers: { "Idempotency-Key": keyD },
  }).catch(() => null); // ответ потерян — результат первого запроса игнорируем
  let dbDpre = { n: 0, ids: [] };
  for (let waited = 0; waited < 8000; waited += 100) {
    dbDpre = await countOrdersByKey(keyD);
    if (dbDpre.n === 1) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`  info: «потерянный» запрос обработан сервером=${dbDpre.n === 1} (его ответ выброшен)`);
  const d2 = await api("POST", "/api/checkout", {
    token: customer,
    body,
    headers: { "Idempotency-Key": keyD },
  });
  await lostResponse; // гасим фоновый промис (его данные не используются)
  assert("D: retry (тот же ключ) → 200", d2.status === 200, `got ${d2.status} ${JSON.stringify(d2.json).slice(0, 140)}`);
  const dbD = await countOrdersByKey(keyD);
  assert("D: в БД ровно 1 заказ с этим ключом (ни дубля, ни потери)", dbD.n === 1, `n=${dbD.n}`);
  if (dbDpre.n === 1) {
    assert(
      "D: retry вернул orderId «потерянного» запроса (replay, не дубль)",
      Boolean(d2.json?.orderId) && dbDpre.ids[0] === d2.json.orderId,
      `${dbDpre.ids[0]} vs ${d2.json?.orderId}`
    );
  }
  if (d2.json?.orderId) collectedOrderIds.push(d2.json.orderId);
  console.log(`  ids: D lost=${dbDpre.ids[0] || "-"} → retry=${d2.json?.orderId}`);

  console.log(`\n  ИТОГО: PASS ${passed}  FAIL ${failed}`);
  if (failed > 0) {
    console.log("  Проваленные проверки:");
    for (const f of failures) console.log(`   - ${f}`);
  }
  return failed === 0;
}

async function cleanupAll() {
  try {
    if (confectionerId) {
      if (originalCapacityConfig) {
        await client.query(
          `UPDATE public.confectioner_capacity
              SET workday_start_minute = $2, workday_end_minute = $3,
                  daily_capacity_minutes = $4, packaging_minutes = $5,
                  quality_check_minutes = $6, handoff_buffer_minutes = $7,
                  delivery_buffer_minutes = $8, is_active = $9
            WHERE user_id = $1::uuid`,
          [
            confectionerId,
            originalCapacityConfig.workday_start_minute,
            originalCapacityConfig.workday_end_minute,
            originalCapacityConfig.daily_capacity_minutes,
            originalCapacityConfig.packaging_minutes,
            originalCapacityConfig.quality_check_minutes,
            originalCapacityConfig.handoff_buffer_minutes,
            originalCapacityConfig.delivery_buffer_minutes,
            originalCapacityConfig.is_active,
          ]
        ).catch(() => {});
      } else {
        await client.query(
          "DELETE FROM public.confectioner_capacity WHERE user_id = $1::uuid",
          [confectionerId]
        ).catch(() => {});
      }
    }
    if (PRODUCT_ID && originalProductionTimeHours !== undefined) {
      await client.query(
        "UPDATE public.products SET production_time_hours = $2 WHERE id = $1::uuid",
        [PRODUCT_ID, originalProductionTimeHours]
      ).catch(() => {});
    }
    // Ключ-базированный догсбор: ловит заказ, созданный оборванным в D запросом
    const byKeys = await client
      .query(
        `SELECT id::text AS id FROM public.orders
          WHERE user_id = $1::uuid AND metadata->>'idempotency_key' = ANY($2)`,
        [CUSTOMER_USER_ID, IDEM_KEYS]
      )
      .catch(() => ({ rows: [] }));
    const allIds = [...new Set([...collectedOrderIds, ...byKeys.rows.map((r) => r.id)])];
    if (allIds.length > 0) {
      await client.query(`DELETE FROM public.product_reviews WHERE order_id = ANY($1::uuid[])`, [allIds]).catch(() => {});
      // Z-v19 §13 fix: financial_ledger ссылается на payments (FK
      // financial_ledger_payment_id_fkey) — ledger чистится ПЕРВЫМ,
      // иначе delete payments ломается и synthetic-строки остаются.
      await client
        .query(
          `DELETE FROM public.financial_ledger WHERE payment_id IN (SELECT id FROM public.payments WHERE order_id = ANY($1::uuid[]))`,
          [allIds]
        )
        .catch(() => {});
      await client.query(`DELETE FROM public.payments WHERE order_id = ANY($1::uuid[])`, [allIds]).catch(() => {});
      await client.query(`DELETE FROM public.order_items WHERE order_id = ANY($1::uuid[])`, [allIds]).catch(() => {});
      await client
        .query(`DELETE FROM public.domain_events WHERE entity_type='order' AND entity_id = ANY($1::text[])`, [allIds])
        .catch(() => {});
      await client
        .query(`DELETE FROM public.notifications WHERE metadata->>'orderId' = ANY($1::text[])`, [allIds])
        .catch(() => {});
      const del = await client.query(`DELETE FROM public.orders WHERE id = ANY($1::uuid[])`, [allIds]);
      console.log(`\n  cleanup: orders=${del.rowCount} (synthetic ${RUN_TAG}; payments/order_items/events/notifications вычищены)`);
    } else {
      console.log("\n  cleanup: нечего удалять (заказы не создались)");
    }
  } catch (err) {
    console.log(`\n  cleanup warning: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

let ok = false;
main()
  .then((r) => {
    ok = r === true;
  })
  .catch((err) => {
    console.error(`\n✖ FATAL: ${err.message}`);
    ok = false;
  })
  .finally(async () => {
    await cleanupAll();
    process.exit(ok ? 0 : 1);
  });
