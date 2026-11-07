/**
 * Z-v14 negative test: cleanup должен ОТКАЗАТЬСЯ от удаления, когда под
 * предикат фикстур попадает запись владельца вне фикстурного набора.
 * Создаёт ловушку (заказ ZV13-TRAP от admin@demo.ru), вызывает dry-run,
 * печатает exit code, удаляет ловушку.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const url = readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim();
const c = new Client({ connectionString: url });
await c.connect();

const admin = await c.query(`SELECT id::text FROM profiles WHERE email='admin@demo.ru'`);
const adminId = admin.rows[0].id;

const existing = await c.query(`SELECT id::text FROM orders WHERE number='ZV13-TRAP'`);
if (existing.rows.length === 0) {
  const trap = await c.query(
    `INSERT INTO orders (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total, status, payment_status)
     VALUES ('ZV13-TRAP',$1,'11111111-1111-4111-8111-111111111101',100,0,0,100,'PENDING','pending')
     RETURNING id::text`,
    [adminId]
  );
  console.log("trap inserted:", trap.rows[0].id);
} else {
  console.log("trap already present:", existing.rows[0].id);
}

// dry-run обязан выйти с кодом 2 (refuse on ambiguity)
let exitCode = 0;
let output = "";
try {
  output = execFileSync("node", ["scripts/zv13-cleanup.mjs"], { encoding: "utf8" });
} catch (e) {
  exitCode = e.status ?? -1;
  output = String(e.stdout ?? "") + String(e.stderr ?? "");
}
console.log("=== cleanup dry-run output (tail) ===");
console.log(output.trim().split("\n").slice(-6).join("\n"));
console.log("exit code:", exitCode);

const planFrozen = output.includes("ОТКАЗ") || output.includes("вне фикстурных пользователей");
console.log("refusal message present:", planFrozen);

// Проверка: dry-run НЕ удалил ловушку
const still = await c.query(`SELECT id::text FROM orders WHERE number='ZV13-TRAP'`);
console.log("trap still exists after dry-run (must be true):", still.rows.length > 0);

// cleanup ловушки
await c.query(`DELETE FROM orders WHERE number='ZV13-TRAP'`);
console.log("trap removed");

await c.end();
process.exit(exitCode === 2 && planFrozen && still.rows.length > 0 ? 0 : 1);
