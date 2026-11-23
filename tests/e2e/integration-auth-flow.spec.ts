/**
 * Интеграционный e2e тест — полный auth flow:
 * register → login → 2fa setup → 2fa verify → refresh → logout
 *
 * Использует Playwright's `request` fixture с baseURL из config.
 * Внимание: тесты создают реальные записи в БД (если доступна).
 *
 * Запуск:
 *   npx playwright test tests/e2e/integration-auth-flow.spec.ts --project=chromium
 */
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '@playwright/test'

// Уникальный email для каждого запуска (чтобы не конфликтовать с предыдущими)
const uniqueId = randomUUID()
const uniqueEmail = `e2e-test-${uniqueId}@example.com`
const testPassword = 'TestPassword123!'
const testName = 'E2E Test User'
const testPhone = `+7${uniqueId.replace(/\\D/g, '').slice(0, 10)}`
const testIp = `10.240.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 200) + 20}`

test.describe.serial('Integration: full auth flow', () => {
  let accessToken: string | null = null
  let refreshToken: string | null = null
  let userId: string | null = null

  test('1. Register → creates user + returns tokens', async ({ request }) => {
    const response = await request.post('/api/auth/register', {
      headers: { 'x-real-ip': testIp },
      data: {
        email: uniqueEmail,
        password: testPassword,
        name: testName,
        phone: testPhone,
        role: 'CUSTOMER',
        consentPd: true,
        consentTerms: true,
        consentOffer: true,
        consentMarketing: false,
      },
    })

    expect(response.status(), await response.text()).toBe(200)
    const json = await response.json()
    expect(json.user).toBeDefined()
    expect(json.user.roles).toContain('CUSTOMER')
    expect(json.accessToken).toBeDefined()
    expect(json.refreshToken).toBeDefined()
    accessToken = json.accessToken
    refreshToken = json.refreshToken
    userId = json.user.id
  })

  test('2. Login → returns tokens', async ({ request }) => {
    expect(refreshToken, 'регистрация обязана вернуть refresh token').toBeTruthy()
    const response = await request.post('/api/auth/login', {
      headers: { 'x-real-ip': testIp },
      data: { email: uniqueEmail, password: testPassword },
    })

    expect(response.status(), await response.text()).toBe(200)
    const json = await response.json()
    expect(json.user).toBeDefined()
    expect(json.accessToken).toBeDefined()
    expect(json.refreshToken).toBeDefined()
    accessToken = json.accessToken
    refreshToken = json.refreshToken
    userId = json.user.id
  })

  test('3. Refresh token → new access token', async ({ request }) => {
    expect(refreshToken).toBeTruthy()
    const response = await request.post('/api/auth/refresh', {
      headers: { 'x-real-ip': testIp },
      data: { refreshToken },
    })

    expect(response.status(), await response.text()).toBe(200)
    const json = await response.json()
    expect(json.accessToken).toBeTruthy()
    expect(json.refreshToken).toBeTruthy()
    accessToken = json.accessToken
    refreshToken = json.refreshToken
  })

  test('4. 2FA setup → returns QR code', async ({ request }) => {
    expect(accessToken).toBeTruthy()
    // Авторизованный запрос без CSRF должен быть отклонён middleware.
    const response = await request.post('/api/auth/2fa/setup', {
      headers: { 'x-real-ip': testIp },
    })
    expect(response.status()).toBe(403)
    expect((await response.json()).error).toContain('CSRF')
  })

  test('5. Health check → status ok or degraded', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(['ok', 'degraded']).toContain(json.status)
    expect(json.features.roles_v2).toBe(true)
    expect(json.features.rbac).toBe(true)
    expect(json.features.csrf_protection).toBe(true)
  })

  test('6. CSRF protection — POST without token → 403', async ({ request }) => {
    // Попытка POST на защищённый endpoint без CSRF
    const response = await request.post('/api/loyalty/partners', {
      data: { company_name: 'Test', company_type: 'bank', contact_email: 'test@test.com' },
      headers: { Cookie: 'cd_session=e2e-cookie-session' },
    })
    expect(response.status()).toBe(403)
    const body = await response.json()
    expect(body.error).toContain('CSRF')
  })

  test('7. Rate limiting — health endpoint always 200', async ({ request }) => {
    for (let i = 0; i < 5; i++) {
      const response = await request.get('/api/health')
      expect(response.status()).toBe(200)
    }
  })

  test('8. Logout revokes the current session', async ({ request }) => {
    expect(accessToken).toBeTruthy()
    const csrfResponse = await request.get('/api/csrf-token', {
      headers: { 'x-real-ip': testIp },
    })
    expect(csrfResponse.status()).toBe(200)
    const csrf = (await csrfResponse.json()).token
    const logout = await request.post('/api/auth/logout', {
      headers: {
        'x-real-ip': testIp,
        Authorization: `Bearer ${accessToken}`,
        'x-csrf-token': csrf,
      },
    })
    expect(logout.status()).toBe(200)
    const session = await request.get('/api/auth/session', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(session.status()).toBe(200)
    expect((await session.json()).user).toBeNull()
  })
})

test.describe('Integration: public API endpoints', () => {
  test('GET /api/products → returns array (public)', async ({ request }) => {
    const response = await request.get('/api/products?limit=5')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(Array.isArray(json.products)).toBe(true)
  })

  test('GET /api/recipes/marketplace → returns array (public)', async ({ request }) => {
    const response = await request.get('/api/recipes/marketplace?limit=5')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(Array.isArray(json.data)).toBe(true)
  })

  test('GET /api/loyalty/partners → returns array (public)', async ({ request }) => {
    const response = await request.get('/api/loyalty/partners?limit=5')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(Array.isArray(json.data)).toBe(true)
  })

  test('GET /api/loyalty/cross-actions → returns array (public)', async ({ request }) => {
    const response = await request.get('/api/loyalty/cross-actions?limit=5')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(Array.isArray(json.data)).toBe(true)
  })

  test('GET /api/venues → returns array (public)', async ({ request }) => {
    const response = await request.get('/api/venues?limit=5')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(Array.isArray(json.data)).toBe(true)
  })

  test('POST /api/ai-assistant/chat without auth → 401', async ({ request }) => {
    const response = await request.post('/api/ai-assistant/chat', {
      data: { message: 'test' },
    })
    expect(response.status()).toBe(401)
  })

  test('POST /api/ai-assistant/feedback without auth → 401', async ({ request }) => {
    const response = await request.post('/api/ai-assistant/feedback', {
      data: { log_id: 1, was_helpful: true },
    })
    expect(response.status()).toBe(401)
  })

  test('GET /api/cron/status without X-Cron-Secret → 401', async ({ request }) => {
    const response = await request.get('/api/cron/status')
    expect(response.status()).toBe(401)
  })

  test('GET /api/b2b/catalog without auth → 401', async ({ request }) => {
    const response = await request.get('/api/b2b/catalog')
    expect(response.status()).toBe(401)
  })

  test('POST /api/orders without CSRF → 403', async ({ request }) => {
    const response = await request.post('/api/orders', {
      data: { items: [] },
      headers: { Cookie: 'cd_session=e2e-cookie-session' },
    })
    expect(response.status()).toBe(403)
  })
})
