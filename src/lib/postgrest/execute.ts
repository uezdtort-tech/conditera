/**
 * execute.ts — транзакционное исполнение с сессией PostgREST-семантики:
 * BEGIN → set_config('request.jwt.claims') → SET LOCAL ROLE → работа → COMMIT.
 *
 * Это воспроизводит поведение PostgREST: RLS-политики видят auth.uid() (через
 * claims), роль anon/authenticated проходит через RLS, service_role имеет
 * BYPASSRLS (задаётся в supabase/compat/0000_supabase_compat.sql).
 */

import type { PoolClient } from "pg";
import { getPool } from "./pool";
import type { PgrstClaims } from "./jwt";

export async function withClaims<T>(claims: PgrstClaims, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const claimsJson = JSON.stringify({
      ...claims.raw,
      role: claims.role,
      ...(claims.sub ? { sub: claims.sub } : {}),
    });
    // set_config(..., true) = локально в транзакции; параметризация — без конкатенации
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [claimsJson]);

    // SET LOCAL ROLE: имена ролей — фиксированный whitelist, инъекции нет
    const role = claims.role;
    if (role === "service_role" || role === "authenticated" || role === "anon") {
      await client.query(`SET LOCAL ROLE ${role}`);
    }

    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* соединение уже разорвано */
    }
    throw err;
  } finally {
    client.release();
  }
}
