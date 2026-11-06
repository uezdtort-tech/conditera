/**
 * Z-v13 E2E: принятие заказа (Acceptance Gate) на изолированных фикстурах ZV13-*.
 * Реальные HTTP-вызовы локального Next (с CSRF-токеном, как настоящий клиент)
 * + проверки состояния PG. Никаких mock-ответов.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const BASE = "http://127.0.0.1:3000";

/** HTTP-клиент пользователя: cookie-jar + Bearer + CSRF */
function makeClient(accessToken) {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${accessToken}`,
        Cookie: cookieHeader(),
        ...(jar.has("csrf_token") && method !== "GET" ? { "x-csrf-token": jar.get("csrf_token") } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }
  return {
    async init() {
      const csrf = await req("GET", "/api/csrf-token");
      if (csrf.body?.token) jar.set("csrf_token", csrf.body.token);
      return csrf.status;
    },
    get: (p) => req("GET", p),
    post: (p, b) => req("POST", p, b ?? {}),
    patch: (p, b) => req("PATCH", p, b ?? {}),
  };
}

async function clientFor(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Demo123!" }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const cl = makeClient(j.accessToken);
  const csrfStatus = await cl.init();
  console.log(`client ${email}: token ok, csrf ${csrfStatus}`);
  return cl;
}

const pg = new Client({ connectionString: url });
await pg.connect();
const dbOne = async (sql, params = []) => (await pg.query(sql, params)).rows[0] ?? null;

const results = [];
function record(name, expect, actual, pass, evidence) {
  results.push({ name, expect, actual, pass, evidence });
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}`);
  console.log(`      expect: ${expect}`);
  console.log(`      actual: ${actual}`);
  if (evidence) console.log(`      proof:  ${evidence}`);
}

const conf = await clientFor("confectioner@demo.ru");
const cust = await clientFor("customer@demo.ru");

const { O_A, O_B, O_C, O_D, O_E, O_F, O_G } = JSON.parse(
  readFileSync("/tmp/zv13-ids.json", "utf8")
);

// Одно событие ORDER_CONFIRMED = 3 строки по каналам (in_app, push, email)
const NOTIF_ROWS_PER_EVENT = 3;
const notifCount = async (orderId) =>
  (await dbOne(`SELECT count(*)::int n FROM notifications WHERE metadata->>'orderId' = $1 AND type='ORDER_CONFIRMED'`, [orderId])).n;
const historyCount = async (orderId) =>
  (await dbOne(`SELECT count(*)::int n FROM order_status_history WHERE order_id=$1::uuid`, [orderId])).n;
const status = async (orderId) =>
  (await dbOne(`SELECT status FROM orders WHERE id=$1::uuid`, [orderId]))?.status ?? "?";

// ---------- 1. Позитив: ZV13-A (полный запас) → CONFIRMED ----------
let r = await conf.post(`/api/orders/${O_A}/accept`);
let st = await status(O_A);
let hc = await historyCount(O_A);
let nc = await notifCount(O_A);
record(
  "1. accept ZV13-A (всё в наличии)",
  "200, status=CONFIRMED, history=1, notification=3 строки (1 событие × in_app/push/email)",
  `${r.status} ${JSON.stringify(r.body).slice(0, 70)}, status=${st}, history=${hc}, notification=${nc}`,
  r.status === 200 && st === "CONFIRMED" && hc === 1 && nc === NOTIF_ROWS_PER_EVENT,
  "PENDING→CONFIRMED; история с атрибуцией; ORDER_CONFIRMED покупателю по каналам"
);

// ---------- 2. Повторное принятие ZV13-A ----------
r = await conf.post(`/api/orders/${O_A}/accept`);
const hc2 = await historyCount(O_A);
const nc2 = await notifCount(O_A);
record(
  "2. повторный accept ZV13-A",
  "400/409, history=1, notification не растёт (3 строки без дублей)",
  `${r.status} (${r.body.error ?? ""}), history=${hc2}, notification=${nc2}`,
  (r.status === 400 || r.status === 409) && hc2 === 1 && nc2 === NOTIF_ROWS_PER_EVENT,
  "статус уже CONFIRMED → отказ до истории/уведомления; дублей каналов нет"
);

// ---------- 3. Нехватка: ZV13-B → 409 LOW_STOCK ----------
r = await conf.post(`/api/orders/${O_B}/accept`);
st = await status(O_B);
const bLow = (r.body.reasons ?? []).some((x) => x.code === "LOW_STOCK");
const bShortages = (r.body.shortages ?? []).length;
const ncB = await notifCount(O_B);
const invB = await dbOne(`SELECT quantity FROM inventory_items WHERE id=$1::uuid`, [JSON.parse(readFileSync("/tmp/zv13-ids.json", "utf8")).INV_B]);
record(
  "3. accept ZV13-B (нехватка 1 ингредиента)",
  "409 ORDER_NOT_FEASIBLE + LOW_STOCK, status=PENDING, notification=0, склад не тронут",
  `${r.status} (${r.body.error ?? ""}), LOW_STOCK=${bLow}, shortages=${bShortages}, status=${st}, notif=${ncB}, склад=${invB?.quantity}`,
  r.status === 409 && bLow && st === "PENDING" && ncB === 0 && Number(invB?.quantity) === 2000,
  "движок вернул дефицит (2000г на складе vs 5000г потребность); списания нет"
);

