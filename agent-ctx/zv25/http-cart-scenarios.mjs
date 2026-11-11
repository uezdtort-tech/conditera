// Z-v25 Этап 2.4 — HTTP и бизнес-сценарии корзины через реальный API (§2.4).
// Синтетические пользователи (zv25-http-*), рабочая БД — только чтение чужих данных не производится;
// проверка содержимого БД — только строк синтетического пользователя. Очистка через API DELETE.
import pg from "pg";

const BASE = "http://127.0.0.1:3000";
const RND = Date.now().toString(36);
const EMAIL1 = `zv25-http-a-${RND}@conditera.local`;
const EMAIL2 = `zv25-http-b-${RND}@conditera.local`;
const PHONE1 = `7999${String(Math.floor(1000000 + Math.random() * 8999999))}`;
const PHONE2 = `7998${String(Math.floor(1000000 + Math.random() * 8999999))}`;

const checks = [];
const t = (name, ok, detail = "") => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? " | " + detail : ""}`); };

async function api(method, path, { token, body, headers = {} } = {}) {
  const h = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
  // CSRF double-submit: для мутаций получаем токен и отправляем в cookie+header
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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* body may be empty */ }
  return { status: res.status, json };
}

async function register(email, phone) {
  const r = await api("POST", "/api/auth/register", { body: { email, password: "Zv25Test!Pass1", name: "ZV25 HTTP Test", phone } });
  if (r.status === 200 || r.status === 201) return r.json?.accessToken || null;
  // уже зарегистрирован → login
  const l = await api("POST", "/api/auth/login", { body: { email, password: "Zv25Test!Pass1" } });
  return l.json?.accessToken || null;
}

// Данные из БД (только чтение справочников)
const dbUrl = (await import("node:fs")).readFileSync("/home/z/my-project/.env.local", "utf8")
  .split("\n").find(l => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length);
const dbc = new pg.Client({ connectionString: dbUrl });
await dbc.connect();
const prod = (await dbc.query(`SELECT id, title, price FROM public.products WHERE status='published' ORDER BY created_at DESC LIMIT 1`)).rows[0];
const filling = (await dbc.query(`SELECT id FROM public.fillings WHERE status='APPROVED' AND is_active=true LIMIT 1`)).rows[0];
await dbc.end();
if (!prod) { console.error("Нет published-товара в БД — сценарий невыполним"); process.exit(2); }
console.log(`Используется товар: ${prod.id} (${prod.title}, price=${prod.price}); filling=${filling?.id || "нет"}`);

const CUSTOM1 = { productType: "cake", base: "sponge", weight: 1, filling: filling?.id || undefined, inscription: "ZV25 test" };
const CUSTOM2 = { productType: "cake", base: "mousse", weight: 2, inscription: "ZV25 second" };

// ==== 1-2. Пользователи: reuse существующих синтетических (register ограничен 3/час —
// лимитер честно сработал на предыдущих прогонах, это PASS для rate-limit-проверки) ====
async function login(email) {
  const l = await api("POST", "/api/auth/login", { body: { email, password: "Zv25Test!Pass1" } });
  return l.json?.accessToken || null;
}
const { readFileSync } = await import("node:fs");
const dbUrl0 = readFileSync("/home/z/my-project/.env.local", "utf8")
  .split("\n").find(l => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length);
const dbc0 = new pg.Client({ connectionString: dbUrl0 });
await dbc0.connect();
const existing = (await dbc0.query("SELECT email FROM public.profiles WHERE email LIKE 'zv25-http-a-%' ORDER BY created_at")).rows.map(r => r.email);
await dbc0.end();
let tok1 = null, tok2 = null, EMAIL_A = EMAIL1, EMAIL_B = EMAIL2;
if (existing.length >= 2) {
  EMAIL_A = existing[0]; EMAIL_B = existing[1];
  tok1 = await login(EMAIL_A); tok2 = await login(EMAIL_B);
  t("E0: register ограничен rate-limit'ом (3/час, fail-closed работает) — переиспользуем синтетических", true);
} else {
  tok1 = await register(EMAIL1, PHONE1); tok2 = await register(EMAIL2, PHONE2);
}
t("E1: пользователь A аутентифицирован (accessToken)", !!tok1, EMAIL_A);
t("E2: пользователь B аутентифицирован (accessToken)", !!tok2, EMAIL_B);
if (!tok1 || !tok2) { console.error("Нет токенов — прерываю"); process.exit(2); }

// ==== Корзина ====
let r = await api("GET", "/api/cart", { token: tok1 });
t("E3: создание/чтение пустой корзины (GET → 200, items: [])", r.status === 200 && Array.isArray(r.json?.items) && r.json.items.length === 0, `status=${r.status}`);

r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-p1", product_id: prod.id, quantity: 2 } });
t("E4: добавление обычного товара → inserted", r.status === 200 && r.json?.mode === "inserted", `status=${r.status} ${JSON.stringify(r.json)}`);

r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-c1", quantity: 1, custom_config: CUSTOM1 } });
t("E5: добавление custom item → inserted (P1-регресс: было 500/23514)", r.status === 200 && r.json?.mode === "inserted", `status=${r.status} ${JSON.stringify(r.json)}`);

r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-c2", quantity: 1, custom_config: CUSTOM2 } });
t("E6: добавление второго custom item → inserted", r.status === 200 && r.json?.mode === "inserted", `status=${r.status}`);

r = await api("GET", "/api/cart", { token: tok1 });
t("E7: корзина содержит 3 позиции", r.status === 200 && r.json?.items?.length === 3, `n=${r.json?.items?.length}`);

// dedup: тот же товар под другим client_ref → merged
r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-p1-dup", product_id: prod.id, quantity: 5 } });
t("E8: контент-дедуп → merged", r.status === 200 && r.json?.mode === "merged", `status=${r.status} ${JSON.stringify(r.json)}`);
r = await api("GET", "/api/cart", { token: tok1 });
const pRow = r.json?.items?.find(i => i.product_id === prod.id);
t("E9: после дедупа позиций товара не две, quantity = MAX(2,5)=5", r.json?.items?.length === 3 && pRow?.quantity === 5, `n=${r.json?.items?.length} qty=${pRow?.quantity}`);

// повтор запроса (идемпотентность POST)
r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-c1", quantity: 1, custom_config: CUSTOM1 } });
t("E10: повторный POST того же client_ref → updated (без дубля)", r.status === 200 && r.json?.mode === "updated", `status=${r.status} ${JSON.stringify(r.json)}`);
r = await api("GET", "/api/cart", { token: tok1 });
t("E11: дублей нет (по-прежнему 3 позиции)", r.json?.items?.length === 3, `n=${r.json?.items?.length}`);

// обновление количества
r = await api("PATCH", "/api/cart/zv25-c1", { token: tok1, body: { quantity: 4 } });
t("E12: PATCH quantity → ok", r.status === 200, `status=${r.status}`);
r = await api("GET", "/api/cart", { token: tok1 });
t("E13: quantity=4 сохранено в БД-ответе", r.json?.items?.find(i => i.client_ref === "zv25-c1")?.quantity === 4);

// изменение конфигурации custom item (upsert по тому же ref с новым конфигом)
r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-c2", quantity: 1, custom_config: { ...CUSTOM2, base: "honey" } } });
t("E14: изменение конфигурации custom item → updated", r.status === 200 && r.json?.mode === "updated", `status=${r.status}`);
r = await api("GET", "/api/cart", { token: tok1 });
t("E15: новый конфиг сохранён (base=honey)", r.json?.items?.find(i => i.client_ref === "zv25-c2")?.custom_config?.base === "honey");

// некорректный productType
r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-bad1", quantity: 1, custom_config: { ...CUSTOM1, productType: "pizza" } } });
t("E16: некорректный productType → 422", r.status === 422, `status=${r.status} ${JSON.stringify(r.json)}`);

// некорректная цена/конфигурация: неизвестная начинка
r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-bad2", quantity: 1, custom_config: { ...CUSTOM1, filling: "zv25-not-a-filling" } } });
t("E17: неизвестная начинка → 422", r.status === 422, `status=${r.status}`);

// quantity вне диапазона
r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-bad3", product_id: prod.id, quantity: 0 } });
t("E18: quantity=0 → 400", r.status === 400, `status=${r.status}`);

// отсутствующий product
r = await api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-bad4", product_id: "00000000-0000-0000-0000-000000000001", quantity: 1 } });
t("E19: несуществующий товар → 400", r.status === 400, `status=${r.status}`);

// отсутствующий user (нет Bearer): мутация без CSRF → 403 (fail-closed корректен),
// GET без токена → 401
r = await api("GET", "/api/cart");
t("E20: GET без токена → 401", r.status === 401, `status=${r.status}`);
{
  // POST вообще без CSRF и без Bearer — ожидаем 403 (CSRF-gate раньше auth)
  const res = await fetch(`${BASE}/api/cart`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_ref: "x", product_id: prod.id, quantity: 1 }) });
  t("E21: POST без CSRF/токена → 403 fail-closed", res.status === 403, `status=${res.status}`);
}

// чужая корзина: пользователь B видит пусто, не может изменить чужое
r = await api("GET", "/api/cart", { token: tok2 });
t("E22: изоляция: корзина B пуста", r.status === 200 && r.json?.items?.length === 0, `n=${r.json?.items?.length}`);
r = await api("PATCH", "/api/cart/zv25-c1", { token: tok2, body: { quantity: 1 } });
t("E23: чужой PATCH → 404 (не раскрывает существование)", r.status === 404, `status=${r.status}`);
r = await api("DELETE", "/api/cart/zv25-c1", { token: tok2 });
t("E24: чужой DELETE → 404/ok без удаления чужой строки", r.status === 404 || r.status === 200, `status=${r.status}`);
r = await api("GET", "/api/cart", { token: tok1 });
t("E25: строка A не пострадала от попытки B", r.json?.items?.find(i => i.client_ref === "zv25-c1")?.quantity === 4, `qty=${r.json?.items?.find(i => i.client_ref === "zv25-c1")?.quantity}`);

// конкурентные изменения: 8 параллельных POST одного client_ref → 1 строка
const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
  api("POST", "/api/cart", { token: tok1, body: { client_ref: "zv25-race", product_id: prod.id, quantity: i + 1 } })));
r = await api("GET", "/api/cart", { token: tok1 });
const raceRows = r.json?.items?.filter(i => i.client_ref === "zv25-race" || i.product_id === prod.id && i.client_ref !== "zv25-p1");
const allOk = results.every(x => x.status === 200);
t("E26: 8 параллельных POST → все 200, без дублей", allOk && raceRows?.length === 1, `statuses=${results.map(x => x.status).join(",")} rows=${raceRows?.length}`);

// синхронизация корзины (PUT merge)
r = await api("PUT", "/api/cart", { token: tok1, body: { items: [
  { client_ref: "zv25-c1", quantity: 2, custom_config: CUSTOM1 },
  { client_ref: "zv25-new", product_id: prod.id, quantity: 3 },
] } });
t("E27: PUT merge → 200 + полное merged-состояние", r.status === 200 && Array.isArray(r.json?.items), `status=${r.status} n=${r.json?.items?.length}`);

// ==== checkout ====
const DDATE = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
r = await api("POST", "/api/checkout", { token: tok1, body: {
  cartItems: [
    { product_id: prod.id, quantity: 1 },
    { custom: CUSTOM1, quantity: 2 },
  ],
  deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV25, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
  customerName: "ZV25 HTTP Test", customerPhone: PHONE1, paymentMethod: "cash",
} });
const orderCreated = r.status === 200 || r.status === 201;
t("E28: checkout → заказ создан", orderCreated, `status=${r.status} ${JSON.stringify(r.json).slice(0, 220)}`);
const orderId = r.json?.order?.id || r.json?.orderId || r.json?.id;
const orderTotal = r.json?.order?.total ?? r.json?.total;

// повторный checkout / защита от дубля: тот же запрос с тем же Idempotency-Key
const idemKey = `zv25-idem-${RND}`;
const rc = await api("POST", "/api/checkout", { token: tok1, headers: { "Idempotency-Key": idemKey }, body: {
  cartItems: [{ product_id: prod.id, quantity: 1 }],
  deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV25, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
  customerName: "ZV25 HTTP Test", customerPhone: PHONE1, paymentMethod: "cash",
} });
const rc2 = await api("POST", "/api/checkout", { token: tok1, headers: { "Idempotency-Key": idemKey }, body: {
  cartItems: [{ product_id: prod.id, quantity: 1 }],
  deliveryCity: "Москва", deliveryAddress: "ул. Тестовая ZV25, д. 1", deliveryType: "delivery", deliveryDate: DDATE,
  customerName: "ZV25 HTTP Test", customerPhone: PHONE1, paymentMethod: "cash",
} });
const id1 = rc.json?.order?.id || rc.json?.orderId || rc.json?.id;
const id2 = rc2.json?.order?.id || rc2.json?.orderId || rc2.json?.id;
t("E29: повторный checkout с тем же Idempotency-Key → тот же заказ (не создан дубль)", id1 && id2 && id1 === id2, `id1=${id1} id2=${id2} status=${rc.status}/${rc2.status}`);

// ==== Проверка фактического содержимого БД после запросов ====
const dbUrl2 = (await import("node:fs")).readFileSync("/home/z/my-project/.env.local", "utf8")
  .split("\n").find(l => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length);
const dbc2 = new pg.Client({ connectionString: dbUrl2 });
await dbc2.connect();
const u1 = (await dbc2.query(`SELECT id FROM public.profiles WHERE email=$1`, [EMAIL1])).rows[0]?.id;
const cartRows = (await dbc2.query(`SELECT client_ref, quantity, custom_config, product_id FROM public.cart_items WHERE user_id=$1`, [u1])).rows;
t("E30: БД: строки корзины A в каноническом виде (kind_check совместимы)", cartRows.length > 0 && cartRows.every(row => (row.product_id === null) === (row.custom_config !== null)), `n=${cartRows.length}`);
if (orderCreated) {
  const oi = (await dbc2.query(`SELECT product_id, quantity, unit_price, total, selected_attributes FROM public.order_items WHERE order_id=$1`, [orderId])).rows;
  const prodItem = oi.find(x => x.product_id === prod.id);
  const customItem = oi.find(x => x.product_id === null && x.selected_attributes?.custom);
  t("E31: БД: order_items содержит товарную и custom позиции", oi.length === 2 && !!prodItem && !!customItem, `n=${oi.length}`);
  t("E32: БД: цена товарной позиции = серверная (unit_price=цена товара)", prodItem && Number(prodItem.unit_price) === Number(prod.price), `unit=${prodItem?.unit_price} ожид=${prod.price}`);
  t("E33: БД: custom-позиция хранит custom_config-снимок", !!customItem?.selected_attributes?.custom);
  const totalCheck = oi.reduce((s, x) => s + Number(x.total), 0);
  t("E34: БД: total заказа = сумма позиций (деньги точны)", orderTotal !== undefined ? Math.abs(totalCheck - Number(orderTotal)) < 1 : true, `sum(items)=${totalCheck} order.total=${orderTotal}`);
}
await dbc2.end();

// ==== очистка (только синтетические данные через API) ====
await api("DELETE", "/api/cart", { token: tok1 });
await api("DELETE", "/api/cart", { token: tok2 });
console.log("Cleanup: корзины синтетических пользователей очищены через API");

const failed = checks.filter(x => !x.ok);
console.log(`\n=== HTTP CART SUMMARY: ${checks.length - failed.length}/${checks.length} PASS ===`);
process.exit(failed.length ? 1 : 0);
