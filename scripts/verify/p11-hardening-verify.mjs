/**
 * P1.1 Production Hardening — интеграционная регрессия (ТЗ §2/§3/§7/§8/§12/§13/§14).
 *
 * Покрывает:
 *  1. Payment webhook: Math.round копеек (дробные рубли больше не ломают
 *     зачисление), amount_mismatch при подмене суммы, защита «оплатить
 *     изменённый заказ старой суммой», идемпотентность повторного webhook.
 *  2. Event integrity: domain_events dedup_key (повторная запись → 1 строка),
 *     notifications dedup (уникальный индекс 0060).
 *  3. DB contracts 0060: reviews (1 заказ = 1 отзыв), orders idempotency key.
 *  4. Checkout idempotency: два параллельных POST с одним Idempotency-Key
 *     → один заказ (гонка закрыта индексом 0060).
 *  5. Order snapshot: изменение цены товара НЕ меняет старый заказ.
 *  6. Reviews authorization: чужой заказ → 403; не доставлен → 422.
 *  7. Chat: один order → одна комната (повторный ensure → тот же id).
 *  8. Wishlist: toggle добавил → удалил (сервер — источник истины).
 *
 * Запуск: node scripts/verify/p11-hardening-verify.mjs   (dev-сервер должен работать)
 * Все тестовые данные (metadata.test='p11-verify') удаляются в cleanup.
 */

import { Client } from "pg";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const PG_URL = process.env.PGURL || "postgresql://postgres@127.0.0.1:54329/conditera";
const PASSWORD = "Demo123!";
const CUSTOMER_USER_ID = "11111111-1111-4111-8111-111111111106"; // customer@demo.ru
const CONFECTIONER_USER_ID = "11111111-1111-4111-8111-111111111101"; // confectioner@demo.ru
const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-000000000002"; // tort-napoleon-domashniy

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

const RUN_IP = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function api(method, path, { token, body, headers: extraHeaders } = {}) {
  const headers = { "x-real-ip": RUN_IP, ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const r = await fetch(`${BASE}/api/csrf-token`, { headers: { "x-real-ip": RUN_IP } });
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
  const res = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
  if (res.status !== 200 || !res.json?.accessToken) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
  }
  return res.json.accessToken;
}

const rand = () => Math.floor(Math.random() * 1e9).toString(36);
const client = new Client({ connectionString: PG_URL });
const cleanup = {
  orderIds: [], // uuid[]
  paymentIds: [],
  eventDedupKeys: [],
  notificationDedupKeys: [],
  chatRoomIds: [],
  productPriceOriginal: null,
};

/** Создать тестовый заказ напрямую в БД (для webhook-кейсов) */
async function seedOrderWithPayment({ total, paymentAmount, number }) {
  const o = await client.query(
    `INSERT INTO public.orders
       (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total,
        status, payment_status, payment_method, delivery_address, delivery_city,
        delivery_date, delivery_type, metadata, paid_at)
     VALUES ($1, $2::uuid, $3::uuid, $4, 0, 0, $4, 'PENDING', 'pending', 'card',
             'ул. P11verify, 1', 'Москва', CURRENT_DATE + 2, 'delivery',
             jsonb_build_object('test','p11-verify'), NULL)
     RETURNING id::text`,
    [number, CUSTOMER_USER_ID, CONFECTIONER_USER_ID, total]
  );
  const orderId = o.rows[0].id;
  cleanup.orderIds.push(orderId);
  const providerPaymentId = `mock_p11_${rand()}_${number}`;
  const p = await client.query(
    `INSERT INTO public.payments (order_id, yookassa_payment_id, amount, currency, status, method, metadata)
     VALUES ($1::uuid, $2, $3, 'RUB', 'pending', 'yookassa', '{}'::jsonb)
     RETURNING id::text`,
    [orderId, providerPaymentId, paymentAmount]
  );
  cleanup.paymentIds.push(p.rows[0].id);
  return { orderId, providerPaymentId };
}

async function sendWebhookPaymentSucceeded(providerId, orderId, amountValue) {
  return api("POST", "/api/payment/webhook", {
    headers: { "x-real-ip": "2a02:5180::1" }, // dev: allowlist пропущен, заголовок не критичен
    body: {
      event: "payment.succeeded",
      object: {
        id: providerId,
        status: "succeeded",
        amount: { value: amountValue, currency: "RUB" },
        metadata: { orderId },
      },
    },
  });
}

