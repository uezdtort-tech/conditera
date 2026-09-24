/**
 * Sentry edge config — для Edge Runtime (middleware, edge API routes).
 * Автоматически загружается Next.js если установлен @sentry/nextjs.
 */
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Edge runtime — меньше sample rate (т.к. middleware срабатывает на каждый запрос)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,

  debug: false,

  environment: process.env.NODE_ENV || 'development',
})
