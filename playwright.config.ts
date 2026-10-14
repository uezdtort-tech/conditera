// @ts-nocheck
/**
 * Playwright e2e tests configuration.
 *
 * Документация: https://playwright.dev/docs/test-configuration
 *
 * Запуск:
 *   npx playwright install --with-deps chromium  # один раз
 *   npm run test:e2e                              # запуск всех e2e
 *   npm run test:e2e:ui                           # интерактивный UI mode
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT || 3000
// ВАЖНО: 127.0.0.1, а не localhost — Node.js ≥17 резолвит localhost в ::1 (IPv6),
// а dev/prod сервер слушает 0.0.0.0 (IPv4-only). API request-context тесты
// падали с ECONNREFUSED ::1:3000 (см. e2e «120 failed» прогон).
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',

  // Timeout для каждого теста (30 сек — для slow CI)
  timeout: 30_000,

  // Timeout для expect() (5 сек)
  expect: { timeout: 5_000 },

  // Параллелизм — 4 воркера на CI, 1 локально (для дебага)
  fullyParallel: process.env.CI ? true : false,
  workers: process.env.CI ? 4 : 1,

  // Fail fast — останавливаем после 5 ошибок
  retries: process.env.CI ? 2 : 0,

  reporter: [
    // HTML отчёт (для локального дебага)
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    // JUnit XML (для CI)
    ['junit', { outputFile: 'test-results/junit.xml' }],
    // Console summary
    ['list'],
  ],

  use: {
    baseURL,
    // Browser options
    headless: true,
    viewport: { width: 1280, height: 720 },
    // Скриншот при ошибке
    screenshot: 'only-on-failure',
    // Видео — только при ошибке
    video: 'retain-on-failure',
    // Trace — для дебага flaky-тестов
    trace: 'on-first-retry',
    // User agent
    userAgent: 'Playwright-E2E/1.0 (+https://conditera.ru)',
    // Принимать любые cookie
    acceptDownloads: true,
    // Игнорировать HTTPS errors (для self-signed сертификатов в dev)
    ignoreHTTPSErrors: true,
  },

  projects: [
    // Desktop Chrome
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Desktop Firefox (раскомментировать при необходимости)
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // Mobile Chrome (responsive testing)
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Автозапуск dev-сервера перед e2e
  // ВАЖНО: `dev` в этом репо = next build && next start (production-режим),
  // поэтому для webServer используем dev:local (настоящий dev-сервер)
  webServer: process.env.E2E_BASE_URL
    ? undefined  // если E2E_BASE_URL задан — сервер уже запущен
    : {
        command: 'bun run dev:local',
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,  // в CI — новый сервер, локально — переиспользуем
        env: {
          // Embedded PostgreSQL (см. scripts/db/runtime.mjs); перед запуском
          // webServer БД должна быть инициализирована: bun run db:setup
          DATABASE_URL: 'postgresql://postgres@127.0.0.1:54329/conditera',
          JWT_SECRET: 'e2e_test_jwt_secret_32_chars_min_aaaaaaaaaa',
          TFA_ENCRYPTION_KEY: 'e2e_test_tfa_key_64_hex_chars_aaaaaaaaaaaaaaaaaaaaaaaa',
          CRON_SECRET: 'e2e_test_cron_secret',
          NODE_ENV: 'test',
        },
      },
})