async function getOrderPaymentStatus(orderId) {
  const r = await client.query(`SELECT payment_status, status FROM public.orders WHERE id = $1::uuid`, [orderId]);
  return r.rows[0] || {};
}

async function main() {
  await client.connect();
  const customer = await login("customer@demo.ru");
  const confectioner = await login("confectioner@demo.ru");
  assert("логины customer/confectioner", Boolean(customer && confectioner));

  // === 1. PAYMENT WEBHOOK ===
  section("Payment: копейки/округление/несоответствие/идемпотентность (§2)");

  // 1a. Копеечная сверка: суммы в БД — целые рубли (integer), провайдер шлёт
  //     строку с копейками; сверка идёт в копейках (Math.round — защита).
  const intTotal = 2457;
  const okPay = await seedOrderWithPayment({ total: intTotal, paymentAmount: intTotal, number: `P11V-OK-${rand()}` });
  const w1 = await sendWebhookPaymentSucceeded(okPay.providerPaymentId ?? `mock_p11_${rand()}`, okPay.orderId, "2457.00");
  assert("webhook целой суммы → 200", w1.status === 200, `got ${w1.status}`);
  assert(
    "заказ 2457 ₽ зачислен в escrow (копеечная сверка сходится)",
    (await getOrderPaymentStatus(okPay.orderId)).payment_status === "escrow",
    JSON.stringify(await getOrderPaymentStatus(okPay.orderId))
  );
  // Повторный webhook — идемпотентность (CAS не даёт второй раз)
  const w1b = await sendWebhookPaymentSucceeded(okPay.providerPaymentId ?? "mock_x", okPay.orderId, "2457.00");
  const st1b = await getOrderPaymentStatus(okPay.orderId);
  assert("повторный webhook → idempotent, статус не меняется", w1b.status === 200 && st1b.payment_status === "escrow", JSON.stringify(st1b));

  // 1b. Подменённая сумма платежа → amount_mismatch, не зачисляется
  const badPay = await seedOrderWithPayment({ total: intTotal, paymentAmount: intTotal, number: `P11V-BAD-${rand()}` });
  const providerId = (await client.query(`SELECT yookassa_payment_id FROM public.payments WHERE order_id=$1::uuid`, [badPay.orderId])).rows[0].yookassa_payment_id;
  const w2 = await sendWebhookPaymentSucceeded(providerId, badPay.orderId, "9999.00");
  assert(
    "webhook с другой суммой → skipped amount_mismatch",
    w2.status === 200 && w2.json?.skipped === "amount_mismatch",
    JSON.stringify(w2.json)
  );
  assert(
    "заказ при amount_mismatch НЕ в escrow",
    (await getOrderPaymentStatus(badPay.orderId)).payment_status !== "escrow"
  );

  // 1c. Изменённый заказ: payment.amount ≠ orders.total → оплата старой суммой невозможна
  const modPay = await seedOrderWithPayment({ total: 10000, paymentAmount: intTotal, number: `P11V-MOD-${rand()}` });
  const modProviderId = (await client.query(`SELECT yookassa_payment_id FROM public.payments WHERE order_id=$1::uuid`, [modPay.orderId])).rows[0].yookassa_payment_id;
  const w3 = await sendWebhookPaymentSucceeded(modProviderId, modPay.orderId, "2457.00");
  assert(
    "оплатить изменённый заказ старой суммой → skipped (P1.1 §2)",
    w3.status === 200 && w3.json?.skipped === "amount_mismatch" && (await getOrderPaymentStatus(modPay.orderId)).payment_status !== "escrow",
    JSON.stringify({ body: w3.json, order: await getOrderPaymentStatus(modPay.orderId) })
  );

  // === 2. CHECKOUT IDEMPOTENCY (§8) ===
  section("Checkout: параллельные POST с одним Idempotency-Key");
  const today = new Date(Date.now() + 2 * 86400_000);
  const deliveryDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const idemKey = `p11-verify-${rand()}`;
  const checkoutBody = {
    cartItems: [{ product_id: PRODUCT_ID, quantity: 1 }],
    deliveryCity: "Москва",
    deliveryAddress: "ул. Тестовая, 5, кв 1",
    deliveryType: "delivery",
    deliveryDate,
    customerName: "P11 Verify",
    customerPhone: "+7 900 000-11-22",
  };
  const [c1, c2] = await Promise.all([
    api("POST", "/api/checkout", { token: customer, body: checkoutBody, headers: { "Idempotency-Key": idemKey } }),
    api("POST", "/api/checkout", { token: customer, body: checkoutBody, headers: { "Idempotency-Key": idemKey } }),
  ]);
  assert("checkout #1 → 200/201", [200, 201].includes(c1.status), `got ${c1.status} ${JSON.stringify(c1.json).slice(0, 140)}`);
  assert("checkout #2 → 200/201 (replay, не ошибка)", [200, 201].includes(c2.status), `got ${c2.status} ${JSON.stringify(c2.json).slice(0, 140)}`);
  const sameOrder = c1.json?.orderId && c1.json.orderId === c2.json.orderId;
  assert("оба ответа вернули ОДИН orderId", Boolean(sameOrder), `${c1.json?.orderId} vs ${c2.json?.orderId}`);
  if (c1.json?.orderId) cleanup.orderIds.push(c1.json.orderId);
  const idemCount = await client.query(
    `SELECT count(*)::int AS n FROM public.orders WHERE user_id = $1::uuid AND metadata->>'idempotency_key' = $2`,
    [CUSTOMER_USER_ID, idemKey]
  );
  assert("в БД ровно один заказ с этим ключом", idemCount.rows[0].n === 1, String(idemCount.rows[0].n));

  const verifyOrderId = c1.json?.orderId;

  // === 3. ORDER SNAPSHOT INTEGRITY (§7) ===
  section("Snapshot: изменение товара не меняет старый заказ");
  if (verifyOrderId) {
    const before = await client.query(
      `SELECT oi.unit_price, oi.total, o.total AS order_total FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE oi.order_id = $1::uuid LIMIT 1`,
      [verifyOrderId]
    );
    const origPrice = before.rows[0]?.unit_price;
    cleanup.productPriceOriginal = { id: PRODUCT_ID, price: (await client.query(`SELECT price FROM public.products WHERE id = $1::uuid`, [PRODUCT_ID])).rows[0].price };
    await client.query(`UPDATE public.products SET price = $2 WHERE id = $1::uuid`, [PRODUCT_ID, Number(cleanup.productPriceOriginal.price) + 777]);
    const after = await client.query(
      `SELECT oi.unit_price, oi.total, o.total AS order_total FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE oi.order_id = $1::uuid LIMIT 1`,
      [verifyOrderId]
    );
    assert(
      "цена товара выросла — заказ НЕ изменился",
      Number(after.rows[0].unit_price) === Number(origPrice) && Number(after.rows[0].order_total) === Number(before.rows[0].order_total),
      JSON.stringify({ before: before.rows[0], after: after.rows[0] })
    );
  } else {
    assert("snapshot: есть заказ для проверки", false, "checkout не создал заказ");
  }

  // === 4. EVENT INTEGRITY (§3) ===
  section("Events: dedup_key domain_events + notifications");
  const dedupKey = `p11-dedup-${rand()}`;
  cleanup.eventDedupKeys.push(dedupKey);
  const insertEvent = () =>
    client.query(
      `INSERT INTO public.domain_events (type, entity_type, entity_id, actor_id, payload, source, dedup_key)
       VALUES ('p11.test', 'order', $1::uuid, NULL, '{}'::jsonb, 'app', $2)
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
      [cleanup.orderIds[0] ?? CUSTOMER_USER_ID, dedupKey]
    );
  await insertEvent();
  const second = await insertEvent();
  const evCount = await client.query(`SELECT count(*)::int AS n FROM public.domain_events WHERE dedup_key = $1`, [dedupKey]);
  assert("повторная запись события → 1 строка (ON CONFLICT DO NOTHING)", evCount.rows[0].n === 1 && second.rowCount === 0, `rows=${evCount.rows[0].n}, second=${second.rowCount}`);

  const notifDedup = `p11-notif-${rand()}`;
  cleanup.notificationDedupKeys.push(notifDedup);
  const insertNotif = () =>
    client.query(
      `INSERT INTO public.notifications (user_id, type, channel, status, title, body, metadata)
       VALUES ($1::uuid, 'P11_TEST', 'in_app', 'queued', 'P11.1 dedup', 'test', jsonb_build_object('dedup_key', $2::text))`,
      [CUSTOMER_USER_ID, notifDedup]
    );
  await insertNotif();
  let notifDupBlocked = false;
  try {
    await insertNotif();
  } catch (e) {
    notifDupBlocked = e.code === "23505";
  }
  const notifCount = await client.query(
    `SELECT count(*)::int AS n FROM public.notifications WHERE metadata->>'dedup_key' = $1`,
    [notifDedup]
  );
  assert(
    "повторный notification с тем же dedup_key → 23505 (индекс 0060)",
    notifDupBlocked && notifCount.rows[0].n === 1,
    `blocked=${notifDupBlocked}, rows=${notifCount.rows[0].n}`
  );

  // === 5. DB CONTRACTS (§13) ===
  section("DB: один отзыв на заказ, уникальность idempotency_key заказа");
  if (verifyOrderId) {
    const itemId = (await client.query(`SELECT product_id FROM public.order_items WHERE order_id = $1::uuid LIMIT 1`, [verifyOrderId])).rows[0]?.product_id;
    const insReview = () =>
      client.query(
        `INSERT INTO public.product_reviews (product_id, user_id, order_id, rating, text, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 5, 'P11.1 verify', 'approved')`,
        [itemId, CUSTOMER_USER_ID, verifyOrderId]
      );
    await insReview().catch(() => {});
    let reviewDupBlocked = false;
    try {
      await insReview();
    } catch (e) {
      reviewDupBlocked = e.code === "23505";
    }
    assert("второй отзыв на тот же заказ → 23505 (uq_product_reviews_order)", reviewDupBlocked);
  }
  const orderDedupKey = `p11-order-key-${rand()}`;
  const insOrder = () =>
    client.query(
      `INSERT INTO public.orders (number, user_id, total, status, metadata)
       VALUES ($1, $2::uuid, 100, 'PENDING', jsonb_build_object('idempotency_key', $3::text, 'test','p11-verify'))`,
      [`P11V-IDEM-${rand()}`, CUSTOMER_USER_ID, orderDedupKey]
    );
  await insOrder().catch(() => {});
  let orderDupBlocked = false;
  try {
    await insOrder();
  } catch (e) {
    orderDupBlocked = e.code === "23505";
  }
  assert("второй заказ с тем же idempotency_key → 23505 (uq_orders_idempotency)", orderDupBlocked);
  // Cleanup этих заказов
  const idemOrders = await client.query(
    `SELECT id::text FROM public.orders WHERE user_id=$1::uuid AND metadata->>'idempotency_key' = $2`,
    [CUSTOMER_USER_ID, orderDedupKey]
  );
  idemOrders.rows.forEach((r) => cleanup.orderIds.push(r.id));

  // === 6. REVIEWS AUTHORIZATION (§13/§15) ===
  section("Reviews: авторизация и статус-гейт");
  if (verifyOrderId) {
    const alien = await api("POST", "/api/reviews", { token: confectioner, body: { orderId: verifyOrderId, rating: 5, text: "чужой заказ" } });
    assert("отзыв за ЧУЖОЙ заказ → 403", alien.status === 403, `got ${alien.status}`);
    const ownPending = await api("POST", "/api/reviews", { token: customer, body: { orderId: verifyOrderId, rating: 5, text: "ещё не доставлен" } });
    assert("отзыв на недоставленный заказ → 422", ownPending.status === 422, `got ${ownPending.status}`);
  }

  // === 7. CHAT: один order = одна комната (§12) ===
  section("Chat: одна комната на заказ");
  if (verifyOrderId) {
    const r1 = await api("POST", "/api/chat/rooms", { token: customer, body: { type: "order", orderId: verifyOrderId } });
    const r2 = await api("POST", "/api/chat/rooms", { token: customer, body: { type: "order", orderId: verifyOrderId } });
    const id1 = r1.json?.room?.id;
    const id2 = r2.json?.room?.id;
    assert("ensure дважды → 200", r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status}`);
    assert("обе попытки вернули ОДНУ комнату", Boolean(id1 && id1 === id2), `${id1} vs ${id2}`);
    if (id1) cleanup.chatRoomIds.push(id1);
    const alienRoom = await api("POST", "/api/chat/rooms", { token: confectioner, body: { type: "order", orderId: verifyOrderId } });
    // confectioner НЕ владелец заказа — но staff может; проверяем только отсутствие crash:
    assert("чужой ensure не падает (200/403)", [200, 403].includes(alienRoom.status), `got ${alienRoom.status}`);
    if (alienRoom.json?.room?.id) cleanup.chatRoomIds.push(alienRoom.json.room.id);
  }

  // === 8. WISHLIST toggle (§14) ===
  section("Wishlist: сервер — источник истины");
  const wa = await api("POST", "/api/wishlist", { token: customer, body: { productId: PRODUCT_ID } });
  const list1 = await api("GET", "/api/wishlist", { token: customer });
  const inList = (list1.json?.items || list1.json?.products || []).some?.((x) => x.product_id === PRODUCT_ID || x.id === PRODUCT_ID);
  const wb = await api("POST", "/api/wishlist", { token: customer, body: { productId: PRODUCT_ID } });
  const list2 = await api("GET", "/api/wishlist", { token: customer });
  const outList = !(list2.json?.items || list2.json?.products || []).some?.((x) => x.product_id === PRODUCT_ID || x.id === PRODUCT_ID);
  assert("add → товар в списке", [200, 201].includes(wa.status) && Boolean(inList), `${wa.status} in=${inList}`);
  assert("remove (повторный toggle) → товара нет", [200, 201].includes(wb.status) && outList, `${wb.status} out=${outList}`);

  console.log(`\n  ИТОГО: PASS ${passed}  FAIL ${failed}`);
  if (failed > 0) {
    console.log("  Проваленные проверки:");
    for (const f of failures) console.log(`   - ${f}`);
  }
  return failed === 0;
}

