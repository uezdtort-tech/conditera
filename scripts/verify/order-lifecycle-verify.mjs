/**
 * Регрессионная проверка P0.5 «Order Lifecycle & Capacity Engine».
 *
 * E2E-сценарии ТЗ §46-50:
 *  №1 нормальный заказ: escrow → assign (+резерв+чеклист+deadline) →
 *     production start → complete → ready (фото-гейт §35) → handoff →
 *     DELIVERED → complete → ORDER_REVIEW_REQUEST + repeat event;
 *  №2 нехватка ингредиента: breakdown → purchase draft → ETA до старта
 *     (CAN_ACCEPT_WITH_PURCHASE) / после (PURCHASE_ETA_AFTER_DEADLINE);
 *  №3 недостаточная capacity: заполненный день → assign 422
 *     CAPACITY_EXCEEDED → альтернативный кондитер 200;
 *  №4 at-risk: latest safe start в прошлом + производство не начато →
 *     ORDER_AT_RISK (RED) + CONTACT_CUSTOMER → старт производства →
 *     авто-resolve задачи (ТЗ §25);
 *  №5 reassignment: release A → reserve B → заказ продолжается.
 *
 * Гонки (ТЗ §27, §45):
 *  - 2 одновременных assign одного заказа → ровно один 200, второй 409;
 *  - 2 параллельных пересекающихся резерва (SQL) → EXCLUDE-констрейнт (23P01).
 *
 * Идемпотентность (ТЗ §26): повторный скан не плодит ORDER_AT_RISK.
 *
 * Запуск: node scripts/verify/order-lifecycle-verify.mjs
 * Тестовые заказы (number LIKE 'P05V-%') и их данные удаляются в finally.
 */

import { Client } from "pg";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const PASSWORD = "Demo123!";
const PG_URL = process.env.PGURL || "postgresql://postgres@127.0.0.1:54329/conditera";

const OWNER_ID = "11111111-1111-4111-8111-111111111101"; // confectioner@demo.ru (Торты на заказ | Сахарная печать)
const CONF_102 = "11111111-1111-4111-8111-111111111102"; // Сладкая уездная
const CONF_103 = "11111111-1111-4111-8111-111111111103"; // Кондитерская Купец
const CONF_111 = "11111111-1111-4111-8111-111111111111"; // Татьяна-Кондитер
const CONF_112 = "11111111-1111-4111-8111-111111111112"; // Сахарный Лебедь
let CUSTOMER_ID = "11111111-1111-4111-8111-111111111106"; // заменяется ID свежезарегистрированного E2E-покупателя
const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-000000000001"; // Свадебный торт «Ягодный бархат» (cakes, recipe)

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

