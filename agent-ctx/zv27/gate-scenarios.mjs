/**
 * Z-v27 Этап 6 — изолированные acceptance/inventory сценарии A-P.
 *
 * Запуск: DATABASE_URL=<disposable> bun agent-ctx/zv27/gate-scenarios.mjs
 * Реальный код проекта (acceptance/breakdown/capacity/lifecycle) + реальный
 * RPC списания apply_inventory_write_off_batch (0071). Фикстуры zv27, БД disposable.
 */
import { createHash } from "node:crypto";
import pg from "pg";

const { checkAcceptance, loadProductItemsData, checkOrderAcceptance } = await import("@/lib/ops/acceptance");
const { computeOrderBreakdown } = await import("@/lib/ops/breakdown");
const { reserveCapacityWindow, getActiveReservation } = await import("@/lib/ops/capacity");
const { applyOrderTransition } = await import("@/lib/ops/lifecycle");

const DB_URL = process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:54329/conditera_zv27_gate";
console.log(`DB: ${DB_URL.replace(/\/[^/]+$/, "/<db>")}`);

const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });

const CONF = "11111111-1111-4111-8111-111111111101";
const CUST = "11111111-1111-4111-8111-111111111106";
const PRODUCT_MAIN = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUCT_NO_RECIPE = "aaaaaaaa-0000-4000-8000-000000000002";
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
  await pool.query(
    `INSERT INTO public.confectioner_capacity (user_id, workday_start_minute, workday_end_minute, daily_capacity_minutes, is_active)
     VALUES ($1::uuid, 540, 1080, 480, true)
     ON CONFLICT (user_id) DO UPDATE SET is_active = true`,
    [CONF]
  );
  const ex = await pool.query(`SELECT id::text FROM public.inventory_items WHERE owner_id=$1::uuid AND (name='Ягоды' OR lower(trim(name))='ягоды')`, [CONF]);
  if (ex.rowCount === 0) {
    await pool.query(
      `INSERT INTO public.inventory_items (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, is_active)
       VALUES ($1::uuid, 'Ягоды', 'zv27-test', 1000, 'г', 0, 300, true)`,
      [CONF]
    );
  } else {
    await pool.query(`UPDATE public.inventory_items SET quantity=1000, is_active=true, unit='г' WHERE id=$1::uuid`, [ex.rows[0].id]);
  }
  const pid = "aaaaaaaa-0000-4000-8000-00000000b001";
  const pex = await pool.query(`SELECT id::text FROM public.products WHERE id=$1::uuid`, [pid]);
  if (pex.rowCount === 0) {
    await pool.query(
      `INSERT INTO public.products (id, confectioner_id, slug, title, price, status, production_time_hours, recipe_id, product_type)
       VALUES ($1::uuid, $2::uuid, 'zv27-test-a', 'ZV27-TEST Товар A', 100, 'published', 6, $3::uuid, 'physical')`,
      [pid, CONF, RECIPE_MAIN]
    );
  } else {
    await pool.query(`UPDATE public.products SET recipe_id=$2::uuid, production_time_hours=6, status='published' WHERE id=$1::uuid`, [pid, RECIPE_MAIN]);
  }
  const dex = await pool.query(`SELECT id::text FROM public.purchase_drafts WHERE owner_id=$1::uuid AND note='zv27-test'`, [CONF]);
  if (dex.rowCount === 0) {
    const d = await pool.query(
      `INSERT INTO public.purchase_drafts (owner_id, status, source, note, expected_eta)
       VALUES ($1::uuid, 'draft', 'zv27-test', 'zv27-test', NULL) RETURNING id::text`,
      [CONF]
    );
    await pool.query(`INSERT INTO public.purchase_draft_items (draft_id, name, quantity, unit) VALUES ($1::uuid, 'Ягоды', 1000, 'г')`, [d.rows[0].id]);
  }
}

