import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(".env.local", "utf8");
const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const url = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 1 });

const r = await q(`
  SELECT ur.role, p.email, p.name, p.is_blocked
  FROM user_roles ur JOIN profiles p ON p.id = ur.user_id
  WHERE ur.role IN ('ADMIN','SUPER_ADMIN','SUPPORT','MODERATOR') AND ur.is_active = true
  ORDER BY ur.role
`);
console.log("=== staff-пользователи ===");
for (const row of r.rows) console.log(`${row.role} | ${row.email} | ${row.name} | blocked=${row.is_blocked}`);
if (r.rows.length === 0) console.log("(нет staff-пользователей)");

await pool.end();
function q(text, params) { return pool.query(text, params); }
