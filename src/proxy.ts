/**
 * Next.js middleware — security headers + CSRF enforcement (cryptographic).
 *
 * CSRF protection: double-submit cookie pattern с timing-safe comparison.
 *  1. Клиент получает CSRF-токен через GET /api/csrf-token (token в JSON body
 *     И в httpOnly+SameSite=Lax+Secure cookie `csrf_token`).
 *  2. На state-changing запросах (POST/PUT/PATCH/DELETE) клиент отправляет
 *     token в header `x-csrf-token`.
 *  3. Middleware сравнивает header vs cookie через `crypto.timingSafeEqual`.
 *     Если не совпадают — 403 Forbidden.
 *
 * Endpoints без CSRF (webhook'и от внешних сервисов): см. CSRF_EXEMPT_PATHS.
 * Такие endpoints должны проверять подпись/HMAC/IP-allowlist самостоятельно.
 *
 * Документация: https://owasp.org/www-community/attacks/csrf
 *
 * ВАЖНО: middleware работает в Edge Runtime — нельзя использовать node:crypto.
 * Используем TextEncoder для конвертации в bytes и ручной constant-time comparison.
 */
import { NextResponse, type NextRequest } from "next/server";

// Список путей, для которых CSRF-проверка пропускается.
// Это endpoints куда стучатся внешние сервисы (YooKassa, n8n, SimpleX, cron).
// Эти endpoints должны валидировать webhook signature / API key / IP allowlist
// самостоятельно в своей реализации.
const CSRF_EXEMPT_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/2fa/login-verify",
  "/api/auth/oauth",
  "/api/csrf-token",
  "/api/payment/webhook",
  "/api/simplex/incoming",
  "/api/webhooks/n8n",
  "/api/webhooks/", // все вебхуки
  "/api/cron/",
  "/api/health",
  "/api/telegram/webhook", // Telegram Bot API отправляет POST без CSRF
  "/api/email/inbound",    // Mailgun/SendGrid отправляют POST без CSRF
  "/api/search", // GET-поиск — public endpoint
];

function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Constant-time comparison двух строк (защита от timing attack).
 * Edge Runtime compatible — без node:crypto, только TextEncoder.
 * Если длины разные — всё равно проходим по всем байтам, чтобы не давать
 * подсказку по времени выполнения.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  // Если длины разные — проделываем фиктивную работу
  // (сравниваем строку саму с собой, чтобы потратить одинаковое время)
  if (bufA.length !== bufB.length) {
    let _result = 0;
    for (let i = 0; i < bufA.length; i++) {
      _result |= bufA[i] ^ bufA[i];
    }
    return false;
  }

  // Constant-time XOR comparison
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

const ALLOWED_FRAME_ANCESTORS = [
  "'self'",
  "https://*.space-z.ai",
  "https://space-z.ai",
  "http://localhost:*",
];

export async function middleware(request: NextRequest) {
  return proxy(request);
}

// Next.js 16+ rename: `middleware` → `proxy` (function name in file is irrelevant,
// only the FILE NAME `proxy.ts` matters). We keep `middleware` alias for tests.
export async function proxy(request: NextRequest) {
  const { method, nextUrl } = request;
  const pathname = nextUrl.pathname;

  // Пропускаем статические файлы
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf|css|js|map)$/)
  ) {
    return NextResponse.next();
  }

  // === Supabase session update (v2.0) ===
  // Refresh access token если истёк, сохраняет в cookies
  const { updateSession } = await import("@/lib/supabase/middleware");
  const response = await updateSession(request);

  // === CSRF enforcement (cryptographic, double-submit cookie) ===
  if (
    pathname.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !isCsrfExempt(pathname)
  ) {
    const headerToken = request.headers.get("x-csrf-token");
    const cookieToken = request.cookies.get("csrf_token")?.value;

    if (!headerToken || !cookieToken) {
      return NextResponse.json(
        {
          error: "CSRF-токен отсутствует. Получите токен через GET /api/csrf-token и отправьте в header 'x-csrf-token'.",
        },
        { status: 403 }
      );
    }

    // Cryptographic comparison (timing-safe)
    if (!timingSafeEqual(headerToken, cookieToken)) {
      return NextResponse.json(
        { error: "Неверный CSRF-токен. Обновите страницу и попробуйте снова." },
        { status: 403 }
      );
    }
  }

  // === Security headers ===
  response.headers.set("X-Content-Type-Options", "nosniff");
  // SAMEORIGIN разрешает встраивание в iframe (нужно для preview-платформы)
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  // X-XSS-Protection устарел, но оставляем для старых браузеров
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions-Policy — отключаем всё лишнее
  response.headers.set(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()"
  );

  // HSTS — только для HTTPS (на localhost мешает dev)
  if (nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  // Cross-Origin Policies — изолируем от других страниц
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");

  // CSP — с разрешением iframe для preview-платформы
  if (!pathname.startsWith("/api/")) {
    response.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://yookassa.ru https://*.yoomoney.ru",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "img-src 'self' data: blob: https: https://images.unsplash.com https://i.pravatar.cc",
        "media-src 'self' data: blob:",
        "connect-src 'self' https: wss: ws:",
        "frame-src 'self' https://www.google.com",
        `frame-ancestors ${ALLOWED_FRAME_ANCESTORS.join(" ")}`,
        "form-action 'self' https://yookassa.ru https://*.yoomoney.ru",
        "base-uri 'self'",
        "object-src 'none'",
        "upgrade-insecure-requests",
      ].join("; ")
    );
  } else {
    // Для API — строгий CSP
    response.headers.set(
      "Content-Security-Policy",
      `default-src 'none'; frame-ancestors ${ALLOWED_FRAME_ANCESTORS.join(" ")}`
    );
  }

  // Cache-Control для sensitive endpoints
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/payment/") ||
    pathname.startsWith("/api/profile/") ||
    pathname.startsWith("/api/admin/")
  ) {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.headers.set("Pragma", "no-cache");
  }

  return response;
}

export const config = {
  // Пропускаем static assets — middleware работает только на динамических путях
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest).*)"],
};
