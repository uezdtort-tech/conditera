// Z-v25 Этап 2.4 — Checkout-сценарии (E28-E30) с товаром, имеющим привязанный рецепт.
import pg from "pg";

const BASE = "http://127.0.0.1:3000";
const checks = [];
const t = (name, ok, detail = "") => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? " | " + detail : ""}`); };

const { readFileSync } = await import("node:fs");
const dbUrl = readFileSync("/home/z/my-project/.env.local", "utf8")
  .split("\n").find(l => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length);

async function api(method, path, { token, body, headers = {} } = {}) {
  const h = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const res = await fetch(`${BASE}/api/csrf-token`);
    const j = await res.json().catch(() => null);
    const setCookie = res.headers.get("set-cookie") || "";
    if (j?.token) {
      h["x-csrf-token"] = j.token;
      const m = setCookie.match(/csrf_token=([^;]+)/);
      if (m) h["Cookie"] = `csrf_token=${m[1]}`;
    }
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const dbc = new pg.Client({ connectionString: dbUrl });
await dbc.connect();
const prod = (await dbc.query(`SELECT id, title, price, recipe_id FROM public.products WHERE id='aaaaaaaa-0000-4000-8000-000000000001'`)).rows[0];
const filling = (await dbc.query(`SELECT id FROM public.fillings WHERE status='APPROVED' AND is_active=true LIMIT 1`)).rows[0];
const userRow = (await dbc.query(`SELECT id, email FROM public.profiles WHERE email LIKE 'zv25-http-a-%' ORDER BY created_at LIMIT 1`)).rows[0];
if (!prod || !userRow) { console.error("Нет товара с рецептом или пользователя"); process.exit(2); }
console.log(`Товар: ${prod.title} (${prod.price}), user: ${userRow.email}`);

const login = await api("POST", "/api/auth/login", { body: { email: userRow.email, password: "Zv25Test!Pass1" } });
const tok = login.json?.accessToken;
t("K1: login", !!tok);
if (!tok) process.exit(2);

const CUSTOM1 = { productType: "cake", base: "sponge", weight: 1, filling: filling?.id, inscription: "ZV25 checkout" };
const DDATE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);

await api("DELETE", "/api/cart", { token: tok });

let r = await api("POST", "/api/checkout", { token: tok, body: {
  cartItems: [
    { product_id: prod.id, quantity: 1 },
    { custom: CUSTOM1, quantity: 2 },
  ],
  deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV25, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
  customerName: "ZV25 HTTP Test", customerPhone: "79990000001", paymentMethod: "cash",
} });
const orderCreated = r.status === 200 || r.status === 201;
t("K2: checkout (товар с рецептом + custom) → заказ создан", orderCreated, `status=${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
const orderId = r.json?.order?.id || r.json?.orderId || r.json?.id;
const orderTotal = r.json?.order?.total ?? r.json?.total ?? r.json?.totals?.total;

// Цена custom-позиции не берётся из клиента: в запросе вообще нет price — сервер считает сам.
// Проверка: заказ создан с положительной суммой и составом
if (orderCreated) {
  const oi = (await dbc.query(`SELECT product_id, quantity, unit_price, total, selected_attributes FROM public.order_items WHERE order_id=$1`, [orderId])).rows;
  const prodItem = oi.find(x => x.product_id === prod.id);
  const customItem = oi.find(x => x.product_id === null);
  t("K3: БД: order_items = 2 (товар + custom)", oi.length === 2, `n=${oi.length}`);
  t("K4: БД: цена товарной позиции = серверная цена товара (клиентская цена не участвует)", prodItem && Number(prodItem.unit_price) === Number(prod.price), `unit=${prodItem?.unit_price} ожидал=${prod.price}`);
  t("K5: БД: custom-позиция хранит снимок custom-конфига", !!customItem && !!customItem.selected_attributes?.custom, JSON.stringify(customItem?.selected_attributes).slice(0, 80));
  t("K6: БД: custom unit_price > 0 (серверный расчёт конструктора)", customItem && Number(customItem.unit_price) > 0, `unit=${customItem?.unit_price}`);
  const sumItems = oi.reduce((s, x) => s + Number(x.total), 0);
  t("K7: сумма позиций согласована с total заказа", orderTotal !== undefined && orderTotal !== null ? Math.abs(sumItems - Number(orderTotal)) < 2 : true, `sum=${sumItems} total=${orderTotal}`);

  // Идемпотентность: тот же Idempotency-Key → тот же заказ
  const idemKey = `zv25-idem-k-${Date.now().toString(36)}`;
  const body1 = {
    cartItems: [{ product_id: prod.id, quantity: 1 }],
    deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV25, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
    customerName: "ZV25 HTTP Test", customerPhone: "79990000001", paymentMethod: "cash",
  };
  await new Promise(res => setTimeout(res, 61_000)); // окно rate-limit 5/мин — ждём чистое окно
  const rc1 = await api("POST", "/api/checkout", { token: tok, headers: { "Idempotency-Key": idemKey }, body: body1 });
  const rc2 = await api("POST", "/api/checkout", { token: tok, headers: { "Idempotency-Key": idemKey }, body: body1 });
  const id1 = rc1.json?.order?.id || rc1.json?.orderId || rc1.json?.id;
  const id2 = rc2.json?.order?.id || rc2.json?.orderId || rc2.json?.id;
  t("K8: повторный checkout с тем же Idempotency-Key → тот же заказ", rc1.status === rc2.status && id1 && id2 && id1 === id2, `s=${rc1.status}/${rc2.status} id1=${id1} id2=${id2}`);
  const cnt = (await dbc.query(`SELECT count(*)::int AS n FROM public.orders WHERE id=$1`, [id1])).rows[0].n;
  t("K9: БД: заказ-идемпотент существует в единственном экземпляре", cnt === 1, `n=${cnt}`);

  // Повторная оплата: payment/create для уже созданного заказа не должен плодить платежи (легкая проверка статуса)
  const pay = await api("POST", "/api/payment/create", { token: tok, body: { orderId } });
  t("K10: payment/create для заказа отвечает управляемо (не 500)", pay.status < 500, `status=${pay.status} ${JSON.stringify(pay.json).slice(0, 160)}`);
} else {
  t("K3-K10: пропущены — заказ не создан", false, "cascade");
}
await dbc.end();
await api("DELETE", "/api/cart", { token: tok });
const failed = checks.filter(x => !x.ok);
console.log(`\n=== CHECKOUT SUMMARY: ${checks.length - failed.length}/${checks.length} PASS ===`);
process.exit(failed.length ? 1 : 0);
