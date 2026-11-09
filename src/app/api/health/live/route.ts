/**
 * GET /api/health/live — LIVENESS probe (DEPLOY-01 §5).
 *
 * Отвечает на вопрос «процесс жив». Никаких зависимостей, никаких
 * данных о конфигурации/окружении/внутренних адресах — только факт
 * работы обработчика. Для внешних мониторов (UptimeRobot/Cloudflare
 * Tunnel/Caddy health_uri) и orchestrator liveness-проб.
 *
 * Отличие от /api/health: тот — readiness-совместимый контракт
 * (Docker HEALTHCHECK, deploy.yml post-deploy грепают "status":"ok")
 * и остаётся без изменений. Здесь — минимальный публичный liveness.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { status: "alive" },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
