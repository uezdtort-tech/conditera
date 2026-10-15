/**
 * inventory-concurrency-verify.mjs — приёмочный верификатор U-11 (приёмка TZ v4.0 §10).
 *
 * ЧТО ПРОВЕРЯЕТ: атомарность списания склада под конкуренцией.
 * Приложение списывает остатки ТОЛЬКО через RPC public.apply_inventory_movement_atomic
 * (миграция 0048): SELECT … FOR UPDATE → guard «OUT не ниже 0» → UPDATE → INSERT журнала.
 * Этот скрипт вызывает ТОТ ЖЕ RPC (не переimplements логику) N=8 параллельными
 * соединениями против одной позиции с остатком 5 и шагом списания 1.
 *
 * ОЖИДАНИЕ (race-safe контракт 0048):
 *   - ровно 5 успешных движений (ok=true), 3 отказа code='insufficient';
 *   - финальный остаток quantity = 0, отрицательных значений нет;
 *   - журнал inventory_movements содержит ровно 5 строк (только успешные);
 *   - сумма списаний в журнале = 5 (нет lost update).
 *
 * ГИГИЕНА: тестовая позиция помечена синтетическим именем (acc-u11) и причиной
 * движения 'acc-u11-acceptance-synthetic'; владелец — существующий demo-профиль
 * (FK-safe). Удаление позиций/движений — в finally, при любом исходе.
 *
 * Запуск: bun scripts/verify/inventory-concurrency-verify.mjs   (exit 0 = PASS)
 *         [env: ACC_DATABASE_URL — по умолчанию из .env.local, PG 127.0.0.1:54329]
 */
import fs from "node:fs";
import path from "node:path";
import pgPkg from "pg";

const { Client, Pool } = pgPkg.default || pgPkg;

const N_WORKERS = 8;
const INITIAL_QTY = 5;
const STEP = 1;
const REASON = "acc-u11-acceptance-synthetic";

function resolveDbUrl() {
  if (process.env.ACC_DATABASE_URL) return process.env.ACC_DATABASE_URL;
  const envPath = path.join(process.cwd(), ".env.local");
  const env = fs.readFileSync(envPath, "utf8");
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL не найден в .env.local (или задайте ACC_DATABASE_URL)");
  return m[1].trim().replace(/^"|"$/g, "");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const dbUrl = resolveDbUrl();
  const setup = new Client({ connectionString: dbUrl });
  await setup.connect();

  let itemId = null;
  try {
    // 1. Синтетическая позиция (FK-safe: владелец — существующий demo-кондитер)
    const owner = await setup.query(
      `SELECT id::text FROM profiles WHERE email = 'confectioner@demo.ru' LIMIT 1`
    );
    if (!owner.rows[0]) throw new Error("demo-профиль confectioner@demo.ru не найден");
    const ownerId = owner.rows[0].id;
    const itemName = `ACC-U11 concurrency synthetic ${Date.now().toString(36)}`;
    const ins = await setup.query(
      `INSERT INTO inventory_items (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, is_active)
       VALUES ($1::uuid, $2, 'acceptance', $3::numeric, 'кг', 0, 0, true) RETURNING id::text`,
      [ownerId, itemName, INITIAL_QTY]
    );
    itemId = ins.rows[0].id;
    console.log(`fixture: inventory_items id=${itemId} name="${itemName}" qty=${INITIAL_QTY} (synthetic, удалится в finally)`);

    // 2. RPC существует? (миграция 0048 применена) — fail-closed как в src/lib/inventory.ts
    const rpcCheck = await setup.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'apply_inventory_movement_atomic'`
    );
    check("RPC apply_inventory_movement_atomic существует (0048)", rpcCheck.rowCount === 1);

    // 3. N параллельных OUT через Pool (реальная конкуренция соединений)
    const pool = new Pool({ connectionString: dbUrl, max: N_WORKERS });
    const jobs = Array.from({ length: N_WORKERS }, (_, i) =>
      pool
        .query(`SELECT * FROM public.apply_inventory_movement_atomic($1::uuid, 'OUT', $2::numeric, $3::uuid, $4, NULL)`, [
          itemId,
          STEP,
          ownerId,
          REASON,
        ])
        .then((r) => ({ worker: i, ok: r.rows[0]?.ok, code: r.rows[0]?.code, newQty: r.rows[0]?.new_qty }))
        .catch((e) => ({ worker: i, ok: false, code: `client_error:${e.message}` }))
    );
    const outcomes = await Promise.all(jobs);
    await pool.end();

    const applied = outcomes.filter((o) => o.ok === true);
    const rejected = outcomes.filter((o) => o.ok === false && o.code === "insufficient");
    const other = outcomes.filter((o) => o.ok === false && o.code !== "insufficient");

    check(`успешных списаний ровно ${INITIAL_QTY} (из ${N_WORKERS} параллельных)`, applied.length === INITIAL_QTY,
      `applied=${applied.length} codes=${outcomes.map((o) => o.code).join(",")}`);
    check(`отказов insufficient ровно ${N_WORKERS - INITIAL_QTY}`, rejected.length === N_WORKERS - INITIAL_QTY,
      `rejected=${rejected.length}`);
    check("нет ошибок клиента/сервера (все вызовы дошли до RPC)", other.length === 0,
      `other=${JSON.stringify(other)}`);

    // 4. Финальный остаток: 0, без отрицательных значений
    const item = await setup.query(`SELECT quantity FROM inventory_items WHERE id = $1::uuid`, [itemId]);
    const finalQty = Number(item.rows[0]?.quantity);
    check(`финальный остаток = 0 (получено ${finalQty})`, finalQty === 0);
    check("отрицательного остатка нет", finalQty >= 0);

    // 5. Журнал движений: только успешные, сумма сходится
    const journal = await setup.query(
      `SELECT count(*)::int n, COALESCE(sum(quantity), 0)::float s FROM inventory_movements WHERE item_id = $1::uuid AND reason = $2`,
      [itemId, REASON]
    );
    check(`журнал inventory_movements: ровно ${INITIAL_QTY} строк (отказы не журналируются)`, journal.rows[0].n === INITIAL_QTY,
      `rows=${journal.rows[0].n}`);
    check(`сумма списаний в журнале = ${INITIAL_QTY} (нет lost update)`, Number(journal.rows[0].s) === INITIAL_QTY,
      `sum=${journal.rows[0].s}`);
  } finally {
    // 6. Cleanup синтетических строк (движения → позиция), при любом исходе
    try {
      if (itemId) {
        const delM = await setup.query(`DELETE FROM inventory_movements WHERE item_id = $1::uuid AND reason = $2`, [itemId, REASON]);
        const delI = await setup.query(`DELETE FROM inventory_items WHERE id = $1::uuid AND name LIKE 'ACC-U11 %'`, [itemId]);
        console.log(`cleanup: inventory_movements deleted=${delM.rowCount}, inventory_items deleted=${delI.rowCount} (synthetic acc-u11)`);
      }
    } catch (e) {
      console.error(`cleanup error: ${e.message}`);
    } finally {
      await setup.end();
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log(`FAILED: ${failed.map((f) => f.name).join("; ")}`);
    process.exit(1);
  }
  console.log("U-11 VERDICT: PASS — атомарное списание выдерживает параллельную конкуренцию без отрицательных остатков и lost updates");
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e.message);
  process.exit(2);
});