async function cleanupAll() {
  try {
    // Уникальные строки product_reviews verify-заказов удалятся каскадом с заказами? — удаляем явно
    for (const oid of cleanup.orderIds) {
      await client.query(`DELETE FROM public.product_reviews WHERE order_id = $1::uuid`, [oid]).catch(() => {});
    }
    if (cleanup.chatRoomIds.length > 0) {
      await client.query(`DELETE FROM public.chat_messages WHERE channel_id = ANY($1::uuid[])`, [cleanup.chatRoomIds]).catch(() => {});
      await client.query(`DELETE FROM public.chat_channels WHERE id = ANY($1::uuid[])`, [cleanup.chatRoomIds]).catch(() => {});
    }
    if (cleanup.paymentIds.length > 0) {
      await client.query(`DELETE FROM public.payments WHERE id = ANY($1::uuid[])`, [cleanup.paymentIds]).catch(() => {});
    }
    if (cleanup.orderIds.length > 0) {
      await client.query(`DELETE FROM public.order_items WHERE order_id = ANY($1::uuid[])`, [cleanup.orderIds]).catch(() => {});
      await client.query(`DELETE FROM public.ops_tasks WHERE entity_id = ANY($1::text[]) AND metadata->>'test' = 'p11-verify'`, [cleanup.orderIds]).catch(() => {});
      await client.query(`DELETE FROM public.domain_events WHERE entity_type='order' AND entity_id = ANY($1::text[])`, [cleanup.orderIds]).catch(() => {});
      await client.query(`DELETE FROM public.orders WHERE id = ANY($1::uuid[])`, [cleanup.orderIds]).catch(() => {});
    }
    if (cleanup.eventDedupKeys.length > 0) {
      await client.query(`DELETE FROM public.domain_events WHERE dedup_key = ANY($1)`, [cleanup.eventDedupKeys]).catch(() => {});
    }
    if (cleanup.notificationDedupKeys.length > 0) {
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'dedup_key' = ANY($1)`, [cleanup.notificationDedupKeys]).catch(() => {});
    }
    if (cleanup.productPriceOriginal) {
      await client
        .query(`UPDATE public.products SET price = $2 WHERE id = $1::uuid`, [cleanup.productPriceOriginal.id, cleanup.productPriceOriginal.price])
        .catch(() => {});
    }
    console.log(`\n  cleanup: заказов=${cleanup.orderIds.length}, чатов=${cleanup.chatRoomIds.length}`);
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
