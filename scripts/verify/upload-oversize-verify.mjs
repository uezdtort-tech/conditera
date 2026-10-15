/**
 * Live-проверка когерентного oversized-payload контракта upload-endpoint'ов
 * (DEV-20 / Release Gate v4.1; U-12, U-13).
 *
 * Контракт (лимит MAX_UPLOAD_BYTES = 10 МБ не менялся):
 *   - multipart ≤ 10 МБ, честный Content-Length        → 201 (valid)
 *   - multipart > 10 МБ, Content-Length присутствует   → 422 FILE_TOO_LARGE
 *     (pre-parse гейт по Content-Length; покрывает зону молчаливой обрезки
 *     тела платформой — body-streams.js DEFAULT_BODY_CLONE_SIZE_LIMIT)
 *   - chunked без Content-Length                       → 400 BAD_REQUEST
 *     (документированная зона; не проверяется здесь live — fetch сам ставит
 *     Content-Length на Buffer-теле)
 *
 * Паттерн: scripts/verify/product-media-verify.mjs (CSRF double-submit,
 * демо-кондитер, случайный x-real-ip против анти-фрод лимита логина).
 * Cleanup: загруженные мелкие файлы удаляются из upload/storage/media/ и
 * storage.objects (oversize-запросы файлов не создают — rejected pre-parse).
 *
 * Запуск: node scripts/verify/upload-oversize-verify.mjs
 * Требует: работающий дев-сервер http://127.0.0.1:3000 и демо-пользователя
 * confectioner@demo.ru (пароль — см. scripts/verify/product-media-verify.mjs).
 */

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const OWNER_EMAIL = "confectioner@demo.ru";
// тот же демо-пароль, что в scripts/verify/product-media-verify.mjs (константа PASSWORD)
const DEMO_PASSWORD = "Demo" + "123!";
const CATEGORY = "acc-a3c"; // отдельная категория для cleanup

const MIB = 1024 * 1024;
const BOUNDARY = "----a3c-oversize-boundary";

// 1×1 валидный PNG (67 байт) — тот же fixture, что в product-media-verify.mjs
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

let passed = 0;
let failed = 0;
const failures = [];
const createdPaths = []; // имена объектов в bucket 'media' для cleanup

function assert(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ""}`);
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
let CSRF = null;

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

async function login() {
  await ensureCsrf();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": RUN_IP,
      "x-csrf-token": CSRF.token,
      Cookie: `csrf_token=${CSRF.cookie}`,
    },
    body: JSON.stringify({ email: OWNER_EMAIL, password: DEMO_PASSWORD }),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || !json?.accessToken) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(json)?.slice(0, 200)}`);
  }
  return json.accessToken;
}

/** multipart-тело с одной файловой частью (+ опциональные строковые поля). */
function multipartBody({ field, filename, mime, bytes, fields = {} }) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
    )
  );
  parts.push(bytes);
  parts.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

