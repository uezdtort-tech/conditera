/**
 * Z-v27 Этап 3 — фактическая модель первого товара «Ягодный бархат».
 * Реальный код проекта (breakdown/acceptance), read-only к рабочей БД.
 */
import { Client } from "pg";
process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/conditera";

const { computeIngredientNeeds } = await import("@/lib/ops/breakdown");
const { loadProductItemsData, checkAcceptance } = await import("@/lib/ops/acceptance");
const { convertQty } = await import("@/lib/ops/units");

const pool = new Client({ connectionString: process.env.DATABASE_URL });
await pool.connect();
const CONF = "11111111-1111-4111-8111-111111111101";
const PRODUCT_MAIN = "aaaaaaaa-0000-4000-8000-000000000001";

// 1. Рецепт первого товара
const r = await pool.query(
  `SELECT r.id::text, r.title, r.prep_time_minutes, r.cook_time_minutes
   FROM public.products p JOIN public.recipes r ON r.id = p.recipe_id
   WHERE p.id = $1::uuid`, [PRODUCT_MAIN]);
console.log("RECIPE:", JSON.stringify(r.rows[0]));
const rid = r.rows[0].id;

const ri = await pool.query(
  `SELECT name, qty, unit, inventory_item_id::text FROM public.recipe_ingredients
   WHERE recipe_id=$1::uuid ORDER BY sort_order`, [rid]);
console.log("RECIPE_INGREDIENTS:");
for (const x of ri.rows) console.log(" ", JSON.stringify(x));

// 2. Склад владельца
const inv = await pool.query(
  `SELECT id::text, name, quantity, unit, is_active FROM public.inventory_items
   WHERE owner_id=$1::uuid ORDER BY name`, [CONF]);
console.log("\nINVENTORY (owner -0101):");
for (const x of inv.rows) console.log(" ", JSON.stringify(x));

// 3. Потребность на 1 торт (реальный код)
const needs = await computeIngredientNeeds(
  [{ recipe_id: rid, quantity: 1 }], CONF);
console.log("\nNEEDS (1 unit):");
for (const i of needs.ingredients)
  console.log(`  ${i.name}: required=${i.required} ${i.unit}, stock=${i.stock}, shortage=${i.shortage}, status=${i.status}, inv=${i.inventory_item_id}`);
console.log("can_produce:", needs.can_produce, "| shortages:", needs.shortages.map(s=>s.name).join(", "));

// 4. Потребность на 2 торта (проверка агрегации)
const needs2 = await computeIngredientNeeds(
  [{ recipe_id: rid, quantity: 2 }], CONF);
console.log("\nNEEDS (2 units): Ягоды required =", needs2.ingredients.find(i=>i.name==="Ягоды")?.required);

// 5. Гейт на ближайшую дату (read-only, now+3 days)
const DAY3 = new Date(Date.now() + 3*86400000).toISOString().slice(0,10);
const items = await loadProductItemsData([{ productId: PRODUCT_MAIN, quantity: 1 }]);
const gate = await checkAcceptance({ items, assignedConfectionerId: CONF, deliveryDate: DAY3, deliveryTimeWindow: null, deliveryTime: null });
console.log("\nGATE (delivery +3d): canAccept=", gate.canAccept, "availability=", gate.availability, "risk=", gate.risk);
console.log("reasons:", gate.reasons.map(x=>`${x.code}: ${x.message}`).join(" | "));
console.log("capacity checked:", gate.owners[0]?.capacity.checked, "fits:", gate.owners[0]?.capacity.fits);

// 6. Конверсия «дес» (Яйца)
console.log("\nCONVERT: 15 дес → шт =", convertQty(15, "дес", "шт"), "| 1 л → мл =", convertQty(1, "л", "мл"), "| 0.25 кг → г =", convertQty(0.25, "кг", "г"));

// 7. Закупки и ETA
const pd = await pool.query(`SELECT id::text, status, expected_eta FROM public.purchase_drafts WHERE owner_id=$1::uuid`, [CONF]);
console.log("\nPURCHASE_DRAFTS:", JSON.stringify(pd.rows));

await pool.end();
console.log("\nDONE (read-only)");
