/**
 * Z-v14 (hardened): адресная очистка изолированных тестовых фикстур ZV14-*.
 *
 * Гарантии (Z-v14 §4):
 *   1. DRY-RUN по умолчанию: только SELECT, отчёт о количестве и идентификаторах
 *      затрагиваемых строк. Реальное удаление — только с флагом --apply.
 *   2. Удаляются ТОЛЬКО записи, однозначно связанные с фикстурами:
 *      заказы — по номеру 'ZV14-%' + проверка владельцев; уведомления — по
 *      metadata->>'orderId' (точное совпадение UUID фикстурных заказов), а не
 *      по тексту; сироты — ORDER_CONFIRMED + metadata.type='order_confirmed'
 *      + номер ZV14- в заголовке + заказ отсутствует.
 *   3. Все условия квалифицированы (однотабличные DELETE / коррелированные
 *      подзапросы с явными алиасами) — неоднозначности колонок нет.
 *   4. Обычные/demo-данные не попадают под предикаты: номера заказов системы
 *      генерируются в формате UK-YYYY-NNNNNN / DEMO-*; защитные проверки
 *      владельцев прерывают выполнение при любом неожиданном пересечении.
 *   5. Транзакция: все удаления в одном BEGIN ... COMMIT/ROLLBACK — при
 *      частичном отказе откатывается всё.
 *   6. Повторный запуск безопасен: те же предикаты на очищенной базе дают 0 строк.
 *   7. При неоднозначности (владелец вне демо-пользователей, аномальное
 *      количество) скрипт ОТКАЗЫВАЕТСЯ от удаления (exit 2), что бы ни было.
 *
 * Использование:
 *   node scripts/zv14-cleanup.mjs           # dry-run: показать план удаления
 *   node scripts/zv14-cleanup.mjs --apply   # выполнить удаление в транзакции
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");

// Демо-пользователи, от лица которых создаёт фикстуры scripts/zv14-fixtures.mjs
const FIXTURE_USERS = [
  "11111111-1111-4111-8111-111111111101", // confectioner@demo.ru (con0)
  "11111111-1111-4111-8111-111111111102", // c1 (кондитер чужих заказов)
  "11111111-1111-4111-8111-111111111106", // customer@demo.ru
];

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();

const c = new Client({ connectionString: url });
await c.connect();

await c.query("BEGIN");
try {
  // ---- Шаг 0. Инвентаризация (только SELECT) --------------------------------
  const ord = await c.query(
    `SELECT o.id::text, o.number, o.user_id::text, o.confectioner_id::text
     FROM orders o WHERE o.number LIKE 'ZV14-%' ORDER BY o.number`
  );
  const ids = ord.rows.map((r) => r.id);

  const notifById = ids.length
    ? await c.query(
        `SELECT n.id::text, n.user_id::text, n.title
         FROM notifications n
         WHERE n.metadata->>'orderId' = ANY($1::text[])`,
        [ids]
      )
    : { rows: [] };

  // Сироты: событие уже не имеет заказа-владельца. Строгий предикат:
  //   тип шаблона + тип события в metadata + номер фикстуры в заголовке
  //   + заказ отсутствует в БД. Совпадение по одному лишь тексту недостаточно.
  const notifOrphan = await c.query(
    `SELECT n.id::text, n.user_id::text, n.title
     FROM notifications n
     WHERE n.type = 'ORDER_CONFIRMED'
       AND n.metadata->>'type' = 'order_confirmed'
       AND n.title LIKE '%ZV14-%'
       AND NOT EXISTS (
         SELECT 1 FROM orders o2 WHERE o2.id::text = n.metadata->>'orderId'
       )`
  );

  const inv = await c.query(
    `SELECT i.id::text, i.name, i.owner_id::text
     FROM inventory_items i WHERE i.name LIKE 'ZV14_%'`
  );
  const rec = await c.query(
    `SELECT r.id::text, r.slug, r.author_id::text
     FROM recipes r WHERE r.slug LIKE 'zv14-recipe-%'`
  );
  const prod = await c.query(
    `SELECT p.id::text, p.slug, p.confectioner_id::text
     FROM products p WHERE p.slug LIKE 'zv14-product-%'`
  );

  // ---- Шаг 1. Проверка однозначности (refuse on ambiguity) -------------------
  const problems = [];
  for (const o of ord.rows) {
    if (!FIXTURE_USERS.includes(o.user_id) || !FIXTURE_USERS.includes(o.confectioner_id)) {
      problems.push(`order ${o.number} (${o.id}): user/confectioner вне фикстурных пользователей`);
    }
  }
  for (const i of inv.rows) {
    if (!FIXTURE_USERS.includes(i.owner_id)) {
      problems.push(`inventory ${i.name} (${i.id}): owner вне фикстурных пользователей`);
    }
  }
  for (const r of rec.rows) {
    if (!FIXTURE_USERS.includes(r.author_id)) {
      problems.push(`recipe ${r.slug} (${r.id}): author вне фикстурных пользователей`);
    }
  }
  for (const p of prod.rows) {
    if (!FIXTURE_USERS.includes(p.confectioner_id)) {
      problems.push(`product ${p.slug} (${p.id}): confectioner вне фикстурных пользователей`);
    }
  }
  // Здравый смысл: фикстуры создают 12 заказов; большее количество — аномалия.
  if (ord.rows.length > 12) {
    problems.push(`под префикс ZV14- попало ${ord.rows.length} заказов (> 12) — отказ`);
  }

  const plan = {
    orders: ord.rows.map((r) => `${r.number}:${r.id.slice(0, 8)}`),
    notifications_by_orderId: notifById.rows.map((r) => r.id),
    notifications_orphan: notifOrphan.rows.map((r) => r.id),
    inventory_items: inv.rows.map((r) => r.id.slice(0, 8)),
    recipes: rec.rows.map((r) => r.slug),
    products: prod.rows.map((r) => r.slug),
  };
  console.log(`ZV14 cleanup — режим: ${APPLY ? "APPLY (удаление)" : "DRY-RUN (только SELECT)"}`);
  console.log("План удаления:", JSON.stringify(plan, null, 1));

  if (problems.length > 0) {
    console.error("ОТКАЗ — неоднозначные записи под предикатами фикстур:");
    for (const p of problems) console.error("  • " + p);
    await c.query("ROLLBACK");
    await c.end();
    process.exit(2);
  }

  if (!APPLY) {
    await c.query("ROLLBACK");
    console.log("DRY-RUN завершён — ничего не удалено. Для удаления: --apply");
    await c.end();
    process.exit(0);
  }

  // ---- Шаг 2. Удаление (в той же транзакции) ---------------------------------
  const deleted = {};
  if (ids.length > 0) {
    const notif = await c.query(
      `DELETE FROM notifications n WHERE n.metadata->>'orderId' = ANY($1::text[]) RETURNING n.id`,
      [ids]
    );
    const hist = await c.query(
      `DELETE FROM order_status_history h WHERE h.order_id = ANY($1::uuid[]) RETURNING h.id`,
      [ids]
    );
    const items = await c.query(
      `DELETE FROM order_items oi WHERE oi.order_id = ANY($1::uuid[]) RETURNING oi.id`,
      [ids]
    );
    deleted.notifications = notif.rowCount;
    deleted.history = hist.rowCount;
    deleted.order_items = items.rowCount;
  }

  const o = await c.query(`DELETE FROM orders WHERE number LIKE 'ZV14-%' RETURNING number`);
  const invD = await c.query(
    `DELETE FROM inventory_items i WHERE i.name LIKE 'ZV14_%' RETURNING i.id`
  );
  const ing = await c.query(
    `DELETE FROM recipe_ingredients ri
     WHERE ri.recipe_id IN (SELECT r.id FROM recipes r WHERE r.slug LIKE 'zv14-recipe-%')
     RETURNING ri.id`
  );
  const recD = await c.query(
    `DELETE FROM recipes r WHERE r.slug LIKE 'zv14-recipe-%' RETURNING r.id`
  );
  const prodD = await c.query(
    `DELETE FROM products p WHERE p.slug LIKE 'zv14-product-%' RETURNING p.id`
  );
  // Сироты — строгий предикат из шага 0 (тот же текст запроса)
  const orphan = await c.query(
    `DELETE FROM notifications n
     WHERE n.type = 'ORDER_CONFIRMED'
       AND n.metadata->>'type' = 'order_confirmed'
       AND n.title LIKE '%ZV14-%'
       AND NOT EXISTS (
         SELECT 1 FROM orders o2 WHERE o2.id::text = n.metadata->>'orderId'
       )
     RETURNING n.id`
  );

  deleted.orders = o.rowCount;
  deleted.inventory_items = invD.rowCount;
  deleted.recipe_ingredients = ing.rowCount;
  deleted.recipes = recD.rowCount;
  deleted.products = prodD.rowCount;
  deleted.orphan_notifications = orphan.rowCount;

  await c.query("COMMIT");
  console.log("ZV14 cleanup (committed):", JSON.stringify(deleted));
} catch (err) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("ZV14 cleanup FAILED — транзакция откатена:", err.message);
  await c.end();
  process.exit(1);
}
await c.end();
