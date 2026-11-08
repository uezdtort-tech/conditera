/**
 * Z-v16 E2E check: escalation created in chat_escalations (read-only).
 * Usage: bun scripts/z16-check-escalations.mjs [--replies]
 * Не выводит секретов: читает DATABASE_URL из .env.local.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(".env.local", "utf8");
const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const url = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");

const pool = new pg.Pool({ connectionString: url, max: 1 });
const q = (text, params) => pool.query(text, params);

const showReplies = process.argv.includes("--replies");

const escalations = await q(`
  SELECT e.id, e.chat_room_id, e.user_id, e.reason, e.priority, e.status,
         e.metadata->>'message_preview' AS preview,
         e.assigned_to, e.created_at,
         p.name AS user_name,
         c.type AS room_type
  FROM chat_escalations e
  LEFT JOIN profiles p ON p.id = e.user_id
  LEFT JOIN chat_channels c ON c.id = e.chat_room_id
  ORDER BY e.created_at DESC
  LIMIT 5
`);

console.log("=== chat_escalations (последние 5) ===");
for (const e of escalations.rows) {
  console.log(
    `${e.created_at.toISOString()} | room=${e.chat_room_id} type=${e.room_type} | user=${e.user_name} | ${e.reason} prio=${e.priority} status=${e.status} | preview="${String(e.preview ?? "").slice(0, 60)}"`
  );
}
if (escalations.rows.length === 0) console.log("(пусто — эскалаций нет)");

if (showReplies) {
  const msgs = await q(
    `
    SELECT m.id, m.channel_id, m.sender_id, m.text, m.is_bot, m.created_at,
           p.name AS sender_name
    FROM chat_messages m
    LEFT JOIN profiles p ON p.id = m.sender_id
    WHERE m.channel_id = (SELECT chat_room_id FROM chat_escalations ORDER BY created_at DESC LIMIT 1)
    ORDER BY m.created_at ASC
    LIMIT 20
  `
  );
  console.log("\n=== chat_messages треда последней эскалации ===");
  for (const m of msgs.rows) {
    console.log(
      `${m.created_at.toISOString()} | ${m.sender_name ?? m.sender_id} | bot=${m.is_bot} | "${String(m.text ?? "").slice(0, 70)}"`
    );
  }
}

await pool.end();