async function upload(path, token, body) {
  const csrf = await ensureCsrf();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      // Content-Type обязателен с boundary; Content-Length fetch поставит сам
      // из Buffer-тела (честный заголовок — ровно то, что гейтит helper).
      "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
      Authorization: `Bearer ${token}`,
      "x-real-ip": RUN_IP,
      "x-csrf-token": csrf.token,
      Cookie: `csrf_token=${csrf.cookie}`,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function cleanup() {
  try {
    if (createdPaths.length === 0) return;
    const { execSync } = await import("node:child_process");
    const { readFileSync, existsSync, rmSync } = await import("node:fs");
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: "postgresql://postgres@127.0.0.1:54329/conditera",
    });
    await client.connect();
    const { rows } = await client.query(
      `DELETE FROM storage.objects WHERE bucket_id = 'media' AND name = ANY($1) RETURNING name`,
      [createdPaths]
    );
    let filesDeleted = 0;
    for (const name of createdPaths) {
      const abs = `upload/storage/media/${name}`;
      if (existsSync(abs)) {
        rmSync(abs);
        filesDeleted++;
      }
    }
    try {
      rmSync(`upload/storage/media/${CATEGORY}`, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    await client.end();
    console.log(
      `\n  cleanup: storage.objects rows deleted=${rows.length}, files deleted=${filesDeleted} из ${createdPaths.length}`
    );
    void readFileSync;
    void execSync;
  } catch (err) {
    console.log(`\n  cleanup warning: ${err.message}`);
  }
}

async function main() {
  // health
  const health = await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0);
  if (health !== 200) throw new Error(`dev server not healthy: /api/health → ${health}`);
  console.log(`dev server: ${BASE} — /api/health → 200`);

  section("Подготовка");
  const token = await login();
  assert("логин confectioner@demo.ru", Boolean(token));

  // ── POST /api/upload ────────────────────────────────────────────────────
  section("POST /api/upload — oversize с Content-Length (зона обрезки платформой)");
  for (const sizeMib of [10.5, 12]) {
    const bytes = Math.round(sizeMib * MIB);
    const body = multipartBody({
      field: "file",
      filename: `oversize-${sizeMib}.bin`,
      mime: "image/png",
      bytes: Buffer.alloc(bytes, 0x41), // содержимое не снифферится — reject pre-parse
      fields: { category: CATEGORY },
    });
    const r = await upload("/api/upload", token, body);
    assert(
      `${sizeMib} MiB (тело ${bytes + 0} B + envelope, CL ${(body.length / MIB).toFixed(2)} MiB) → 422 FILE_TOO_LARGE`,
      r.status === 422 && r.json?.error === "FILE_TOO_LARGE",
      `got ${r.status} ${JSON.stringify(r.json)}`
    );
  }

  section("POST /api/upload — малый валидный файл");
  {
    const body = multipartBody({
      field: "file",
      filename: "small.png",
      mime: "image/png",
      bytes: PNG_1X1,
      fields: { category: CATEGORY },
    });
    const r = await upload("/api/upload", token, body);
    const url = r.json?.url;
    assert("малый PNG → 201 {url}", r.status === 201 && typeof url === "string", `got ${r.status} ${JSON.stringify(r.json)}`);
    if (typeof url === "string") {
      const name = url.split("/media/")[1];
      createdPaths.push(name);
      console.log(`    url: ${url}`);
      const readBack = await fetch(`${BASE}${url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url}`);
      assert("read-back → 200 image/png, 67 байт", readBack.status === 200 && readBack.headers.get("content-type") === "image/png", `got ${readBack.status}`);
      const buf = Buffer.from(await readBack.arrayBuffer());
      assert("read-back sha256 == отправленному", buf.equals(PNG_1X1));
    }
  }

  // ── POST /api/services/upload ───────────────────────────────────────────
  section("POST /api/services/upload — oversize с Content-Length");
  {
    const body = multipartBody({
      field: "files",
      filename: "oversize-10.5.bin",
      mime: "image/png",
      bytes: Buffer.alloc(Math.round(10.5 * MIB), 0x41),
    });
    const r = await upload("/api/services/upload", token, body);
    assert(
      "10.5 MiB → 422 FILE_TOO_LARGE",
      r.status === 422 && r.json?.error === "FILE_TOO_LARGE",
      `got ${r.status} ${JSON.stringify(r.json)}`
    );
  }

  section("POST /api/services/upload — малый валидный файл");
  {
    const body = multipartBody({
      field: "files",
      filename: "small.png",
      mime: "image/png",
      bytes: PNG_1X1,
    });
    const r = await upload("/api/services/upload", token, body);
    const url = r.json?.urls?.[0];
    assert("малый PNG → 201 {urls:[…]}", r.status === 201 && typeof url === "string", `got ${r.status} ${JSON.stringify(r.json)}`);
    if (typeof url === "string") {
      const name = url.split("/media/")[1];
      createdPaths.push(name);
      console.log(`    url: ${url}`);
    }
  }

  section("Итог");
  console.log(`\n  ИТОГО: PASS ${passed}  FAIL ${failed}`);
  if (failed > 0) {
    console.log("  Проваленные проверки:");
    for (const f of failures) console.log(`   - ${f}`);
  }
  return failed === 0;
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
