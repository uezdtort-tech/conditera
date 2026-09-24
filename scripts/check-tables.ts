import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";

async function main() {
  const db = new PGlite(join(process.cwd(), "db", "pglite-dev"));

  const result = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);

  const tables = result.rows.map((r: any) => r.table_name);
  console.log(`Total tables: ${tables.length}`);

  // Проверяем новые таблицы
  const newTables = [
    "simplex_contacts", "simplex_messages", "product_slices",
    "badges", "user_badges", "challenges", "user_challenges",
    "live_streams", "live_stream_viewers", "live_stream_orders", "live_stream_messages",
    "story_likes", "story_replies",
    "accounts", "sessions", "refresh_tokens", "two_factor_challenges",
    "promo_codes", "promo_code_usages", "promo_campaigns",
    "push_subscriptions", "blacklist_entries", "semaphores",
  ];

  console.log("\n=== Новые таблицы ===");
  for (const t of newTables) {
    const exists = tables.includes(t);
    console.log(`  ${exists ? "✓" : "✗"} ${t}`);
  }

  await db.close();
}

main().catch(console.error);
