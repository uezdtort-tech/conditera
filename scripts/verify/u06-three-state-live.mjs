#!/usr/bin/env node
/**
 * u06-three-state-live.mjs — U-06 (v4.3 DEV-01) live three-state verification.
 *
 * На ЖИВОМ dev-стеке (:3000) и реальном продукте
 * aaaaaaaa-0000-4000-8000-000000000002 «Домашний „Наполеон"»:
 *   State A — нет разреза: секции «Срезы торта по начинкам» нет, главное фото
 *             в DOM и реально загружено (naturalWidth>0);
 *   State B — один разрез: секция есть, <img alt="[TEMP-U06] …"> реально загружен;
 *   State C — несколько разрезов: 2 фото срезов в DOM, API /slices — sortOrder asc.
 *
 * УСТОЙЧИВОСТЬ: песочница периодически убивает next dev — перед каждым шагом
 * ensureServer() (идемпотентный ensure-dev.sh + poll), при сбое визита — повтор.
 *
 * ПРАВИЛА КОНТЕНТА (v4.3 DEV-01): temp-строки помечены [TEMP-U06]; image —
 * РЕАЛЬНЫЙ ассет репо (проверяется на диске), НЕ фиктивный URL и НЕ
 * production-контент; cleanup восстанавливает БД байт-в-байт (fillings='[]',
 * product_slices=0). Скрипт НЕ создаёт фотографии разрезов.
 *
 * Запуск: node scripts/verify/u06-three-state-live.mjs
 */
import { Client } from "pg";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = "/home/z/my-project";
const PG = "postgresql://postgres@127.0.0.1:54329/conditera";
const BASE = "http://127.0.0.1:3000";
const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-000000000002";
const PRODUCT_PAGE = `${BASE}/product?id=${PRODUCT_ID}`;
const EV_DIR = path.join(ROOT, "docs/evidence/u06-v43");

const FILLING_1 = "[TEMP-U06] Ванильный крем (проверка)";
const FILLING_2 = "[TEMP-U06] Шоколадный ганаш (проверка)";
const IMG_1 = "/uploads/products/svadebnyy-tort-yagodnyy-barhat.png";
const IMG_2 = "/uploads/products/bento-tort-nezhnyy.png";
const TEMP_SLICE_IDS = ["temp-u06-0002-1", "temp-u06-0002-2"];
const TEMP_MARKER = "[TEMP-U06]";

const results = [];
function log(line) { console.log(`U06-THREESTATE: ${line}`); }
function assert(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
}

async function healthOnce() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(6000) });
    return r.status;
  } catch { return 0; }
}

async function ensureServer(maxMs = 120_000) {
  if ((await healthOnce()) === 200) return log("server up (health 200)");
  // Prod-бандл ПЕРВЫМ: .next собран на 12c8815, после билда менялись только
  // vitest-файлы и docs (git diff 12c8815..HEAD -- src/ = 2 тестовых файла) →
  // бандл валиден для HEAD; prod-сервер отдаёт маршруты мгновенно, без
  // dev-перекомпиляции, и укладывается в короткое окно жизни процесса.
  log("server down — direct spawn `bun run start` (prod bundle)…");
  const direct = spawn("bun", ["run", "start"], { cwd: ROOT, detached: true, stdio: "ignore" });
  direct.unref();
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    if ((await healthOnce()) === 200) return log("server up (health 200, prod bundle)");
  }
  // Fallback: dev-сервер (медленнее — перекомпиляция маршрутов)
  log("prod spawn не поднял сервер — fallback `bun run dev:local`…");
  const dev = spawn("bun", ["run", "dev:local"], { cwd: ROOT, detached: true, stdio: "ignore" });
  dev.unref();
  const deadline2 = Date.now() + 90_000;
  while (Date.now() < deadline2) {
    await new Promise((r) => setTimeout(r, 5000));
    if ((await healthOnce()) === 200) return log("server up (health 200, dev)");
  }
  throw new Error("server did not come up");
}

async function withServer(fn, label) {
  if ((await healthOnce()) !== 200) await ensureServer();
  try { return await fn(); }
  catch (e) {
    log(`${label}: first attempt failed (${String(e.message).slice(0, 90)}) — re-ensure and retry once`);
    await ensureServer();
    return await fn();
  }
}

