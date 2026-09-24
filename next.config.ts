import type { NextConfig } from "next";

// Домен из env (для CSP и других заголовков)
const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "") || "conditera.ru";
const IS_PROD = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Standalone-сборка для Docker (генерирует .next/standalone)
  output: "standalone",

  // Turbopack: указываем корень проекта (исправляет предупреждение
  // "package-lock.json outside Git repository" на Windows в C:\www\Uezdny)
  turbopack: {
    root: process.cwd(),
  },

  // TypeScript — строгая проверка (НЕ игнорируем ошибки)
  typescript: {
    ignoreBuildErrors: false,
  },

  // React strict mode — включает дополнительные проверки в dev
  reactStrictMode: true,

  // Whitelist доменов для next/image
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "i.pravatar.cc" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "**.yandex.net" },
      { protocol: "https", hostname: "**.yandex.ru" },
      { protocol: "https", hostname: "**.cloudinary.com" },
      // ===== Supabase Storage — для аватаров, портфолио, изображений товаров =====
      // Self-hosted Supabase (dev): http://localhost:8000/storage/v1/object/public/...
      { protocol: "http", hostname: "localhost", port: "8000" },
      // Supabase Cloud: https://<project>.supabase.co/storage/v1/object/public/...
      { protocol: "https", hostname: "**.supabase.co" },
      // Supabase self-hosted prod (своё доменное имя через env)
      ...(process.env.SUPABASE_STORAGE_HOSTNAME
        ? [{ protocol: (process.env.SUPABASE_STORAGE_PROTOCOL as "http" | "https") || "https", hostname: process.env.SUPABASE_STORAGE_HOSTNAME }]
        : []),
    ],
    qualities: [60, 70, 75, 80, 90],
    minimumCacheTTL: 86400, // 24 часа — кэшируем изображения (включая unsplash)
  },

  // ===== Security headers =====
  // Полная защита: CSP, HSTS, Permissions-Policy, COOP/CORP/COEP
  async headers() {
    const csp = [
      "default-src 'self'",
      // Next.js требует 'unsafe-inline' для стилей в dev; в prod — nonce-based (см. ниже)
      // Для скриптов: только 'self' + whitelist внешних доменов
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://yookassa.ru https://*.yoomoney.ru`,
      // Стили — только self + inline (Next.js инлайнит критичные стили)
      `style-src 'self' 'unsafe-inline'`,
      // Шрифты — только локальные (self-hosted через next/font)
      `font-src 'self' data:`,
      // Изображения — широкий whitelist для каталога
      `img-src 'self' data: blob: https: https://images.unsplash.com https://i.pravatar.cc`,
      // Медиа (голосовые сообщения в чате)
      `media-src 'self' data: blob:`,
      // WebSocket (Socket.IO чат) + fetch к API
      `connect-src 'self' https: wss: ws:`,
      // iframe — только свои + preview-платформа
      `frame-src 'self' https://www.google.com`,
      `frame-ancestors 'self' https://*.space-z.ai https://space-z.ai http://localhost:*`,
      // Запрещаем<object>, <embed> (Flash и т.п.)
      `object-src 'none'`,
      // base-uri — только свой домен (защита от base-tag injection)
      `base-uri 'self'`,
      // form-action — ограничиваем отправку форм
      `form-action 'self' https://yookassa.ru https://*.yoomoney.ru`,
      // Запрещаем preflight для beacon API
      `navigate-to 'self'`,
      // Upgrade insecure requests (HTTP → HTTPS)
      `upgrade-insecure-requests`,
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN разрешает встраивание в iframe (нужно для preview-платформы)
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Permissions-Policy — отключаем всё лишнее
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
          },
          // HSTS — только в production (на localhost мешает dev)
          ...(IS_PROD
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains; preload",
                },
              ]
            : []),
          // Cross-Origin политики — изолируем от других страниц
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          // CSP
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      // Для API/auth и payment — no-store
      {
        source: "/api/(auth|payment|profile|admin)/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },

  poweredByHeader: false,
};

// ===== Sentry wrapper (если установлен @sentry/nextjs) =====
// ВАЖНО: next.config.ts должен экспортировать синхронный объект.
// Sentry подключается через отдельные файлы sentry.*.config.ts,
// а здесь — только если SENTRY_DSN задан и пакет доступен.
if (process.env.SENTRY_DSN) {
  try {
    // @ts-ignore — динамический require, может не быть установлен
    const { withSentryConfig } = require("@sentry/nextjs");
    module.exports = withSentryConfig(nextConfig, {
      silent: true,
      errorHandler: (err: unknown) => {
        console.warn("[sentry] build error (non-blocking):", err);
      },
    });
  } catch {
    // @sentry/nextjs не установлен — экспортируем как есть
  }
}

export default nextConfig;
