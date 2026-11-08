/**
 * verify-supplier-procurement-v17.ts — интеграционная верификация контура
 * закупок на реальной БД (Z-v17). Запуск:
 *
 *   DATABASE_URL=... bun scripts/verify-supplier-procurement-v17.ts
 *
 * Сценарии:
 *   1. Happy path: SUBMITTED → CONFIRMED → PROCESSING → READY_FOR_SHIPMENT →
 *      SHIPPED → DELIVERED; резерв→списание; история; движения.
 *   2. Недостаточно остатка → 409, резерва нет.
 *   3. Нарушение MOQ/кратности → 409.
 *   4. Конкурентные заказы на последний остаток: 1 победит, 2-й → 409.
 *   5. Идемпотентность: повторный create с тем же ключом → existing, 1 запись.
 *   6. Reject освобождает резерв.
 *   7. Confirm с корректировкой количеств: излишек резерва освобождается.
 *   8. Buyer cancel после confirm → резерв освобождён.
 *   9. Изоляция: чужой buyer не может отменить заказ (403/409).
 *  10. Неопубликованный товар не заказывается.
 * По завершении тестовые данные удаляются (rollback).
 */
import { Pool } from "pg";

const url =
  process.env.DATABASE_URL ||
  (() => {
    const fs = require("node:fs");
    const m = fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m);
    return m ? m[1].trim() : "postgresql://postgres@127.0.0.1:54329/conditera";
  })();

const pool = new Pool({ connectionString: url });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TS = Date.now();
const idPart = String(TS).slice(-8); // 8 цифр → последняя группа UUID = 12 символов
const SUPPLIER = `11111111-aaaa-4bbb-8ccc-${idPart}0001`;
const SUPPLIER2 = `11111111-aaaa-4bbb-8ccc-${idPart}0002`;
const BUYER = `11111111-aaaa-4bbb-8ccc-${idPart}0003`;
const BUYER2 = `11111111-aaaa-4bbb-8ccc-${idPart}0004`;
const PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$fakefakefake$fakefakefakefakefakefakefakefake";

async function seedUser(id: string, email: string, role: string, name: string) {
  await pool.query(
    `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), jsonb_build_object('name', $4::text, 'role', $5::text), NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, email, PASSWORD_HASH, name, role]
  );
  await pool.query(
    `INSERT INTO profiles (id, email, name, is_blocked) VALUES ($1, $2, $3, false)
     ON CONFLICT (id) DO NOTHING`,
    [id, email, name]
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role, is_active) VALUES ($1, $2, true)
     ON CONFLICT (user_id, role) DO UPDATE SET is_active = true`,
    [id, role]
  );
}

async function seedSupplierProfile(userId: string, companyName: string, status = "approved") {
  const res = await pool.query(
    `INSERT INTO supplier_profiles
       (id, "userId", "companyName", "contactPerson", phone, email, region, description,
        "productCategories", "verificationStatus", "isActive", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'Тест Контакт', '+7 900 000-00-00', $3,
             'Москва', 'Тестовый поставщик Z-v17', ARRAY['chocolate']::text[], $4, true, NOW(), NOW())
     RETURNING id`,
    [userId, companyName, `s${userId.slice(0, 8)}@test.local`, status]
  );
  return res.rows[0].id as string;
}

async function seedProduct(supplierId: string, name: string, opts: {
  quantity: number; price: number; moq?: number; step?: number; status?: string;
}) {
  const res = await pool.query(
    `INSERT INTO supplier_products
       (supplier_id, product_name, category, unit, quantity, price, min_order_qty, order_step, status, is_active)
     VALUES ($1, $2, 'chocolate', 'kg', $3, $4, $5, $6, $7, true)
     RETURNING id, quantity, reserved_quantity`,
    [supplierId, name, opts.quantity, opts.price, opts.moq ?? 1, opts.step ?? 1, opts.status ?? "published"]
  );
  return res.rows[0];
}

// Импорт бизнес-логики после подготовки env.
const { createPurchaseOrder, transitionPurchaseOrder } = await import(
  "../src/lib/purchase-orders.ts"
);

