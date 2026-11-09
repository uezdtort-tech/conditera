/**
 * GET /api/health/ready — READINESS probe (DEPLOY-01 §5).
 *
 * Отвечает на вопрос «приложение готово принимать трафик»: БД жива
 * (SELECT 1, 3s). Наружу НЕ раскрываются секреты, внутренние адреса,
 * SQL, stack trace, имена отсутствующих env-переменных (отличие от
 * расширенного /api/health, который остаётся как есть для существующих
 * контрактов Docker/deploy.yml/Caddy).
 *
 * Публичный; минимальная информация: status + database.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkDatabase(): Promise<"ok" | "unavailable"> {
  try {
    const { getPool } = await import("@/lib/postgrest/pool");
    const pool = getPool();
    const timeout = new Promise<"unavailable">((resolve) =>
      setTimeout(() => resolve("unavailable"), 3000)
    );
    const query = pool
      .query("SELECT 1")
      .then(() => "ok" as const)
      .catch(() => "unavailable" as const);
    return await Promise.race([query, timeout]);
  } catch {
    return "unavailable";
  }
}

export async function GET(): Promise<NextResponse> {
  const db = await checkDatabase();
  const ready = db === "ok";
  return NextResponse.json(
    { status: ready ? "ready" : "not-ready", database: db },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
