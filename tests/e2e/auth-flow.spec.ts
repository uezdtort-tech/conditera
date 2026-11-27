/**
 * E2E тесты для auth flow.
 *
 * Использует Playwright's `request` fixture (вместо raw fetch()).
 * baseURL из playwright.config.ts (http://localhost:3000).
 *
 * CSRF exemptions (from middleware.ts CSRF_EXEMPT_PATHS):
 *   /api/auth/login, /api/auth/register, /api/auth/refresh,
 *   /api/auth/2fa/login-verify — НЕ требуют CSRF token
 *
 * НЕ exempt (требуют CSRF):
 *   /api/auth/2fa/setup, /api/auth/2fa/verify, /api/auth/2fa/disable,
 *   /api/auth/logout, /api/auth/session (GET — не требует)
 */
import { test, expect, type APIRequestContext } from '@playwright/test'

test.describe('Auth flow — register/login (exempt от CSRF)', () => {
  // register и login exempt от CSRF → POST проходит без CSRF

  test('POST /api/auth/register без полей → 400 (exempt от CSRF)', async ({ request }) => {
    const response = await request.post('/api/auth/register', { data: {} })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain('обязательные поля')
  })

  test('POST /api/auth/register с коротким паролем → 400', async ({ request }) => {
    const response = await request.post('/api/auth/register', {
      data: {
        email: 'short-password@example.com',
        password: '123',
        name: 'Short Password Test',
        phone: '+79998887766',
        consentPd: true,
        consentTerms: true,
        consentOffer: true,
      },
      headers: { 'x-real-ip': '10.230.10.11' },
    })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain('Пароль')
  })

  test('POST /api/auth/login без email/password → 400', async ({ request }) => {
    const response = await request.post('/api/auth/login', { data: {} })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain('обязательны')
  })

  test('POST /api/auth/refresh без refreshToken → 400', async ({ request }) => {
    const response = await request.post('/api/auth/refresh', { data: {} })
    expect(response.status()).toBe(400)
  })

  test('POST /api/auth/refresh с невалидным refreshToken → 401', async ({ request }) => {
    const response = await request.post('/api/auth/refresh', { data: { refreshToken: 'invalid' } })
    expect(response.status()).toBe(401)
  })
})

test.describe('Auth flow — 2FA (без авторизации запрещено)', () => {
  // Без cookie-сессии эти endpoints должны вернуть 401; CSRF проверяется только для cookie-auth.

  test('POST /api/auth/2fa/setup без сессии → 401', async ({ request }) => {
    const response = await request.post('/api/auth/2fa/setup')
    expect(response.status()).toBe(401)
  })

  test('POST /api/auth/2fa/verify без сессии → 401', async ({ request }) => {
    const response = await request.post('/api/auth/2fa/verify', { data: { code: '123456' } })
    expect(response.status()).toBe(401)
  })

  test('POST /api/auth/2fa/disable без сессии → 401', async ({ request }) => {
    const response = await request.post('/api/auth/2fa/disable', { data: { code: '123456' } })
    expect(response.status()).toBe(401)
  })

  test('POST /api/auth/2fa/login-verify без tfaTempToken → 400 (exempt)', async ({ request }) => {
    const response = await request.post('/api/auth/2fa/login-verify', { data: { code: '123456' } })
    expect(response.status()).toBe(400)
  })

  test('POST /api/auth/2fa/login-verify без code и backupCode → 400', async ({ request }) => {
    const response = await request.post('/api/auth/2fa/login-verify', { data: { tfaTempToken: 'fake' } })
    expect(response.status()).toBe(400)
  })

  test('POST /api/auth/2fa/login-verify с невалидным tfaTempToken → 401', async ({ request }) => {
    const response = await request.post('/api/auth/2fa/login-verify', {
      data: { tfaTempToken: 'invalid', code: '123456' },
    })
    expect(response.status()).toBe(401)
  })
})

test.describe('Auth flow — session & logout', () => {
  test('GET /api/auth/session без авторизации → 200 и user=null', async ({ request }) => {
    const response = await request.get('/api/auth/session', { headers: { cookie: '' } })
    expect(response.status()).toBe(200)
    expect((await response.json()).user).toBeNull()
  })

  test('POST /api/auth/logout без сессии безопасно очищает cookie → 200', async ({ request }) => {
    const response = await request.post('/api/auth/logout')
    expect(response.status()).toBe(200)
  })
})

test.describe('Auth flow — health endpoint', () => {
  test('GET /api/health возвращает status "ok" или "degraded"', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(['ok', 'degraded']).toContain(json.status)
    expect(json.features.roles_v2).toBe(true)
    expect(json.features.csrf_protection).toBe(true)
  })
})
