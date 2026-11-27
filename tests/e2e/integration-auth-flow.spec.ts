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
import { Client } from 'pg'
import { generateTotp } from '../../src/lib/totp'
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
  let totpSecret: string | null = null
  let backupCodes: string[] = []
  let tfaTempToken: string | null = null

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

  test('4. 2FA setup → persists encrypted TOTP secret and returns QR payload', async ({ request }) => {
    expect(accessToken).toBeTruthy()
    const response = await request.post('/api/auth/2fa/setup', {
      headers: { 'x-real-ip': testIp, Authorization: `Bearer ${accessToken}` },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json()
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(body.otpauthUri).toContain('otpauth://totp/')
    expect(body.qrCodeUrl).toContain('api.qrserver.com')
    totpSecret = body.secret
  })

  test('5. 2FA verify → activates TOTP and stores only hashed backup codes', async ({ request }) => {
    expect(accessToken).toBeTruthy()
    expect(totpSecret).toBeTruthy()
    const response = await request.post('/api/auth/2fa/verify', {
      headers: { 'x-real-ip': testIp, Authorization: `Bearer ${accessToken}` },
      data: { code: generateTotp(totpSecret!) },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.backupCodes).toHaveLength(10)
    backupCodes = body.backupCodes

    const db = new Client({ connectionString: process.env.PGURL || process.env.DATABASE_URL })
    await db.connect()
    try {
      const stored = await db.query(
        'SELECT two_factor_enabled, two_factor_secret, two_factor_backup_codes FROM public.profiles WHERE id=$1::uuid',
        [userId],
      )
      expect(stored.rowCount).toBe(1)
      expect(stored.rows[0].two_factor_enabled).toBe(true)
      expect(stored.rows[0].two_factor_secret).not.toBe(totpSecret)
      expect(stored.rows[0].two_factor_secret).toContain(':')
      expect(stored.rows[0].two_factor_backup_codes).toHaveLength(10)
      expect(stored.rows[0].two_factor_backup_codes).not.toContain(backupCodes[0])
    } finally {
      await db.end()
    }
  })

  test('6. Login with enabled 2FA → returns temporary token, never access token', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      headers: { 'x-real-ip': testIp },
      data: { email: uniqueEmail, password: testPassword },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json()
    expect(body.tfaRequired).toBe(true)
    expect(body.tfaTempToken).toBeTruthy()
    expect(body.accessToken).toBeUndefined()
    tfaTempToken = body.tfaTempToken
  })

  test('7. TOTP second factor → issues a normal application session', async ({ request }) => {
    expect(tfaTempToken).toBeTruthy()
    expect(totpSecret).toBeTruthy()
    const response = await request.post('/api/auth/2fa/login-verify', {
      headers: { 'x-real-ip': testIp },
      data: { tfaTempToken, code: generateTotp(totpSecret!) },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json()
    expect(body.user.id).toBe(userId)
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    accessToken = body.accessToken
    refreshToken = body.refreshToken
  })

  test('8. Backup code is accepted exactly once', async ({ request }) => {
    expect(backupCodes.length).toBe(10)
    const login = await request.post('/api/auth/login', {
      headers: { 'x-real-ip': testIp },
      data: { email: uniqueEmail, password: testPassword },
    })
    expect(login.status(), await login.text()).toBe(200)
    const loginBody = await login.json()
    expect(loginBody.tfaRequired).toBe(true)
    const payload = { tfaTempToken: loginBody.tfaTempToken, backupCode: backupCodes[0] }

    const first = await request.post('/api/auth/2fa/login-verify', {
      headers: { 'x-real-ip': testIp },
      data: payload,
    })
    expect(first.status(), await first.text()).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.accessToken).toBeTruthy()
    expect(firstBody.refreshToken).toBeTruthy()
    accessToken = firstBody.accessToken
    refreshToken = firstBody.refreshToken

    const replay = await request.post('/api/auth/2fa/login-verify', {
      headers: { 'x-real-ip': testIp },
      data: payload,
    })
    expect(replay.status()).toBe(401)
  })

  test('9. Logout revokes the current server-side session', async ({ request }) => {
    expect(accessToken).toBeTruthy()
    const logout = await request.post('/api/auth/logout', {
      headers: { 'x-real-ip': testIp, Authorization: `Bearer ${accessToken}` },
    })
    expect(logout.status(), await logout.text()).toBe(200)
    const session = await request.get('/api/auth/session', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(session.status()).toBe(200)
    expect((await session.json()).user).toBeNull()
  })

  test('10. Health check → status ok or degraded', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(['ok', 'degraded']).toContain(json.status)
    expect(json.features.roles_v2).toBe(true)
    expect(json.features.rbac).toBe(true)
    expect(json.features.csrf_protection).toBe(true)
  })

  test('11. CSRF protection — POST without token → 403', async ({ request }) => {
    const response = await request.post('/api/loyalty/partners', {
      data: { company_name: 'Test', company_type: 'bank', contact_email: 'test@test.com' },
      headers: { Cookie: 'cd_session=e2e-cookie-session' },
    })
    expect(response.status()).toBe(403)
    const body = await response.json()
    expect(body.error).toContain('CSRF')
  })

  test('12. Rate limiting — health endpoint always 200', async ({ request }) => {
    for (let i = 0; i < 5; i++) {
      const response = await request.get('/api/health')
      expect(response.status()).toBe(200)
    }
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
