/**
 * Интеграционный e2e тест — полный auth flow:
 * register → login → refresh → 2fa setup (CSRF-гейт)
 *
 * Использует Playwright's `request` fixture с baseURL из config.
 * Внимание: тесты создают реальные записи в БД (если доступна).
 *
 * Детерминизм фикстур (TZ v4.0 §8.2, DEV-05):
 *   Раньше телефон был ФИКСИРОВАННЫМ (+79990000000): пользователь от успешного
 *   прогона блокировал следующий (409 «Телефон уже зарегистрирован»), а 409
 *   ошибочно классифицировался как «email занят» → test.skip → каскадные skip
 *   шагов 2–4. Теперь:
 *     • email/phone генерируются УНИКАЛЬНЫМИ на каждый прогон (RFC-валидные,
 *       синтетические домены .test — маркеры тестовых данных, не PII);
 *     • 409 классифицируется ПО ТЕЛУ ОТВЕТА (route возвращает
 *       {error:"Email уже зарегистрирован"} | {error:"Телефон уже зарегистрирован"},
 *       см. src/app/api/auth/register/route.ts шаги 3–4) и всегда ПАДАЕТ, не skip;
 *     • каскадные test.skip() убраны: шаги сами проверяют свои предпосылки
 *       expect'ами и честно ПАДАЮТ с точной диагностикой. Единственный
 *       разрешённый skip в e2e-сьюте — E2E_FULL_STACK (onboarding-flow.spec.ts).
 *   Поэтому здесь НЕТ test.describe.serial: серийный режим Playwright сам
 *   скипает последующие тесты после падения — тот же каскадный skip под
 *   другим именем. Порядок выполнения обеспечивается одним воркером
 *   (workers=1, fullyParallel=false локально; CI — chromium-only).
 *
 * Запуск (канонический режим — dev, см. docs/evidence/e2e-tally/TALLY.md):
 *   E2E_SERVER_MODE=dev bash scripts/e2e-one.sh integration-auth-flow
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// Идентификатор прогона: попадает в фикстуры (и в диагностику падений) —
// по нему однозначно видно, чей пользователь создал конфликт.
export const E2E_RUN_ID = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`

// Per-run уникальные фикстуры. ЯВНО синтетические: домен .test (RFC 2606
// зарезервирован для тестов), телефон из диапазона +7 999 XXX XX XX.
// Экспортируются, чтобы другие спеки могли импортировать константы, а не
// плодить собственные фиксированные значения.
export const uniqueEmail = `e2e-${E2E_RUN_ID}@e2e.test`
export const testPhone = `+7999${randomUUID().replace(/\D/g, '').padEnd(7, '0').slice(0, 7)}`
const testPassword = 'TestPassword123!'
const testName = 'E2E Test User'

test.describe('Integration: full auth flow (порядок: register → login → refresh)', () => {
  // Решение владельца 2026-10-17: register-лимит возвращён к исходным 3/час,
  // а реальная регистрация здесь жёстко падает на 429 (см. классификацию ниже).
  // Выделен собственный симулированный клиентский IP — прогон детерминирован
  // и не зависит от register-попыток других спеков. x-real-ip — доверенный
  // канал reverse-proxy (extractIp, src/lib/anti-fraud.ts); в production
  // значение перезаписывает Caddy, подделка исключена (docs/DNS_SETUP.md).
  test.use({ extraHTTPHeaders: { 'x-real-ip': '10.20.0.22' } })

  let accessToken: string | null = null
  let refreshToken: string | null = null
  let userId: string | null = null

  test('1. Register → creates user + returns tokens', async ({ request }) => {
    const response = await request.post('/api/auth/register', {
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
    const body = await response.json().catch(() => null as { error?: string; details?: string; retryAfter?: number } | null)

    if (response.status() !== 201) {
      // Классификация ПО ТЕЛУ ОТВЕТА (не догадкой по «409 = email»):
      //   409 + «Телефон…» → PHONE_TAKEN; 409 + «Email…» → EMAIL_TAKEN;
      //   прочее — честная метка причины. Фикстуры прогона уникальны, поэтому
      //   конфликт возможен только с данными ДРУГОГО прогона/источника —
      //   это дефект изоляции: тест ПАДАЕТ (skip запрещён, TZ §8.2).
      const reason = (body && (body.error || body.details)) || '(тело ответа без поля error)'
      const kind =
        response.status() === 409
          ? /телефон/i.test(reason)
            ? 'PHONE_TAKEN'
            : /email/i.test(reason)
              ? 'EMAIL_TAKEN'
              : 'CONFLICT_UNKNOWN_REASON'
          : response.status() === 429
            ? 'RATE_LIMITED(anti-fraud)'
            : response.status() === 500
              ? 'SERVER_ERROR(dev-режим регистрация должна работать — см. TALLY.md «Режимы»)'
              : 'UNEXPECTED_STATUS'
      throw new Error(
        `Register → ${response.status()} (${kind}): ${reason} | run=${E2E_RUN_ID}. ` +
          `Фикстуры этого прогона уникальны; конфликт означает коллизию с чужими данными, ` +
          `выжженное окно антифрода или отказ БД — прогон падает, а не пропускается.`,
      )
    }

    expect(body?.user).toBeDefined()
    expect(body?.accessToken).toBeDefined()
    expect(body?.refreshToken).toBeDefined()
    accessToken = body!.accessToken
    refreshToken = body!.refreshToken
    userId = body!.user.id
  })

  test('2. Login → returns tokens', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: { email: uniqueEmail, password: testPassword },
    })
    // Контракт: сразу после успешной регистрации теми же учётными данными
    // логин ОБЯЗАН вернуть 200. 401 здесь — провал регистрации (шаг 1) или
    // потеря записи между шагами — честное падение, не skip.
    expect(response.status(), 'login после успешной register обязан вернуть 200').toBe(200)
    const json = await response.json()
    expect(json.user).toBeDefined()
    expect(json.accessToken).toBeDefined()
    accessToken = json.accessToken
    refreshToken = json.refreshToken
    userId = json.user.id
  })

  test('3. Refresh token → new access token', async ({ request }) => {
    // Гард от каскадного skip: нет refresh-токена = register/login не выдали
    // токены — это ПРОВАЛ контракта, падаем с точной диагностикой.
    expect(refreshToken, 'refresh-токен отсутствует: register/login не выдали refresh (см. шаги 1–2)').toBeTruthy()

    const response = await request.post('/api/auth/refresh', {
      data: { refreshToken },
    })
    // Свежевыпущенный refresh-токен обязан приниматься: ровно 200.
    expect(response.status(), 'свежий refresh-токен обязан давать 200').toBe(200)
    const json = await response.json()
    expect(json.accessToken).toBeDefined()
    accessToken = json.accessToken
  })

  test('4. 2FA setup → returns QR code', async ({ request }) => {
    // Этот шаг — негативный CSRF-тест: он НЕ зависит от успеха регистрации
    // (проверяется гейт middleware, а не сессия), поэтому каскадная
    // предпосылка «есть access token» удалена — раньше она давала
    // каскадный skip при падении шага 1.
    // 2FA setup требует CSRF — пробуем без (ожидаем 403 CSRF-гейт / 401 auth).
    const response = await request.post('/api/auth/2fa/setup')

    // 403 (CSRF) или 401 (не авторизован)
    expect([403, 401]).toContain(response.status())
  })

  // Шаги 5–7 независимы от auth-цепочки (публичная инфраструктура).

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
    // Health не rate-limited
    for (let i = 0; i < 5; i++) {
      const response = await request.get('/api/health')
      expect(response.status()).toBe(200)
    }
  })
})

/**
 * Получить CSRF-токен (header) и csrf_token cookie (double-submit pattern).
 * Middleware требует ОБА: header x-csrf-token и cookie csrf_token.
 */