async function main() {
  console.log("=== Z-v17: интеграционная верификация закупок ===");
  console.log(`DB: ${url.replace(/\/\/.*@/, "//<hidden>@")}`);

  // --- Seed ---
  await seedUser(SUPPLIER, `v17sup${TS}@test.local`, "SUPPLIER", "Поставщик Тест 17");
  await seedUser(SUPPLIER2, `v17sup2${TS}@test.local`, "SUPPLIER", "Поставщик Второй 17");
  await seedUser(BUYER, `v17buy${TS}@test.local`, "CONFECTIONER", "Кондитер Тест 17");
  await seedUser(BUYER2, `v17buy2${TS}@test.local`, "CONFECTIONER", "Кондитер Чужой 17");
  await seedSupplierProfile(SUPPLIER, "ШокоПром Тест");
  await seedSupplierProfile(SUPPLIER2, "Запасной Поставщик Тест");

  const prodA = await seedProduct(SUPPLIER, "Шоколад тёмный 70% (тест)", { quantity: 10, price: 8500, moq: 2, step: 2 });
  const prodB = await seedProduct(SUPPLIER, "Шоколад молочный (последний)", { quantity: 2, price: 7900, moq: 1, step: 1 });
  const prodC = await seedProduct(SUPPLIER, "Какао-порошок (корректировка)", { quantity: 10, price: 3200, moq: 1, step: 1 });
  const prodHidden = await seedProduct(SUPPLIER, "Скрытый товар (draft)", { quantity: 50, price: 1000, status: "draft" });

  // --- 1. Happy path ---
  console.log("\n[1] Happy path SUBMITTED→…→DELIVERED");
  const created = await createPurchaseOrder(BUYER, {
    supplierId: SUPPLIER,
    items: [{ productId: prodA.id, quantity: 4 }],
    deliveryMethod: "pickup",
    buyerComment: "Тестовый заказ",
  });
  check("заказ создан (201)", created.ok === true);
  if (!created.ok) throw new Error("happy path не создан, дальше бессмысленно");
  const order = created.order as any;
  check("номер PO-формата", /^PO-\d{4}-\d{4}$/.test(order.number), order.number);
  check("статус SUBMITTED", order.status === "SUBMITTED");
  check("сумма 4×8500=34000 копеек", order.subtotal === 34000, String(order.subtotal));

  const r1 = await pool.query("SELECT quantity, reserved_quantity FROM supplier_products WHERE id=$1", [prodA.id]);
  check("резерв 4 зафиксирован", Number(r1.rows[0].reserved_quantity) === 4, JSON.stringify(r1.rows[0]));

  const mv1 = await pool.query(
    "SELECT count(*) c FROM supplier_product_movements WHERE order_id=$1 AND type='RESERVE'",
    [order.id]
  );
  check("движение RESERVE в журнале", Number(mv1.rows[0].c) === 1);

  // Кондитер не может подтвердить заказ (роль buyer).
  const buyerConfirm = await transitionPurchaseOrder({
    orderId: order.id, actorId: BUYER, actorParty: "buyer", actorRole: "buyer", action: "confirm",
  });
  check("buyer.confirm запрещён", buyerConfirm.ok === false && (buyerConfirm as any).httpStatus === 403);

  // Поставщик подтверждает.
  const conf = await transitionPurchaseOrder({
    orderId: order.id, actorId: SUPPLIER, actorParty: "supplier", actorRole: "supplier", action: "confirm",
  });
  check("supplier.confirm → CONFIRMED", conf.ok === true && (conf as any).order.status === "CONFIRMED", conf.ok ? undefined : JSON.stringify(conf));

  const chain: Array<[any, string]> = [
    [{ orderId: order.id, actorId: SUPPLIER, actorParty: "supplier", actorRole: "supplier", action: "process" }, "process"],
    [{ orderId: order.id, actorId: SUPPLIER, actorParty: "supplier", actorRole: "supplier", action: "ready_for_shipment", promisedShipmentDate: "2026-12-01" }, "ready_for_shipment"],
    [{ orderId: order.id, actorId: SUPPLIER, actorParty: "supplier", actorRole: "supplier", action: "ship" }, "ship"],
    [{ orderId: order.id, actorId: BUYER, actorParty: "buyer", actorRole: "buyer", action: "confirm_delivery" }, "confirm_delivery"],
  ];
  let lastStatus = "CONFIRMED";
  for (const [params, label] of chain) {
    const r = await transitionPurchaseOrder(params as any);
    check(
      `${label} → ${(r as any).order?.status ?? "FAIL"}`,
      r.ok === true,
      r.ok ? undefined : JSON.stringify(r)
    );
    if (r.ok) lastStatus = (r as any).order.status;
  }
  check("финальный статус DELIVERED", lastStatus === "DELIVERED");

  const r2 = await pool.query("SELECT quantity, reserved_quantity FROM supplier_products WHERE id=$1", [prodA.id]);
  check("списание: quantity 10-4=6", Number(r2.rows[0].quantity) === 6, JSON.stringify(r2.rows[0]));
  check("резерв снят: 0", Number(r2.rows[0].reserved_quantity) === 0);

  const mv2 = await pool.query(
    "SELECT type, sum(quantity) q FROM supplier_product_movements WHERE order_id=$1 GROUP BY type ORDER BY type",
    [order.id]
  );
  const types = Object.fromEntries(mv2.rows.map((r: any) => [r.type, Number(r.q)]));
  check("движения: RESERVE=4, OUT=4", types["RESERVE"] === 4 && types["OUT"] === 4, JSON.stringify(types));

  const hist = await pool.query(
    "SELECT to_status FROM purchase_order_status_history WHERE order_id=$1 ORDER BY created_at",
    [order.id]
  );
  check("история: 6 переходов", hist.rows.length === 6, String(hist.rows.length));

  // Уведомления создаёт route.ts (HTTP-слой), а не lib — проверяется в browser E2E.

  // Повторное confirm (идемпотентность статуса) → 409.
  const reconfirm = await transitionPurchaseOrder({
    orderId: order.id, actorId: SUPPLIER, actorParty: "supplier", actorRole: "supplier", action: "confirm",
  });
  check("повторный confirm → 409", reconfirm.ok === false && (reconfirm as any).httpStatus === 409);

  // --- 2. Недостаточно остатка ---
  console.log("\n[2] Недостаточно остатка → 409");
  const tooMuch = await createPurchaseOrder(BUYER, {
    supplierId: SUPPLIER, items: [{ productId: prodA.id, quantity: 100 }], deliveryMethod: "pickup",
  });
  check("заказ 100 кг → 409", tooMuch.ok === false && (tooMuch as any).httpStatus === 409, JSON.stringify(tooMuch));
  const r3 = await pool.query("SELECT reserved_quantity FROM supplier_products WHERE id=$1", [prodA.id]);
  check("резерв не изменился (0)", Number(r3.rows[0].reserved_quantity) === 0);

  // --- 3. MOQ ---
  console.log("\n[3] MOQ/кратность → 409");
  const moqBad = await createPurchaseOrder(BUYER, {
    supplierId: SUPPLIER, items: [{ productId: prodA.id, quantity: 3 }], deliveryMethod: "pickup",
  });
  check("3 кг при MOQ 2/step 2 → 409", moqBad.ok === false && (moqBad as any).httpStatus === 409);

  // --- 4. Конкурентные заказы на последний остаток ---
  console.log("\n[4] Гонка за последний остаток (2 ед., 2 параллельных заказа)");
  const [race1, race2] = await Promise.all([
    createPurchaseOrder(BUYER, { supplierId: SUPPLIER, items: [{ productId: prodB.id, quantity: 2 }], deliveryMethod: "pickup", idempotencyKey: `11111111-0000-4000-8000-${idPart}00a1` }),
    createPurchaseOrder(BUYER, { supplierId: SUPPLIER, items: [{ productId: prodB.id, quantity: 2 }], deliveryMethod: "pickup", idempotencyKey: `11111111-0000-4000-8000-${idPart}00a2` }),
  ]);
  const winners = [race1, race2].filter((r) => r.ok === true);
  const losers = [race1, race2].filter((r) => r.ok === false);
  check("ровно один победитель", winners.length === 1, `winners=${winners.length} ${JSON.stringify(race1)} ${JSON.stringify(race2)}`);
  check("проигравший получил 409", losers.length === 1 && (losers[0] as any).httpStatus === 409);
  const r4 = await pool.query("SELECT quantity, reserved_quantity FROM supplier_products WHERE id=$1", [prodB.id]);
  check("резерв ровно 2 (без двойного резерва)", Number(r4.rows[0].reserved_quantity) === 2, JSON.stringify(r4.rows[0]));

  // Отклонение поставщиком освобождает резерв.
  const raceOrderId = (winners[0] as any).order.id;
  const rej = await transitionPurchaseOrder({
    orderId: raceOrderId, actorId: SUPPLIER, actorParty: "supplier", actorRole: "supplier",
    action: "reject", rejectionReason: "Партия повреждена при транспортировке",
  });
  check("supplier.reject → REJECTED", rej.ok === true);
  const r5 = await pool.query("SELECT rejection_reason FROM purchase_orders WHERE id=$1", [raceOrderId]);
  const r5b = await pool.query("SELECT reserved_quantity FROM supplier_products WHERE id=$1", [prodB.id]);
  check("резерв освобождён после отказа", Number(r5b.rows[0].reserved_quantity) === 0, JSON.stringify(r5b.rows[0]));
  check("причина отказа сохранена", String(r5.rows[0].rejection_reason).includes("транспортировке"));

  // --- 5. Идемпотентность ---
  console.log("\n[5] Идемпотентность создания");
  const idemKey = `11111111-0000-4000-8000-${idPart}00b1`;
  const i1 = await createPurchaseOrder(BUYER, {
    supplierId: SUPPLIER, items: [{ productId: prodC.id, quantity: 2 }], deliveryMethod: "pickup", idempotencyKey: idemKey,
  });
  const i2 = await createPurchaseOrder(BUYER, {
    supplierId: SUPPLIER, items: [{ productId: prodC.id, quantity: 2 }], deliveryMethod: "pickup", idempotencyKey: idemKey,
  });
  check("первый создан", i1.ok === true && (i1 as any).existing !== true);
  check("повтор → existing:true, тот же номер", i2.ok === true && (i2 as any).existing === true && (i2 as any).order.number === (i1 as any).order.number);
  const i3 = await pool.query("SELECT count(*) c FROM purchase_orders WHERE idempotency_key=$1", [idemKey]);
  check("в БД ровно 1 заказ", Number(i3.rows[0].c) === 1);
  const i4 = await pool.query("SELECT reserved_quantity FROM supplier_products WHERE id=$1", [prodC.id]);
  check("резерв ровно 2 (без двойного)", Number(i4.rows[0].reserved_quantity) === 2);

  // --- 7. Confirm с корректировкой ---
  console.log("\n[6] Confirm с корректировкой объёма");
  const idemOrderId = (i1 as any).order.id;
  const itemsRows = await pool.query("SELECT id FROM purchase_order_items WHERE order_id=$1", [idemOrderId]);
  const confAdj = await transitionPurchaseOrder({
    orderId: idemOrderId, actorId: SUPPLIER, actorParty: "supplier", actorRole: "supplier",
    action: "confirm",
    confirmedItems: [{ itemId: itemsRows.rows[0].id, quantity: 1 }],
  });
  check("confirm с корректировкой → CONFIRMED", confAdj.ok === true);
  const r6 = await pool.query("SELECT confirmed_quantity, confirmed_subtotal FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.order_id WHERE poi.order_id=$1", [idemOrderId]);
  check("confirmed_quantity=1", Number(r6.rows[0].confirmed_quantity) === 1, JSON.stringify(r6.rows[0]));
  check("confirmed_subtotal=3200", Number(r6.rows[0].confirmed_subtotal) === 3200);
  const r6b = await pool.query("SELECT reserved_quantity FROM supplier_products WHERE id=$1", [prodC.id]);
  check("излишек резерва освобождён (1)", Number(r6b.rows[0].reserved_quantity) === 1, JSON.stringify(r6b.rows[0]));

  // Buyer cancel после confirm → освобождение.
  const cancel = await transitionPurchaseOrder({
    orderId: idemOrderId, actorId: BUYER, actorParty: "buyer", actorRole: "buyer", action: "cancel",
  });
  check("buyer.cancel после confirm → CANCELLED", cancel.ok === true);
  const r6c = await pool.query("SELECT reserved_quantity FROM supplier_products WHERE id=$1", [prodC.id]);
  check("резерв 0 после отмены", Number(r6c.rows[0].reserved_quantity) === 0);

  // --- 9. Изоляция ---
  console.log("\n[7] Изоляция участников");
  const iso = await createPurchaseOrder(BUYER, {
    supplierId: SUPPLIER, items: [{ productId: prodA.id, quantity: 2 }], deliveryMethod: "pickup",
  });
  const isoOrderId = (iso as any).order.id;
  const foreign = await transitionPurchaseOrder({
    orderId: isoOrderId, actorId: BUYER2, actorParty: "buyer", actorRole: "buyer", action: "cancel",
  });
  check("чужой кондитер не может отменить (403)", foreign.ok === false && (foreign as any).httpStatus === 403, JSON.stringify(foreign));
  const foreign2 = await transitionPurchaseOrder({
    orderId: isoOrderId, actorId: SUPPLIER2, actorParty: "supplier", actorRole: "supplier", action: "confirm",
  });
  check("чужой поставщик не может подтвердить (403)", foreign2.ok === false && (foreign2 as any).httpStatus === 403);
  const selfOrder = await createPurchaseOrder(SUPPLIER, {
    supplierId: SUPPLIER, items: [{ productId: prodA.id, quantity: 2 }], deliveryMethod: "pickup",
  });
  check("поставщик не может заказать у себя (409)", selfOrder.ok === false && (selfOrder as any).httpStatus === 409);

  // --- 10. Неопубликованный товар ---
  console.log("\n[8] Неопубликованный товар недоступен");
  const hidden = await createPurchaseOrder(BUYER, {
    supplierId: SUPPLIER, items: [{ productId: prodHidden.id, quantity: 1 }], deliveryMethod: "pickup",
  });
  check("заказ draft-товара → 409", hidden.ok === false && (hidden as any).httpStatus === 409);

  // --- Итог ---
  console.log(`\n=== ИТОГ: passed=${passed}, failed=${failed} ===`);
  if (failures.length) {
    console.error("Провалы:");
    for (const f of failures) console.error("  - " + f);
  }
  await cleanup();
  process.exit(failed === 0 ? 0 : 1);
}