async function setBerries(qty, unit = "г") {
  await pool.query(`UPDATE public.inventory_items SET quantity=$2, unit=$3 WHERE owner_id=$1::uuid AND (name='Ягоды' OR lower(trim(name))='ягоды')`, [CONF, qty, unit]);
}
async function setDraftEta(eta) {
  await pool.query(`UPDATE public.purchase_drafts SET expected_eta=$2 WHERE owner_id=$1::uuid AND note='zv27-test'`, [CONF, eta]);
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
     VALUES ($1::uuid, $2::uuid, 'ZV27-TEST', 100, $3, 100 * $3)`,
    [id, productId, qty]
  );
  return id;
}

function sig(items) {
  const canon = [...items].map((i) => `${i.item_id}:${i.quantity}`).sort().join("|");
  return createHash("sha256").update(canon).digest("hex");
}

// Order-путь списания (0048/0049): batch_id=NULL, идемпотентность по (owner, order, signature)
async function writeOffBatch(orderId, items) {
  const r = await pool.query(
    `SELECT public.apply_inventory_write_off_batch($1::uuid, $2::jsonb, $3::uuid, NULL, NULL, $4) AS out`,
    [CONF, JSON.stringify(items), orderId, sig(items)]
  );
  return r.rows[0].out;
}

await upsertFixture();

// ═══════ A-F: гейт (повтор Z-v26 на текущем HEAD для свежих доказательств) ═══════
section("A — корректный товар (рецепт+время+склад+мощность)");
{
  const r = await gateFor("aaaaaaaa-0000-4000-8000-00000000b001");
  const codes = r.reasons.map((x) => x.code);
  assert("A1 gate passes (canAccept)", r.canAccept === true, `codes=${codes.join("|")}`);
  assert("A2 availability=available", r.availability === "available", `got=${r.availability}`);
  assert("A3 нет блокирующих кодов", codes.length === 0);
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

section("C — production_time не сконфигурирован (warning)");
{
  const r = await gateFor(PRODUCT_MAIN);
  const codes = r.reasons.map((x) => x.code);
  assert("C1 MISSING_PRODUCT_DATA присутствует", codes.includes("MISSING_PRODUCT_DATA"), `codes=${codes.join("|")}`);
  assert("C2 warning (не блокирует)", r.canAccept === true && r.availability === "available_with_warning", `canAccept=${r.canAccept}`);
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

section("E — закупка с ETA успевает (CAN_ACCEPT_WITH_PURCHASE)");
{
  await setBerries(100);
  await setDraftEta(DAY2_NOON.toISOString());
  const r = await gateFor(PRODUCT_MAIN);
  const codes = r.reasons.map((x) => x.code);
  assert("E1 CAN_ACCEPT_WITH_PURCHASE, без LOW_STOCK", codes.includes("CAN_ACCEPT_WITH_PURCHASE") && !codes.includes("LOW_STOCK"), `codes=${codes.join("|")}`);
  assert("E2 canAccept=true", r.canAccept === true);
  await setDraftEta(null);
  await setBerries(1000);
}

section("F — закупка без ETA (блокирует)");
{
  await setBerries(100);
  await setDraftEta(null);
  const r = await gateFor(PRODUCT_MAIN);
  const codes = r.reasons.map((x) => x.code);
  assert("F1 PURCHASE_ETA_MISSING блокирующий", codes.includes("PURCHASE_ETA_MISSING"), `codes=${codes.join("|")}`);
  assert("F2 canAccept=false", r.canAccept === false);
  await setBerries(1000);
}

// ═══════ G-J: резервы/жизненный цикл ═══════
section("G — конкурентное резервирование окна (EXCLUDE)");
{
  const o1 = await makeOrder("ZV27-G1", "aaaaaaaa-0000-4000-8000-00000000b001");
  const o2 = await makeOrder("ZV27-G2", "aaaaaaaa-0000-4000-8000-00000000b001");
  let first = null, secondErr = null;
  const p1 = reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 900, estimatedMinutes: 360, createdBy: CONF })
    .then((r) => { first = r; }).catch((e) => { secondErr = e; });
  const p2 = reserveCapacityWindow({ orderId: o2, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 900, estimatedMinutes: 360, createdBy: CONF })
    .then((r) => { if (!first) first = r; else secondErr = new Error("BOTH_SUCCEEDED"); }).catch((e) => { secondErr = e; });
  await Promise.all([p1, p2]);
  assert("G1 ровно один резерв создан", first !== null && secondErr !== null && secondErr.code === "OVERLAP", `err=${secondErr?.message ?? "-"}`);
  assert("G2 OVERLAP (23P01)", secondErr !== null && secondErr.code === "OVERLAP");
  await pool.query(`DELETE FROM public.capacity_reservations WHERE order_id::text = ANY($1)`, [[o1, o2]]);
  await pool.query(`DELETE FROM public.orders WHERE id::text = ANY($1)`, [[o1, o2]]);
}

section("H — повторный резерв того же заказа");
{
  const o1 = await makeOrder("ZV27-H1", "aaaaaaaa-0000-4000-8000-00000000b001");
  await reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 700, estimatedMinutes: 160, createdBy: CONF });
  let err2 = null;
  try {
    await reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 700, endMinute: 860, estimatedMinutes: 160, createdBy: CONF });
  } catch (e) { err2 = e; }
  assert("H1 ORDER_ALREADY_RESERVED", err2 !== null && err2.code === "ORDER_ALREADY_RESERVED", `code=${err2?.code ?? "-"}`);
  await pool.query(`DELETE FROM public.capacity_reservations WHERE order_id::text = ANY($1)`, [[o1]]);
  await pool.query(`DELETE FROM public.orders WHERE id::text = ANY($1)`, [[o1]]);
}

section("I/M — правка рецепта после заказа (версии не снапшотятся)");
{
  const oid = await makeOrder("ZV27-I1", PRODUCT_MAIN);
  const b1 = await computeOrderBreakdown(oid);
  const berries1 = b1?.ingredients.find((i) => i.name === "Ягоды");
  assert("I1 разбор исторического заказа: Ягоды 250 г", berries1?.required === 250, `required=${berries1?.required}`);

  await pool.query(`UPDATE public.recipe_ingredients SET qty=500 WHERE recipe_id=$1::uuid AND name='Ягоды'`, [RECIPE_MAIN]);
  const b2 = await computeOrderBreakdown(oid);
  const berries2 = b2?.ingredients.find((i) => i.name === "Ягоды");
  assert("I2 разбор СТАРОГО заказа изменился (500 г) — версия не изолирована", berries2?.required === 500, `required=${berries2?.required}`);

  // M-ext: склад 250 г → после правки рецепта accept СТАРОГО заказа падает (canProduce=false)
  await setBerries(250);
  const acc = await checkOrderAcceptance(oid);
  const invBlocked = acc?.owners.some((o) => !o.inventory.canProduce) ?? false;
  assert("M1 после правки рецепта accept исторического заказа БЛОКИРОВАН (409 ORDER_NOT_FEASIBLE)", invBlocked === true, `canAccept=${acc?.canAccept} invBlocked=${invBlocked}`);
  assert("M2 причина — дефицит Ягоды −250 г", (acc?.owners[0]?.inventory.shortages ?? []).some((s) => s.name === "Ягоды" && s.shortage === 250), JSON.stringify(acc?.owners[0]?.inventory.shortages));

  await pool.query(`UPDATE public.recipe_ingredients SET qty=250 WHERE recipe_id=$1::uuid AND name='Ягоды'`, [RECIPE_MAIN]);
  const acc2 = await checkOrderAcceptance(oid);
  assert("M3 откат рецепта восстанавливает приемлемость (order не повреждён)", acc2?.canAccept === true && !(acc2?.owners.some((o) => !o.inventory.canProduce)), `canAccept=${acc2?.canAccept}`);
  await setBerries(1000);
  await pool.query(`DELETE FROM public.orders WHERE id::text=$1`, [oid]);
}

section("J — отмена заказа освобождает резерв");
{
  const o1 = await makeOrder("ZV27-J1", "aaaaaaaa-0000-4000-8000-00000000b001");
  await reserveCapacityWindow({ orderId: o1, confectionerId: CONF, date: DAY3, startMinute: 540, endMinute: 700, estimatedMinutes: 160, createdBy: CONF });
  const before = await getActiveReservation(o1);
  assert("J1 резерв активен до отмены", before !== null);
  const res = await applyOrderTransition({ orderId: o1, to: "CANCELLED", actorId: CUST, actorRoles: ["CUSTOMER"] });
  assert("J2 переход PENDING→CANCELLED выполнен", res.to === "CANCELLED", `from=${res.from}`);
  const after = await getActiveReservation(o1);
  assert("J3 резерв освобождён (released)", after === null);
  const st = await pool.query(`SELECT status FROM public.capacity_reservations WHERE order_id=$1::uuid`, [o1]);
  assert("J4 запись сохранена со статусом released", st.rows[0]?.status === "released");
  await pool.query(`DELETE FROM public.orders WHERE id::text=$1`, [o1]);
}

// ═══════ K/L/N/O/P: списание и fail-closed ═══════
section("L — повторное списание (RPC 0071, идемпотентный replay)");
{
  const oid = await makeOrder("ZV27-L1", "aaaaaaaa-0000-4000-8000-00000000b001");
  const inv = await pool.query(`SELECT id::text FROM public.inventory_items WHERE owner_id=$1::uuid AND name='Ягоды'`, [CONF]);
  const itemId = inv.rows[0].id;
  const before = await pool.query(`SELECT quantity FROM public.inventory_items WHERE id=$1::uuid`, [itemId]);
  const items = [{ item_id: itemId, quantity: 100 }];
  const r1 = await writeOffBatch(oid, items);
  assert("L1 первое списание применено (applied>0)", (r1.result?.applied?.length ?? 0) === 1, JSON.stringify(r1).slice(0, 120));
  const after1 = await pool.query(`SELECT quantity FROM public.inventory_items WHERE id=$1::uuid`, [itemId]);
  assert("L2 остаток уменьшился ровно на 100", Number(before.rows[0].quantity) - Number(after1.rows[0].quantity) === 100, `${before.rows[0].quantity}→${after1.rows[0].quantity}`);
  const r2 = await writeOffBatch(oid, items);
  assert("L3 повтор → idempotent:true", r2.idempotent === true, JSON.stringify(r2).slice(0, 120));
  const after2 = await pool.query(`SELECT quantity FROM public.inventory_items WHERE id=$1::uuid`, [itemId]);
  assert("L4 повторного движения НЕТ (остаток не изменился)", Number(after2.rows[0].quantity) === Number(after1.rows[0].quantity), `${after1.rows[0].quantity}→${after2.rows[0].quantity}`);
  const mv = await pool.query(`SELECT count(*)::int AS n FROM public.inventory_movements WHERE item_id=$1::uuid AND order_id=$2::uuid`, [itemId, oid]);
  assert("L5 ровно 1 movement в реестре", mv.rows[0].n === 1, `n=${mv.rows[0].n}`);
  await setBerries(1000);
  await pool.query(`DELETE FROM public.inventory_write_offs WHERE order_id=$1::uuid`, [oid]);
  await pool.query(`DELETE FROM public.orders WHERE id::text=$1`, [oid]);
}

section("N/O — атомарность и запрет оверселла/отрицательного остатка");
{
  const oid = await makeOrder("ZV27-N1", "aaaaaaaa-0000-4000-8000-00000000b001");
  await setBerries(250);
  const inv = await pool.query(`SELECT id::text FROM public.inventory_items WHERE owner_id=$1::uuid AND name='Ягоды'`, [CONF]);
  const itemId = inv.rows[0].id;

  // N: два конкурентных списания по 200 при остатке 250 — два РАЗНЫХ заказа
  // (разные подписи), один и тот же остаток; FOR UPDATE сериализует, ровно одно применяется
  const oid2 = await makeOrder("ZV27-N2", "aaaaaaaa-0000-4000-8000-00000000b001");
  let e1 = null, e2 = null, r1ok = false, r2ok = false;
  const p1 = writeOffBatch(oid, [{ item_id: itemId, quantity: 200 }]).then(() => { r1ok = true; }).catch((e) => { e1 = e; });
  const p2 = writeOffBatch(oid2, [{ item_id: itemId, quantity: 200 }]).then(() => { r2ok = true; }).catch((e) => { e2 = e; });
  await Promise.all([p1, p2]);
  assert("N1 ровно одно из двух конкурентных списаний прошло", (r1ok && !r2ok) || (!r1ok && r2ok), `ok1=${r1ok} ok2=${r2ok}`);
  const q1 = await pool.query(`SELECT quantity FROM public.inventory_items WHERE id=$1::uuid`, [itemId]);
  assert("N2 остаток ровно 50 (нет оверселла)", Number(q1.rows[0].quantity) === 50, `got=${q1.rows[0].quantity}`);

  // O1: попытка списать больше остатка → ошибка, остаток не меняется
  const oid3 = await makeOrder("ZV27-N3", "aaaaaaaa-0000-4000-8000-00000000b001");
  let oErr = null;
  try { await writeOffBatch(oid3, [{ item_id: itemId, quantity: 100 }]); } catch (e) { oErr = e; }
  const q2 = await pool.query(`SELECT quantity FROM public.inventory_items WHERE id=$1::uuid`, [itemId]);
  assert("O1 списание сверх остатка отклонено", oErr !== null && Number(q2.rows[0].quantity) === 50, `err=${oErr?.message?.slice(0, 80) ?? "none"} qty=${q2.rows[0].quantity}`);

  // O2: прямой UPDATE в минус невозможен (CHECK 0077)
  const chk = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.inventory_items'::regclass AND contype='c' AND conname LIKE '%nonneg%'`);
  let negErr = null;
  try { await pool.query(`UPDATE public.inventory_items SET quantity=-1 WHERE id=$1::uuid`, [itemId]); } catch (e) { negErr = e; }
  assert("O2 CHECK nonnegative существует и блокирует минус", chk.rowCount > 0 && negErr !== null, `constraint=${chk.rows[0]?.conname ?? "none"}`);
  const q3 = await pool.query(`SELECT quantity FROM public.inventory_items WHERE id=$1::uuid`, [itemId]);
  assert("O3 остаток после попытки минуса не изменился", Number(q3.rows[0].quantity) === 50, `got=${q3.rows[0].quantity}`);

  await setBerries(1000);
  await pool.query(`DELETE FROM public.inventory_write_offs WHERE order_id=$1::uuid`, [oid]);
  await pool.query(`DELETE FROM public.orders WHERE id::text = ANY($1)`, [[oid, oid2, oid3]]);
}

