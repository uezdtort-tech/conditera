/**
 * GET /api/health — liveness/readiness probe для Docker/K8s healthchecks.
 *
 * Возвращает 200 OK с базовой информацией о сервисе + статусом зависимостей.
 * Не требует авторизации (public endpoint).
 *
 * Статусы зависимостей:
 *  - supabase: проверяется через env vars presence (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *  - auth_gotrue (v4.1 Этап 3.1 / DEV-18): ЖИВАЯ reachability-проба GoTrue —
 *    GET {SUPABASE_URL}/auth/v1/health с таймаутом 3s (тот же base-path, что и
 *    admin.createUser регистрации). Классификация: reachable (2xx) /
 *    unreachable (сетевая ошибка/таймаут/не-2xx, вкл. 501 локальной заглушки) /
 *    not-configured (нет env-пары — проба не выполняется). Dеградация top-level
 *    статуса — ТОЛЬКО в production при configured+unreachable (регистрация
 *    fail-closed: 500); в dev/стабе классификация без production-failure.
 *    Фейл-клоузед гейт регистрации НЕ обходится и НЕ ослабляется.
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
import { resolveSupabaseServerUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";
// Живые проверки БД/n8n — роут больше не может быть статическим
export const dynamic = "force-dynamic";

interface DependencyStatus {
  name: string;
  required: boolean;
  configured: boolean;
  /** Только для auth_gotrue: результат reachability-пробы GoTrue. */
  reachability?: "reachable" | "unreachable" | "not-configured";
  details?: string;
}

