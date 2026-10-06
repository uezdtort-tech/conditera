/**
 * Регрессионная проверка расширения карточки товара (медиа + модерация).
 *
 * Покрывает требования ТЗ (п.25):
 *  - лимиты: 1 фото PASS, 10 фото PASS, 11 REJECT; 1/3 видео PASS, 4 REJECT;
 *  - модерация: pending не виден публично, approved виден, rejected не виден;
 *  - безопасность: чужой пользователь не может грузить/удалять/модерировать;
 *    владелец не может сам-одобрить; админ может;
 *  - filesystem: upload → файл есть; delete → файла нет; упавший INSERT не
 *    оставляет orphan-файлов; approve переносит pending → published;
 *  - карточка: сохранение/публичное отображение характеристик, состава,
 *    аллергенов, КБЖУ, хранения, срока годности, заказа;
 *  - публикация: гейт PUBLISH_VALIDATION_FAILED, published_at.
 *
 * Запуск: node scripts/verify/product-media-verify.mjs
 * Требует: работающий дев-сервер (по умолчанию http://127.0.0.1:3000) и
 * демо-пользователей (admin@demo.ru / confectioner@demo.ru / customer@demo.ru,
 * пароль Demo123!). Тестовые товары в конце удаляются из БД и с диска.
 */

import { Client } from "pg";
// Примечание: мутации требуют CSRF double-submit (см. src/proxy.ts),

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const PASSWORD = "Demo123!";
const ADMIN_EMAIL = "admin@demo.ru";
const OWNER_EMAIL = "confectioner@demo.ru";
const CUSTOMER_EMAIL = "customer@demo.ru";
const OWNER_USER_ID = "11111111-1111-4111-8111-111111111101";
const ADMIN_USER_ID = "11111111-1111-4111-8111-111111111107";

const MAX_PHOTOS = 10;
const MAX_VIDEOS = 3;

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

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

/** 1×1 валидный PNG (67 байт). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** Минимальный MP4: ftyp(isom) + free + mdat — проходит сниффер magic bytes. */
function buildMinimalMp4(size = 1024) {
  const ftyp = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from("isommp42", "ascii"),
  ]);
  const free = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x08]), Buffer.from("free", "ascii")]);
  const payloadSize = Math.max(0, size - ftyp.length - free.length - 8);
  const mdat = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("mdat", "ascii"),
    Buffer.alloc(payloadSize, 0x2f),
  ]);
  mdat.writeUInt32BE(mdat.length, 0);
  return Buffer.concat([ftyp, free, mdat]);
}

/** CSRF double-submit: cookie csrf_token + заголовок x-csrf-token (одинаковое значение). */
let CSRF = null;
/** Случайный x-real-ip на прогон: анти-фрод логина лимитирует 20/час на IP,
 * что ломает многократные регрессионные прогоны с локальной машины. */
const RUN_IP = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
async function ensureCsrf() {
  if (CSRF) return CSRF;
  const res = await fetch(`${BASE}/api/csrf-token`, { headers: { "x-real-ip": RUN_IP } });
  const json = await res.json().catch(() => null);
  const setCookie = res.headers.getSetCookie?.().find((c) => c.startsWith("csrf_token="));
  const cookieValue = setCookie ? setCookie.split(";")[0].split("=").slice(1).join("=") : json?.token;
  if (!json?.token || !cookieValue) throw new Error("failed to obtain csrf token");
  CSRF = { token: json.token, cookie: cookieValue };
  return CSRF;
}

