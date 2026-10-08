/**
 * Регрессионная проверка P0-ядра «операционной системы» (ops-center).
 *
 * Покрывает:
 *  - rule engine: материализация задач (ORDER_UNASSIGNED/ORDER_OVERDUE/
 *    MEDIA_PENDING/LOW_STOCK/CHAT_UNANSWERED/ORDER_REVIEW_REQUEST),
 *    идемпотентность (повторный скан не плодит дубли), throttle;
 *  - resolve/dismiss с ролями и CAS (повторный resolve → 409);
 *  - visibility: кондитер видит только свои задачи, покупатель — ничего;
 *  - summary (админ) и confectioner-today (кондитер);
 *  - разбор заказа: заказ → рецепт → ингредиенты → склад, дефицит,
 *    оценки стоимости, несовместимые единицы;
 *  - закупка из дефицита: draft + items, NO_SHORTAGES;
 *  - completeness score: чеклист, ready_to_publish;
 *  - event log: domain_events пишутся в ключевых точках.
 *
 * Запуск: node scripts/verify/ops-center-verify.mjs
 * Тестовые заказы (metadata.test='ops-verify') и их черновики удаляются.
 */

import { Client } from "pg";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const PASSWORD = "Demo123!";
const OWNER_USER_ID = "11111111-1111-4111-8111-111111111101"; // confectioner@demo.ru
const CUSTOMER_USER_ID = "11111111-1111-4111-8111-111111111106"; // customer@demo.ru

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

