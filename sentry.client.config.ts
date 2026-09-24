/**
 * Sentry client config — автоматически загружается Next.js если установлен @sentry/nextjs.
 *
 * Активируется только если есть SENTRY_DSN и пакет @sentry/nextjs установлен.
 * Без DSN — Sentry не инициализируется, файл остаётся no-op.
 *
 * Документация: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
import * as Sentry from '@sentry/nextjs'

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

Sentry.init({
  dsn: SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Replay — запись сессии пользователя при ошибке (влияет на bundle size)
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,

  integrations: [
    Sentry.replayIntegration({
      // Дополнительная конфигурация Replay
      maskAllText: true,           // маскируем весь текст (PII protection)
      blockAllMedia: true,         // не записываем изображения
    }),
  ],

  // Ignore noisy errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',  // browser bug
    'Network request failed',              // user offline
    'cancelled',                          // user navigated away
  ],

  // Deny URLs — не отправляем трейсы для определённых URL
  denyUrls: [
    // Chrome extensions
    /extensions\//i,
    /^chrome:\/\//i,
    // Facebook crawlers
    /graph\.facebook\.com/i,
  ],
})
