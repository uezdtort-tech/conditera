/**
 * Z-v14 PROBE (pre-fix evidence): гонка PATCH+PATCH и PATCH+POST на заказах
 * ZV14-H1 / ZV14-H2. Фиксирует фактические счётчики истории/уведомлений.
 * Запуск: node scripts/zv14-concurrency-probe.mjs
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const BASE = "http://127.0.0.1:3000";

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
  await cl.init();
  return cl;
}

const pg = new Client({ connectionString: url });
await pg.connect();
const one = async (sql, p = []) => (await pg.query(sql, p)).rows[0] ?? null;

const { O_H1, O_H2 } = JSON.parse(readFileSync("/tmp/zv14-ids.json", "utf8"));
const conf = await clientFor("confectioner@demo.ru");

async function report(tag, orderId) {
  const hist = await one(`SELECT count(*)::int n FROM order_status_history WHERE order_id=$1::uuid`, [orderId]);
  const notif = await one(
    `SELECT count(*)::int n, count(DISTINCT (metadata->>'dedup_key'))::int ev FROM notifications WHERE metadata->>'orderId' = $1 AND type='ORDER_CONFIRMED'`,
    [orderId]
  );
  const st = await one(`SELECT status FROM orders WHERE id=$1::uuid`, [orderId]);
  console.log(`[${tag}] status=${st?.status} history=${hist.n} notifRows=${notif.n} notifEvents(distinct dedup_key)=${notif.ev}`);
  return { hist: hist.n, notifRows: notif.n };
}

// ---- гонка 1: PATCH + PATCH (одновременно, одинаковый переход PENDING→CONFIRMED)
const [p1, p2] = await Promise.all([
  conf.patch(`/api/orders/${O_H1}`, { status: "CONFIRMED" }),
  conf.patch(`/api/orders/${O_H1}`, { status: "CONFIRMED" }),
]);
console.log(`PATCH+PATCH statuses: [${p1.status}, ${p2.status}]`);
const h1 = await report("H1 PATCH+PATCH", O_H1);

// ---- гонка 2: PATCH + POST /accept (одновременно)
const [q1, q2] = await Promise.all([
  conf.patch(`/api/orders/${O_H2}`, { status: "CONFIRMED" }),
  conf.post(`/api/orders/${O_H2}/accept`),
]);
console.log(`PATCH+POST statuses: PATCH=${q1.status}, POST=${q2.status}`);
const h2 = await report("H2 PATCH+POST", O_H2);

console.log("\n==== VERDICT ====");
const dupEvent1 = h1.notifRows > 3;
const dupEvent2 = h2.notifRows > 3;
console.log(`H1: history dup=${h1.hist > 1}, event dup=${dupEvent1}`);
console.log(`H2: history dup=${h2.hist > 1}, event dup=${dupEvent2}`);

await pg.end();