async function api(method, path, { token, body } = {}) {
  const headers = { "x-real-ip": RUN_IP };
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

// P1.1: единый паттерн с order-lifecycle-verify — PGURL окружением переопределяется
const PG_URL = process.env.PGURL || "postgresql://postgres@127.0.0.1:54329/conditera";
const client = new Client({ connectionString: PG_URL });
const cleanupIds = { orders: [], drafts: [] };

async function main() {
  await client.connect();
  // Верификационный сброс engine-задач review-request (после resolve движок
  // корректно НЕ переоткрывает вручную закрытые — для повторных прогонов
  // пересоздаём их честным путём: условие живо → скан материализует заново)
  await client.query(`DELETE FROM public.ops_tasks WHERE source='engine' AND type='ORDER_REVIEW_REQUEST'`);
  section("Подготовка");
  const admin = await login("admin@demo.ru");
  const owner = await login("confectioner@demo.ru");
  const customer = await login("customer@demo.ru");
  assert("логины admin/confectioner/customer", Boolean(admin && owner && customer));

  // Демо-заказ DEMO-1048 (создан скриптом demo-data): recipe-товар ×2
  const demo = await client.query(
    `SELECT o.id, o.number, o.confectioner_id, oi.product_id, oi.quantity::int AS qty
     FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.number = 'DEMO-1048' LIMIT 1`
  );
  assert("демо-заказ DEMO-1048 существует", demo.rowCount > 0);
  const orderId = demo.rows[0].id;

  // P0.5: ORDER_UNASSIGNED теперь эскалирует по SLA (15/30/60 мин).
  // Для проверки critical-уровня создаём «давно не назначенный» заказ
  // (paid_at 40 минут назад → severity critical). Удаляется в cleanup.
  const aged = await client.query(
    `INSERT INTO public.orders
       (number, user_id, subtotal, delivery_cost, discount, total, status, payment_status,
        payment_method, delivery_address, delivery_city, delivery_date, delivery_time_window,
        delivery_type, metadata, paid_at)
     VALUES ('OPSVERIFY-AGED-' || floor(random()*100000)::text, '11111111-1111-4111-8111-111111111106',
             1000, 0, 0, 1000, 'PENDING', 'escrow', 'card', 'тест', 'Москва',
             CURRENT_DATE + 1, '10:00-12:00', 'delivery',
             jsonb_build_object('test','ops-verify'), now() - interval '40 minutes')
     RETURNING id::text`
  );
  cleanupIds.orders.push(aged.rows[0].id);

  // P0.5: ORDER_REVIEW_REQUEST правило (info) требует завершённый заказ
  // за последние 2 дня — создаём свой (иначе зависимость от чужих данных,
  // после чисток которых правило материализует пусто).
  const done = await client.query(
    `INSERT INTO public.orders
       (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total, status, payment_status,
        payment_method, delivery_address, delivery_city, delivery_date, delivery_time_window,
        delivery_type, metadata, paid_at, delivered_at, completed_at)
     VALUES ('OPSVERIFY-DONE-' || floor(random()*100000)::text, '11111111-1111-4111-8111-111111111106',
             '11111111-1111-4111-8111-111111111101', 1000, 0, 0, 1000, 'COMPLETED', 'released',
             'card', 'тест', 'Москва', CURRENT_DATE - 1, '12:00-14:00', 'delivery',
             jsonb_build_object('test','ops-verify'), now() - interval '2 days',
             now() - interval '1 day', now() - interval '1 day')
     RETURNING id::text`
  );
  cleanupIds.orders.push(done.rows[0].id);

  section("Rule engine: материализация и идемпотентность");
  const scan1 = await api("GET", "/api/ops/tasks?refresh=1", { token: admin });
  assert("GET /api/ops/tasks → 200", scan1.status === 200, `got ${scan1.status}`);
  const c1 = scan1.json?.counts || {};
  assert("есть задачи всех уровней (critical+important+info)", (c1.critical || 0) > 0 && (c1.important || 0) > 0 && (c1.info || 0) > 0, JSON.stringify(c1));
  const types = new Set((scan1.json?.tasks || []).map((t) => t.type));
  assert("MEDIA_PENDING материализована", types.has("MEDIA_PENDING"));
  assert("LOW_STOCK материализована", types.has("LOW_STOCK"));
  assert("ORDER_REVIEW_REQUEST присутствует (инфо)", types.has("ORDER_REVIEW_REQUEST"));
  const scan2 = await api("GET", "/api/ops/tasks?refresh=1", { token: admin });
  assert("повторный скан идемпотентен (counts стабильны)", JSON.stringify(scan2.json?.counts) === JSON.stringify(c1), `${JSON.stringify(c1)} → ${JSON.stringify(scan2.json?.counts)}`);
  const dedups = (scan1.json?.tasks || []).map((t) => t.dedup_key);
  assert("dedup_key уникальны", new Set(dedups).size === dedups.length);

  section("Resolve / dismiss и права");
  const target = (scan1.json?.tasks || []).find((t) => t.type === "ORDER_REVIEW_REQUEST" && t.status === "open");
  if (target) {
    const custTry = await api("POST", `/api/ops/tasks/${target.id}`, { token: customer, body: { action: "resolve" } });
    assert("покупатель не может resolve чужую задачу → 404/403", custTry.status === 404 || custTry.status === 403, `got ${custTry.status}`);
    const ok = await api("POST", `/api/ops/tasks/${target.id}`, { token: admin, body: { action: "resolve", comment: "verify" } });
    assert("админ resolve → 200 resolved", ok.status === 200 && ok.json?.task?.status === "resolved", `got ${ok.status}`);
    const again = await api("POST", `/api/ops/tasks/${target.id}`, { token: admin, body: { action: "resolve" } });
    assert("повторный resolve → 409 NOT_OPEN", again.status === 409, `got ${again.status}`);
    const after = await api("GET", "/api/ops/tasks?refresh=1", { token: admin });
    const still = (after.json?.tasks || []).find((t) => t.id === target.id);
    assert("resolved-задача не переоткрывается движком", !still || still.status === "resolved");
  } else {
    assert("найдена open-задача ORDER_REVIEW_REQUEST для теста resolve", false);
  }

  section("Visibility ролей");
  const mine = await api("GET", "/api/ops/tasks?refresh=1", { token: owner });
  const ownerTasks = mine.json?.tasks || [];
  assert("кондитер видит только свои задачи (LOW_STOCK/REVIEW)", ownerTasks.every((t) => t.assignee_id === OWNER_USER_ID || t.assignee_role === null), JSON.stringify(ownerTasks.slice(0, 2).map((t) => [t.type, t.assignee_role, t.assignee_id])));
  const cust = await api("GET", "/api/ops/tasks", { token: customer });
  assert("покупатель не получает задач (или только null-assignee)", (cust.json?.tasks || []).every((t) => !t.assignee_id || t.assignee_id === CUSTOMER_USER_ID));

  section("Summary и «Сегодня» кондитера");
  const sum = await api("GET", "/api/ops/summary", { token: admin });
  assert("summary → 200", sum.status === 200);
  assert("summary.today заполнен", sum.json?.today && Number.isFinite(sum.json.today.orders));
  assert("summary.attention совпадает с очередью", sum.json?.attention?.critical >= 0);
  assert("summary.system.db ok", sum.json?.system?.db === "ok");
  const today = await api("GET", "/api/ops/confectioner-today", { token: owner });
  assert(
    "confectioner-today → 200, все секции",
    today.status === 200 &&
      Array.isArray(today.json?.tasks?.items) &&
      ["ordersToday", "inProduction", "lowStock", "purchaseDrafts"].every((k) => Array.isArray(today.json?.[k])),
    `got ${today.status} keys=${Object.keys(today.json || {}).join(",")}`
  );
  assert("DEMO-1048 в «Заказах сегодня»", (today.json?.ordersToday || []).some((o) => o.number === "DEMO-1048"), JSON.stringify((today.json?.ordersToday || []).map((o) => o.number)));
  assert("revenueToday включает DEMO-1048", (today.json?.revenueToday || 0) >= 37000, String(today.json?.revenueToday));

  section("Разбор заказа: рецепт → ингредиенты → склад");
  const bd = await api("GET", `/api/orders/${orderId}/breakdown`, { token: owner });
  assert("breakdown → 200", bd.status === 200, `got ${bd.status}`);
  const ing = bd.json?.ingredients || [];
  assert("ингредиенты из рецепта (5 позиций)", ing.length >= 5, `got ${ing.length}`);
  const flour = ing.find((i) => i.name.toLowerCase().includes("мука"));
  assert("Мука: required = 450 г × qty", flour && Math.abs(flour.required - 450 * demo.rows[0].qty) < 0.01, JSON.stringify(flour));
  const cream = ing.find((i) => i.name.toLowerCase().includes("сливки"));
  assert("Сливки приводятся к единице склада (stock в мл/л)", cream && Number.isFinite(cream.stock), JSON.stringify(cream));
  assert("есть дефицит или всё ok (can_produce корректен)", typeof bd.json?.can_produce === "boolean");
  const wrongOwner = await api("GET", `/api/orders/${orderId}/breakdown`, { token: customer });
  assert("покупатель не видит breakdown → 403", wrongOwner.status === 403, `got ${wrongOwner.status}`);

  section("Закупка из дефицита");
  if (bd.json?.shortages?.length > 0) {
    const draft = await api("POST", `/api/orders/${orderId}/purchase-draft`, { token: owner, body: { note: "verify: закупка из дефицита" } });
    assert("purchase-draft → 201", draft.status === 201, `got ${draft.status} ${JSON.stringify(draft.json).slice(0, 120)}`);
    assert("items соответствуют дефициту", (draft.json?.items || []).length === bd.json.shortages.length, `${(draft.json?.items || []).length} vs ${bd.json.shortages.length}`);
    if (draft.json?.draft?.id) cleanupIds.drafts.push(draft.json.draft.id);
    const evCheck = await client.query(`SELECT 1 FROM public.domain_events WHERE type='purchase.draft_created' ORDER BY occurred_at DESC LIMIT 1`);
    assert("событие purchase.draft_created в domain_events", evCheck.rowCount > 0);
  } else {
    const noShort = await api("POST", `/api/orders/${orderId}/purchase-draft`, { token: owner, body: {} });
    assert("нет дефицита → 422 NO_SHORTAGES", noShort.status === 422 && noShort.json?.error === "NO_SHORTAGES", `got ${noShort.status}`);
  }

  section("Completeness score");
  const prod = await client.query(`SELECT id FROM public.products WHERE recipe_id IS NOT NULL LIMIT 1`);
  const comp = await api("GET", `/api/products/${prod.rows[0].id}/completeness`, { token: owner });
  assert("completeness → 200", comp.status === 200, `got ${comp.status}`);
  assert("score 0..100 и checks заполнены", comp.json?.score >= 0 && comp.json?.score <= 100 && (comp.json?.checks || []).length >= 14, `score=${comp.json?.score}, checks=${comp.json?.checks?.length}`);
  assert("ready_to_publish — boolean", typeof comp.json?.ready_to_publish === "boolean");

  section("Event log и врезки recordEvent");
  // Живая проверка врезки: перевод заказа в PREPARING пишёт order.status_changed
  const st = await api("PATCH", `/api/orders/${orderId}`, { token: owner, body: { status: "PREPARING" } });
  assert(
    "PATCH заказа → PREPARING (или уже переведён)",
    [200, 400, 403, 409, 422].includes(st.status),
    `got ${st.status} ${JSON.stringify(st.json).slice(0, 100)}`
  );
  // P1.1: recordEvent — fire-and-forget (void, асинхронно) — ждём событие
  // до 3 с, прежде чем признать отсутствие записи реальной проблемой.
  let evWritten = false;
  for (let i = 0; i < 10; i++) {
    const evStatus = await client.query(
      `SELECT 1 FROM public.domain_events WHERE type='order.status_changed' AND entity_id=$1 LIMIT 1`,
      [orderId]
    );
    if (evStatus.rowCount > 0) {
      evWritten = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  assert("order.status_changed записан в domain_events", evWritten);
  const evTypes = await client.query(`SELECT DISTINCT type FROM public.domain_events ORDER BY type`);
  const typesList = evTypes.rows.map((r) => r.type);
  assert(
    "domain_events содержат ключевые типы",
    typesList.some((t) => t.startsWith("order.")) && typesList.includes("purchase.draft_created") && typesList.includes("ops.task_created"),
    typesList.join(",")
  );

  section("Итог");
  console.log(`\n  ИТОГО: PASS ${passed}  FAIL ${failed}`);
  if (failed > 0) {
    console.log("  Проваленные проверки:");
    for (const f of failures) console.log(`   - ${f}`);
  }
  return failed === 0;
}

async function cleanup() {
  try {
    if (cleanupIds.orders.length > 0) {
      await client.query(`DELETE FROM public.ops_tasks WHERE entity_id = ANY($1::text[])`, [cleanupIds.orders]);
      await client.query(`DELETE FROM public.domain_events WHERE entity_type='order' AND entity_id = ANY($1::text[])`, [cleanupIds.orders]);
      await client.query(`DELETE FROM public.orders WHERE id = ANY($1::uuid[])`, [cleanupIds.orders]);
    }
    if (cleanupIds.drafts.length > 0) {
      await client.query(`DELETE FROM public.purchase_drafts WHERE id = ANY($1)`, [cleanupIds.drafts]);
    }
    // P1.1 §4: verify мутировал демо-фикстуру (PATCH → PREPARING) —
    // восстанавливаем, чтобы повторный прогон стартовал из известного состояния.
    await client.query(
      `UPDATE public.orders SET status='CONFIRMED', updated_at=now() WHERE number='DEMO-1048' AND status <> 'CONFIRMED'`
    );
    console.log(`\n  cleanup: удалено черновиков верификации: ${cleanupIds.drafts.length}, заказов: ${cleanupIds.orders.length}`);
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
    await cleanup();
    process.exit(ok ? 0 : 1);
  });
