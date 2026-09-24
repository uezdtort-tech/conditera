/**
 * Скриншоты ключевых экранов для отчёта (правило проекта: скриншоты после каждого этапа).
 * Запуск: node scripts/e2e-screenshots.mjs [BASE_URL]
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = join(process.cwd(), "download", "screenshots");
mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["home", "/"],
  ["catalog", "/catalog"],
  ["confectioners", "/confectioners"],
  ["recipes", "/recipes"],
  ["faq", "/faq"],
  ["sitemap", "/sitemap.xml"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const [name, path] of PAGES) {
  try {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `preview-${name}.png`), fullPage: false });
    console.log(`OK: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name} — ${e.message.split("\n")[0]}`);
  }
}

await browser.close();
console.log(`Screenshots: ${OUT}`);
