/**
 * Z-v27 Этап 6.2/7 — реальный checkout через HTTP API (главный dev-сервер).
 *
 * Проверки:
 *  L1  register синтетического пользователя (zv27-http-*)
 *  L2  GET /api/products → 200
 *  L3  cart: добавить товар aaaa-0001 («Ягодный бархат», рецепт есть, Ягоды нет)
 *  L4  checkout товара → 422 (F1 на HTTP-уровне) + reasons
 *  L5  после 422: заказ НЕ создан, корзина НЕ очищена, capacity_reservations нет,
 *      inventory_movements нет
 *  L6  checkout custom-позиции (конструктор) → 200/201, заказ + stub-платёж
 *  L7  идемпотентность: повтор с тем же Idempotency-Key → тот же orderId
 *  L8  snapshot: order_items содержит серверную цену, totals корректны
 *  L9  cleanup: удаление своих артефактов (заказы, корзина, пользователь)
 */
import pg from "pg";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const RND = Date.now().toString(36);
const EMAIL = `zv27-http-${RND}@conditera.local`;
const PHONE = `7997${String(Math.floor(1000000 + Math.random() * 8999999))}`;
const PASSWORD = "Zv26Test!Pass1";
const PRODUCT = "aaaaaaaa-0000-4000-8000-000000000001"; // Ягодный бархат (рецепт есть, Ягоды нет)
const IDEM_KEY = `zv27-idem-${RND}`;