section("P — неизвестная единица склада (fail-closed?)");
{
  // Складская позиция «Ягоды» с НЕИЗВЕСТНОЙ единицей «ложка»: конверсия в «г»
  // невозможна → breakdown даёт unit_mismatch (не shortage).
  await setBerries(1000, "ложка");
  const r = await gateFor(PRODUCT_MAIN);
  const codes = r.reasons.map((x) => x.code);
  const canProduce = r.owners[0]?.inventory.canProduce;
  console.log(`  [факт] canAccept=${r.canAccept} codes=${codes.join("|")} canProduce=${canProduce} shortages=${JSON.stringify(r.owners[0]?.inventory.shortages ?? [])}`);
  assert("P1 CHECKOUT-гейт блокирует при неизвестной единице склада (fail-closed)", r.canAccept === false, `canAccept=${r.canAccept} codes=${codes.join("|")}`);
  assert("P2 accept-путь блокирует (canProduce=false)", canProduce === false, `canProduce=${canProduce}`);
  await setBerries(1000);
}

console.log(`\n════════════════════════════════`);
console.log(`PASSED: ${passed}  FAILED: ${failed}`);
if (failures.length) { console.log(`Failures: ${failures.join("; ")}`); }
await pool.end();
process.exit(failed > 0 ? 1 : 0);