// ---------- 4. unit_mismatch: ZV13-C → 409 ----------
r = await conf.post(`/api/orders/${O_C}/accept`);
st = await status(O_C);
const ncC = await notifCount(O_C);
record(
  "4. accept ZV13-C (л vs кг — несовместимые единицы)",
  "409 (canProduce=false → inventoryBlocked), status=PENDING, notification=0",
  `${r.status} (${r.body.error ?? ""}), status=${st}, notification=${ncC}`,
  r.status === 409 && st === "PENDING" && ncC === 0,
  "unit_mismatch не входит в shortages, но ломает can_produce → гейт 409 (не false-PASS)"
);

// ---------- 5. Нет рецепта: ZV13-D → 409 RECIPE_MISSING ----------
r = await conf.post(`/api/orders/${O_D}/accept`);
st = await status(O_D);
const bRec = (r.body.reasons ?? []).some((x) => x.code === "RECIPE_MISSING");
record(
  "5. accept ZV13-D (позиция без рецепта)",
  "409, RECIPE_MISSING, status=PENDING",
  `${r.status} (${r.body.error ?? ""}), RECIPE_MISSING=${bRec}, status=${st}`,
  r.status === 409 && bRec && st === "PENDING",
  "сценарий D: приёмка без расчёта потребности запрещена"
);

// ---------- 6. Параллельный accept ZV13-E ----------
const [r1, r2] = await Promise.all([conf.post(`/api/orders/${O_E}/accept`), conf.post(`/api/orders/${O_E}/accept`)]);
const codes = [r1.status, r2.status].sort((a, b) => a - b);
st = await status(O_E);
hc = await historyCount(O_E);
nc = await notifCount(O_E);
record(
  "6. параллельный accept ZV13-E (2 одновременных POST)",
  "ровно один 200; второй 409; history=1; notification=3 строки (одно событие)",
  `[${r1.status},${r2.status}], status=${st}, history=${hc}, notification=${nc}`,
  codes[0] === 200 && codes[1] === 409 && st === "CONFIRMED" && hc === 1 && nc === NOTIF_ROWS_PER_EVENT,
  "conditional UPDATE ... WHERE status='PENDING' → победитель один; уведомление не дублируется"
);

// ---------- 7. Покупатель не может сменить статус ----------
r = await cust.patch(`/api/orders/${O_B}`, { status: "CONFIRMED" });
st = await status(O_B);
record(
  "7. покупатель PATCH status=CONFIRMED по своему заказу",
  "403 (переход PENDING→CONFIRMED запрещён CUSTOMER), status=PENDING",
  `${r.status} (${String(r.body.error).slice(0, 60)}), status=${st}`,
  r.status === 403 && st === "PENDING",
  "матрица переходов: PENDING→CONFIRMED только CONFECTIONER/ADMIN"
);

// ---------- 8. Покупатель не может вызвать accept ----------
r = await cust.post(`/api/orders/${O_C}/accept`);
record(
  "8. покупатель POST /accept по своему заказу",
  "401/403 (не CONFECTIONER)",
  `${r.status}`,
  r.status === 401 || r.status === 403,
  "requireRole(CONFECTIONER)"
);

// ---------- 9. Кондитер не может принять чужой заказ (ZV13-F назначен c1) ----------
r = await conf.post(`/api/orders/${O_F}/accept`);
st = await status(O_F);
record(
  "9. accept ZV13-F (чужой заказ: назначен c1)",
  "403 «Заказ назначен другому кондитеру», status=PENDING",
  `${r.status} (${r.body.error ?? ""}), status=${st}`,
  r.status === 403 && st === "PENDING",
  "orders.confectioner_id ≠ user.id → 403 (уже после CSRF, значит проверка принадлежности)"
);

// ---------- 10. Покупатель не видит чужой заказ (ZV13-G: user_id=con0) ----------
r = await cust.get(`/api/orders/${O_G}`);
record(
  "10. покупатель GET чужого заказа ZV13-G",
  "403/404 (не владелец)",
  `${r.status} (${r.body.error ?? ""})`,
  r.status === 403 || r.status === 404,
  `order ${O_G.slice(0, 8)}… user_id=con0 ≠ покупатель`
);

// ---------- 11. Покупатель видит СВОЙ заказ и таймлайн ----------
r = await cust.get(`/api/orders/${O_A}`);
const own = r.status === 200 && r.body?.order?.id === O_A;
r = await cust.get(`/api/orders/${O_A}/timeline`);
const tlEntry = (r.body?.timeline ?? []).find((e) => e.kind === "status" && e.payload?.from === "PENDING" && e.payload?.to === "CONFIRMED");
const tlHasDate = tlEntry && !Number.isNaN(Date.parse(tlEntry.at));
record(
  "11. покупатель GET своего заказа + timeline",
  "200 order; 200 timeline с переходом PENDING→CONFIRMED и датой",
  `order ok=${own}, timeline entries=${r.body?.timeline?.length ?? "n/a"}, CONFIRMED переход=${Boolean(tlEntry)}, дата валидна=${tlHasDate}`,
  own && Boolean(tlEntry) && tlHasDate,
  "история статусов доступна владельцу с датами (ТЗ §41)"
);

console.log("\n==== ИТОГО ====");
const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} PASS`);
await pg.end();
if (failed.length) process.exit(1);