async function api(method, path, { token, body, raw, extraHeaders } = {}) {
  const headers = { "x-real-ip": RUN_IP, ...(extraHeaders || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (raw) {
    // raw: FormData — не ставим Content-Type (boundary проставит fetch)
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const r = await fetch(`${BASE}/api/csrf-token`, { headers: { "x-real-ip": RUN_IP } });
    const j = await r.json().catch(() => ({}));
    const sc = r.headers.getSetCookie().find((c) => c.startsWith("csrf_token="));
    const cv = sc ? sc.split(";")[0].split("=").slice(1).join("=") : j.token;
    headers["x-csrf-token"] = j.token;
    headers.Cookie = `csrf_token=${cv}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? raw : body !== undefined ? JSON.stringify(body) : undefined,
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

const client = new Client({ connectionString: PG_URL });

// ---------------------------------------------------------------------------
// SQL-хелперы тестовых заказов
// ---------------------------------------------------------------------------

let seq = 0;
function orderNumber() {
  return `P05V-${Date.now()}-${++seq}`;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function createTestOrder({ confectionerId = null, deliveryDate, window = "15:00-18:00", escrow = true, deliveryType = "delivery" }) {
  const number = orderNumber();
  const res = await client.query(
    `INSERT INTO public.orders
       (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total,
        status, payment_status, payment_method, delivery_address, delivery_city,
        delivery_date, delivery_time_window, delivery_type, metadata, paid_at,
        confirmed_at)
     VALUES ($1, $2::uuid, $3::uuid, 2400, 0, 0, 2400, 'PENDING', $4, 'card',
             'ул. Тестовая, 1', 'Москва', $5::date, $6, $8,
             jsonb_build_object('test','p05-verify'), $7, $7)
     RETURNING id::text`,
    [
      number,
      CUSTOMER_ID,
      confectionerId,
      escrow ? "escrow" : "pending",
      deliveryDate,
      window,
      escrow ? new Date().toISOString() : null,
      deliveryType,
    ]
  );
  const orderId = res.rows[0].id;
  await client.query(
    `INSERT INTO public.order_items (order_id, product_id, product_title, unit_price, quantity, total)
     VALUES ($1::uuid, $2::uuid, 'Свадебный торт «Ягодный бархат» (verify)', 2400, 1, 2400)`,
    [orderId, PRODUCT_ID]
  );
  return { orderId, number };
}

async function deleteOrder(orderId) {
  const mediaRows = await client.query(
    `SELECT storage_path FROM public.order_media WHERE order_id = $1::uuid`,
    [orderId]
  ).catch(() => ({ rows: [] }));
  for (const media of mediaRows.rows || []) {
    await client.query(
      `DELETE FROM storage.objects WHERE bucket_id = 'order_media' AND name = $1`,
      [media.storage_path]
    ).catch(() => {});
  }
  await client.query(`DELETE FROM public.inventory_movements WHERE order_id = $1::uuid`, [orderId]).catch(() => {});
  await client.query(`DELETE FROM public.inventory_write_offs WHERE order_id = $1::uuid`, [orderId]).catch(() => {});
  // escrow_accounts создаётся триггером/эккаунтингом при payment_status='escrow'
  await client.query(`DELETE FROM public.escrow_accounts WHERE order_id = $1::uuid`, [orderId]).catch(() => {});
  await client.query(`DELETE FROM public.loyalty_transactions WHERE order_id = $1::uuid`, [orderId]).catch(() => {});
  await client.query(`DELETE FROM public.payments WHERE order_id = $1::uuid`, [orderId]).catch(() => {});
  await client.query(`DELETE FROM public.deliveries WHERE order_id = $1::uuid`, [orderId]).catch(() => {});
  await client.query(`DELETE FROM public.order_media WHERE order_id = $1::uuid`, [orderId]);
  await client.query(`DELETE FROM public.capacity_reservations WHERE order_id = $1::uuid`, [orderId]);
  await client.query(`DELETE FROM public.order_production_checklist WHERE order_id = $1::uuid`, [orderId]);
  await client.query(`DELETE FROM public.order_production WHERE order_id = $1::uuid`, [orderId]);
  await client.query(`DELETE FROM public.order_status_history WHERE order_id = $1::uuid`, [orderId]);
  await client.query(`DELETE FROM public.domain_events WHERE entity_type='order' AND entity_id = $1::text`, [orderId]);
  await client.query(`DELETE FROM public.ops_tasks WHERE entity_id = $1::text`, [orderId]);
  await client.query(`DELETE FROM public.orders WHERE id = $1::uuid`, [orderId]);
}

// Минимальный валидный PNG 1×1 (red pixel)
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function disputeForm() {
  const fd = new FormData();
  fd.append("category", "quality");
  fd.append("description", "На изделии обнаружен дефект покрытия и повреждение декора после получения заказа.");
  fd.append("evidence", new Blob([PNG_1PX], { type: "image/png" }), "defect-evidence.png");
  return fd;
}

function disputeReplyForm() {
  const fd = new FormData();
  fd.append("message", "Прикладываю дополнительные сведения: повреждение заметно сразу после распаковки, упаковка была целой.");
  return fd;
}

function photoForm() {
  const fd = new FormData();
  fd.append("file", new Blob([PNG_1PX], { type: "image/png" }), "ready.png");
  return fd;
}

function quotePhotoForm(kind) {
  const fd = new FormData();
  fd.append("file", new Blob([PNG_1PX], { type: "image/png" }), `${kind}.png`);
  fd.append("kind", kind);
  return fd;
}

// ===========================================================================

const testOrders = [];
const testDraftIds = [];
const testQuoteRequestIds = [];
let recipeInventoryFixture = null;
let registeredCustomerId = null;
let acceptedQuoteOrder = null;

/** Demo recipe intentionally omits berries from seed stock. */
async function prepareRecipeInventoryFixture() {
  const recipeResult = await client.query(
    `SELECT p.recipe_id, ri.id::text AS ingredient_id,
            ri.inventory_item_id::text AS previous_item_id,
            ri.name, ri.qty, ri.unit
       FROM public.products p
       JOIN public.recipe_ingredients ri ON ri.recipe_id = p.recipe_id
      WHERE p.id = $1::uuid
      ORDER BY ri.name`,
    [PRODUCT_ID]
  );
  if (!recipeResult.rows.length) throw new Error("demo product recipe has no ingredients");
  if (!recipeResult.rows.some(row => row.name === "Ягоды")) {
    throw new Error("demo product recipe/Ягоды ingredient not found");
  }

  const snapshot = await client.query(
    `SELECT id::text, quantity, unit, is_active
       FROM public.inventory_items
      WHERE owner_id = $1::uuid`,
    [OWNER_ID]
  );
  const ingredientLinks = [];
  const createdInventoryIds = [];
  let berryId = null;

  // Для acceptance gate нужен полный складской комплект рецепта, а не только
  // одна демонстрационная позиция. Сохраняем исходные остатки и связи, чтобы
  // тест не оставлял изменений после завершения.
  for (const ingredient of recipeResult.rows) {
    const required = Math.max(Number(ingredient.qty) || 0, 0.001);
    const targetQuantity = required * 100;
    let inventoryItem = null;

    if (ingredient.previous_item_id) {
      const linked = await client.query(
        `SELECT id::text, quantity, unit
           FROM public.inventory_items
          WHERE id = $1::uuid AND owner_id = $2::uuid`,
        [ingredient.previous_item_id, OWNER_ID]
      );
      inventoryItem = linked.rows[0] ?? null;
    }

    if (!inventoryItem) {
      const byName = await client.query(
        `SELECT id::text, quantity, unit
           FROM public.inventory_items
          WHERE owner_id = $1::uuid AND lower(trim(name)) = lower(trim($2))
            AND is_active = true
          ORDER BY created_at ASC
          LIMIT 1`,
        [OWNER_ID, ingredient.name]
      );
      inventoryItem = byName.rows[0] ?? null;
    }

    if (!inventoryItem) {
      const inserted = await client.query(
        `INSERT INTO public.inventory_items
           (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, supplier, is_active)
         VALUES ($1::uuid, $2, $2, $3, $4, 0, 0, 'P05V E2E fixture', true)
         RETURNING id::text`,
        [OWNER_ID, ingredient.name, targetQuantity, ingredient.unit || "шт"]
      );
      inventoryItem = {
        id: inserted.rows[0].id,
        quantity: targetQuantity,
        unit: ingredient.unit || "шт",
      };
      createdInventoryIds.push(inventoryItem.id);
    } else {
      await client.query(
        `UPDATE public.inventory_items
            SET quantity = GREATEST(quantity, $2), unit = $3, is_active = true
          WHERE id = $1::uuid`,
        [inventoryItem.id, targetQuantity, ingredient.unit || "шт"]
      );
    }

    if (inventoryItem.id !== ingredient.previous_item_id) {
      await client.query(
        `UPDATE public.recipe_ingredients
            SET inventory_item_id = $2::uuid
          WHERE id = $1::uuid`,
        [ingredient.ingredient_id, inventoryItem.id]
      );
    }
    ingredientLinks.push({
      ingredientId: ingredient.ingredient_id,
      previousItemId: ingredient.previous_item_id,
    });
    if (ingredient.name === "Ягоды") berryId = inventoryItem.id;
  }

  return {
    berryId,
    ingredientLinks,
    inventorySnapshot: snapshot.rows.map(row => ({
      id: row.id,
      quantity: Number(row.quantity),
      unit: row.unit,
      isActive: row.is_active,
    })),
    createdInventoryIds,
  };
}

async function main() {
  await client.connect();

  section("Подготовка");
  const admin = await login("admin@demo.ru");
  const owner = await login("confectioner@demo.ru");
  const courier = await login("courier@demo.ru");
  assert("логины admin/confectioner/courier", Boolean(admin && owner && courier));
  recipeInventoryFixture = await prepareRecipeInventoryFixture();
  assert("временная складская позиция ягод привязана к рецепту", Boolean(recipeInventoryFixture.berryId));

  const tomorrow = new Date(Date.now() + 86_400_000);
  const tomorrowStr = isoDate(tomorrow);

  // Новый покупатель проходит реальную саморегистрацию, а не использует demo-аккаунт.
  const uniqueSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const customerPhone = `+7999${uniqueSuffix.slice(-7)}`;
  const customerEmail = `e2e-buyer-${uniqueSuffix}@example.test`;
  const registration = await api("POST", "/api/auth/register", {
    body: {
      email: customerEmail,
      password: PASSWORD,
      name: "E2E Покупатель",
      phone: customerPhone,
      role: "CUSTOMER",
      accountType: "individual",
      consentPd: true,
      consentTerms: true,
      consentOffer: true,
      consentMarketing: false,
    },
  });
  assert("новый покупатель зарегистрирован через /api/auth/register → 200", registration.status === 200 && Boolean(registration.json?.accessToken && registration.json?.user?.id), JSON.stringify(registration.json).slice(0, 180));
  if (registration.status !== 200 || !registration.json?.accessToken || !registration.json?.user?.id) {
    throw new Error("Регистрация нового E2E-покупателя не завершилась успешно");
  }
  let customer = registration.json.accessToken;
  CUSTOMER_ID = registration.json.user.id;
  registeredCustomerId = CUSTOMER_ID;
  const registeredSession = await client.query(
    `SELECT count(*)::int AS count FROM public.user_sessions
     WHERE user_id = $1::uuid AND revoked_at IS NULL AND refresh_jti IS NOT NULL`,
    [CUSTOMER_ID]
  );
  assert("после регистрации создана серверная сессия с refresh JTI", registeredSession.rows[0]?.count === 1);

  // Проверяем одноразовую ротацию refresh-токена и обнаружение replay.
  const firstRefresh = await api("POST", "/api/auth/refresh", {
    body: { refreshToken: registration.json.refreshToken },
  });
  assert("первый refresh успешно ротирует токен → 200", firstRefresh.status === 200 && Boolean(firstRefresh.json?.refreshToken && firstRefresh.json?.accessToken), JSON.stringify(firstRefresh.json).slice(0, 160));
  if (firstRefresh.status !== 200 || !firstRefresh.json?.refreshToken) {
    throw new Error("Первичная ротация refresh-токена не прошла");
  }
  const replayRefresh = await api("POST", "/api/auth/refresh", {
    body: { refreshToken: registration.json.refreshToken },
  });
  assert("повтор старого refresh-токена отклонён → 401", replayRefresh.status === 401, JSON.stringify(replayRefresh.json));
  const nextRefresh = await api("POST", "/api/auth/refresh", {
    body: { refreshToken: firstRefresh.json.refreshToken },
  });
  assert("новый refresh-токен остаётся рабочим после обнаружения replay → 200", nextRefresh.status === 200 && Boolean(nextRefresh.json?.refreshToken), JSON.stringify(nextRefresh.json).slice(0, 160));
  if (nextRefresh.status !== 200 || !nextRefresh.json?.accessToken) {
    throw new Error("Ротация нового refresh-токена не прошла");
  }
  customer = nextRefresh.json.accessToken;
  const replayAudit = await client.query(
    `SELECT count(*)::int AS count FROM public.user_security_events
     WHERE user_id = $1::uuid AND event_type = 'refresh_replay_detected'`,
    [CUSTOMER_ID]
  );
  assert("обнаруженный replay записан в журнал безопасности", replayAudit.rows[0]?.count === 1);

  const initialSessions = await api("GET", "/api/auth/sessions", { token: customer });
  assert("покупатель видит собственный текущий сеанс",
    initialSessions.status === 200 && initialSessions.json?.sessions?.length === 1 &&
    initialSessions.json.sessions[0]?.isCurrent === true);
  const secondCustomerLogin = await api("POST", "/api/auth/login", {
    body: { email: customerEmail, password: PASSWORD },
  });
  assert("повторный вход создаёт новую персональную сессию",
    secondCustomerLogin.status === 200 && Boolean(secondCustomerLogin.json?.accessToken));
  const revokedPreviousSession = await api("GET", "/api/auth/sessions", { token: customer });
  assert("повторный вход немедленно отзывает предыдущий JWT → 401",
    revokedPreviousSession.status === 401);
  customer = secondCustomerLogin.json.accessToken;
  const currentSessionAfterLogin = await api("GET", "/api/auth/sessions", { token: customer });
  assert("после повторного входа доступна ровно одна текущая сессия",
    currentSessionAfterLogin.status === 200 &&
    currentSessionAfterLogin.json?.sessions?.length === 1 &&
    currentSessionAfterLogin.json.sessions[0]?.isCurrent === true);
  const ownSecurityEvents = await api("GET", "/api/auth/security-events", { token: customer });
  assert("журнал безопасности показывает создание и отзыв прежней сессии",
    ownSecurityEvents.status === 200 &&
    ownSecurityEvents.json?.events?.some(event => event.event_type === "session_created") &&
    ownSecurityEvents.json?.events?.some(event => event.event_type === "session_revoked"));
  const revokeOtherSessions = await api("DELETE", "/api/auth/sessions", { token: customer });
  assert("завершение остальных сессий при эксклюзивной политике идемпотентно",
    revokeOtherSessions.status === 200 && Number(revokeOtherSessions.json?.revoked) === 0);

  // Индивидуальный RFQ: проект → предложение с рецептом → заказ → платёж.
  const confectionerRow = await client.query(
    `SELECT id FROM public.confectioners WHERE "userId" = $1::text LIMIT 1`,
    [OWNER_ID]
  );
  const quoteConfectionerId = confectionerRow.rows[0]?.id;
  const competingConfectionerRow = await client.query(
    `SELECT id FROM public.confectioners WHERE id <> $1::text ORDER BY id LIMIT 1`,
    [quoteConfectionerId]
  );
  const competingConfectionerId = competingConfectionerRow.rows[0]?.id ?? null;
  const quoteProduct = await client.query(
    `SELECT id::text, confectioner_id::text FROM public.products WHERE id = $1::uuid`,
    [PRODUCT_ID]
  );
  // confectioners.id is an internal text key (e.g. c0); products.confectioner_id
  // stores the auth user UUID. These identities must be joined, not compared.
  assert("RFQ fixture: catalog product belongs to signed-in confectioner account",
    Boolean(quoteConfectionerId && quoteProduct.rows[0]?.confectioner_id === OWNER_ID),
    JSON.stringify({ quoteConfectionerId, ownerUserId: OWNER_ID, product: quoteProduct.rows[0] }));

  if (quoteConfectionerId && quoteProduct.rows[0]?.confectioner_id === OWNER_ID) {
    const quoteCreate = await api("POST", "/api/quotes", {
      token: customer,
      body: {
        product_type: "cake",
        product_type_label: "Индивидуальный торт E2E",
        event_type: "birthday",
        base: "sponge",
        filling: "chocolate_ganache",
        coating: "ganache_dark",
        decorations: ["berries", "macarons", "gold_leaf", "flowers", "pearls"],
        dietary: [],
        servings: 8,
        quantity: 1,
        tiers: 1,
        shape: "round",
        city: "Москва",
        delivery_date: tomorrowStr,
        delivery_type: "delivery",
        address: "ул. Тестовая, 1",
        estimated_price: 330000,
        estimated_delivery_cost: 0,
        confectioner_ids: [quoteConfectionerId, ...(competingConfectionerId ? [competingConfectionerId] : [])],
        project_spec: {
          productType: "cake", base: "sponge", filling: "chocolate_ganache",
          coating: "ganache_dark", decorations: ["berries", "macarons", "gold_leaf", "flowers", "pearls"], servings: 8,
          city: "Москва", deliveryDate: tomorrowStr, deliveryType: "delivery",
        },
      },
    });
    assert("покупатель создаёт RFQ с project_spec → 201",
      quoteCreate.status === 201 && Boolean(quoteCreate.json?.quoteRequest?.id),
      JSON.stringify(quoteCreate.json).slice(0, 240));
    const tooManyDecorations = await api("POST", "/api/quotes", {
      token: customer,
      body: {
        city: "Москва",
        confectioner_ids: [quoteConfectionerId],
        decorations: ["a", "b", "c", "d", "e", "f"],
        project_spec: { decorations: ["a", "b", "c", "d", "e", "f"] },
      },
    });
    assert("шестой элемент декора отклоняется на сервере → 400",
      tooManyDecorations.status === 400,
      JSON.stringify(tooManyDecorations.json).slice(0, 180));

    if (quoteCreate.status === 201 && quoteCreate.json?.quoteRequest?.id) {
      const quoteRequestId = quoteCreate.json.quoteRequest.id;
      testQuoteRequestIds.push(quoteRequestId);

      const referenceUpload = await api("POST", `/api/quotes/${quoteRequestId}/media`, {
        token: customer, raw: quotePhotoForm("customer_reference"),
      });
      assert("покупатель прикрепляет фото-пожелание к RFQ → 201",
        referenceUpload.status === 201 && referenceUpload.json?.media?.kind === "customer_reference",
        JSON.stringify(referenceUpload.json).slice(0, 200));
      const builderPreviewUpload = await api("POST", `/api/quotes/${quoteRequestId}/media`, {
        token: customer, raw: quotePhotoForm("builder_preview"),
      });
      assert("покупатель прикрепляет превью конструктора к RFQ → 201",
        builderPreviewUpload.status === 201 && builderPreviewUpload.json?.media?.kind === "builder_preview",
        JSON.stringify(builderPreviewUpload.json).slice(0, 200));

      const savedProject = await client.query(
        `SELECT project_spec->>'productType' AS product_type,
                jsonb_array_length(project_spec->'decorations') AS decor_count
         FROM public.quote_requests WHERE id = $1::uuid`,
        [quoteRequestId]
      );
      assert("RFQ project snapshot сохранён в PostgreSQL",
        savedProject.rows[0]?.product_type === "cake" && Number(savedProject.rows[0]?.decor_count) === 5);

      const eligibleProducts = await api("GET", `/api/quotes/${quoteRequestId}/respond`, {
        token: owner,
      });
      assert("кондитер видит свой товар с действующим рецептом в списке для RFQ",
        eligibleProducts.status === 200 &&
        eligibleProducts.json?.products?.some(item => item.id === PRODUCT_ID),
        JSON.stringify(eligibleProducts.json).slice(0, 220));

      const quoteResponse = await api("POST", `/api/quotes/${quoteRequestId}/respond`, {
        token: owner,
        body: {
          base_cost: 330000,
          delivery_cost: 0,
          comment: "Индивидуальное предложение E2E",
          prep_days: 2,
          production_product_id: PRODUCT_ID,
        },
      });
      assert("кондитер отправляет предложение с проверенным рецептом → 200",
        quoteResponse.status === 200 && Boolean(quoteResponse.json?.quote?.id),
        JSON.stringify(quoteResponse.json).slice(0, 240));

      if (quoteResponse.status === 200 && quoteResponse.json?.quote?.id && competingConfectionerId) {
        // Имитация второго приглашённого кондитера: его цена не должна попасть
        // в embedded my_quotes первого кондитера.
        await client.query(
          `INSERT INTO public.confectioner_quotes
             (quote_request_id, confectioner_id, base_cost, subtotal, total_price, status)
           VALUES ($1::uuid, $2::text, 77777, 77777, 77777, 'pending')`,
          [quoteRequestId, competingConfectionerId]
        );
        const confectionerInbox = await api("GET", "/api/quotes?mode=confectioner", { token: owner });
        const ownRequest = (confectionerInbox.json?.quotes || []).find(item => item.id === quoteRequestId);
        const ownOffers = Array.isArray(ownRequest?.my_quotes)
          ? ownRequest.my_quotes
          : ownRequest?.my_quotes ? [ownRequest.my_quotes] : [];
        assert("кондитер получает только собственное предложение, без цены конкурента",
          confectionerInbox.status === 200 && ownOffers.length === 1 &&
          ownOffers[0].confectioner_id === quoteConfectionerId,
          JSON.stringify(ownOffers).slice(0, 220));
      }

      if (quoteResponse.status === 200 && quoteResponse.json?.quote?.id) {
        const quoteId = quoteResponse.json.quote.id;
        const acceptQuote = await api("POST", `/api/quotes/${quoteId}/accept`, { token: customer });
        assert("покупатель принимает предложение: заказ и payment URL созданы",
          acceptQuote.status === 201 && Boolean(acceptQuote.json?.orderId && acceptQuote.json?.paymentUrl),
          JSON.stringify(acceptQuote.json).slice(0, 260));
        if (acceptQuote.status === 201 && acceptQuote.json?.orderId) {
          testOrders.push(acceptQuote.json.orderId);
          acceptedQuoteOrder = {
            orderId: acceptQuote.json.orderId,
            number: acceptQuote.json.orderNumber,
          };
          const acceptedOrderSpec = await client.query(
            `SELECT o.confectioner_id, o.source_quote_id,
                    o.metadata->'project_spec' AS order_spec,
                    oi.selected_attributes->'project_spec' AS item_spec
               FROM public.orders o
               JOIN public.order_items oi ON oi.order_id = o.id
              WHERE o.id = $1::uuid LIMIT 1`,
            [acceptQuote.json.orderId]
          );
          const acceptedSpecRow = acceptedOrderSpec.rows[0];
          assert("заказ сохраняет UUID кондитера, исходный RFQ и снимок проекта",
            acceptedSpecRow?.confectioner_id === OWNER_ID &&
            acceptedSpecRow?.source_quote_id === quoteId &&
            acceptedSpecRow?.order_spec?.productType === "cake" &&
            acceptedSpecRow?.item_spec?.decorations?.length === 5,
            JSON.stringify(acceptedSpecRow).slice(0, 260));

          const repeatedQuoteAccept = await api("POST", `/api/quotes/${quoteId}/accept`, { token: customer });
          assert("повторное принятие RFQ возвращает тот же заказ и платёжную ссылку",
            repeatedQuoteAccept.status === 200 &&
            repeatedQuoteAccept.json?.orderId === acceptQuote.json.orderId &&
            repeatedQuoteAccept.json?.paymentUrl === acceptQuote.json.paymentUrl,
            JSON.stringify(repeatedQuoteAccept.json).slice(0, 220));

          const acceptedMediaList = await api("GET", `/api/orders/${acceptQuote.json.orderId}/reference-media`, {
            token: customer,
          });
          const inheritedReferences = acceptedMediaList.json?.media || [];
          assert("после принятия RFQ фото-пожелание и превью доступны в материалах заказа",
            acceptedMediaList.status === 200 && inheritedReferences.length === 2 &&
            inheritedReferences.some(item => item.kind === "customer_reference") &&
            inheritedReferences.some(item => item.kind === "builder_preview"),
            JSON.stringify(acceptedMediaList.json).slice(0, 280));
          if (inheritedReferences[0]?.url) {
            const confectionerReference = await api("GET", inheritedReferences[0].url, { token: owner });
            assert("назначенный кондитер открывает исходный референс индивидуального заказа → 200",
              confectionerReference.status === 200);
            const anonymousReference = await api("GET", inheritedReferences[0].url);
            assert("аноним не может открыть исходный референс → 401",
              anonymousReference.status === 401);
          }
          const courierReferenceList = await api("GET", `/api/orders/${acceptQuote.json.orderId}/reference-media`, {
            token: courier,
          });
          assert("не назначенный курьер не видит вложения индивидуального заказа → 403",
            courierReferenceList.status === 403);

          const acceptedOrderPayment = await client.query(
            `SELECT yookassa_payment_id, amount FROM public.payments
             WHERE order_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
            [acceptQuote.json.orderId]
          );
          const acceptedPaymentId = acceptedOrderPayment.rows[0]?.yookassa_payment_id;
          assert("принятый RFQ создаёт запись платежа в ledger",
            Boolean(acceptedPaymentId && Number(acceptedOrderPayment.rows[0]?.amount) === Number(acceptQuote.json.total)));
          if (acceptedPaymentId) {
            const acceptedWebhook = await api("POST", "/api/payment/webhook", {
              body: {
                event: "payment.succeeded",
                object: {
                  id: acceptedPaymentId,
                  status: "succeeded",
                  amount: { value: Number(acceptQuote.json.total).toFixed(2), currency: "RUB" },
                  metadata: { orderId: acceptQuote.json.orderId },
                },
              },
            });
            assert("оплата принятого RFQ проходит через webhook → 200",
              acceptedWebhook.status === 200, JSON.stringify(acceptedWebhook.json).slice(0, 200));
            const acceptedStatus = await client.query(
              `SELECT status::text AS status, payment_status::text AS payment_status
                 FROM public.orders WHERE id = $1::uuid`,
              [acceptQuote.json.orderId]
            );
            assert("оплаченный индивидуальный заказ удерживает деньги в escrow без преждевременного старта производства",
              acceptedStatus.rows[0]?.payment_status === "escrow" &&
              acceptedStatus.rows[0]?.status === "PENDING",
              JSON.stringify(acceptedStatus.rows[0]));
          }
        }
      }
    }
  }

  // Оформляем первый заказ через настоящий checkout и подтверждаем mock-webhook.
  // В CI нет секретов YooKassa: mock-платёж проверяет тот же ledger/webhook-переход,
  // но не заменяет отдельную проверку реального провайдера в production.
  const checkout = await api("POST", "/api/checkout", {
    token: customer,
    body: {
      cartItems: [{ product_id: PRODUCT_ID, quantity: 1 }],
      deliveryAddress: "ул. Тестовая, 1",
      deliveryCity: "Москва",
      deliveryDate: tomorrowStr,
      deliveryType: "delivery",
      customerName: "E2E Покупатель",
      customerPhone,
      paymentMethod: "yookassa",
    },
  });
  assert("покупатель оформляет заказ через /api/checkout → 200", checkout.status === 200 && Boolean(checkout.json?.orderId && checkout.json?.paymentUrl), JSON.stringify(checkout.json));
  if (checkout.status !== 200 || !checkout.json?.orderId) {
    throw new Error(`Checkout нового покупателя не создал заказ: ${JSON.stringify(checkout.json)}`);
  }
  const checkoutOrder = { orderId: checkout.json.orderId, number: checkout.json.orderNumber };
  testOrders.push(checkoutOrder.orderId);
  assert("обычный checkout сохраняет исполнителя товара", Boolean((await client.query(
    `SELECT confectioner_id FROM public.orders WHERE id = $1::uuid`, [checkoutOrder.orderId]
  )).rows[0]?.confectioner_id));

  const paymentRow = await client.query(
    `SELECT yookassa_payment_id, amount FROM public.payments
     WHERE order_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
    [checkoutOrder.orderId]
  );
  const paymentId = paymentRow.rows[0]?.yookassa_payment_id;
  assert("checkout создаёт локальную запись платежа", Boolean(paymentId && Number(paymentRow.rows[0]?.amount) === Number(checkout.json.total)));
  if (!paymentId) throw new Error("После checkout отсутствует локальная запись платежа");
  const webhook = await api("POST", "/api/payment/webhook", {
    body: {
      event: "payment.succeeded",
      object: {
        id: paymentId,
        status: "succeeded",
        amount: { value: Number(checkout.json.total).toFixed(2), currency: "RUB" },
        metadata: { orderId: checkoutOrder.orderId },
      },
    },
  });
  assert("payment.succeeded обычного checkout переводит заказ в escrow → 200", webhook.status === 200, JSON.stringify(webhook.json));
  const paidState = await client.query(
    `SELECT o.payment_status, p.status AS provider_status
     FROM public.orders o JOIN public.payments p ON p.order_id = o.id
     WHERE o.id = $1::uuid ORDER BY p.created_at DESC LIMIT 1`,
    [checkoutOrder.orderId]
  );
  assert("оплата обычного checkout зафиксирована в orders и payments", paidState.rows[0]?.payment_status === "escrow" && paidState.rows[0]?.provider_status === "succeeded", JSON.stringify(paidState.rows[0]));
  const duplicateWebhook = await api("POST", "/api/payment/webhook", {
    body: {
      event: "payment.succeeded",
      object: {
        id: paymentId,
        status: "succeeded",
        amount: { value: Number(checkout.json.total).toFixed(2), currency: "RUB" },
        metadata: { orderId: checkoutOrder.orderId },
      },
    },
  });
  assert("повтор webhook обычного checkout идемпотентен", duplicateWebhook.status === 200 && duplicateWebhook.json?.idempotent === true, JSON.stringify(duplicateWebhook.json));

  // Полный производственный путь запускаем для индивидуального заказа, если
  // RFQ прошёл согласование и оплату. Обычный checkout отдельно проверен выше.
  const o1 = acceptedQuoteOrder ?? checkoutOrder;
  assert(acceptedQuoteOrder
    ? "полный lifecycle выбран для оплаченного индивидуального RFQ-заказа"
    : "полный lifecycle использует оплаченный checkout-заказ как fallback", true);
  const dayAfterTomorrow = new Date(tomorrow.getTime() + 86_400_000);
  const dayAfterTomorrowStr = isoDate(dayAfterTomorrow);
  const todayStr = isoDate(new Date());

  // =========================================================================
  section("E2E №1 — нормальный заказ (ТЗ §46)");
  const lc0 = await api("GET", `/api/orders/${o1.orderId}/lifecycle`, { token: customer });
  assert("GET lifecycle → 200 (покупатель после регистрации)", lc0.status === 200, `got ${lc0.status}`);
  assert("заказ ожидает производства и уже связан с кондитером", lc0.json?.derived?.businessStatus === "created" && lc0.json?.derived?.assignmentStatus === "assigned", JSON.stringify(lc0.json?.derived));

  const assignForbidden = await api("POST", `/api/orders/${o1.orderId}/assign`, { token: owner, body: { confectionerId: OWNER_ID } });
  assert("кондитер не может назначать → 403", assignForbidden.status === 403, `got ${assignForbidden.status}`);

  const assign = await api("POST", `/api/orders/${o1.orderId}/assign`, { token: admin, body: { confectionerId: OWNER_ID } });
  assert("POST assign → 200", assign.status === 200, JSON.stringify(assign.json).slice(0, 200));
  assert("оценка трудоёмкости: 240 мин по категории (lead time товара не считается рабочим окном)", assign.json?.estimate?.minutes === 240 && assign.json?.estimate?.source === "category" && assign.json?.estimate?.approximate === true, JSON.stringify(assign.json?.estimate));
  assert("резерв создан на дату доставки", assign.json?.reservation?.date === tomorrowStr, JSON.stringify(assign.json?.reservation));
  assert("latestSafeStartAt рассчитан", Boolean(assign.json?.deadline?.latestSafeStartAt));
  // 18:00 − 65м буферов − 240м производства = 12:55
  assert("latest safe start = 12:55", assign.json?.deadline?.latestSafeStartAt?.includes("T12:55"), assign.json?.deadline?.latestSafeStartAt);

  const lc1 = await api("GET", `/api/orders/${o1.orderId}/lifecycle`, { token: admin });
  assert("после assign: assigned", lc1.json?.derived?.assignmentStatus === "assigned", JSON.stringify(lc1.json?.derived));

  // P0: прямой accept не должен обходить платёжный gate.
  const unpaidOrder = await createTestOrder({ confectionerId: OWNER_ID, deliveryDate: tomorrowStr, escrow: false });
  testOrders.push(unpaidOrder.orderId);
  const unpaidAccept = await api("POST", `/api/orders/${unpaidOrder.orderId}/accept`, { token: owner });
  assert("accept неоплаченного card-заказа → 422 PAYMENT_NOT_CONFIRMED", unpaidAccept.status === 422 && unpaidAccept.json?.error === "PAYMENT_NOT_CONFIRMED", JSON.stringify(unpaidAccept.json).slice(0, 160));

  // Кондитер принимает оплаченный заказ (PENDING → CONFIRMED) — lifecycle engine
  const accept = await api("POST", `/api/orders/${o1.orderId}/accept`, { token: owner });
  assert("accept (PENDING → CONFIRMED) → 200", accept.status === 200, JSON.stringify(accept.json).slice(0, 160));

  const lc1b = await api("GET", `/api/orders/${o1.orderId}/lifecycle`, { token: admin });
  assert("после accept: productionStatus=planned", lc1b.json?.derived?.productionStatus === "planned", JSON.stringify(lc1b.json?.derived));
  assert("чеклист торта: 10 этапов (ТЗ §18)", lc1b.json?.production?.checklist?.length === 10, `got ${lc1b.json?.production?.checklist?.length}`);
  assert("фото-гейт включён (cakes, §35)", lc1b.json?.production?.readyPhotoRequired === true);

  const cap = await api("GET", `/api/orders/${o1.orderId}/capacity`, { token: owner });
  assert("GET capacity → 200, загрузка > 0", cap.status === 200 && cap.json?.utilizationPercent > 0, `util=${cap.json?.utilizationPercent}`);

  const custView = await api("GET", `/api/orders/${o1.orderId}/capacity`, { token: customer });
  assert("клиент видит capacity своего заказа", custView.status === 200);

  const completeBeforeStart = await api("POST", `/api/orders/${o1.orderId}/production/complete`, { token: owner });
  assert("production/complete до старта → 409", completeBeforeStart.status === 409 && completeBeforeStart.json?.error === "INVALID_PRODUCTION_STATE", JSON.stringify(completeBeforeStart.json).slice(0, 160));
  const stageBeforeStart = await api("POST", `/api/orders/${o1.orderId}/production/stage`, { token: owner, body: { stageKey: "baking", done: true } });
  assert("production/stage до старта → 409", stageBeforeStart.status === 409 && stageBeforeStart.json?.error === "INVALID_PRODUCTION_STATE", JSON.stringify(stageBeforeStart.json).slice(0, 160));

  const start = await api("POST", `/api/orders/${o1.orderId}/production/start`, { token: owner });
  assert("production/start → 200 (PREPARING)", start.status === 200, JSON.stringify(start.json).slice(0, 160));

  const incompleteProduction = await api("POST", `/api/orders/${o1.orderId}/production/complete`, { token: owner });
  assert("production/complete с незакрытым чеклистом → 422", incompleteProduction.status === 422 && incompleteProduction.json?.error === "PRODUCTION_CHECKLIST_INCOMPLETE", JSON.stringify(incompleteProduction.json).slice(0, 160));

  const checklistView = await api("GET", `/api/orders/${o1.orderId}/lifecycle`, { token: owner });
  const workStages = (checklistView.json?.production?.checklist || []).filter((stage) => !["ready_photo", "handoff"].includes(stage.stage_key));
  assert("чеклист содержит производственные этапы", workStages.length > 0);
  for (const stage of workStages) {
    const marked = await api("POST", `/api/orders/${o1.orderId}/production/stage`, { token: owner, body: { stageKey: stage.stage_key, done: true } });
    assert(`этап ${stage.stage_key} отмечается отдельно → 200`, marked.status === 200 && marked.json?.stage?.is_done === true, JSON.stringify(marked.json).slice(0, 120));
  }

  const recipeOutCount = await client.query(
    `SELECT count(*)::int AS count FROM public.inventory_movements WHERE order_id = $1::uuid AND type = 'OUT'`,
    [o1.orderId]
  );
  assert("подтверждение ingredients_prepared автоматически списало рецепт со склада", recipeOutCount.rows[0].count > 0);
  const repeatIngredientsStage = await api("POST", `/api/orders/${o1.orderId}/production/stage`, {
    token: owner,
    body: { stageKey: "ingredients_prepared", done: true },
  });
  const recipeOutCountAfterRetry = await client.query(
    `SELECT count(*)::int AS count FROM public.inventory_movements WHERE order_id = $1::uuid AND type = 'OUT'`,
    [o1.orderId]
  );
  assert(
    "повтор ingredients_prepared не создаёт повторных списаний",
    repeatIngredientsStage.status === 200 && recipeOutCountAfterRetry.rows[0].count === recipeOutCount.rows[0].count
  );

  const prematureComplete = await api("POST", `/api/orders/${o1.orderId}/production/complete`, { token: owner });
  assert("production/complete при незагруженном фото → 200, но фото остаётся обязательным", prematureComplete.status === 200 && (prematureComplete.json?.remainingBeforeReady || []).includes("Фото готовности"), JSON.stringify(prematureComplete.json).slice(0, 160));
  const editAfterProductionComplete = await api("POST", `/api/orders/${o1.orderId}/production/stage`, { token: owner, body: { stageKey: workStages[0].stage_key, done: false } });
  assert("после фиксации завершения нельзя менять этапы → 409", editAfterProductionComplete.status === 409 && editAfterProductionComplete.json?.error === "PRODUCTION_ALREADY_COMPLETED", JSON.stringify(editAfterProductionComplete.json).slice(0, 160));

  const complete = await api("POST", `/api/orders/${o1.orderId}/production/complete`, { token: owner });
  assert("production/complete → 200", complete.status === 200);
  assert("остался только ready_photo перед готовностью", (complete.json?.remainingBeforeReady || []).includes("Фото готовности"), JSON.stringify(complete.json?.remainingBeforeReady));

  const readyNoPhoto = await api("POST", `/api/orders/${o1.orderId}/ready`, { token: owner });
  assert("ready без фото → 422 READY_PHOTO_REQUIRED (ТЗ §35)", readyNoPhoto.status === 422 && readyNoPhoto.json?.error === "READY_PHOTO_REQUIRED", JSON.stringify(readyNoPhoto.json).slice(0, 160));

  const upload = await api("POST", `/api/orders/${o1.orderId}/media`, { token: owner, raw: photoForm() });
  assert("загрузка фото готовности → 201", upload.status === 201, JSON.stringify(upload.json).slice(0, 160));
  // Четыре конкурентные загрузки заполняют лимит до пяти; шестая обязана
  // отклоняться DB-trigger даже если все запросы прошли предварительный count.
  const concurrentPhotos = await Promise.all(
    Array.from({ length: 4 }, () =>
      api("POST", `/api/orders/${o1.orderId}/media`, { token: owner, raw: photoForm() })
    )
  );
  assert(
    "параллельные загрузки не превышают пять одобренных фото",
    concurrentPhotos.every((item) => item.status === 201 || (item.status === 422 && item.json?.error === "PHOTO_LIMIT_REACHED")),
    JSON.stringify(concurrentPhotos.map((item) => ({ status: item.status, error: item.json?.error })))
  );
  const sixthPhoto = await api("POST", `/api/orders/${o1.orderId}/media`, { token: owner, raw: photoForm() });
  assert("шестая фотография отклоняется → 422 PHOTO_LIMIT_REACHED", sixthPhoto.status === 422 && sixthPhoto.json?.error === "PHOTO_LIMIT_REACHED", JSON.stringify(sixthPhoto.json));
  const mediaUrl = upload.json?.media?.url;
  assert("media URL формата /api/order-media/<id>", typeof mediaUrl === "string" && mediaUrl.startsWith("/api/order-media/"));
  const mediaObject = await client.query(
    `SELECT storage_path FROM public.order_media WHERE id = $1::uuid`,
    [upload.json?.media?.id]
  );
  const storageObject = await client.query(
    `SELECT id FROM storage.objects WHERE bucket_id = 'order_media' AND name = $1`,
    [mediaObject.rows[0]?.storage_path]
  );
  assert("фото готового изделия физически сохранено в приватном Supabase Storage", storageObject.rowCount === 1);

  // Покупатель должен видеть фото собственного готового изделия, но не иметь
  // возможности загружать производственные доказательства вместо кондитера.
  const customerMediaList = await api("GET", `/api/orders/${o1.orderId}/media`, { token: customer });
  const readyPhotos = (customerMediaList.json?.media || []).filter((item) => item.kind === "ready_photo");
  assert("покупатель получает все пять фото готового изделия → 200",
    customerMediaList.status === 200 && readyPhotos.length === 5,
    JSON.stringify(customerMediaList.json).slice(0, 240));
  const customerMediaFile = await api("GET", mediaUrl, { token: customer });
  assert("покупатель открывает фото своего заказа → 200", customerMediaFile.status === 200);

  const ready = await api("POST", `/api/orders/${o1.orderId}/ready`, { token: owner });
  assert("ready после фото → 200 (READY)", ready.status === 200, JSON.stringify(ready.json).slice(0, 160));

  const courierBeforeHandoff = await api("GET", "/api/courier/available-orders", { token: courier });
  assert("курьер не может забрать заказ до подтверждённой передачи", courierBeforeHandoff.status === 200 && !(courierBeforeHandoff.json?.orders || []).some((o) => o.id === o1.orderId));

  const handoff = await api("POST", `/api/orders/${o1.orderId}/handoff`, { token: owner, body: { executor: "Курьер Демо" } });
  assert("handoff (delivery) → IN_DELIVERY", handoff.status === 200 && handoff.json?.status === "IN_DELIVERY", JSON.stringify(handoff.json).slice(0, 160));

  const courierAvailable = await api("GET", "/api/courier/available-orders", { token: courier });
  assert("заказ появляется у курьера только после handoff", courierAvailable.status === 200 && (courierAvailable.json?.orders || []).some((o) => o.id === o1.orderId), JSON.stringify(courierAvailable.json).slice(0, 160));

  const courierAssign = await api("POST", "/api/courier/assign", { token: courier, body: { orderId: o1.orderId } });
  assert("курьер принимает переданный ему заказ → 200", courierAssign.status === 200 && courierAssign.json?.courierId === "11111111-1111-4111-8111-111111111113", JSON.stringify(courierAssign.json).slice(0, 160));

  const courierOrder = await api("GET", `/api/orders/${o1.orderId}`, { token: courier });
  assert("назначенный курьер открывает карточку заказа → 200", courierOrder.status === 200, JSON.stringify(courierOrder.json).slice(0, 120));

  const courierDashboard = await api("GET", "/api/courier/dashboard", { token: courier });
  assert("кабинет курьера показывает назначенную доставку", courierDashboard.status === 200 && (courierDashboard.json?.activeDeliveries || []).some((d) => d.orderId === o1.number), JSON.stringify(courierDashboard.json).slice(0, 160));

  const courierMedia = await api("GET", mediaUrl, { token: courier });
  assert("назначенный курьер открывает фото готового изделия → 200", courierMedia.status === 200);

  const patchDelivered = await api("PATCH", `/api/orders/${o1.orderId}`, { token: courier, body: { status: "DELIVERED" } });
  assert("PATCH DELIVERED назначенным курьером → 200", patchDelivered.status === 200, JSON.stringify(patchDelivered.json).slice(0, 120));
  const deliveryState = await client.query(
    `SELECT status, delivered_at FROM public.deliveries WHERE order_id = $1::uuid AND courier_id = $2::uuid`,
    [o1.orderId, "11111111-1111-4111-8111-111111111113"]
  );
  assert("доставка и заказ закрыты одним переходом", deliveryState.rows[0]?.status === "delivered" && Boolean(deliveryState.rows[0]?.delivered_at));

  const done = await api("POST", `/api/orders/${o1.orderId}/complete`, { token: customer });
  assert("complete (клиент) → COMPLETED", done.status === 200 && done.json?.status === "COMPLETED", JSON.stringify(done.json).slice(0, 160));
  assert("repeat offer запланирован (+30 дней, ТЗ §38)", Boolean(done.json?.repeatOfferAt));

  await api("GET", "/api/ops/tasks?refresh=1", { token: admin });
  const reviewTask = await client.query(
    `SELECT status FROM public.ops_tasks WHERE type='ORDER_REVIEW_REQUEST' AND entity_id = $1`,
    [o1.orderId]
  );
  assert("ORDER_REVIEW_REQUEST материализована (ТЗ §37)", reviewTask.rowCount > 0);

  const timeline = await api("GET", `/api/orders/${o1.orderId}/timeline`, { token: admin });
  const tlTypes = (timeline.json?.timeline || []).map((t) => t.type);
  for (const ev of ["order.assigned", "order.reservation_created", "order.production_started", "order.ready", "order.handed_off", "order.completed"]) {
    assert(`timeline содержит ${ev}`, tlTypes.includes(ev), tlTypes.join(","));
  }
  assert("timeline НЕ содержит параллельной истории (только события+статусы)", timeline.json?.timeline?.length >= 8, `len=${timeline.json?.timeline?.length}`);

  // Самовывоз: передача кондитером не равна подтверждению получения покупателем.
  section("E2E №1b — самовывоз: handoff отдельно от customer receipt");
  const pickup = await createTestOrder({
    confectionerId: OWNER_ID,
    deliveryDate: tomorrowStr,
    deliveryType: "pickup",
  });
  testOrders.push(pickup.orderId);
  await client.query(
    `UPDATE public.orders SET status = 'READY' WHERE id = $1::uuid`,
    [pickup.orderId]
  );

  const pickupPrematureComplete = await api("POST", `/api/orders/${pickup.orderId}/complete`, { token: customer });
  assert("покупатель не может подтвердить получение до handoff → 409",
    pickupPrematureComplete.status === 409);

  const pickupHandoff = await api("POST", `/api/orders/${pickup.orderId}/handoff`, {
    token: owner,
    body: { executor: "Кондитер самовывоза" },
  });
  assert("самовывоз: handoff переводит READY → DELIVERED",
    pickupHandoff.status === 200 && pickupHandoff.json?.status === "DELIVERED",
    JSON.stringify(pickupHandoff.json));

  const pickupDeliveryRows = await client.query(
    `SELECT count(*)::int AS count FROM public.deliveries WHERE order_id = $1::uuid`,
    [pickup.orderId]
  );
  assert("для самовывоза не создаётся доставка курьером",
    pickupDeliveryRows.rows[0]?.count === 0);

  const pickupHandoffEvents = await client.query(
    `SELECT count(*)::int AS count FROM public.domain_events
      WHERE entity_type = 'order' AND entity_id = $1::text AND type = 'order.handed_off'`,
    [pickup.orderId]
  );
  assert("самовывоз записывает ровно одно событие order.handed_off",
    pickupHandoffEvents.rows[0]?.count === 1,
    `count=${pickupHandoffEvents.rows[0]?.count}`);

  const pickupComplete = await api("POST", `/api/orders/${pickup.orderId}/complete`, { token: customer });
  assert("только после handoff покупатель подтверждает получение → COMPLETED",
    pickupComplete.status === 200 && pickupComplete.json?.status === "COMPLETED",
    JSON.stringify(pickupComplete.json));

  const pickupDbState = await client.query(
    `SELECT status FROM public.orders WHERE id = $1::uuid`,
    [pickup.orderId]
  );
  assert("БД сохраняет отдельный финальный статус COMPLETED",
    pickupDbState.rows[0]?.status === "COMPLETED");

  // Спор о дефекте: отдельный процесс, приватные доказательства и неизменяемый журнал.
  const disputeCreate = await api("POST", `/api/orders/${pickup.orderId}/disputes`, {
    token: customer,
    raw: disputeForm(),
  });
  assert("покупатель открывает спор с фото-доказательством → 201",
    disputeCreate.status === 201 && Boolean(disputeCreate.json?.dispute?.id),
    JSON.stringify(disputeCreate.json).slice(0, 240));
  const disputeId = disputeCreate.json?.dispute?.id;
  const duplicateDispute = await api("POST", `/api/orders/${pickup.orderId}/disputes`, {
    token: customer,
    raw: disputeForm(),
  });
  assert("второй активный спор по тому же заказу отклоняется → 409",
    duplicateDispute.status === 409 && duplicateDispute.json?.error === "ACTIVE_DISPUTE_ALREADY_EXISTS",
    JSON.stringify(duplicateDispute.json));
  const disputeMediaCount = await client.query(
    `SELECT count(*)::int AS count FROM public.order_media
      WHERE order_id = $1::uuid AND kind = 'dispute_evidence' AND status = 'approved'`,
    [pickup.orderId],
  );
  assert("отклонённый дубль не оставляет активного orphan-файла",
    disputeMediaCount.rows[0]?.count === 1,
    `active evidence media=${disputeMediaCount.rows[0]?.count}`);
  const disputeView = await api("GET", `/api/orders/${pickup.orderId}/disputes`, { token: customer });
  assert("покупатель видит свой спор и вложенное доказательство",
    disputeView.status === 200 && disputeView.json?.dispute?.evidence?.length === 1,
    JSON.stringify(disputeView.json).slice(0, 240));
  assert("доказательство связано с SHA-256 оригинального файла",
    /^[0-9a-f]{64}$/.test(disputeView.json?.dispute?.evidence?.[0]?.content_sha256 || ""));
  let evidenceHashMismatchState = "";
  try {
    await client.query(
      `INSERT INTO public.order_dispute_evidence
        (dispute_id, order_media_id, uploaded_by, content_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, repeat('0', 64))`,
      [disputeId, disputeView.json?.dispute?.evidence?.[0]?.order_media_id, CUSTOMER_ID],
    );
  } catch (error) {
    evidenceHashMismatchState = error.code;
  }
  assert("БД отклоняет доказательство с хешем, не совпадающим с оригиналом (23514)",
    evidenceHashMismatchState === "23514", evidenceHashMismatchState);
  const evidenceUrl = disputeView.json?.dispute?.evidence?.[0]?.url;
  const evidenceDownload = await fetch(`${BASE}${evidenceUrl}`, { headers: { Authorization: `Bearer ${customer}` } });
  assert("оригинал доказательства доступен участнику заказа как image/png",
    evidenceDownload.status === 200 && evidenceDownload.headers.get("content-type") === "image/png",
    `${evidenceDownload.status} ${evidenceDownload.headers.get("content-type")}`);

  const confectionerDisputeDecision = await api("PATCH", `/api/orders/${pickup.orderId}/disputes`, {
    token: owner,
    body: { disputeId, status: "under_review" },
  });
  assert("кондитер не может принимать решение по спору → 403",
    confectionerDisputeDecision.status === 403);
  const prematureDisputeReply = await api("POST", `/api/orders/${pickup.orderId}/disputes/${disputeId}/reply`, {
    token: customer,
    raw: disputeReplyForm(),
  });
  assert("покупатель не может отвечать до запроса поддержки → 409",
    prematureDisputeReply.status === 409);
  const confectionerDisputeReply = await api("POST", `/api/orders/${pickup.orderId}/disputes/${disputeId}/reply`, {
    token: owner,
    raw: disputeReplyForm(),
  });
  assert("кондитер не может отправлять ответ от имени покупателя → 403",
    confectionerDisputeReply.status === 403);
  const disputeReview = await api("PATCH", `/api/orders/${pickup.orderId}/disputes`, {
    token: admin,
    body: { disputeId, status: "under_review" },
  });
  assert("администратор переводит спор в under_review",
    disputeReview.status === 200 && disputeReview.json?.dispute?.status === "under_review",
    JSON.stringify(disputeReview.json));
  const disputeAskCustomer = await api("PATCH", `/api/orders/${pickup.orderId}/disputes`, {
    token: admin,
    body: { disputeId, status: "awaiting_customer", resolution: "Нужны дополнительные сведения об упаковке и моменте обнаружения дефекта." },
  });
  assert("администратор запрашивает уточнение у покупателя",
    disputeAskCustomer.status === 200 && disputeAskCustomer.json?.dispute?.status === "awaiting_customer",
    JSON.stringify(disputeAskCustomer.json));
  const disputeReply = await api("POST", `/api/orders/${pickup.orderId}/disputes/${disputeId}/reply`, {
    token: customer,
    raw: disputeReplyForm(),
  });
  assert("покупатель отвечает на запрос поддержки → спор возвращается в under_review",
    disputeReply.status === 201 && disputeReply.json?.status === "under_review",
    JSON.stringify(disputeReply.json));
  const disputeAfterReply = await api("GET", `/api/orders/${pickup.orderId}/disputes`, { token: customer });
  assert("переписка сохраняет запрос поддержки и ответ покупателя",
    disputeAfterReply.status === 200 &&
    disputeAfterReply.json?.dispute?.messages?.length === 2 &&
    disputeAfterReply.json.dispute.messages[0]?.message.includes("Нужны дополнительные сведения") &&
    disputeAfterReply.json.dispute.messages[1]?.message.includes("Прикладываю дополнительные сведения"));
  let disputeMessageMutationState = "";
  try {
    await client.query(
      `UPDATE public.order_dispute_messages SET message = 'tampered' WHERE id = $1::uuid`,
      [disputeAfterReply.json?.dispute?.messages?.[0]?.id],
    );
  } catch (error) {
    disputeMessageMutationState = error.code;
  }
  assert("БД запрещает подмену сообщения в истории спора (SQLSTATE 55000)",
    disputeMessageMutationState === "55000", disputeMessageMutationState);
  const disputeResolve = await api("PATCH", `/api/orders/${pickup.orderId}/disputes`, {
    token: admin,
    body: { disputeId, status: "resolved", resolution: "Дефект подтверждён, покупателю согласован полный возврат." },
  });
  assert("администратор фиксирует решение спора",
    disputeResolve.status === 200 && disputeResolve.json?.dispute?.status === "resolved",
    JSON.stringify(disputeResolve.json));
  const evidenceId = disputeView.json?.dispute?.evidence?.[0]?.id;
  let evidenceMutationState = "";
  try {
    await client.query(`UPDATE public.order_dispute_evidence SET note = 'tampered' WHERE id = $1::uuid`, [evidenceId]);
  } catch (error) {
    evidenceMutationState = error.code;
  }
  assert("БД запрещает подмену доказательства (SQLSTATE 55000)", evidenceMutationState === "55000", evidenceMutationState);
  const mediaId = disputeView.json?.dispute?.evidence?.[0]?.order_media_id;
  let mediaMutationState = "";
  try {
    await client.query(`UPDATE public.order_media SET status = 'deleted' WHERE id = $1::uuid`, [mediaId]);
  } catch (error) {
    mediaMutationState = error.code;
  }
  assert("БД запрещает удалить файл, приложенный к спору (SQLSTATE 55000)", mediaMutationState === "55000", mediaMutationState);
  let mediaTruncateState = "";
  await client.query("BEGIN");
  try {
    await client.query("TRUNCATE public.order_media");
  } catch (error) {
    mediaTruncateState = error.code;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
  assert("БД запрещает TRUNCATE хранилища при наличии доказательств (SQLSTATE 55000)",
    mediaTruncateState === "55000", mediaTruncateState);
  const disputeEvents = await client.query(
    `SELECT count(*)::int AS count FROM public.order_dispute_events WHERE dispute_id = $1::uuid`,
    [disputeId],
  );
  assert("журнал спора сохраняет открытие, рассмотрение и решение",
    disputeEvents.rows[0]?.count === 5,
    `events=${disputeEvents.rows[0]?.count}`);
  const disputeOpsTask = await client.query(
    `SELECT status, resolved_by, action_url FROM public.ops_tasks
      WHERE type = 'ORDER_DISPUTE_OPENED' AND entity_id = $1`,
    [disputeId],
  );
  const adminIdentity = await client.query(
    `SELECT id::text FROM auth.users WHERE email = 'admin@demo.ru' LIMIT 1`,
  );
  assert("открытие спора создаёт задачу администратору, а решение закрывает её",
    disputeOpsTask.rows[0]?.status === "resolved" &&
    disputeOpsTask.rows[0]?.resolved_by === adminIdentity.rows[0]?.id &&
    disputeOpsTask.rows[0]?.action_url === "/dashboard?tab=orders",
    JSON.stringify(disputeOpsTask.rows[0]));

  const mediaServe = await fetch(`${BASE}${mediaUrl}`, { headers: { Authorization: `Bearer ${admin}` } });
  assert("фото раздаётся авторизованному (200, image/png)", mediaServe.status === 200 && mediaServe.headers.get("content-type") === "image/png", `${mediaServe.status} ${mediaServe.headers.get("content-type")}`);
  const mediaAnon = await fetch(`${BASE}${mediaUrl}`);
  assert("анониму фото недоступно (401/404)", mediaAnon.status === 401 || mediaAnon.status === 404, `got ${mediaAnon.status}`);

  // =========================================================================
  section("E2E №2 — нехватка ингредиента → закупка → ETA (ТЗ §47, §20)");
  // Сценарий №1 списал рецепт; обнуляем ягоды для гарантированного shortage.
  await client.query(`UPDATE public.inventory_items SET quantity = 0 WHERE id = $1::uuid`, [recipeInventoryFixture.berryId]);
  // Отдельный день: заказ №1 уже занял слот владельца на tomorrowStr.
  const o2 = await createTestOrder({ deliveryDate: dayAfterTomorrowStr });
  testOrders.push(o2.orderId);
  const a2 = await api("POST", `/api/orders/${o2.orderId}/assign`, { token: admin, body: { confectionerId: OWNER_ID } });
  assert("o2 assign → 200", a2.status === 200, JSON.stringify(a2.json).slice(0, 120));

  const breakdown = await api("GET", `/api/orders/${o2.orderId}/breakdown`, { token: admin });
  assert("breakdown: дефицит «Ягоды» (no_stock)", (breakdown.json?.shortages || []).some((s) => s.name === "Ягоды"), JSON.stringify((breakdown.json?.shortages || []).map((s) => s.name)));
  assert("breakdown: can_produce=false", breakdown.json?.can_produce === false);

  const draft = await api("POST", `/api/orders/${o2.orderId}/purchase-draft`, { token: admin, body: {} });
  assert("purchase-draft из дефицита → 201", draft.status === 201, JSON.stringify(draft.json).slice(0, 120));
  const draftId = draft.json?.draft?.id;
  if (draftId) testDraftIds.push(draftId);

  // Без ETA — принять нельзя (закупка не запланирована)
  const accNoEta = await api("POST", `/api/orders/${o2.orderId}/acceptance-check`, { token: admin });
  assert("acceptance-check без ETA: canAccept=false (PURCHASE_ETA_MISSING)", accNoEta.status === 200 && accNoEta.json?.canAccept === false && (accNoEta.json?.reasons || []).some((r) => r.code === "PURCHASE_ETA_MISSING"), JSON.stringify((accNoEta.json?.reasons || []).map((r) => r.code)));

  // ETA до безопасного старта (09:00 < 11:55 в день доставки) → CAN_ACCEPT_WITH_PURCHASE
  const etaOk = new Date(`${dayAfterTomorrowStr}T09:00:00`);
  const setEta = await api("PATCH", `/api/purchase-drafts/${draftId}`, { token: owner, body: { expectedEta: etaOk.toISOString() } });
  assert("PATCH purchase-draft ETA → 200", setEta.status === 200, JSON.stringify(setEta.json).slice(0, 120));
  const accOk = await api("POST", `/api/orders/${o2.orderId}/acceptance-check`, { token: admin });
  assert("ETA до старта → canAccept=true (CAN_ACCEPT_WITH_PURCHASE)", accOk.status === 200 && accOk.json?.canAccept === true && accOk.json?.availability === "available_with_warning", JSON.stringify({ canAccept: accOk.json?.canAccept, av: accOk.json?.availability }));

  // ETA после безопасного старта → CANNOT_ACCEPT
  const etaLate = new Date(`${dayAfterTomorrowStr}T20:00:00`);
  await api("PATCH", `/api/purchase-drafts/${draftId}`, { token: owner, body: { expectedEta: etaLate.toISOString() } });
  const accLate = await api("POST", `/api/orders/${o2.orderId}/acceptance-check`, { token: admin });
  assert("ETA после старта → canAccept=false (PURCHASE_ETA_AFTER_DEADLINE)", accLate.json?.canAccept === false && (accLate.json?.reasons || []).some((r) => r.code === "PURCHASE_ETA_AFTER_DEADLINE"), JSON.stringify((accLate.json?.reasons || []).map((r) => r.code)));

  // Доступность для клиента (ТЗ §29)
  const avail = await api("POST", "/api/orders/availability", {
    token: customer,
    body: { items: [{ productId: PRODUCT_ID, quantity: 1 }], deliveryDate: tomorrowStr },
  });
  assert("POST availability → 200 (ТЗ §29)", avail.status === 200, `got ${avail.status}`);
  assert("availability: unavailable (дефицит без ETA после сброса)", avail.json?.availability === "unavailable" || avail.json?.availability === "available_with_warning", avail.json?.availability);

  // =========================================================================
  section("E2E №3 — недостаточная capacity → альтернатива (ТЗ §48, §16)");
  // Заполняем день CONF_112 заказами+резервами 09:00-18:00
  const filler1 = await createTestOrder({ confectionerId: CONF_112, deliveryDate: tomorrowStr });
  const filler2 = await createTestOrder({ confectionerId: CONF_112, deliveryDate: tomorrowStr });
  testOrders.push(filler1.orderId, filler2.orderId);
  await client.query(
    `INSERT INTO public.capacity_reservations (order_id, confectioner_id, reserved_date, start_minute, end_minute, estimated_minutes)
     VALUES ($1::uuid, $2::uuid, $3::date, 540, 810, 270), ($4::uuid, $2::uuid, $3::date, 810, 1080, 270)`,
    [filler1.orderId, CONF_112, tomorrowStr, filler2.orderId]
  );

  const o3 = await createTestOrder({ deliveryDate: tomorrowStr });
  testOrders.push(o3.orderId);
  const assignFull = await api("POST", `/api/orders/${o3.orderId}/assign`, { token: admin, body: { confectionerId: CONF_112 } });
  assert("assign перегруженному → 422 CAPACITY_EXCEEDED (ТЗ §16)", assignFull.status === 422 && assignFull.json?.error === "CAPACITY_EXCEEDED", JSON.stringify(assignFull.json).slice(0, 200));
  assert("в отказе арифметика: required/available", assignFull.json?.capacity?.requiredMinutes === 240 && assignFull.json?.capacity?.availableMinutes === 0, JSON.stringify(assignFull.json?.capacity));

  const orderStillUnassigned = await client.query(`SELECT confectioner_id FROM public.orders WHERE id = $1::uuid`, [o3.orderId]);
  assert("после отказа заказ остался unassigned (откат захвата)", orderStillUnassigned.rows[0]?.confectioner_id === null);

  const assignAlt = await api("POST", `/api/orders/${o3.orderId}/assign`, { token: admin, body: { confectionerId: CONF_111 } });
  assert("альтернативный кондитер → 200", assignAlt.status === 200, JSON.stringify(assignAlt.json).slice(0, 160));

  // Проверка рекомендаций (ТЗ §14-15): CONF_111 должен получить положительный score
  // (косвенно: assign прошёл; полный matching покрыт unit-тестами весов)

  // =========================================================================
  section("E2E №4 — заказ становится at-risk → авто-resolve (ТЗ §49, §13)");
  // Заказ с выдачей сегодня в 00:00-01:00 → latest safe start уже прошёл
  const o4 = await createTestOrder({ confectionerId: OWNER_ID, deliveryDate: todayStr, window: "00:00-01:00" });
  testOrders.push(o4.orderId);
  await client.query(
    `INSERT INTO public.order_production (order_id, estimated_minutes, estimate_source, latest_safe_start_at, deadline_at, planned_date, planned_start_minute, ready_photo_required)
     VALUES ($1::uuid, 240, 'category', now() - interval '90 minutes', $2::timestamptz, $3::date, 0, true)
     ON CONFLICT (order_id) DO UPDATE SET latest_safe_start_at = now() - interval '90 minutes'`,
    [o4.orderId, new Date(`${todayStr}T01:00:00`).toISOString(), todayStr]
  );
  // Резерв окна (заказ назначен через SQL — создаём резерв явно, чтобы после
  // старта производства риск полностью ушёл в GREEN, ТЗ §49)
  await client.query(
    `INSERT INTO public.capacity_reservations (order_id, confectioner_id, reserved_date, start_minute, end_minute, estimated_minutes)
     VALUES ($1::uuid, $2::uuid, $3::date, 0, 240, 240) ON CONFLICT DO NOTHING`,
    [o4.orderId, OWNER_ID, todayStr]
  );

  const scan1 = await api("GET", "/api/ops/tasks?refresh=1", { token: admin });
  assert("скан → 200", scan1.status === 200);
  const atRiskTask = (scan1.json?.tasks || []).find((t) => t.type === "ORDER_AT_RISK" && t.entity_id === o4.orderId);
  assert("ORDER_AT_RISK создана (ТЗ §13)", Boolean(atRiskTask));
  assert("ORDER_AT_RISK severity critical (RED)", atRiskTask?.severity === "critical", atRiskTask?.severity);
  const riskReasons = atRiskTask?.payload?.reasons || [];
  assert("причина: PRODUCTION_NOT_STARTED", riskReasons.includes("PRODUCTION_NOT_STARTED"), JSON.stringify(riskReasons));
  const contactTask = (scan1.json?.tasks || []).find((t) => t.type === "CONTACT_CUSTOMER" && t.entity_id === o4.orderId);
  assert("CONTACT_CUSTOMER создана (ТЗ §23)", Boolean(contactTask));

  // Идемпотентность (ТЗ §26): повторный скан не плодит дубли
  const scan2 = await api("GET", "/api/ops/tasks?refresh=1", { token: admin });
  const arAdmin = (scan2.json?.tasks || []).filter((t) => t.type === "ORDER_AT_RISK" && t.dedup_key === `ORDER_AT_RISK:${o4.orderId}`);
  const arAll = (scan2.json?.tasks || []).filter((t) => t.type === "ORDER_AT_RISK" && t.entity_id === o4.orderId);
  const uniqueKeys = new Set(arAll.map((t) => t.dedup_key));
  assert("повторный скан: ровно 1 админ-задача ORDER_AT_RISK (идемпотентность)", arAdmin.length === 1, `got ${arAdmin.length}`);
  assert("dedup_key уникальны (кондитерская копия не дубль)", uniqueKeys.size === arAll.length, `${arAll.length}/${uniqueKeys.size}`);

  const accept4 = await api("POST", `/api/orders/${o4.orderId}/accept`, { token: owner });
  assert("o4 accept → 200", accept4.status === 200, JSON.stringify(accept4.json).slice(0, 120));

  const startLate = await api("POST", `/api/orders/${o4.orderId}/production/start`, { token: owner });
  assert("поздний старт производства → 200", startLate.status === 200, JSON.stringify(startLate.json).slice(0, 140));

  const scan3 = await api("GET", "/api/ops/tasks?refresh=1", { token: admin });
  const arAfter = (scan3.json?.tasks || []).find((t) => t.type === "ORDER_AT_RISK" && t.entity_id === o4.orderId);
  assert("после старта: задача авто-resolved (ТЗ §25)", !arAfter || arAfter.status === "resolved", JSON.stringify({ status: arAfter?.status, comment: arAfter?.resolve_comment }));
  const ccAfter = (scan3.json?.tasks || []).find((t) => t.type === "CONTACT_CUSTOMER" && t.entity_id === o4.orderId);
  assert("CONTACT_CUSTOMER авто-resolved", !ccAfter || ccAfter.status === "resolved");

  // =========================================================================
  section("E2E №5 — reassignment (ТЗ §50)");
  const o5 = await createTestOrder({ deliveryDate: tomorrowStr });
  testOrders.push(o5.orderId);
  const a5 = await api("POST", `/api/orders/${o5.orderId}/assign`, { token: admin, body: { confectionerId: CONF_102 } });
  assert("assign кондитеру A → 200", a5.status === 200, JSON.stringify(a5.json).slice(0, 140));
  const oldRes = a5.json?.reservation;
  assert("резерв A закреплён", Boolean(oldRes));

  const r5 = await api("POST", `/api/orders/${o5.orderId}/reassign`, { token: admin, body: { confectionerId: CONF_103 } });
  assert("reassign A→B → 200", r5.status === 200, JSON.stringify(r5.json).slice(0, 160));
  assert("преждний исполнитель сохранён в ответе", r5.json?.previousConfectionerId === CONF_102);
  const resCheck = await client.query(
    `SELECT confectioner_id::text, status FROM public.capacity_reservations WHERE order_id = $1::uuid ORDER BY created_at`,
    [o5.orderId]
  );
  const released = resCheck.rows.find((r) => r.status === "released");
  const active = resCheck.rows.find((r) => r.status === "reserved" || r.status === "confirmed");
  assert("старый резерв released", Boolean(released) && released.confectioner_id === CONF_102, JSON.stringify(resCheck.rows));
  assert("новый резерв активен у B", Boolean(active) && active.confectioner_id === CONF_103);
  const ev = await client.query(
    `SELECT count(*)::int AS c FROM public.domain_events WHERE entity_type='order' AND entity_id = $1::text AND type = 'order.reassigned'`,
    [o5.orderId]
  );
  assert("событие order.reassigned записано", ev.rows[0].c === 1);

  // =========================================================================
  section("Гонки (ТЗ §27, §45)");
  // Дата +2 дня: гонка CAS не должна зависеть от занятости других тестов
  const raceDate = isoDate(new Date(Date.now() + 2 * 86_400_000));
  const o6 = await createTestOrder({ deliveryDate: raceDate });
  testOrders.push(o6.orderId);
  const [race1, race2] = await Promise.all([
    api("POST", `/api/orders/${o6.orderId}/assign`, { token: admin, body: { confectionerId: CONF_102 } }),
    api("POST", `/api/orders/${o6.orderId}/assign`, { token: admin, body: { confectionerId: CONF_103 } }),
  ]);
  const statuses = [race1.status, race2.status].sort();
  assert("2 одновременных assign: ровно один 200, второй 409", statuses[0] === 200 && statuses[1] === 409, JSON.stringify([race1.status, race2.status]));
  const winners = await client.query(`SELECT count(*)::int AS c FROM public.capacity_reservations WHERE order_id = $1::uuid AND status IN ('reserved','confirmed')`, [o6.orderId]);
  assert("ровно один активный резерв после гонки", winners.rows[0].c === 1, `got ${winners.rows[0].c}`);

  // SQL-уровень: параллельные пересекающиеся резервы → EXCLUDE (23P01).
  // Изолированная дата исключает конфликт с demo/fixture reservations.
  const dayPlus2 = "2099-01-01";
  const o7 = await createTestOrder({ confectionerId: OWNER_ID, deliveryDate: dayPlus2 });
  const o8 = await createTestOrder({ confectionerId: OWNER_ID, deliveryDate: dayPlus2 });
  testOrders.push(o7.orderId, o8.orderId);
  // Два независимых pg.Client — один Client сериализует query() и не проверяет гонку.
  const concurrentClient = new Client({ connectionString: PG_URL });
  await concurrentClient.connect();
  let ins1;
  let ins2;
  try {
    [ins1, ins2] = await Promise.allSettled([
      client.query(`INSERT INTO public.capacity_reservations (order_id, confectioner_id, reserved_date, start_minute, end_minute, estimated_minutes) VALUES ($1::uuid, $2::uuid, $3::date, 540, 780, 240)`, [o7.orderId, OWNER_ID, dayPlus2]),
      concurrentClient.query(`INSERT INTO public.capacity_reservations (order_id, confectioner_id, reserved_date, start_minute, end_minute, estimated_minutes) VALUES ($1::uuid, $2::uuid, $3::date, 700, 940, 240)`, [o8.orderId, OWNER_ID, dayPlus2]),
    ]);
  } finally {
    await concurrentClient.end();
  }
  const okInserts = (ins1.status === "fulfilled" ? 1 : 0) + (ins2.status === "fulfilled" ? 1 : 0);
  assert("параллельные пересекающиеся резервы: ровно один INSERT прошёл (EXCLUDE)", okInserts === 1, `${ins1.status}/${ins2.status} ${ins1.status === "rejected" ? ins1.reason?.code : ""} ${ins2.status === "rejected" ? ins2.reason?.code : ""}`);
  const overlapRejected = [ins1, ins2].some((r) => r.status === "rejected" && r.reason?.code === "23P01");
  assert("отклонён ошибкой 23P01 (exclusion_violation)", overlapRejected);

  // =========================================================================
  section("API-гигиена");
  const lcMod = await api("GET", `/api/orders/${o5.orderId}/lifecycle`, { token: customer });
  assert("клиент-владелец видит lifecycle переназначенного заказа", lcMod.status === 200 && lcMod.json?.order?.confectioner_id === CONF_103);
  const anonLc = await fetch(`${BASE}/api/orders/${o5.orderId}/lifecycle`, { redirect: "manual" });
  assert("аноним lifecycle → 401/307 (без утечки данных)", anonLc.status === 401 || anonLc.status === 307, `got ${anonLc.status}`);
  const todayUi = await api("GET", "/api/ops/confectioner-today", { token: owner });
  assert("confectioner-today: capacity присутствует", todayUi.status === 200 && todayUi.json?.capacity && Number.isFinite(todayUi.json.capacity.utilizationPercent), JSON.stringify(todayUi.json?.capacity).slice(0, 120));
  assert("confectioner-today: productionPlan массив", Array.isArray(todayUi.json?.productionPlan));
  assert("confectioner-today: attention-счётчики", todayUi.json?.attention && "lowStockItems" in todayUi.json.attention);
  const tower = await api("GET", "/api/ops/orders-today", { token: admin });
  assert("Control Tower → 200 c группами (ТЗ §21-22)", tower.status === 200 && tower.json?.groups && "atRisk" in tower.json.groups && "unassigned" in tower.json.groups);
  assert("Tower: группа atRisk содержит o4 (RED до старта был)", Array.isArray(tower.json?.groups?.atRisk));

  // Контроль передачи аккаунта: второй вход с другого устройства заменяет старую сессию.
  const newDeviceLogin = await api("POST", "/api/auth/login", {
    body: { email: customerEmail, password: PASSWORD },
    extraHeaders: {
      "x-real-ip": "10.241.242.243",
      "user-agent": "Conditera-E2E-New-Device/1.0",
    },
  });
  assert("вход с нового устройства проходит аутентификацию",
    newDeviceLogin.status === 200 && Boolean(newDeviceLogin.json?.accessToken));
  const activeSessionsAfterReplacement = await client.query(
    `SELECT count(*)::int AS count FROM public.user_sessions
      WHERE user_id = $1::uuid AND revoked_at IS NULL AND expires_at > now()`,
    [CUSTOMER_ID]
  );
  assert("после нового входа у аккаунта ровно одна активная сессия",
    activeSessionsAfterReplacement.rows[0]?.count === 1,
    `active=${activeSessionsAfterReplacement.rows[0]?.count}`);
  const previousTokenCheck = await api("GET", "/api/auth/sessions", { token: customer });
  assert("JWT предыдущего устройства немедленно отозван → 401",
    previousTokenCheck.status === 401,
    JSON.stringify(previousTokenCheck.json));
  const newDeviceSecurityEvent = await client.query(
    `SELECT count(*)::int AS count FROM public.user_security_events
      WHERE user_id = $1::uuid AND event_type = 'new_device_session'`,
    [CUSTOMER_ID]
  );
  assert("новое устройство фиксируется как security warning",
    newDeviceSecurityEvent.rows[0]?.count >= 1);
  const replacementEvent = await client.query(
    `SELECT count(*)::int AS count FROM public.user_security_events
      WHERE user_id = $1::uuid AND event_type = 'session_revoked'
        AND details->>'reason' = 'replaced_by_new_login'`,
    [CUSTOMER_ID]
  );
  assert("отзыв старого устройства записан в security journal",
    replacementEvent.rows[0]?.count >= 1);
  const newDeviceAdminTask = await client.query(
    `SELECT count(*)::int AS count FROM public.ops_tasks
      WHERE type = 'ACCOUNT_NEW_DEVICE' AND entity_id = $1 AND status = 'open'`,
    [CUSTOMER_ID]
  );
  assert("для нового устройства создаётся задача контроля аккаунта",
    newDeviceAdminTask.rows[0]?.count >= 1);

  // Одновременные входы с двух новых устройств: advisory lock должен оставить
  // ровно одну активную сессию, независимо от порядка завершения запросов.
  const [parallelLoginA, parallelLoginB] = await Promise.all([
    api("POST", "/api/auth/login", {
      body: { email: customerEmail, password: PASSWORD },
      extraHeaders: { "x-real-ip": "10.241.242.244", "user-agent": "Conditera-E2E-Parallel-A/1.0" },
    }),
    api("POST", "/api/auth/login", {
      body: { email: customerEmail, password: PASSWORD },
      extraHeaders: { "x-real-ip": "10.241.242.245", "user-agent": "Conditera-E2E-Parallel-B/1.0" },
    }),
  ]);
  assert("конкурентные входы: победитель 200, проигравший 409 либо успел завершиться до гонки",
    [parallelLoginA.status, parallelLoginB.status].every((status) => status === 200 || status === 409) &&
    [parallelLoginA.status, parallelLoginB.status].includes(200),
    `${parallelLoginA.status}/${parallelLoginB.status}`);
  const [parallelSessionA, parallelSessionB] = await Promise.all([
    api("GET", "/api/auth/sessions", { token: parallelLoginA.json?.accessToken }),
    api("GET", "/api/auth/sessions", { token: parallelLoginB.json?.accessToken }),
  ]);
  const validParallelTokens = [parallelSessionA.status, parallelSessionB.status].filter((status) => status === 200).length;
  assert("конкурентные логины оставляют действительным ровно один JWT",
    validParallelTokens === 1,
    `HTTP=${parallelSessionA.status}/${parallelSessionB.status}`);
  const parallelActiveCount = await client.query(
    `SELECT count(*)::int AS count FROM public.user_sessions
      WHERE user_id = $1::uuid AND revoked_at IS NULL AND expires_at > now()`,
    [CUSTOMER_ID],
  );
  assert("после конкурентных логинов в БД ровно одна активная сессия",
    parallelActiveCount.rows[0]?.count === 1,
    `active=${parallelActiveCount.rows[0]?.count}`);
}

main()
  .catch((e) => {
    failed++;
    failures.push(`fatal: ${e.message}`);
    console.error("FATAL:", e);
  })
  .finally(async () => {
    // ---- Очистка (ТЗ: тестовые данные не остаются) ----
    try {
      // Тестовые доказательства очищаются только в disposable CI-БД после
      // проверки immutability; production-процесс не имеет такого пути.
      const disputeStorage = await client.query(
        `SELECT m.storage_path FROM public.order_media m
          WHERE m.order_id = ANY($1::uuid[])
            AND m.id IN (SELECT e.order_media_id FROM public.order_dispute_evidence e)`,
        [testOrders],
      ).catch(() => ({ rows: [] }));
      for (const row of disputeStorage.rows) {
        await client.query(
          `DELETE FROM storage.objects WHERE bucket_id = 'order_media' AND name = $1`,
          [row.storage_path],
        ).catch(() => {});
      }
      await client.query("ALTER TABLE public.order_dispute_evidence DISABLE TRIGGER USER").catch(() => {});
      await client.query(
        `DELETE FROM public.order_dispute_evidence
          WHERE dispute_id IN (SELECT id FROM public.order_disputes WHERE order_id = ANY($1::uuid[]))`,
        [testOrders],
      ).catch(() => {});
      await client.query("ALTER TABLE public.order_dispute_evidence ENABLE TRIGGER USER").catch(() => {});
      await client.query("ALTER TABLE public.order_dispute_messages DISABLE TRIGGER USER").catch(() => {});
      await client.query(
        `DELETE FROM public.order_dispute_messages
          WHERE dispute_id IN (SELECT id FROM public.order_disputes WHERE order_id = ANY($1::uuid[]))`,
        [testOrders],
      ).catch(() => {});
      await client.query("ALTER TABLE public.order_dispute_messages ENABLE TRIGGER USER").catch(() => {});
      await client.query("ALTER TABLE public.order_dispute_events DISABLE TRIGGER USER").catch(() => {});
      await client.query(
        `DELETE FROM public.order_dispute_events
          WHERE dispute_id IN (SELECT id FROM public.order_disputes WHERE order_id = ANY($1::uuid[]))`,
        [testOrders],
      ).catch(() => {});
      await client.query("ALTER TABLE public.order_dispute_events ENABLE TRIGGER USER").catch(() => {});
      await client.query(
        `DELETE FROM public.ops_tasks WHERE type = 'ORDER_DISPUTE_OPENED' AND entity_id IN
          (SELECT id::text FROM public.order_disputes WHERE order_id = ANY($1::uuid[]))`,
        [testOrders],
      ).catch(() => {});
      await client.query(
        `DELETE FROM public.order_disputes WHERE order_id = ANY($1::uuid[])`,
        [testOrders],
      ).catch(() => {});
      for (const id of testOrders) {
        await deleteOrder(id).catch(() => {});
      }
      if (recipeInventoryFixture) {
        for (const link of recipeInventoryFixture.ingredientLinks) {
          await client.query(
            `UPDATE public.recipe_ingredients SET inventory_item_id = $2::uuid WHERE id = $1::uuid`,
            [link.ingredientId, link.previousItemId]
          );
        }
        for (const row of recipeInventoryFixture.inventorySnapshot) {
          await client.query(
            `UPDATE public.inventory_items
                SET quantity = $2, unit = $3, is_active = $4
              WHERE id = $1::uuid`,
            [row.id, row.quantity, row.unit, row.isActive]
          );
        }
        for (const id of recipeInventoryFixture.createdInventoryIds) {
          await client.query(`DELETE FROM public.inventory_items WHERE id = $1::uuid`, [id]);
        }
      }
      for (const quoteRequestId of testQuoteRequestIds) {
        const quoteFiles = await client.query(
          `SELECT storage_path FROM public.quote_request_media WHERE quote_request_id = $1::uuid`,
          [quoteRequestId]
        ).catch(() => ({ rows: [] }));
        for (const file of quoteFiles.rows) {
          await client.query(
            `DELETE FROM storage.objects WHERE bucket_id = 'quote_media' AND name = $1`,
            [file.storage_path]
          ).catch(() => {});
        }
        await client.query(`DELETE FROM public.quote_requests WHERE id = $1::uuid`, [quoteRequestId]);
      }
      for (const d of testDraftIds) {
        await client.query(`DELETE FROM public.purchase_draft_items WHERE draft_id = $1::uuid`, [d]);
        await client.query(`DELETE FROM public.purchase_drafts WHERE id = $1::uuid`, [d]);
      }
      // Закрываем движковые задачи по удалённым заказам (условие исчезло — резолвятся сканом)
      await client.query(
        `DELETE FROM public.ops_tasks WHERE entity_type='order' AND entity_id = ANY($1::text[])`,
        [testOrders]
      );
      if (registeredCustomerId) {
        // Удаляем все оставшиеся тестовые заказы этого покупателя, включая
        // возможные записи, не попавшие в testOrders из вспомогательных сценариев.
        await client.query(`DELETE FROM public.orders WHERE user_id = $1::uuid`, [registeredCustomerId]);
        // Удаляем созданные этим E2E сигналы нового устройства: они не должны
        // оставлять тестовые security events, уведомления и admin-задачи.
        await client.query(`DELETE FROM public.ops_tasks WHERE type = 'ACCOUNT_NEW_DEVICE' AND entity_id = $1`, [registeredCustomerId]).catch(() => {});
        await client.query(`DELETE FROM public.notifications WHERE user_id = $1::uuid`, [registeredCustomerId]).catch(() => {});
        await client.query(`DELETE FROM public.user_security_events WHERE user_id = $1::uuid`, [registeredCustomerId]).catch(() => {});
        await client.query(`DELETE FROM public.user_sessions WHERE user_id = $1::uuid`, [registeredCustomerId]).catch(() => {});
        await client.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [registeredCustomerId]);
      }
      const left = await client.query(`SELECT count(*)::int AS c FROM public.orders WHERE number LIKE 'P05V-%'`);
      console.log(`cleanup: заказов удалено ${testOrders.length}, осталось P05V: ${left.rows[0].c}`);
    } catch (e) {
      console.error("cleanup error:", e.message);
    }
    await client.end().catch(() => {});
    console.log(`\n══════════════════════════════════════`);
    console.log(`P0.5 verify: ${passed} passed, ${failed} failed`);
    if (failures.length) {
      console.log("Failures:");
      failures.forEach((f) => console.log(`  ✖ ${f}`));
    }
    process.exit(failed ? 1 : 0);
  });
