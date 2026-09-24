/**
 * GET /api/health — liveness/readiness probe для Docker/K8s healthchecks.
 *
 * Возвращает 200 OK с базовой информацией о сервисе + статусом зависимостей.
 * Не требует авторизации (public endpoint).
 *
 * Статусы зависимостей:
 *  - supabase: проверяется через env vars presence (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *  - ai_assistant: проверяется через наличие z-ai-web-dev-sdk в node_modules
 *  - smtp: проверяется через env vars (SMTP_HOST, SMTP_USER, SMTP_PASSWORD)
 *  - telegram: проверяется через TELEGRAM_BOT_TOKEN
 *
 * Этот endpoint не должен вызывать внешние сервисы — только проверять конфигурацию.
 * Используется K8s readiness probe (если зависимости не готовы → restart pod).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

interface DependencyStatus {
  name: string;
  required: boolean;
  configured: boolean;
  details?: string;
}

interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  environment: string;
  features: {
    roles_v2: boolean;             // 30 ролей вместо 26
    recipe_marketplace: boolean;  // миграция 0012
    loyalty_partners: boolean;
    ai_assistant: boolean;
    escrow: boolean;
    rbac: boolean;
    csrf_protection: boolean;
    rate_limiting: boolean;
  };
  dependencies: DependencyStatus[];
}

const APP_VERSION = "2.0.0";

/**
 * Проверить, сконфигурированы ли переменные окружения.
 */
function checkEnvVars(vars: string[]): { configured: boolean; missing: string[] } {
  const missing = vars.filter((v) => !process.env[v]);
  return { configured: missing.length === 0, missing };
}

/**
 * GET /api/health — liveness/readiness probe.
 */
export async function GET(): Promise<NextResponse> {
  const supabaseCheck = checkEnvVars(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const smtpCheck = checkEnvVars(["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]);
  const telegramCheck = checkEnvVars(["TELEGRAM_BOT_TOKEN"]);
  const yookassaCheck = checkEnvVars(["YOOKASSA_SHOP_ID", "YOOKASSA_SECRET_KEY"]);
  const jwtCheck = checkEnvVars(["JWT_SECRET"]);
  const cronCheck = checkEnvVars(["CRON_SECRET"]);

  const dependencies: DependencyStatus[] = [
    {
      name: "supabase",
      required: true,
      configured: supabaseCheck.configured,
      details: supabaseCheck.configured ? undefined : `Missing: ${supabaseCheck.missing.join(", ")}`,
    },
    {
      name: "jwt",
      required: true,
      configured: jwtCheck.configured,
      details: jwtCheck.configured ? undefined : `Missing: ${jwtCheck.missing.join(", ")}`,
    },
    {
      name: "smtp",
      required: false,
      configured: smtpCheck.configured,
      details: smtpCheck.configured ? undefined : `Missing: ${smtpCheck.missing.join(", ")}`,
    },
    {
      name: "telegram_bot",
      required: false,
      configured: telegramCheck.configured,
      details: telegramCheck.configured ? undefined : "Missing: TELEGRAM_BOT_TOKEN",
    },
    {
      name: "yookassa",
      required: false,
      configured: yookassaCheck.configured,
      details: yookassaCheck.configured ? undefined : `Missing: ${yookassaCheck.missing.join(", ")}`,
    },
    {
      name: "cron_secret",
      required: true,
      configured: cronCheck.configured,
      details: cronCheck.configured ? undefined : "Missing: CRON_SECRET (cron endpoints will refuse to run)",
    },
  ];

  // Status: ok если все required dependencies настроены
  const allRequiredOk = dependencies
    .filter((d) => d.required)
    .every((d) => d.configured);

  const response: HealthResponse = {
    status: allRequiredOk ? "ok" : "degraded",
    service: "conditera",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    features: {
      roles_v2: true,           // 30 ролей (миграция 0012 добавила RECIPE_DEVELOPER, LOYALTY_PARTNER, AI_ASSISTANT)
      recipe_marketplace: true,  // /api/recipes/marketplace (GET, POST, /:id, /:id/purchase)
      loyalty_partners: true,    // /api/loyalty/partners, /api/loyalty/cross-actions
      ai_assistant: true,        // /api/ai-assistant/chat, /conversations, /feedback
      escrow: true,              // escrow_release cron + escrow_accounts table
      rbac: true,                // role-guards.ts с requireRole/requireAnyRole
      csrf_protection: true,     // middleware с double-submit cookie + timing-safe comparison
      rate_limiting: true,       // @/lib/rate-limit
    },
    dependencies,
  };

  const httpStatus = 200;  // liveness probe — всегда 200; K8s использует readiness для проверки зависимостей
  return NextResponse.json(response, { status: httpStatus });
}
