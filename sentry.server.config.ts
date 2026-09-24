/**
 * Sentry server config — для server-side (Node.js runtime) error tracking.
 * Автоматически загружается Next.js если установлен @sentry/nextjs.
 *
 * Активируется только если есть SENTRY_DSN.
 */
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Release tracking (из CI)
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.npm_package_version,

  // Environment
  environment: process.env.NODE_ENV || 'development',

  // Ignore noisy errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Network request failed',
    'cancelled',
    'prisma:error',  // Prisma-ошибки логируем отдельно в БД
  ],
})
