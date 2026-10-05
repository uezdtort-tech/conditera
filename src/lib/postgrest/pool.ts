/**
 * pool.ts — единственный pg.Pool для PostgREST-шима (глобальный, переиспользуется
 * между запросами Next.js). DATABASE_URL резолвится с учётом платформенного
 * плейсхолдера file: (см. resolveDatabaseUrl) — без fail-fast каскада 500-х.
 */

import { Pool, type PoolConfig } from "pg";

const globalForPool = globalThis as unknown as { __conditeraPgPool?: Pool };

/**
 * Резолв строки подключения к PostgreSQL.
 *
 * Платформа песочницы инжектит в окружение DATABASE_URL=file:... (SQLite-плейсхолдер),
 * который перекрывает .env/.env.local. pg-драйвер со схемой file: работать не умеет
 * (ECONNREFUSED/500 на каждом запросе), поэтому такой значение считается
 * «плейсхолдером» и заменяется на встроенный локальный PostgreSQL
 * (см. scripts/db/runtime.mjs: EMBEDDED_URL, CONDITERA_PG_PORT).
 */
function resolveDatabaseUrl(): string {
  const raw = (process.env.DATABASE_URL || "").trim();
  if (!raw || raw.startsWith("file:")) {
    const port = process.env.CONDITERA_PG_PORT || "54329";
    const fallback = `postgresql://postgres@127.0.0.1:${port}/conditera`;
    if (raw) {
      console.warn(
        `[pgrst/pool] DATABASE_URL=${raw.slice(0, 40)}… — платформенный плейсхолдер, использую встроенный PG: ${fallback.replace(/:[^:@/]+@/, ":***@")}`
      );
    }
    return fallback;
  }
  return raw;
}

export function getPool(): Pool {
  if (globalForPool.__conditeraPgPool) return globalForPool.__conditeraPgPool;

  const connectionString = resolveDatabaseUrl();

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