async function api(method, path, { token, body, formData } = {}) {
  const headers = { "x-real-ip": RUN_IP };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (shouldCheckCsrf(method)) {
    const csrf = await ensureCsrf();
    headers["x-csrf-token"] = csrf.token;
    headers.Cookie = `csrf_token=${csrf.cookie}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, headers: res.headers };
}

function shouldCheckCsrf(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

async function login(email) {
  await ensureCsrf();
  const res = await api("POST", "/api/auth/login", {
    body: { email, password: PASSWORD },
  });
  if (res.status !== 200 || !res.json?.accessToken) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
  }
  return res.json.accessToken;
}

// ---------------------------------------------------------------------------

const client = new Client({ connectionString: "postgresql://postgres@127.0.0.1:54329/conditera" });
const createdProducts = []; // {id, storageRoot}

async function main() {
  await client.connect();
  section("Подготовка: логины");
  const admin = await login(ADMIN_EMAIL);
  const owner = await login(OWNER_EMAIL);
  const customer = await login(CUSTOMER_EMAIL);
  assert("логин admin@demo.ru", Boolean(admin));
  assert("логин confectioner@demo.ru", Boolean(owner));
  assert("логин customer@demo.ru", Boolean(customer));

  // ─────────────────────────────────────────────────────────────────────────
  section("Создание тестового товара (админ, владелец — демо-кондитер)");
  const uniq = Date.now().toString(36);
  const created = await api("POST", "/api/products", {
    token: admin,
    body: {
      confectionerId: OWNER_USER_ID,
      title: `Verify media product ${uniq}`,
      description: "Технологический товар для регрессионной проверки медиа",
      price: 1999,
      status: "draft",
    },
  });
  assert("POST /api/products (админ) → 201", created.status === 201, `got ${created.status}`);
  const productId = created.json?.product?.id;
  assert("товар создан, id получен", Boolean(productId));
  createdProducts.push({ id: productId, storageRoot: null });

  // ─────────────────────────────────────────────────────────────────────────
  section("Фотографии: 1 → PASS, 10 → PASS, 11 → REJECT");
  const photoIds = [];
  for (let i = 1; i <= MAX_PHOTOS + 1; i++) {
    const fd = new FormData();
    fd.append("file", new File([PNG_1X1], `photo-${i}.png`, { type: "image/png" }));
    fd.append("mediaType", "photo");
    const res = await api("POST", `/api/products/${productId}/media`, { token: owner, formData: fd });
    if (i <= MAX_PHOTOS) {
      assert(
        `фото #${i} → 201 pending`,
        res.status === 201 && res.json?.status === "pending" && res.json?.media_type === "photo",
        `got ${res.status} ${JSON.stringify(res.json).slice(0, 160)}`
      );
      if (res.status === 201) photoIds.push(res.json.id);
    } else {
      assert(
        `фото #${MAX_PHOTOS + 1} → 409 PHOTO_LIMIT_REACHED`,
        res.status === 409 && res.json?.error === "PHOTO_LIMIT_REACHED",
        `got ${res.status} ${JSON.stringify(res.json).slice(0, 160)}`
      );
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM product_media WHERE product_id = $1 AND media_type = 'photo'`,
        [productId]
      );
      assert("в БД ровно 10 фото", rows[0].n === MAX_PHOTOS, `got ${rows[0].n}`);
    }
  }
  {
    const root = "storage"; // storage_path в БД относителен корня storage
    createdProducts[0].storageRoot = root;
    const { execSync } = await import("node:child_process");
    let files = 0;
    try {
      files = execSync(`ls -1 "${root}/products/${productId}/pending/photos" | wc -l`).toString().trim() * 1;
    } catch {
      files = -1;
    }
    assert("orphan-файлов нет: в pending/photos ровно 10 файлов", files === MAX_PHOTOS, `got ${files}`);
  }

  section("Видео: 1 → PASS, 3 → PASS, 4 → REJECT");
  const videoIds = [];
  const mp4 = buildMinimalMp4(2048);
  for (let i = 1; i <= MAX_VIDEOS + 1; i++) {
    const fd = new FormData();
    fd.append("file", new File([mp4], `clip-${i}.mp4`, { type: "video/mp4" }));
    fd.append("mediaType", "video");
    const res = await api("POST", `/api/products/${productId}/media`, { token: owner, formData: fd });
    if (i <= MAX_VIDEOS) {
      assert(
        `видео #${i} → 201 pending`,
        res.status === 201 && res.json?.status === "pending" && res.json?.media_type === "video",
        `got ${res.status} ${JSON.stringify(res.json).slice(0, 160)}`
      );
      if (res.status === 201) videoIds.push(res.json.id);
    } else {
      assert(
        `видео #${MAX_VIDEOS + 1} → 409 VIDEO_LIMIT_REACHED`,
        res.status === 409 && res.json?.error === "VIDEO_LIMIT_REACHED",
        `got ${res.status} ${JSON.stringify(res.json).slice(0, 160)}`
      );
    }
  }

  section("Модерация: pending скрыт, approved виден, rejected скрыт");
  {
    const anon = await api("GET", `/api/product-media/${photoIds[0]}`);
    assert("pending-фото анонимно → 404", anon.status === 404, `got ${anon.status}`);
    const cust = await api("GET", `/api/product-media/${photoIds[0]}`, { token: customer });
    assert("pending-фото покупателю → 404", cust.status === 404, `got ${cust.status}`);

    const ownerSelfApprove = await api("PATCH", `/api/products/${productId}/media/${photoIds[0]}`, {
      token: owner,
      body: { action: "approve" },
    });
    assert("владелец НЕ может сам-одобрить → 403", ownerSelfApprove.status === 403, `got ${ownerSelfApprove.status}`);

    const approve = await api("PATCH", `/api/products/${productId}/media/${photoIds[0]}`, {
      token: admin,
      body: { action: "approve" },
    });
    assert("админ одобряет фото #1 → 200 approved", approve.status === 200 && approve.json?.status === "approved", `got ${approve.status}`);
    assert("storage_path перенесён в published/", String(approve.json?.storage_path || "").includes("/published/photos/"), approve.json?.storage_path);

    const pub = await api("GET", `/api/product-media/${photoIds[0]}`);
    assert("approved-фото анонимно → 200 image/png", pub.status === 200 && pub.headers.get("content-type") === "image/png", `got ${pub.status} ${pub.headers.get("content-type")}`);
    const range = await fetch(`${BASE}/api/product-media/${photoIds[0]}`, { headers: { Range: "bytes=0-9" } });
    assert("Range-запрос → 206", range.status === 206, `got ${range.status}`);

    const rejectNoComment = await api("PATCH", `/api/products/${productId}/media/${photoIds[1]}`, {
      token: admin,
      body: { action: "reject" },
    });
    assert("reject без причины → 422", rejectNoComment.status === 422, `got ${rejectNoComment.status}`);
    const reject = await api("PATCH", `/api/products/${productId}/media/${photoIds[1]}`, {
      token: admin,
      body: { action: "reject", comment: "Низкое качество изображения" },
    });
    assert("reject с причиной → 200 rejected", reject.status === 200 && reject.json?.status === "rejected", `got ${reject.status}`);
    const rejectedHidden = await api("GET", `/api/product-media/${photoIds[1]}`);
    assert("rejected-фото анонимно → 404", rejectedHidden.status === 404, `got ${rejectedHidden.status}`);
  }

  section("Публикация товара и публичная карточка");
  {
    const pubFail = await api("PATCH", `/api/products/${productId}`, { token: admin, body: { status: "published", description: "коротко" } });
    assert(
      "публикация с некорректным описанием → 422 (zod или гейт)",
      pubFail.status === 422 && ["PUBLISH_VALIDATION_FAILED", "VALIDATION_FAILED"].includes(pubFail.json?.error),
      `got ${pubFail.status} ${pubFail.json?.error}`
    );

    const card = {
      shortDescription: "Муссовый десерт для проверки",
      diameterCm: 18.5,
      heightCm: 7,
      sizeText: "18×7 см",
      shape: "круглый",
      productType: "Торт",
      fillingDescription: "Шоколадный ганаш и вишня",
      layersCount: 3,
      composition: {
        ingredients: ["Мука пшеничная", "Сахар", "Сливки 33%"],
        allergens: ["Глютен", "Молоко"],
        nutritionalValue: { calories: 320, protein: 4.2, fat: 18, carbs: 36 },
        storageConditions: "Хранить при 2-6°C",
        shelfLife: "48 часов",
      },
      minOrderQty: 2,
      customOrderAvailable: true,
      isAvailable: true,
      productionTimeHours: 48,
    };
    const patch = await api("PATCH", `/api/products/${productId}`, { token: owner, body: { ...card, status: "published" } });
    assert("PATCH карточки + публикация → 200", patch.status === 200 && patch.json?.product?.status === "published", `got ${patch.status} ${JSON.stringify(patch.json).slice(0, 200)}`);
    assert("published_at выставлен", Boolean(patch.json?.product?.published_at));

    const detail = await api("GET", `/api/products/${productId}`);
    const p = detail.json?.product ?? {};
    assert("публичный GET → 200", detail.status === 200, `got ${detail.status}`);
    assert("composition дошёл до карточки", p.composition?.ingredients?.length === 3 && p.composition?.allergens?.includes("Глютен"), JSON.stringify(p.composition).slice(0, 120));
    assert("КБЖУ в карточке", p.composition?.nutritionalValue?.calories === 320);
    assert("хранение/срок годности", p.composition?.storageConditions === "Хранить при 2-6°C" && p.composition?.shelfLife === "48 часов");
    assert("характеристики (диаметр/высота/размер/форма/тип)", Number(p.diameter_cm) === 18.5 && Number(p.height_cm) === 7 && p.size_text === "18×7 см" && p.shape === "круглый" && p.product_type === "Торт");
    assert("начинка (описание + слои)", p.filling_description === "Шоколадный ганаш и вишня" && Number(p.layers_count) === 3);
    assert("заказ (min_order_qty, срок изготовления)", Number(p.min_order_qty) === 2 && Number(p.production_time_hours) === 48);
    const media = p.media ?? [];
    assert("media[] содержит только approved (1 фото, 0 видео)", media.length === 1 && media[0].mediaType === "photo" && media[0].status === "approved", JSON.stringify(media.map((m) => m.status)));
    assert("images[0] = /api/product-media/<approved>", String(p.images?.[0] || "").startsWith("/api/product-media/"), p.images?.[0]);
  }

  section("Безопасность: чужие пользователи");
  {
    const fd = new FormData();
    fd.append("file", new File([PNG_1X1], "hacker.png", { type: "image/png" }));
    const custUpload = await api("POST", `/api/products/${productId}/media`, { token: customer, formData: fd });
    assert("покупатель не может загрузить медиа чужого товара → 403", custUpload.status === 403, `got ${custUpload.status}`);

    const custModerate = await api("PATCH", `/api/products/${productId}/media/${photoIds[2]}`, { token: customer, body: { action: "approve" } });
    assert("покупатель не может модерировать → 403", custModerate.status === 403, `got ${custModerate.status}`);

    const custDelete = await api("DELETE", `/api/products/${productId}/media/${photoIds[2]}`, { token: customer });
    assert("покупатель не может удалять медиа → 403", custDelete.status === 403, `got ${custDelete.status}`);

    // Чужой товар: создаём товар, владелец — админ
    const adminOwned = await api("POST", "/api/products", {
      token: admin,
      body: { confectionerId: ADMIN_USER_ID, title: `Foreign product ${uniq}`, description: "Товар для проверки ownership", price: 500, status: "draft" },
    });
    const foreignId = adminOwned.json?.product?.id;
    createdProducts.push({ id: foreignId, storageRoot: createdProducts[0].storageRoot });
    assert("чужой товар создан", Boolean(foreignId));

    const fd2 = new FormData();
    fd2.append("file", new File([PNG_1X1], "x.png", { type: "image/png" }));
    const ownerForeignUpload = await api("POST", `/api/products/${foreignId}/media`, { token: owner, formData: fd2 });
    assert("кондитер не может грузить медиа чужого товара → 403", ownerForeignUpload.status === 403, `got ${ownerForeignUpload.status}`);

    const ownerForeignPatch = await api("PATCH", `/api/products/${foreignId}`, { token: owner, body: { price: 1 } });
    assert("кондитер не может PATCH чужой карточки → 403", ownerForeignPatch.status === 403, `got ${ownerForeignPatch.status}`);

    const noAuth = await api("POST", `/api/products/${productId}/media`, {
      formData: (() => {
        const f = new FormData();
        f.append("file", new File([PNG_1X1], "a.png", { type: "image/png" }));
        return f;
      })(),
    });
    assert("upload без токена → 401", noAuth.status === 401, `got ${noAuth.status}`);

    const badMime = await api("POST", `/api/products/${productId}/media`, {
      token: admin,
      formData: (() => {
        const f = new FormData();
        f.append("file", new File([Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")], "evil.png", { type: "image/png" }));
        f.append("mediaType", "photo");
        return f;
      })(),
    });
    assert("SVG, замаскированный под .png → 415", badMime.status === 415, `got ${badMime.status}`);
  }

  section("Обложка, сортировка, удаление, filesystem");
  {
    const setCover = await api("PATCH", `/api/products/${productId}/media/${photoIds[2]}`, { token: owner, body: { action: "set-cover" } });
    assert("set-cover владельцем → 200", setCover.status === 200 && setCover.json?.is_cover === true, `got ${setCover.status}`);

    const list = await api("GET", `/api/products/${productId}/media`, { token: owner });
    const photoOrder = (list.json?.photos ?? []).map((p) => p.id);
    assert("обложка первая в списке", photoOrder[0] === photoIds[2], JSON.stringify(photoOrder.slice(0, 3)));
    assert("counts.photos = 10 (1 approved, 8 pending, 1 rejected)", JSON.stringify(list.json?.counts?.photos) === JSON.stringify({ pending: 8, approved: 1, rejected: 1 }), JSON.stringify(list.json?.counts?.photos));
    assert("counts.videos = 3 pending", JSON.stringify(list.json?.counts?.videos) === JSON.stringify({ pending: 3, approved: 0, rejected: 0 }), JSON.stringify(list.json?.counts?.videos));

    const reorder = await api("POST", `/api/products/${productId}/media/reorder`, {
      token: owner,
      body: { photos: [photoIds[2], photoIds[0], ...photoIds.slice(3)] },
    });
    assert("reorder → 200", reorder.status === 200, `got ${reorder.status}`);

    // Удаление: файл должен исчезнуть с диска
    const list2 = await api("GET", `/api/products/${productId}/media`, { token: owner });
    const victim = (list2.json?.videos ?? [])[0];
    const root = createdProducts[0].storageRoot || "storage";
    const victimRel = String(victim.storage_path || "").replace(`products/${productId}/`, "");
    const victimAbs = `${root}/products/${productId}/${victimRel}`;
    const { existsSync } = await import("node:fs");
    assert("файл удаляемого видео существует на диске", existsSync(victimAbs), victimAbs);
    const del = await api("DELETE", `/api/products/${productId}/media/${victim.id}`, { token: owner });
    assert("DELETE видео владельцем → 200", del.status === 200, `got ${del.status} ${JSON.stringify(del.json).slice(0, 120)}`);
    assert("файл удалён с диска", !existsSync(victimAbs), victimAbs);
    const afterDel = await api("GET", `/api/products/${productId}/media`, { token: owner });
    assert("после удаления videos = 2 (слот освободился)", afterDel.json?.counts?.videos?.pending === 2, JSON.stringify(afterDel.json?.counts?.videos));

    // Очередь модерации (админский список)
    const queue = await api("GET", `/api/admin/product-media?status=pending&limit=100`, { token: admin });
    assert("админская очередь pending → 200 и содержит наш товар", queue.status === 200 && (queue.json?.items ?? []).some((i) => i.product_id === productId), `got ${queue.status}, items=${(queue.json?.items ?? []).length}`);
    const queueCustomer = await api("GET", `/api/admin/product-media`, { token: customer });
    assert("очередь недоступна покупателю → 403", queueCustomer.status === 403, `got ${queueCustomer.status}`);
  }

  section("Итог");
  console.log(`\n  ИТОГО: PASS ${passed}  FAIL ${failed}`);
  if (failed > 0) {
    console.log("  Проваленные проверки:");
    for (const f of failures) console.log(`   - ${f}`);
  }
  return failed === 0;
}

async function cleanup() {
  // Тестовые товары: строки БД (product_media каскадом) + файлы с диска
  try {
    const ids = createdProducts.map((p) => p.id).filter(Boolean);
    if (ids.length > 0) {
      await client.query(`DELETE FROM products WHERE id = ANY($1)`, [ids]);
      const { rmSync } = await import("node:fs");
      for (const id of ids) {
        try {
          rmSync(`storage/products/${id}`, { recursive: true, force: true });
          rmSync(`${createdProducts[0]?.storageRoot || "storage"}/products/${id}`, { recursive: true, force: true });
        } catch {
          /* noop */
        }
      }
      console.log(`\n  cleanup: удалено тестовых товаров: ${ids.length}`);
    }
  } catch (err) {
    console.log(`\n  cleanup warning: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

let ok = false;
main()
  .then((result) => {
    ok = result === true;
  })
  .catch((err) => {
    console.error(`\n✖ FATAL: ${err.message}`);
    ok = false;
  })
  .finally(async () => {
    await cleanup();
    process.exit(ok ? 0 : 1);
  });
