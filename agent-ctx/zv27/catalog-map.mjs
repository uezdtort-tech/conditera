/**
 * Z-v27 Этап 8 — карта готовности каталога: все 12 published-товаров через
 * РЕАЛЬНЫЙ acceptance-gate (read-only к рабочей БД; фикстуры не создаются).
 */
import { Client } from "pg";
process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/conditera";

const { loadProductItemsData, checkAcceptance } = await import("@/lib/ops/acceptance");

const pool = new Client({ connectionString: process.env.DATABASE_URL });
await pool.connect();

const DAY3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const prods = await pool.query(
  `SELECT p.id::text, p.title, p.price, p.recipe_id::text AS recipe_id, p.production_time_hours,
          p.confectioner_id::text AS conf_id, c."businessName" AS conf_name
   FROM public.products p
   LEFT JOIN public.confectioners c ON c."userId"::uuid = p.confectioner_id
   WHERE p.status='published' AND p.deleted_at IS NULL ORDER BY p.id`);

console.log(`CATALOG READINESS (gate on delivery ${DAY3})\n`);
const rows = [];
for (const p of prods.rows) {
  const items = await loadProductItemsData([{ productId: p.id, quantity: 1 }]);
  const r = await checkAcceptance({ items, assignedConfectionerId: p.conf_id, deliveryDate: DAY3, deliveryTimeWindow: null, deliveryTime: null });
  const codes = r.reasons.map(x => x.code);
  const blocking = codes.filter(c => ["CAPACITY_EXCEEDED","PURCHASE_ETA_AFTER_DEADLINE","PURCHASE_ETA_MISSING","DEADLINE_TOO_CLOSE","LOW_STOCK","RECIPE_MISSING","INVENTORY_UNIT_MISMATCH"].includes(c));
  const shortages = r.owners.flatMap(o => o.inventory.shortages).map(s => `${s.name}(−${s.shortage}${s.unit})`);
  rows.push({ n: rows.length + 1, title: p.title, price: p.price, recipe: p.recipe_id ? "✓" : "—", hours: p.production_time_hours, conf: p.conf_name, canAccept: r.canAccept, blocking, shortages });
}
for (const x of rows) {
  console.log(`#${x.n} «${x.title}» ${x.price}₽ | рецепт:${x.recipe} время:${x.hours ?? "—"} | ${x.conf} | canAccept=${x.canAccept} | blocking=[${x.blocking.join(",")}] | дефицит=[${x.shortages.join(", ")}]`);
}
const summary = {};
for (const x of rows) {
  const key = x.canAccept ? "GATE-PASS" : (x.blocking.join("+"));
  summary[key] = (summary[key] ?? 0) + 1;
}
console.log("\nSUMMARY:", JSON.stringify(summary, null, 0));
await pool.end();
console.log("DONE (read-only)");
