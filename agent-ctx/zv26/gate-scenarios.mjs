/**
 * Z-v26 Этап 6 — изолированные acceptance-gate сценарии A-J.
 *
 * Запуск: DATABASE_URL=<disposable> bun agent-ctx/zv26/gate-scenarios.mjs
 * Использует РЕАЛЬНЫЙ код проекта (acceptance/breakdown/capacity/lifecycle).
 * Все фикстуры синтетические (маркер zv26), БД disposable.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

// Реальный код проекта (bun резолвит @/ алиасы)
const { checkAcceptance, loadProductItemsData } = await import("@/lib/ops/acceptance");
const { computeOrderBreakdown } = await import("@/lib/ops/breakdown");
const { reserveCapacityWindow, getActiveReservation } = await import("@/lib/ops/capacity");
const { applyOrderTransition } = await import("@/lib/ops/lifecycle");

const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const mainUrl = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const DB_URL = process.env.DATABASE_URL || mainUrl;
console.log(`DB: ${DB_URL.replace(/:[^:@/]+@/, ":***@").replace(/\/[^/]+$/, "/<db>")}`);

const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });

const CONF = "11111111-1111-4111-8111-111111111101"; // confectioner@demo.ru (владелец склада)
const CUST = "11111111-1111-4111-8111-111111111106"; // customer@demo.ru
const PRODUCT_MAIN = "aaaaaaaa-0000-4000-8000-000000000001"; // Ягодный бархат (recipe bound)
const PRODUCT_NO_RECIPE = "aaaaaaaa-0000-4000-8000-000000000002"; // Наполеон (без рецепта)
// RECIPE_MAIN резолвится динамически (UUID сидов отличаются между инстансами)
const RECIPE_ROW = await pool.query(`SELECT id::text FROM public.recipes WHERE title='Красный бархат (демо)' LIMIT 1`);
if (RECIPE_ROW.rowCount === 0) { console.error("recipe Красный бархат (демо) not found"); process.exit(2); }
const RECIPE_MAIN = RECIPE_ROW.rows[0].id;

let passed = 0, failed = 0;
const failures = [];
function assert(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✔ ${name}${extra ? " — " + extra : ""}`); }
  else { failed++; failures.push(name); console.log(`  ✖ ${name}${extra ? " — " + extra : ""}`); }
}
function section(t) { console.log(`\n─── ${t} ───`); }

function isoDate(d) { return d.toISOString().slice(0, 10); }
const now = new Date();
const DAY3 = isoDate(new Date(now.getTime() + 3 * 86400000));
const DAY2_NOON = new Date(now.getTime() + 2 * 86400000);
DAY2_NOON.setHours(12, 0, 0, 0);

async function upsertFixture() {
  // Синтетическая конфигурация мощности кондитера (диспозабл-БД)
  await pool.query(
    `INSERT INTO public.confectioner_capacity (user_id, workday_start_minute, workday_end_minute, daily_capacity_minutes, is_active)
     VALUES ($1::uuid, 540, 1080, 480, true)
     ON CONFLICT (user_id) DO UPDATE SET is_active = true`,
    [CONF]
  );
  // Синтетический склад «Ягоды» 1000 г (имя точно совпадает с recipe_ingredients.name).
  // ВНИМАНИЕ: C-коллация — lower() не опускает кириллицу, сравниваем оба варианта.
  const ex = await pool.query(`SELECT id::text FROM public.inventory_items WHERE owner_id=$1::uuid AND (name='Ягоды' OR lower(trim(name))='ягоды')`, [CONF]);
  if (ex.rowCount === 0) {
    await pool.query(
      `INSERT INTO public.inventory_items (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, is_active)
       VALUES ($1::uuid, 'Ягоды', 'zv26-test', 1000, 'г', 0, 300, true)`,
      [CONF]
    );
  } else {
    await pool.query(`UPDATE public.inventory_items SET quantity=1000, is_active=true WHERE id=$1::uuid`, [ex.rows[0].id]);
  }
  // Синтетический товар ZV26-A: рецепт привязан, время 6ч
  const pid = "aaaaaaaa-0000-4000-8000-00000000b001";
  const pex = await pool.query(`SELECT id::text FROM public.products WHERE id=$1::uuid`, [pid]);
  if (pex.rowCount === 0) {
    await pool.query(
      `INSERT INTO public.products (id, confectioner_id, slug, title, price, status, production_time_hours, recipe_id, product_type)
       VALUES ($1::uuid, $2::uuid, 'zv26-test-a', 'ZV26-TEST Товар A', 100, 'published', 6, $3::uuid, 'physical')`,
      [pid, CONF, RECIPE_MAIN]
    );
  } else {
    await pool.query(`UPDATE public.products SET recipe_id=$2::uuid, production_time_hours=6, status='published' WHERE id=$1::uuid`, [pid, RECIPE_MAIN]);
  }
  // Черновик закупки «Ягоды» (управляется сценариями E/F)
  const dex = await pool.query(`SELECT id::text FROM public.purchase_drafts WHERE owner_id=$1::uuid AND note='zv26-test'`, [CONF]);
  if (dex.rowCount === 0) {
    const d = await pool.query(
      `INSERT INTO public.purchase_drafts (owner_id, status, source, note, expected_eta)
       VALUES ($1::uuid, 'draft', 'zv26-test', 'zv26-test', NULL) RETURNING id::text`,
      [CONF]
    );
    await pool.query(
      `INSERT INTO public.purchase_draft_items (draft_id, name, quantity, unit)
       VALUES ($1::uuid, 'Ягоды', 1000, 'г')`,
      [d.rows[0].id]
    );
  }
}

async function setBerries(qty) {
  // C-коллация: lower() не опускает кириллицу — сравниваем оба варианта (см. acceptance.ts)
  await pool.query(`UPDATE public.inventory_items SET quantity=$2 WHERE owner_id=$1::uuid AND (name='Ягоды' OR lower(trim(name))='ягоды')`, [CONF, qty]);
}
async function setDraftEta(eta) {
  await pool.query(`UPDATE public.purchase_drafts SET expected_eta=$2 WHERE owner_id=$1::uuid AND note='zv26-test'`, [CONF, eta]);
}
async function setProductHours(pid, hours) {
  await pool.query(`UPDATE public.products SET production_time_hours=$2 WHERE id=$1::uuid`, [pid, hours]);
}

async function gateFor(productId, deliveryDate = DAY3) {
  const items = await loadProductItemsData([{ productId, quantity: 1 }]);
  return checkAcceptance({ items, assignedConfectionerId: CONF, deliveryDate, deliveryTimeWindow: null, deliveryTime: null });
}

async function makeOrder(number, productId, qty = 1) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO public.orders (id, number, user_id, status, payment_status, total, confectioner_id, delivery_date)
     VALUES ($1::uuid, $2, $3::uuid, 'PENDING', 'pending', 100, $4::uuid, $5::date)`,
    [id, number, CUST, CONF, DAY3]
  );
  await pool.query(
    `INSERT INTO public.order_items (order_id, product_id, product_title, unit_price, quantity, total)
     VALUES ($1::uuid, $2::uuid, 'ZV26-TEST', 100, $3, 100 * $3)`,
    [id, productId, qty]
  );
  return id;
}

// ═══════════════════ СЦЕНАРИИ ═══════════════════
await upsertFixture();

section("A — корректный товар (рецепт+время+склад+мощность)");
{
  const r = await gateFor("aaaaaaaa-0000-4000-8000-00000000b001");
  const codes = r.reasons.map((x) => x.code);
  assert("A1 gate passes (canAccept)", r.canAccept === true, `codes=${codes.join("|")}`);
  assert("A2 availability=available", r.availability === "available", `got=${r.availability}`);
  assert("A3 нет блокирующих кодов", codes.length === 0, `codes=${codes.join("|")}`);
  assert("A4 capacity fits", r.owners[0]?.capacity.fits === true);
  assert("A5 estimate source=product (360 min)", r.owners[0]?.productionMinutes === 360 && r.owners[0]?.estimateSource === "product");
}

section("B — отсутствие рецепта (блокирует)");
{
  const r = await gateFor(PRODUCT_NO_RECIPE);
  const codes = r.reasons.map((x) => x.code);
  assert("B1 canAccept=false", r.canAccept === false);
  assert("B2 RECIPE_MISSING блокирующий", codes.includes("RECIPE_MISSING"), `codes=${codes.join("|")}`);
  assert("B3 availability=unavailable", r.availability === "unavailable");
}

section("C — production_time не сконфигурирован");
{
  const r = await gateFor(PRODUCT_MAIN); // рецепт есть, hours=null, у рецепта prep/cok=null
  const codes = r.reasons.map((x) => x.code);
  assert("C1 MISSING_PRODUCT_DATA присутствует", codes.includes("MISSING_PRODUCT_DATA"), `codes=${codes.join("|")}`);
  assert("C2 классификация warning (не блокирует)", r.canAccept === true && r.availability === "available_with_warning", `canAccept=${r.canAccept} av=${r.availability}`);
  // C2b: estimate через категорию (cakes=240), approximate
  assert("C2b estimateSource=category (240, approximate)", r.owners[0]?.estimateSource === "category" && r.owners[0]?.productionMinutes === 240 && r.owners[0]?.estimateApproximate === true);
  // C3: продукт С hours → кода нет
  const r2 = await gateFor("aaaaaaaa-0000-4000-8000-00000000b001");
  assert("C3 с hours кода нет", !r2.reasons.map((x) => x.code).includes("MISSING_PRODUCT_DATA"));
}

section("D — недостаток ингредиента (нет закупки)");
{
  await setBerries(100);
  const r = await gateFor(PRODUCT_MAIN);
  const codes = r.reasons.map((x) => x.code);
  assert("D1 LOW_STOCK блокирующий", codes.includes("LOW_STOCK"), `codes=${codes.join("|")}`);
  assert("D2 canAccept=false", r.canAccept === false);
  const st = r.owners[0]?.inventory.shortages ?? [];
  assert("D3 дефицит Ягоды −150 г", st.some((s) => s.name === "Ягоды" && s.shortage === 150), JSON.stringify(st));
  await setBerries(1000);
}

section("E — подтверждённая закупка (ETA успевает)");
{
  await setBerries(100);
  await setDraftEta(DAY2_NOON.toISOString());
  const r = await gateFor(PRODUCT_MAIN);
  const codes = r.reasons.map((x) => x.code);
  assert("E1 CAN_ACCEPT_WITH_PURCHASE (warning, не блокирует)", codes.includes("CAN_ACCEPT_WITH_PURCHASE") && !codes.includes("LOW_STOCK") && !codes.includes("PURCHASE_ETA_MISSING"), `codes=${codes.join("|")}`);
  assert("E2 canAccept=true", r.canAccept === true, `av=${r.availability}`);
  await setDraftEta(null);
  await setBerries(1000);
}

section("F — неизвестный ETA (не превращается в доступность)");
{
  await setBerries(100);
  await setDraftEta(null); // черновик есть, ETA не указана
  const r = await gateFor(PRODUCT_MAIN);
  const codes = r.reasons.map((x) => x.code);
  assert("F1 PURCHASE_ETA_MISSING блокирующий", codes.includes("PURCHASE_ETA_MISSING"), `codes=${codes.join("|")}`);
  assert("F2 canAccept=false", r.canAccept === false);
  await setBerries(1000);
}

section("G — конкурентное резервирование окна (EXCLUDE)");
{
  const o1 = await makeOrder("ZV26-G1", "aaaaaaaa-0000-4000-8000-00000000b001");
  const o2 = await makeOrder("ZV26-G2", "aaaaaaaa-0000-4000-8000-00000000b001");
  let first = null, secondErr = null;
  const p1 = reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 900, estimatedMinutes: 360, createdBy: CONF })
    .then((r) => { first = r; }).catch((e) => { secondErr = e; });
  const p2 = reserveCapacityWindow({ orderId: o2, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 900, estimatedMinutes: 360, createdBy: CONF })
    .then((r) => { if (!first) first = r; else secondErr = new Error("BOTH_SUCCEEDED"); }).catch((e) => { secondErr = e; });
  await Promise.all([p1, p2]);
  assert("G1 ровно один резерв создан (второй отклонён БД)", first !== null && secondErr !== null && secondErr.code === "OVERLAP", `err=${secondErr?.message ?? "-"}`);
  assert("G2 пересечение → OVERLAP (23P01)", secondErr !== null && secondErr.code === "OVERLAP", `code=${secondErr?.code ?? "-"}`);
  // очистка
  await pool.query(`DELETE FROM public.capacity_reservations WHERE order_id::text = ANY($1)`, [[o1, o2]]);
  await pool.query(`DELETE FROM public.orders WHERE id::text = ANY($1)`, [[o1, o2]]);
}

section("H — повторный резерв того же заказа (уникальность)");
{
  const o1 = await makeOrder("ZV26-H1", "aaaaaaaa-0000-4000-8000-00000000b001");
  const r1 = await reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 700, estimatedMinutes: 160, createdBy: CONF });
  let err2 = null;
  try {
    await reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 700, endMinute: 860, estimatedMinutes: 160, createdBy: CONF });
  } catch (e) { err2 = e; }
  assert("H1 второй резерв того же заказа отклонён", err2 !== null && err2.code === "ORDER_ALREADY_RESERVED", `code=${err2?.code ?? "-"}`);
  await pool.query(`DELETE FROM public.capacity_reservations WHERE order_id::text = ANY($1)`, [[o1]]);
  await pool.query(`DELETE FROM public.orders WHERE id::text = ANY($1)`, [[o1]]);
}

section("I — изменение рецепта задним числом (модель: версия не снапшотится)");
{
  const oid = await makeOrder("ZV26-I1", PRODUCT_MAIN);
  const b1 = await computeOrderBreakdown(oid);
  const berries1 = b1?.ingredients.find((i) => i.name === "Ягоды");
  assert("I1 разбор исторического заказа: Ягоды 250 г", berries1?.required === 250, `required=${berries1?.required}`);
  await pool.query(`UPDATE public.recipe_ingredients SET qty=500 WHERE recipe_id=$1::uuid AND name='Ягоды'`, [RECIPE_MAIN]);
  const b2 = await computeOrderBreakdown(oid);
  const berries2 = b2?.ingredients.find((i) => i.name === "Ягоды");
  assert("I2 после правки рецепта разбор СТАРОГО заказа изменился (500 г) — версия не изолирована", berries2?.required === 500, `required=${berries2?.required}`);
  await pool.query(`UPDATE public.recipe_ingredients SET qty=250 WHERE recipe_id=$1::uuid AND name='Ягоды'`, [RECIPE_MAIN]);
  await pool.query(`DELETE FROM public.orders WHERE id::text=$1`, [oid]);
}

section("J — отмена заказа освобождает резерв");
{
  const o1 = await makeOrder("ZV26-J1", "aaaaaaaa-0000-4000-8000-00000000b001");
  await reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 700, estimatedMinutes: 160, createdBy: CONF });
  const before = await getActiveReservation(o1);
  assert("J1 резерв активен до отмены", before !== null);
  const res = await applyOrderTransition({ orderId: o1, to: "CANCELLED", actorId: CUST, actorRoles: ["CUSTOMER"] });
  assert("J2 переход PENDING→CANCELLED выполнен", res.to === "CANCELLED", `from=${res.from}`);
  const after = await getActiveReservation(o1);
  assert("J3 резерв освобождён (status=released)", after === null);
  const st = await pool.query(`SELECT status FROM public.capacity_reservations WHERE order_id=$1::uuid`, [o1]);
  assert("J4 запись резерва сохранена со статусом released", st.rows[0]?.status === "released", `status=${st.rows[0]?.status}`);
  await pool.query(`DELETE FROM public.orders WHERE id::text=$1`, [o1]);
}

// Итог
console.log(`\n════════════════════════════════`);
console.log(`PASSED: ${passed}  FAILED: ${failed}`);
if (failures.length) { console.log(`Failures: ${failures.join("; ")}`); }
await pool.end();
process.exit(failed > 0 ? 1 : 0);