async function extractCsrf(csrfResponse: any): Promise<{ token: string; cookie: string }> {
  expect(csrfResponse.status()).toBe(200)
  const body = await csrfResponse.json()
  const setCookie = csrfResponse.headers()['set-cookie'] || ''
  const match = setCookie.match(/csrf_token=([^;]+)/)
  expect(match).toBeTruthy()
  return { token: body.token, cookie: match![1] }
}

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
    // Контракт: без сессии, но с валидным CSRF-токеном → маршрут отвечает 401.
    // ВАЖНО: куку отправляем ЯВНО из того же ответа — csrf_token в prod-режиме
    // помечен Secure и request-фикстура не отправляет Secure-куки по http.
    const csrf = await request.get('/api/csrf-token')
    const { token, cookie } = await extractCsrf(csrf)
    const response = await request.post('/api/ai-assistant/chat', {
      data: { message: 'test' },
      headers: { 'x-csrf-token': token, cookie: `${'csrf_token'}=${cookie}` },
    })
    expect(response.status()).toBe(401)
  })

  test('POST /api/ai-assistant/feedback without auth → 401', async ({ request }) => {
    const csrf = await request.get('/api/csrf-token')
    const { token, cookie } = await extractCsrf(csrf)
    const response = await request.post('/api/ai-assistant/feedback', {
      data: { log_id: 1, was_helpful: true },
      headers: { 'x-csrf-token': token, cookie: `${'csrf_token'}=${cookie}` },
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