let passed = 0, failed = 0;
const failures = [];
function t(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ✔ ${name}${detail ? " — " + detail : ""}`); }
  else { failed++; failures.push(name); console.log(`  ✖ ${name}${detail ? " — " + detail : ""}`); }
}

const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const dbc = new pg.Client({ connectionString: dbUrl });
await dbc.connect();

// Рандомный IP на прогон — иначе checkout rate-limit (5/min per IP) унаследует
// лимиты предыдущих прогонов с 127.0.0.1 (сам лимитер при этом честно PASS).
const RUN_IP = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function api(method, path, { token, body, headers = {} } = {}) {
  const h = { "Content-Type": "application/json", "x-real-ip": RUN_IP, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const res = await fetch(`${BASE}/api/csrf-token`);
    const j = await res.json().catch(() => null);
    const sc = res.headers.get("set-cookie") || "";
    if (j?.token) {
      h["x-csrf-token"] = j.token;
      const m = sc.match(/csrf_token=([^;]+)/);
      if (m) h["Cookie"] = `csrf_token=${m[1]}`;
    }
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function countOrders(userId) {
  const r = await dbc.query(`SELECT count(*)::int AS n FROM public.orders WHERE user_id=$1::uuid`, [userId]);
  return r.rows[0].n;
}

// L1 — регистрация/логин
let tok = null, userId = null;
{
  const r = await api("POST", "/api/auth/register", { body: { email: EMAIL, password: PASSWORD, name: "ZV26 HTTP Test", phone: PHONE } });
  tok = r.json?.accessToken || null;
  if (!tok) {
    const l = await api("POST", "/api/auth/login", { body: { email: EMAIL, password: PASSWORD } });
    tok = l.json?.accessToken || null;
  }
  t("L1 пользователь аутентифицирован", !!tok, EMAIL);
  if (tok) {
    const me = await api("GET", "/api/auth/me", { token: tok });
    userId = me.json?.user?.id ?? me.json?.id ?? null;
    if (!userId) {
      const db = await dbc.query(`SELECT id::text FROM public.profiles WHERE email=$1`, [EMAIL]);
      userId = db.rows[0]?.id ?? null;
    }
    t("L1b userId определён", !!userId, userId ?? "");
  }
}
if (!tok || !userId) { console.error("нет токена — прерываю"); process.exit(2); }

// L2 — каталог
{
  const r = await api("GET", "/api/products");
  t("L2 GET /api/products → 200", r.status === 200, `status=${r.status}`);
}

// L3 — корзина: товар
{
  await api("DELETE", "/api/cart", { token: tok });
  const r = await api("POST", "/api/cart", { token: tok, body: { client_ref: "zv27-p1", product_id: PRODUCT, quantity: 1 } });
  t("L3 товар добавлен в корзину", r.status === 200 && r.json?.mode === "inserted", `status=${r.status}`);
}

// L4 — товарный checkout → 422 (F1)
{
  const DDATE = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const before = await countOrders(userId);
  const r = await api("POST", "/api/checkout", { token: tok, headers: { "Idempotency-Key": IDEM_KEY }, body: {
    cartItems: [{ product_id: PRODUCT, quantity: 1 }],
    deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV26, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
    customerName: "ZV26 HTTP Test", customerPhone: PHONE, paymentMethod: "cash",
  } });
  const codes = (r.json?.reasons ?? []).map((x) => x.code);
  t("L4 товарный checkout → 422 (блокировка гейта, F1)", r.status === 422, `status=${r.status}`);
  t("L4b reasons содержат блокирующие коды данных", codes.includes("RECIPE_MISSING") === false && (codes.includes("LOW_STOCK") || codes.includes("PURCHASE_ETA_MISSING")), `codes=${codes.join("|")}`);
  const after = await countOrders(userId);
  t("L5 заказ НЕ создан после 422", after === before, `before=${before} after=${after}`);
  // корзина не очищена
  const cart = await api("GET", "/api/cart", { token: tok });
  t("L5b корзина НЕ очищена после неудачного checkout", cart.status === 200 && (cart.json?.items?.length ?? 0) >= 1, `items=${cart.json?.items?.length}`);
  // нет side-эффектов
  const mv = await dbc.query(`SELECT count(*)::int AS n FROM public.inventory_movements`);
  const rv = await dbc.query(`SELECT count(*)::int AS n FROM public.capacity_reservations`);
  t("L5c inventory_movements не изменились (журнал = 12, без движений)", mv.rows[0].n === 12, `n=${mv.rows[0].n}`);
  t("L5d capacity_reservations пуст", rv.rows[0].n === 0, `n=${rv.rows[0].n}`);
}

// L6 — custom checkout (конструктор) → happy path
let orderId = null, orderNumber = null, total1 = null;
{
  const filling = (await dbc.query(`SELECT id::text FROM public.fillings WHERE status='APPROVED' AND is_active=true LIMIT 1`)).rows[0];
  const CUSTOM = { productType: "cake", base: "sponge", weight: 1, filling: filling?.id, inscription: "ZV26 checkout" };
  const DDATE = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const r = await api("POST", "/api/checkout", { token: tok, headers: { "Idempotency-Key": IDEM_KEY }, body: {
    cartItems: [{ custom: CUSTOM, quantity: 2 }],
    deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV26, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
    customerName: "ZV26 HTTP Test", customerPhone: PHONE, paymentMethod: "cash",
  } });
  orderId = r.json?.orderId ?? r.json?.order?.id ?? r.json?.id ?? null;
  orderNumber = r.json?.orderNumber ?? r.json?.order?.number ?? null;
  total1 = r.json?.total ?? r.json?.order?.total ?? null;
  t("L6 custom checkout → заказ создан", (r.status === 200 || r.status === 201) && !!orderId, `status=${r.status} order=${orderNumber} total=${total1}`);
  t("L6b stub-платёж (YooKassa не настроена — честный isStub)", r.json?.isStub === true || !!r.json?.paymentUrl, `isStub=${r.json?.isStub}`);
}

// L7 — идемпотентность
if (orderId) {
  const filling = (await dbc.query(`SELECT id::text FROM public.fillings WHERE status='APPROVED' AND is_active=true LIMIT 1`)).rows[0];
  const CUSTOM = { productType: "cake", base: "sponge", weight: 1, filling: filling?.id, inscription: "ZV26 checkout" };
  const DDATE = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const r = await api("POST", "/api/checkout", { token: tok, headers: { "Idempotency-Key": IDEM_KEY }, body: {
    cartItems: [{ custom: CUSTOM, quantity: 2 }],
    deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV26, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
    customerName: "ZV26 HTTP Test", customerPhone: PHONE, paymentMethod: "cash",
  } });
  const orderId2 = r.json?.orderId ?? r.json?.order?.id ?? r.json?.id ?? null;
  t("L7 повтор с тем же Idempotency-Key → тот же заказ (без дубля)", orderId2 === orderId, `order1=${orderId} order2=${orderId2}`);
  const n = await countOrders(userId);
  t("L7b в БД ровно один заказ пользователя", n === 1, `n=${n}`);
}

// L8 — snapshot
if (orderId) {
  const oi = await dbc.query(
    `SELECT product_id::text, product_title, unit_price::text, quantity, total::text, selected_attributes
     FROM public.order_items WHERE order_id=$1::uuid`, [orderId]);
  const o = await dbc.query(`SELECT number, total::text, promo_code, delivery_cost::text, status, payment_status FROM public.orders WHERE id=$1::uuid`, [orderId]);
  t("L8 order_items содержит snapshot позиции", oi.rows.length === 1 && Number(oi.rows[0].quantity) === 2, `rows=${oi.rows.length}`);
  t("L8b total заказа корректен (= sum items)", Number(o.rows[0].total) === Number(oi.rows.reduce((s, i) => s + Number(i.total), 0)), `total=${o.rows[0].total}`);
  t("L8c selected_attributes (конфиг) сохранён", !!oi.rows[0].selected_attributes && typeof oi.rows[0].selected_attributes === "object");
}

// L9 — cleanup (только свои артефакты; порядок с учётом FK financial_ledger→payments)
{
  const targets = await dbc.query(
    `SELECT o.id::text AS oid FROM public.orders o JOIN public.profiles p ON p.id=o.user_id
     WHERE p.email LIKE 'zv27-http-%'`);
  for (const row of targets.rows) {
    const oid = row.oid;
    await dbc.query(`DELETE FROM public.financial_ledger WHERE payment_id IN (SELECT id FROM public.payments WHERE order_id=$1::uuid)`, [oid]);
    await dbc.query(`DELETE FROM public.payments WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.order_status_history WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.order_items WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.capacity_reservations WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.orders WHERE id=$1::uuid`, [oid]);
  }
  await api("DELETE", "/api/cart", { token: tok });
  const left = await countOrders(userId);
  t("L9 cleanup: заказы пользователя удалены", left === 0, `left=${left}`);
  if (left === 0) {
    await dbc.query(`DELETE FROM public.cart_items WHERE user_id=$1::uuid`, [userId]);
    await dbc.query(`DELETE FROM public.sessions WHERE "userId"=$1`, [userId]);
    await dbc.query(`DELETE FROM public.profiles WHERE id=$1::uuid AND email LIKE 'zv27-http-%'`, [userId]);
    const chk = await dbc.query(`SELECT count(*)::int AS n FROM public.profiles WHERE id=$1::uuid`, [userId]);
    t("L9b синтетический пользователь удалён", chk.rows[0].n === 0);
  }
}

console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
if (failures.length) console.log(`Failures: ${failures.join("; ")}`);
await dbc.end();
process.exit(failed > 0 ? 1 : 0);
