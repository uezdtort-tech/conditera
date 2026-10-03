/**
 * pool.ts — единственный pg.Pool для PostgREST-шима (глобальный, переиспользуется
 * между запросами Next.js). DATABASE_URL обязателен — иначе падаем сразу
 * с понятным сообщением (fail-fast, а не каскад 500-х).
 */

import { Pool, type PoolConfig } from "pg";

const globalForPool = globalThis as unknown as { __conditeraPgPool?: Pool };

export function getPool(): Pool {
  if (globalForPool.__conditeraPgPool) return globalForPool.__conditeraPgPool;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — run npm run db:setup (creates .env.local with the local PostgreSQL URL)"
    );
  }

  const config: PoolConfig = {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  const pool = new Pool(config);
  console.log(
    `[pgrst/pool] DATABASE_URL → ${connectionString ? connectionString.replace(/:[^:@/]+@/, ":***@") : "UNDEFINED (pg will default to localhost:5432)"}`
  );
  // Глушим unhandled 'error' на простаивающих клиентах (ECONNRESET и т.п.)
  (pool as unknown as { on: (ev: string, cb: (err: Error) => void) => void }).on("error", (err: Error) => {
    console.warn("[pgrst/pool] idle client error:", err.message);
  });

  globalForPool.__conditeraPgPool = pool;
  return pool;
}
