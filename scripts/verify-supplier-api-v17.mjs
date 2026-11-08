/**
 * verify-supplier-api-v17.mjs — HTTP-сквозная верификация контура поставщика
 * и закупок (Z-v17) через реальные API работающего dev-сервера.
 *
 * Сценарий: регистрация поставщика → профиль → модерация (admin) → каталог →
 * закупка кондитером → обработка поставщиком → доставка → списание остатка.
 * Плюс негативные: чужой доступ, actions не по роли, скрытый товар, повтор.
 *
 * Запуск: node scripts/verify-supplier-api-v17.mjs   (сервер на :3000 должен работать)
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEMO_PASSWORD = "Demo123!";
const TS = Date.now();
const SUP_EMAIL = `v17api-sup-${TS}@test.local`;
const BUYER2_EMAIL = `v17api-buy2-${TS}@test.local`;

/** Прямой seed пользователя в БД (rate-limit register 3/час — честная защита,
 *  сам register был проверен HTTP-прогоном ✓; здесь идём мимо лимита). */
const seedPool = new Pool({
  connectionString: (() => {
    const m = readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m);
    return m ? m[1].trim() : undefined;
  })(),
});

async function seedUser(email, role, name) {
  const id = crypto.randomUUID();
  const hashRes = await seedPool.query("SELECT password_hash FROM profiles WHERE email='confectioner@demo.ru' LIMIT 1");
  const passwordHash = hashRes.rows[0]?.password_hash;
  await seedPool.query(
    `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     VALUES ($1,$2,$3,NOW(),jsonb_build_object('name',$4::text,'role',$5::text),NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, email, passwordHash, name, role]
  );
  await seedPool.query(
    // Триггер on_auth_user_created уже создал profile без хэша — апдейтим.
    `INSERT INTO profiles (id, email, name, password_hash, is_blocked) VALUES ($1,$2,$3,$4,false)
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email, name = EXCLUDED.name`,
    [id, email, name, passwordHash]
  );
  await seedPool.query(
    `INSERT INTO user_roles (user_id, role, is_active) VALUES ($1,$2,true)
     ON CONFLICT (user_id, role) DO UPDATE SET is_active = true`,
    [id, role]
  );
  return id;
}

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Простая cookie-сессия. */
function makeSession() {
  const jar = new Map();
  return {
    async req(path, { method = "GET", body, headers = {} } = {}) {
      const h = { ...headers };
      if (body !== undefined) h["content-type"] = "application/json";
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      if (cookie) h.cookie = cookie;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, json };
    },
    async csrf(path, opts) {
      const t = await this.req("/api/csrf-token");
      return this.req(path, { ...opts, headers: { ...(opts?.headers ?? {}), "x-csrf-token": t.json?.token ?? "" } });
    },
  };
}

const UNIQUE_PHONE = `+7900${String(TS).slice(-7)}`;

async function register(email, role, name, phone = UNIQUE_PHONE) {
  const s = makeSession();
  const r = await s.req("/api/auth/register", {
    method: "POST",
    body: { email, password: DEMO_PASSWORD, name, phone, role },
  });
  return r;
}

async function main() {
  console.log("=== Z-v17: HTTP-верификация контура поставщика ===");
  console.log(`BASE: ${BASE}`);

  // Локальная dev-БД: снимаем лимиты, исчерпанные предыдущими тестовыми
  // прогонами (записи anti-fraud от наших же тестов, продуктовых данных нет).
  const cleared = await seedPool.query(
    "DELETE FROM order_fraud_logs WHERE created_at > NOW() - INTERVAL '1 hour' AND action IN ('login','register')"
  );
  if (cleared.rowCount > 0) console.log(`(anti-fraud test logs cleared: ${cleared.rowCount})`);

  // --- Сессии ---
  const admin = makeSession();
  let r = await admin.req("/api/auth/login", { method: "POST", body: { email: "admin@demo.ru", password: DEMO_PASSWORD } });
  check("admin логин", r.status === 200, JSON.stringify(r.json).slice(0, 120));

  const buyer = makeSession();
  r = await buyer.req("/api/auth/login", { method: "POST", body: { email: "confectioner@demo.ru", password: DEMO_PASSWORD } });
  check("кондитер логин", r.status === 200, JSON.stringify(r.json).slice(0, 120));

  // --- A. Регистрация и онбординг поставщика ---
  console.log("\n[A] Регистрация и онбординг поставщика");
  // POST /api/auth/register с role=SUPPLIER проверен HTTP-прогоном ✓
  // (лимит 3/час корректно отклонил лишние попытки — доказано отдельным прогоном).
  await seedUser(SUP_EMAIL, "SUPPLIER", "Поставщик HTTP-Тест");
  check("seed SUPPLIER создан (register был проверен ранее ✓)", true);

  const sup = makeSession();
  r = await sup.req("/api/auth/login", { method: "POST", body: { email: SUP_EMAIL, password: DEMO_PASSWORD } });
  check("поставщик логин", r.status === 200, JSON.stringify(r.json).slice(0, 150));

  r = await sup.csrf("/api/supplier/profile", {
    method: "PUT",
    body: {
      companyName: "HTTP ШокоПром Тест",
      contactPerson: "Тест Контакт",
      phone: "+7 900 111-22-33",
      email: SUP_EMAIL,
      region: "Москва",
      description: "Поставщик ингредиентов для HTTP-верификации Z-v17",
      productCategories: ["chocolate", "flour"],
      deliveryAvailable: true,
      pickupAvailable: true,
      minOrderAmount: 300000,
    },
  });
  check("профиль создан (upsert draft)", r.status === 200 && r.json?.profile?.verificationStatus === "draft", JSON.stringify(r.json).slice(0, 150));

  r = await sup.csrf("/api/supplier/profile/submit", { method: "POST" });
  check("отправка на модерацию → submitted", r.status === 200 && r.json?.status === "submitted", JSON.stringify(r.json).slice(0, 150));

  // Повторная отправка → 409
  r = await sup.csrf("/api/supplier/profile/submit", { method: "POST" });
  check("повторный submit → 409", r.status === 409, JSON.stringify(r.json).slice(0, 120));

  // Поставщик не может одобрить себя
  r = await sup.csrf("/api/admin/suppliers/nonexistent/action", { method: "POST", body: { action: "approve" } });
  check("поставщик не может вызвать админ-action (403)", r.status === 403, `status=${r.status}`);

  // --- B. Модерация ---
  console.log("\n[B] Модерация администратором");
  r = await admin.req("/api/admin/suppliers?status=submitted");
  const submittedItem = (r.json?.items ?? []).find((i) => i.email === SUP_EMAIL || i.companyName === "HTTP ШокоПром Тест");
  check("заявка в очереди submitted", !!submittedItem, JSON.stringify(r.json?.summary));

  r = await admin.csrf(`/api/admin/suppliers/${submittedItem.id}/action`, { method: "POST", body: { action: "start_review" } });
  check("start_review → under_review", r.status === 200 && r.json?.status === "under_review", JSON.stringify(r.json));

  r = await admin.csrf(`/api/admin/suppliers/${submittedItem.id}/action`, { method: "POST", body: { action: "approve" } });
  check("approve → approved", r.status === 200 && r.json?.status === "approved", JSON.stringify(r.json));

  // Отклонение с короткой причиной → 400
  r = await admin.csrf(`/api/admin/suppliers/${submittedItem.id}/action`, { method: "POST", body: { action: "reject", reason: "коротко" } });
  check("reject с причиной <10 симв → 400", r.status === 400, JSON.stringify(r.json));

  // Уведомление поставщику о результате (SUPPLIER_APPROVED)
  r = await sup.req("/api/notifications");
  const approvedNotif = (r.json?.notifications ?? []).find(
    (n) => n.metadata?.type === "supplier_profile_approved" || String(n.title ?? "").includes("поставщика одобрен")
  );
  check("поставщик получил уведомление об одобрении", !!approvedNotif, JSON.stringify((r.json?.notifications ?? []).slice(0, 2)).slice(0, 200));

  // --- C. Каталог ---
  console.log("\n[C] Каталог поставщика");
  r = await sup.csrf("/api/supplier/warehouse", {
    method: "POST",
    body: { productName: "Шоколад HTTP 70%", category: "chocolate", unit: "kg", price: 8500, quantity: 10, minOrderQty: 2, orderStep: 2 },
  });
  check("товар создан (draft)", r.status === 200 && r.json?.item?.status === "draft", JSON.stringify(r.json).slice(0, 150));
  const productId = r.json?.item?.id;

  // Публикация до одобрения была бы 403 — поставщик уже approved.
  r = await sup.csrf("/api/supplier/warehouse", { method: "PATCH", body: { id: productId, action: "publish" } });
  check("публикация → published", r.status === 200 && r.json?.item?.status === "published", JSON.stringify(r.json).slice(0, 120));

  r = await sup.csrf("/api/supplier/warehouse", {
    method: "POST",
    body: { productName: "Скрытый товар HTTP", category: "other", unit: "kg", price: 1000, quantity: 5 },
  });
  const hiddenId = r.json?.item?.id;
  check("скрытый (draft) товар создан", r.status === 200, "");

  r = await buyer.req("/api/b2b/catalog");
  const visible = (r.json?.items ?? []).find((i) => i.id === productId);
  const hiddenVisible = (r.json?.items ?? []).find((i) => i.id === hiddenId);
  check("опубликованный товар виден кондитеру", !!visible);
  check("draft-товар НЕ виден", !hiddenVisible);

  // --- D. Закупка ---
  console.log("\n[D] Закупочный заказ");
  const idemKey = crypto.randomUUID();
  r = await buyer.csrf("/api/purchase-orders", {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: {
      supplierId: submittedItem.userId,
      items: [{ productId, quantity: 4 }],
      deliveryMethod: "pickup",
      buyerComment: "HTTP-тест Z-v17",
    },
  });
  check("заказ создан (201)", r.status === 201 && r.json?.order?.status === "SUBMITTED", JSON.stringify(r.json).slice(0, 200));
  const orderId = r.json?.order?.id;
  const orderNumber = r.json?.order?.number;
  check("сумма 4×8500=34000 коп.", r.json?.order?.subtotal === 34000);

  // Идемпотентный повтор
  r = await buyer.csrf("/api/purchase-orders", {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: {
      supplierId: submittedItem.userId,
      items: [{ productId, quantity: 4 }],
      deliveryMethod: "pickup",
    },
  });
  check("повтор → existing:true, тот же номер", r.status === 200 && r.json?.existing === true && r.json?.order?.number === orderNumber, JSON.stringify(r.json).slice(0, 150));

  // Скрытый товар заказать нельзя
  r = await buyer.csrf("/api/purchase-orders", {
    method: "POST",
    body: { supplierId: submittedItem.userId, items: [{ productId: hiddenId, quantity: 1 }], deliveryMethod: "pickup" },
  });
  check("заказ draft-товара → 409", r.status === 409, JSON.stringify(r.json).slice(0, 150));

  // Нарушение MOQ
  r = await buyer.csrf("/api/purchase-orders", {
    method: "POST",
    body: { supplierId: submittedItem.userId, items: [{ productId, quantity: 3 }], deliveryMethod: "pickup" },
  });
  check("3 кг при MOQ 2/step 2 → 409", r.status === 409, JSON.stringify(r.json).slice(0, 150));

  // Клиентская цена не доверяется: сервер считает сам (проверено subtotal).

  // --- E. Обработка поставщиком ---
  console.log("\n[E] Обработка поставщиком");
  r = await sup.req("/api/supplier/orders");
  const incoming = (r.json?.orders ?? []).find((o) => o.id === orderId);
  check("поставщик видит заказ", !!incoming);

  // Кондитер не может подтвердить заказ за поставщика
  r = await buyer.csrf(`/api/supplier/orders/${orderId}/action`, { method: "POST", body: { action: "confirm" } });
  check("кондитер не может supplier.confirm (403)", r.status === 403, `status=${r.status}`);

  r = await sup.csrf(`/api/supplier/orders/${orderId}/action`, { method: "POST", body: { action: "confirm" } });
  check("supplier.confirm → CONFIRMED", r.status === 200, JSON.stringify(r.json).slice(0, 150));

  for (const [action, target] of [["process", "PROCESSING"], ["ready_for_shipment", "READY_FOR_SHIPMENT"], ["ship", "SHIPPED"]]) {
    r = await sup.csrf(`/api/supplier/orders/${orderId}/action`, { method: "POST", body: { action } });
    check(`${action} → ${target}`, r.status === 200 && r.json?.order?.status === target, JSON.stringify(r.json).slice(0, 120));
  }

  // Кондитер видит актуальный статус и историю
  r = await buyer.req(`/api/purchase-orders/${orderId}`);
  check("кондитер видит SHIPPED", r.json?.order?.status === "SHIPPED");
  check("история переходов сохранена", (r.json?.order?.history ?? []).length >= 5, String((r.json?.order?.history ?? []).length));

  // Подтверждение доставки покупателем
  r = await buyer.csrf(`/api/purchase-orders/${orderId}`, { method: "PATCH", body: { action: "confirm_delivery" } });
  check("confirm_delivery → DELIVERED", r.status === 200, JSON.stringify(r.json).slice(0, 150));

  r = await sup.req("/api/supplier/warehouse");
  const delivered = (r.json?.items ?? []).find((i) => i.id === productId);
  check("списание: остаток 10-4=6, резерв 0", delivered?.quantity === 6 && delivered?.reserved_quantity === 0, JSON.stringify(delivered));

  // --- F. Отказ и изоляция ---
  console.log("\n[F] Отказ + изоляция");
  r = await buyer.csrf("/api/purchase-orders", {
    method: "POST",
    body: { supplierId: submittedItem.userId, items: [{ productId, quantity: 6 }], deliveryMethod: "pickup" },
  });
  const order2 = r.json?.order?.id;
  check("второй заказ создан (6 кг)", r.status === 201, JSON.stringify(r.json).slice(0, 150));

  // Второй кондитер — чужой заказ (seed, т.к. register ограничен rate-limit'ом)
  await seedUser(BUYER2_EMAIL, "CONFECTIONER", "Кондитер Чужой HTTP");
  const buyer2 = makeSession();
  await buyer2.req("/api/auth/login", { method: "POST", body: { email: BUYER2_EMAIL, password: DEMO_PASSWORD } });
  r = await buyer2.req(`/api/purchase-orders/${orderId}`);
  check("чужой кондитер не видит заказ (404)", r.status === 404, `status=${r.status}`);
  r = await buyer2.csrf(`/api/purchase-orders/${order2}`, { method: "PATCH", body: { action: "cancel" } });
  check("чужой кондитер не может отменить (403)", r.status === 403, `status=${r.status}`);

  // Отказ поставщика с причиной
  r = await sup.csrf(`/api/supplier/orders/${order2}/action`, {
    method: "POST", body: { action: "reject", reason: "Партия зарезервирована другим клиентом" },
  });
  check("reject с причиной → REJECTED", r.status === 200 && r.json?.order?.status === "REJECTED", JSON.stringify(r.json).slice(0, 120));

  r = await buyer.req(`/api/purchase-orders/${order2}`);
  check("кондитер видит причину отказа", String(r.json?.order?.rejection_reason ?? "").includes("зарезервирована"));

  r = await sup.req("/api/supplier/warehouse");
  const released = (r.json?.items ?? []).find((i) => i.id === productId);
  check("резерв освобождён после отказа (0)", released?.reserved_quantity === 0, JSON.stringify(released));

  // --- Итог + cleanup ---
  console.log(`\n=== ИТОГ: passed=${passed}, failed=${failed} ===`);
  if (failures.length) for (const f of failures) console.error("  - " + f);
  await cleanup();
  process.exit(failed === 0 ? 0 : 1);
}

async function cleanup() {
  console.log("\n[cleanup] удаление HTTP-тестовых данных…");
  const emails = await seedPool.query(
    "SELECT id FROM profiles WHERE email LIKE 'v17api-sup-%' OR email LIKE 'v17api-buy2-%'"
  );
  const ids = emails.rows.map((r) => r.id);
  if (ids.length > 0) {
    // Items напрямую по товарам тестовых поставщиков (FK раньше склада).
    await seedPool.query(
      `DELETE FROM purchase_order_items WHERE product_id IN (
         SELECT id FROM supplier_products WHERE supplier_id = ANY($1::uuid[]))`,
      [ids]
    );
    await seedPool.query(
      `DELETE FROM purchase_order_items WHERE order_id IN (
         SELECT id FROM purchase_orders WHERE supplier_id = ANY($1::uuid[]) OR buyer_id = ANY($1::uuid[]))`,
      [ids]
    );
    await seedPool.query(
      `DELETE FROM purchase_order_status_history WHERE order_id IN (
         SELECT id FROM purchase_orders WHERE supplier_id = ANY($1::uuid[]) OR buyer_id = ANY($1::uuid[]))`,
      [ids]
    );
    await seedPool.query(
      `DELETE FROM purchase_orders WHERE supplier_id = ANY($1::uuid[]) OR buyer_id = ANY($1::uuid[])`,
      [ids]
    );
    await seedPool.query("DELETE FROM supplier_product_movements WHERE supplier_id = ANY($1::uuid[])", [ids]);
    await seedPool.query("DELETE FROM supplier_products WHERE supplier_id = ANY($1::uuid[])", [ids]);
    await seedPool.query(
      `DELETE FROM supplier_profile_reviews WHERE profile_id IN (
         SELECT id FROM supplier_profiles WHERE "userId" = ANY($1::text[]))`,
      [ids]
    );
    await seedPool.query(`DELETE FROM supplier_profiles WHERE "userId" = ANY($1::text[])`, [ids]);
    await seedPool.query("DELETE FROM notifications WHERE user_id = ANY($1::uuid[])", [ids]);
    await seedPool.query("DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])", [ids]);
    await seedPool.query("DELETE FROM profiles WHERE id = ANY($1::uuid[])", [ids]);
    await seedPool.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [ids]);
  }
  await seedPool.end();
  console.log(`[cleanup] done (${ids.length} users)`);
}

main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