async function cleanup() {
  console.log("\n[cleanup] удаление тестовых данных…");
  await pool.query("DELETE FROM purchase_orders WHERE buyer_id = ANY($1) OR supplier_id = ANY($1)", [[SUPPLIER, SUPPLIER2, BUYER, BUYER2]]);
  await pool.query("DELETE FROM supplier_product_movements WHERE supplier_id = ANY($1)", [[SUPPLIER, SUPPLIER2]]);
  await pool.query("DELETE FROM supplier_products WHERE supplier_id = ANY($1)", [[SUPPLIER, SUPPLIER2]]);
  await pool.query("DELETE FROM supplier_profile_reviews WHERE profile_id IN (SELECT id FROM supplier_profiles WHERE \"userId\" = ANY($1))", [[SUPPLIER, SUPPLIER2]]);
  await pool.query("DELETE FROM supplier_profiles WHERE \"userId\" = ANY($1)", [[SUPPLIER, SUPPLIER2]]);
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1)", [[SUPPLIER, SUPPLIER2, BUYER, BUYER2]]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [[SUPPLIER, SUPPLIER2, BUYER, BUYER2]]);
  await pool.query("DELETE FROM profiles WHERE id = ANY($1)", [[SUPPLIER, SUPPLIER2, BUYER, BUYER2]]);
  await pool.query("DELETE FROM auth.users WHERE id = ANY($1)", [[SUPPLIER, SUPPLIER2, BUYER, BUYER2]]);
  console.log("[cleanup] done");
}

main()
  .catch(async (e) => {
    console.error("FATAL:", e?.message ?? e);
    await cleanup().catch(() => {});
    process.exit(1);
  })
  .finally(() => pool.end());
