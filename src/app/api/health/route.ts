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
 * Этап 4 (local-runtime): добавлены живые проверки database (SELECT 1 через
 * PostgREST-пул) и n8n (HEAD/GET с таймаутом, fail-open) — ключи
 * app/database/n8n/environment. 200 когда app+db ok, 503 если БД недоступна.
 * Используется K8s readiness probe (если зависимости не готовы → restart pod).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Живые проверки БД/n8n — роут больше не может быть статическим
export const dynamic = "force-dynamic";

interface DependencyStatus {
  name: string;
  required: boolean;
  configured: boolean;
  details?: string;
}

interface HealthResponse {
  app: "ok";
  database: "ok" | "unavailable";
  n8n: "ok" | "unavailable";
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

/**
 * SELECT 1 через существующий пул с гардом 3s.
 * Никогда не бросает — возвращает "ok" | "unavailable".
 */
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

/**
 * Живая проверка n8n (N8N_BASE_URL или localhost:5678), таймаут 1.5s.
 * Fail-open: любая ошибка → "unavailable", никогда не бросает.
 */
async function checkN8n(): Promise<"ok" | "unavailable"> {
  const base = process.env.N8N_BASE_URL || "http://localhost:5678";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(base, {
      method: "GET",
      signal: controller.signal,
      headers: process.env.N8N_WEBHOOK_SECRET
        ? { "X-N8N-Secret": process.env.N8N_WEBHOOK_SECRET }
        : undefined,
    });
    // n8n отвечает на любой HTTP-код — главное, что сервис жив
    return res.status > 0 ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}

// pay4: версия образа прокидывается через ARG/ENV APP_VERSION (Dockerfile);
// вне Docker (dev) — fallback "2.0.0-dev"
const APP_VERSION = process.env.APP_VERSION || "2.0.0-dev";

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

  // Живые проверки: БД (SELECT 1, 3s) и n8n (1.5s, fail-open)
  const [dbStatus, n8nStatus] = await Promise.all([checkDatabase(), checkN8n()]);

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
    app: "ok",
    database: dbStatus,
    n8n: n8nStatus,
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

  // 200 когда приложение и БД живы; 503 когда БД недоступна (readiness-гейт)
  const httpStatus = dbStatus === "ok" ? 200 : 503;
  return NextResponse.json(response, { status: httpStatus });
}