async function launchBrowser() {
  for (let i = 1; i <= 3; i++) {
    try {
      const b = await chromium.launch();
      log(`chromium launched (attempt ${i})`);
      return b;
    } catch (e) {
      log(`chromium launch attempt ${i} failed: ${String(e.message).slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw new Error("chromium failed to launch after 3 attempts");
}

const domProbe = () => JSON.stringify((() => {
  const h3 = [...document.querySelectorAll("h3")];
  const section = h3.filter((h) => (h.textContent || "").includes("Срезы торта по начинкам"));
  const imgs = [...document.querySelectorAll("img")];
  const main = imgs.find((i) => (i.getAttribute("src") || "").includes("tort-napoleon-domashniy"));
  const slices = imgs
    .filter((i) => (i.getAttribute("alt") || "").includes("[TEMP-U06]"))
    .map((i) => ({ alt: i.getAttribute("alt"), src: i.getAttribute("src"), loaded: i.naturalWidth > 0 }));
  return {
    sections: section.length, mainFound: !!main,
    mainLoaded: main ? main.naturalWidth > 0 : false,
    slices, bodyLen: document.body?.innerText?.length ?? 0,
  };
})());

async function pgClient() { const c = new Client({ connectionString: PG }); await c.connect(); return c; }

async function dbState(client) {
  const q = await client.query(`SELECT fillings::text AS f FROM products WHERE id=$1`, [PRODUCT_ID]);
  const n = await client.query(`SELECT count(*)::int AS n FROM product_slices WHERE "productId"=$1`, [PRODUCT_ID]);
  const t = await client.query(`SELECT count(*)::int AS n FROM product_slices`);
  return { fillings: q.rows[0]?.f ?? null, slices: n.rows[0].n, slicesTotal: t.rows[0].n };
}

async function cleanup(client, { verify = true } = {}) {
  await client.query(`DELETE FROM product_slices WHERE id = ANY($1)`, [TEMP_SLICE_IDS]);
  await client.query(`UPDATE products SET fillings='[]'::jsonb WHERE id=$1`, [PRODUCT_ID]);
  if (verify) {
    const st = await dbState(client);
    assert("cleanup: fillings restored to []", st.fillings === "[]", `fillings=${st.fillings}`);
    assert("cleanup: product_slices back to 0 (product & total)",
      st.slices === 0 && st.slicesTotal === 0, `product=${st.slices} total=${st.slicesTotal}`);
  }
}

async function apiCard() {
  const r = await fetch(`${BASE}/api/products/${PRODUCT_ID}`, { signal: AbortSignal.timeout(25_000) });
  const j = await r.json();
  return { status: r.status, fillings: j?.product?.fillings ?? null, images: j?.product?.images ?? null };
}
async function apiSlices() {
  const r = await fetch(`${BASE}/api/products/${PRODUCT_ID}/slices`, { signal: AbortSignal.timeout(25_000) });
  return (await r.json())?.slices ?? [];
}

async function main() {
  mkdirSync(EV_DIR, { recursive: true });
  log(`start ${new Date().toISOString()} (candidate tree 7dcc09d)`);
  await ensureServer();

  const client = await pgClient();
  let browser = null, page = null;
  try {
    const orig = await dbState(client);
    log(`pre state: fillings=${orig.fillings} slices(product)=${orig.slices} slices(total)=${orig.slicesTotal}`);
    if (orig.slices > 0 || orig.fillings !== "[]") {
      log("leftover temp data — safety cleanup first");
      await cleanup(client, { verify: false });
    }
    assert("asset exists: IMG_1 (real repo file)", existsSync(path.join(ROOT, "public", IMG_1)), IMG_1);
    assert("asset exists: IMG_2 (real repo file)", existsSync(path.join(ROOT, "public", IMG_2)), IMG_2);

    browser = await launchBrowser();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // Ждём ИМЕННО финальное DOM-состояние (поллинг probe) — без гонок с перерендером
    async function visitUntil(pred, label, attempts = 3) {
      for (let i = 1; i <= attempts; i++) {
        try {
          await page.goto(PRODUCT_PAGE, { waitUntil: "domcontentloaded", timeout: 45_000 });
          const deadline = Date.now() + 35_000;
          while (Date.now() < deadline) {
            const dom = JSON.parse(await page.evaluate(domProbe));
            if (pred(dom)) return dom;
            await page.waitForTimeout(700);
          }
          log(`${label}: condition not met in 35s (attempt ${i})`);
        } catch (e) {
          log(`${label}: visit error (attempt ${i}): ${String(e.message).slice(0, 100)}`);
          await ensureServer();
        }
      }
      throw new Error(`${label}: DOM condition not met after ${attempts} attempts`);
    }

    // ===== State A: нет разреза =====
    await withServer(async () => {
      const apiA = await apiCard();
      assert("A: API card fillings empty", Array.isArray(apiA.fillings) && apiA.fillings.length === 0,
        JSON.stringify(apiA.fillings));
    }, "A-api");
    const domA = await visitUntil((d) => d.mainFound && d.mainLoaded && d.sections === 0, "A-dom");
    assert("A: DOM no slice section", domA.sections === 0, `sections=${domA.sections}`);
    assert("A: DOM main photo present+loaded", domA.mainFound && domA.mainLoaded, "");
    await page.screenshot({ path: path.join(EV_DIR, "stateA-no-slices.png"), fullPage: true });
    log("screenshot: stateA-no-slices.png");

    // ===== State B: один разрез =====
    await withServer(async () => {
      await client.query(`UPDATE products SET fillings=$1::jsonb WHERE id=$2`,
        [JSON.stringify([{ name: FILLING_1, priceModifier: 0 }]), PRODUCT_ID]);
      await client.query(
        `INSERT INTO product_slices (id,"productId","fillingName",image,caption,"sortOrder","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,0,now(),now())
         ON CONFLICT (id) DO UPDATE SET "fillingName"=EXCLUDED."fillingName", image=EXCLUDED.image,
           caption=EXCLUDED.caption, "sortOrder"=EXCLUDED."sortOrder"`,
        [TEMP_SLICE_IDS[0], PRODUCT_ID, FILLING_1, IMG_1,
         `${TEMP_MARKER} временная строка механики v4.3 — НЕ production-контент`]);
      const apiB = await apiCard();
      const sB = await apiSlices();
      assert("B: API card 1 filling", (apiB.fillings || []).length === 1, JSON.stringify(apiB.fillings));
      assert("B: API card main image intact",
        JSON.stringify(apiB.images || []).includes("tort-napoleon-domashniy"), JSON.stringify(apiB.images));
      assert("B: GET /slices = 1 slice with IMG_1",
        sB.length === 1 && sB[0].image === IMG_1 && sB[0].fillingName === FILLING_1, JSON.stringify(sB));
    }, "B-api");
    const domB = await visitUntil((d) => d.sections === 1 && d.slices.length === 1 &&
      d.slices[0].loaded && d.slices[0].alt === FILLING_1, "B-dom");
    assert("B: DOM slice section present", domB.sections === 1, `sections=${domB.sections}`);
    assert("B: DOM one slice img loaded", domB.slices.length === 1 && domB.slices[0].loaded,
      JSON.stringify(domB.slices));
    assert("B: DOM slice alt === fillingName", domB.slices[0]?.alt === FILLING_1, `alt=${domB.slices[0]?.alt}`);
    assert("B: DOM main photo still present", domB.mainFound && domB.mainLoaded, "");
    await page.screenshot({ path: path.join(EV_DIR, "stateB-one-slice.png"), fullPage: true });
    log("screenshot: stateB-one-slice.png");

    // ===== State C: несколько разрезов =====
    await withServer(async () => {
      await client.query(`UPDATE products SET fillings=$1::jsonb WHERE id=$2`,
        [JSON.stringify([{ name: FILLING_1, priceModifier: 0 },
                         { name: FILLING_2, priceModifier: 300 }]), PRODUCT_ID]);
      await client.query(
        `INSERT INTO product_slices (id,"productId","fillingName",image,caption,"sortOrder","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,1,now(),now())
         ON CONFLICT (id) DO UPDATE SET "fillingName"=EXCLUDED."fillingName", image=EXCLUDED.image,
           caption=EXCLUDED.caption, "sortOrder"=EXCLUDED."sortOrder"`,
        [TEMP_SLICE_IDS[1], PRODUCT_ID, FILLING_2, IMG_2,
         `${TEMP_MARKER} временная строка механики v4.3 — НЕ production-контент`]);
      const sC = await apiSlices();
      assert("C: GET /slices = 2 slices ordered by sortOrder asc",
        sC.length === 2 && sC[0].sortOrder === 0 && sC[1].sortOrder === 1 &&
        sC[0].image === IMG_1 && sC[1].image === IMG_2, JSON.stringify(sC));
      const apiC = await apiCard();
      assert("C: API card 2 fillings", (apiC.fillings || []).length === 2, JSON.stringify(apiC.fillings));
    }, "C-api");
    const domC = await visitUntil((d) => d.sections === 1 && d.slices.length === 2 &&
      d.slices.every((s) => s.loaded), "C-dom");
    assert("C: DOM slice section present", domC.sections === 1, `sections=${domC.sections}`);
    assert("C: DOM two slice imgs loaded", domC.slices.length === 2 && domC.slices.every((s) => s.loaded),
      JSON.stringify(domC.slices));
    assert("C: DOM slice alts = both fillings in order",
      domC.slices[0]?.alt === FILLING_1 && domC.slices[1]?.alt === FILLING_2,
      JSON.stringify(domC.slices.map((s) => s.alt)));
    await page.screenshot({ path: path.join(EV_DIR, "stateC-two-slices.png"), fullPage: true });
    log("screenshot: stateC-two-slices.png");

    // ===== Cleanup + пост-верификация =====
    await cleanup(client, { verify: true });
    await withServer(async () => {
      const apiAfter = await apiCard();
      const sAfter = await apiSlices();
      assert("post: API card fillings empty again",
        Array.isArray(apiAfter.fillings) && apiAfter.fillings.length === 0, JSON.stringify(apiAfter.fillings));
      assert("post: GET /slices empty again", sAfter.length === 0, JSON.stringify(sAfter));
    }, "post-api");
  } finally {
    try { await page?.close(); } catch {}
    try { await browser?.close(); } catch {}
    try { await client.end(); } catch {}
  }

  const failed = results.filter((r) => !r.pass);
  log(`SUMMARY pass=${results.length - failed.length}/${results.length} fail=${failed.length}`);
  if (failed.length) { console.log(JSON.stringify(failed, null, 2)); process.exit(1); }
  log("VERDICT: mechanics three-state PASS (real content still ABSENT — owner checklist stands)");
}

main().catch((e) => { console.error("U06-THREESTATE: FATAL", e); process.exit(2); });