interface HealthResponse {
  app: "ok";
  database: "ok" | "unavailable";
  n8n: "ok" | "unavailable";
  /**
   * GoTrue (Supabase Auth) reachability — v4.1 Этап 3.1.
   * "ok" = configured и GET {URL}/auth/v1/health ответил 2xx;
   * "unreachable" = configured, но проба не подтвердила GoTrue
   * (сетевая ошибка/таймаут/не-2xx — вкл. 501 локальной заглушки в dev);
   * "not-configured" = нет env-пары, проба не выполнялась.
   * Production-gate: configured+unreachable в NODE_ENV=production →
   * top-level status:"degraded" (регистрация fail-closed вернёт 500).
   */
  auth: "ok" | "unreachable" | "not-configured";
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

// v4.1 Этап 3.1: таймаут reachability-пробы GoTrue (короткий — health не должен
// зависеть от медленного auth-провайдера дольше readiness-интервала)
const GOTRUE_PROBE_TIMEOUT_MS = 3000;

type GoTrueReachability = "reachable" | "unreachable" | "not-configured";

interface GoTrueProbeResult {
  configured: boolean;
  reachability: GoTrueReachability;
  baseUrl: string;
  httpStatus?: number;
  error?: string;
}

/**
 * Живая проверка достижимости GoTrue — GET {SUPABASE_URL}/auth/v1/health (3s).
 *
 * Тот же base-path, что использует регистрация: admin.createUser →
 * POST {URL}/auth/v1/admin/users (см. src/app/api/auth/register/route.ts,
 * шаг 7), base — resolveSupabaseServerUrl() (единая точка, src/lib/supabase/url.ts).
 *
 * Классификация (никогда не бросает):
 *  - "not-configured": нет env-пары (URL / сервисный role-ключ) — проба НЕ
 *    выполняется; совпадает с configured:false компонента "supabase";
 *  - "reachable": HTTP 2xx от /auth/v1/health (канонический health-эндпоинт GoTrue);
 *  - "unreachable": сетевая ошибка/таймаут ИЛИ не-2xx ответ — вкл. 501 заглушки
 *    локального рантайма (src/app/auth/v1/[...path]/route.ts), 404 неверного
 *    пути и 5xx шлюза: GoTrue не подтверждён.
 *
 * Прод-гейт деградации — НЕ здесь, а в GET(): top-level status:"degraded"
 * только при NODE_ENV=production + configured + unreachable. В dev/стабе
 * классификация остаётся фактической ("unreachable" для 501-заглушки), но
 * production-misconfig НЕ маркируется — гейт регистрации fail-closed не
 * обходится и не ослабляется (DEV-18).
 */
async function checkGoTrue(): Promise<GoTrueProbeResult> {
  // NB: имя сервисного ключа НЕ печатаем в details (evidence-hygiene —
  // сканер секретов в excerpt'ах health-тела), только факт отсутствия env-пары.
  const missing = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (missing) {
    return { configured: false, reachability: "not-configured", baseUrl: "" };
  }
  const baseUrl = resolveSupabaseServerUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOTRUE_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/auth/v1/health`, {
      method: "GET",
      signal: controller.signal,
      // apikey — как ходит сам admin-клиент (Kong-гейтвей может требовать apikey
      // даже на health); значение — уже используемый сервисный ключ.
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string },
    });
    const reachable = res.status >= 200 && res.status < 300;
    return {
      configured: true,
      reachability: reachable ? "reachable" : "unreachable",
      baseUrl,
      httpStatus: res.status,
    };
  } catch (e: any) {
    return {
      configured: true,
      reachability: "unreachable",
      baseUrl,
      error: e?.name === "AbortError" ? "timeout 3s" : e?.message || "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}

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

  // Живые проверки: БД (SELECT 1, 3s), n8n (1.5s, fail-open) и GoTrue
  // (GET /auth/v1/health, 3s — v4.1 Этап 3.1)
  const [dbStatus, n8nStatus, authProbe] = await Promise.all([
    checkDatabase(),
    checkN8n(),
    checkGoTrue(),
  ]);

  const isProduction = process.env.NODE_ENV === "production";

  // details для auth_gotrue — человекочитаемая классификация. В production
  // unreachable явно называет следствие (fail-closed 500 регистрации).
  let authDetails: string;
  if (!authProbe.configured) {
    authDetails =
      "Missing: NEXT_PUBLIC_SUPABASE_URL and/or service-role key env — probe skipped";
  } else if (authProbe.reachability === "reachable") {
    authDetails = `GoTrue reachable: GET ${authProbe.baseUrl}/auth/v1/health → ${authProbe.httpStatus}`;
  } else {
    const cause = authProbe.error
      ? `error: ${authProbe.error}`
      : `HTTP ${authProbe.httpStatus}`;
    authDetails = isProduction
      ? `GoTrue unreachable (${cause}) — production registration is fail-closed (500) until the auth provider is reachable`
      : `GoTrue unreachable (${cause}) — dev/local runtime, no production gate`;
  }

  const dependencies: DependencyStatus[] = [
    {
      name: "supabase",
      required: true,
      configured: supabaseCheck.configured,
      details: supabaseCheck.configured ? undefined : `Missing: ${supabaseCheck.missing.join(", ")}`,
    },
    {
      name: "auth_gotrue", // v4.1 Этап 3.1: reachability-проба (см. докблок checkGoTrue)
      required: true,
      configured: authProbe.configured,
      reachability: authProbe.reachability,
      details: authDetails,
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

  // Status: ok если все required dependencies настроены И БД жива.
  // DEV-17: статус когерентен HTTP-коду — 503 (БД недоступна) не может
  // сопровождаться status:"ok" в теле. n8n — fail-open по задокументированному
  // контракту (см. докблок выше) и на readiness/status не влияет.
  // v4.1 Этап 3.1: GoTrue недостижим В PRODUCTION (env есть, проба не
  // подтвердила) — деградация статуса (семантика required:true): регистрация
  // fail-closed вернёт 500 первому пользователю. В dev/стабе (NODE_ENV !==
  // "production") деградации НЕТ — false-positive исключён по построению.
  const authProductionFailure =
    isProduction && authProbe.configured && authProbe.reachability === "unreachable";
  const allRequiredOk =
    dependencies.filter((d) => d.required).every((d) => d.configured) &&
    !authProductionFailure;
  const status: HealthResponse["status"] =
    dbStatus === "ok" && allRequiredOk ? "ok" : "degraded";

  const response: HealthResponse = {
    app: "ok",
    database: dbStatus,
    n8n: n8nStatus,
    auth: authProbe.reachability === "reachable" ? "ok" : authProbe.reachability,
    status,
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

