/**
 * E2E тесты для новых API routes v2.0 (миграция 0012):
 *   - /api/recipes/marketplace
 *   - /api/recipes/marketplace/[id]
 *   - /api/recipes/marketplace/[id]/purchase
 *   - /api/loyalty/partners
 *   - /api/loyalty/cross-actions
 *   - /api/ai-assistant/chat
 *   - /api/ai-assistant/feedback
 *
 * Эти тесты запускаются против running приложения (npm run dev или preview).
 * Используют публичные endpoints (GET) и валидируют контракты.
 * Для POST/PATCH/DELETE — проверяют что endpoint защищён аутентификацией и CSRF.
 *
 * Запуск:
 *   npx playwright test --grep "API v2.0 routes"
 *   npx playwright test tests/e2e/api-v2.spec.ts
 */
import { test, expect } from '@playwright/test'

const CSRF_HEADER = 'x-csrf-token'
const CSRF_COOKIE = 'csrf_token'

/**
 * Получить CSRF-токен и cookie для защищённых запросов.
 * Нужно вызвать GET /api/csrf-token, получить token из JSON body
 * и cookie csrf_token (httpOnly).
 */
async function getCsrfToken(baseURL: string): Promise<{ token: string; cookie: string }> {
  const response = await fetch(`${baseURL}/api/csrf-token`)
  if (!response.ok) {
    throw new Error(`CSRF token fetch failed: ${response.status}`)
  }
  const data = await response.json() as { token: string; header: string }
  // Извлечь csrf_token cookie из Set-Cookie
  const setCookie = response.headers.get('set-cookie') || ''
  const cookieMatch = setCookie.match(/csrf_token=([^;]+)/)
  if (!cookieMatch) {
    throw new Error('CSRF cookie not set in response')
  }
  return { token: data.token, cookie: cookieMatch[1] }
}

test.describe('API v2.0 — recipes marketplace', () => {
  test('GET /api/recipes/marketplace — public list возвращает пустой массив или список', async () => {
    const response = await fetch('/api/recipes/marketplace?limit=10')
    expect(response.status).toBe(200)
    const json = await response.json() as { data: unknown[]; meta: { limit: number; offset: number } }
    expect(json).toHaveProperty('data')
    expect(json).toHaveProperty('meta')
    expect(json.meta.limit).toBe(10)
    expect(json.meta.offset).toBe(0)
    expect(Array.isArray(json.data)).toBe(true)
  })

  test('GET /api/recipes/marketplace — фильтр is_premium=true работает', async () => {
    const response = await fetch('/api/recipes/marketplace?is_premium=true&limit=50')
    expect(response.status).toBe(200)
    const json = await response.json() as { data: Array<{ is_premium: boolean }> }
    expect(Array.isArray(json.data)).toBe(true)
    // Все возвращённые рецепты должны быть премиум (если они есть)
    for (const r of json.data) {
      expect(r.is_premium).toBe(true)
    }
  })

  test('GET /api/recipes/marketplace — пагинация limit+offset работает', async () => {
    const response1 = await fetch('/api/recipes/marketplace?limit=5&offset=0')
    const json1 = await response1.json() as { data: unknown[] }
    const response2 = await fetch('/api/recipes/marketplace?limit=5&offset=5')
    const json2 = await response2.json() as { data: unknown[] }
    expect(response1.status).toBe(200)
    expect(response2.status).toBe(200)
    // Размеры должны быть <= 5
    expect(json1.data.length).toBeLessThanOrEqual(5)
    expect(json2.data.length).toBeLessThanOrEqual(5)
  })

  test('POST /api/recipes/marketplace без авторизации → 401', async () => {
    const response = await fetch('/api/recipes/marketplace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test recipe' }),
    })
    // Без авторизации — 401
    expect([401, 403]).toContain(response.status)
  })

  test('POST /api/recipes/marketplace с CSRF но без авторизации → 401 (не 403 CSRF)', async () => {
    const csrf = await getCsrfToken('')  // передаём пустой baseURL → fetch без baseURL
    const response = await fetch('/api/recipes/marketplace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER]: csrf.token,
        cookie: `${CSRF_COOKIE}=${csrf.cookie}`,
      },
      body: JSON.stringify({ title: 'Test recipe' }),
    })
    // CSRF проходит (cookie == header), но без авторизации → 401
    expect(response.status).toBe(401)
  })

  test('POST /api/recipes/marketplace/[id]/purchase без авторизации → 401', async () => {
    // Используем любой UUID — даже несуществующий, проверяем только guard
    const fakeId = '00000000-0000-0000-0000-000000000099'
    const response = await fetch(`/api/recipes/marketplace/${fakeId}/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect([401, 403]).toContain(response.status)
  })
})

test.describe('API v2.0 — loyalty partners', () => {
  test('GET /api/loyalty/partners — public endpoint возвращает список', async () => {
    const response = await fetch('/api/loyalty/partners?limit=10')
    expect(response.status).toBe(200)
    const json = await response.json() as { data: unknown[]; meta: { limit: number } }
    expect(json).toHaveProperty('data')
    expect(json.meta.limit).toBe(10)
    expect(Array.isArray(json.data)).toBe(true)
  })

  test('GET /api/loyalty/partners — фильтр company_type=bank работает', async () => {
    const response = await fetch('/api/loyalty/partners?company_type=bank')
    expect(response.status).toBe(200)
    const json = await response.json() as { data: Array<{ company_type: string }> }
    expect(Array.isArray(json.data)).toBe(true)
    // Все возвращённые партнёры должны быть типа bank
    for (const p of json.data) {
      expect(p.company_type).toBe('bank')
    }
  })

  test('GET /api/loyalty/partners — некорректный company_type игнорируется (не падает)', async () => {
    const response = await fetch('/api/loyalty/partners?company_type=invalid_type')
    expect(response.status).toBe(200)
  })

  test('POST /api/loyalty/partners без авторизации → 401 или 403', async () => {
    const response = await fetch('/api/loyalty/partners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: 'Test Co', company_type: 'bank' }),
    })
    expect([401, 403]).toContain(response.status)
  })

  test('GET /api/loyalty/cross-actions — public endpoint возвращает список', async () => {
    const response = await fetch('/api/loyalty/cross-actions?limit=10')
    expect(response.status).toBe(200)
    const json = await response.json() as { data: unknown[] }
    expect(Array.isArray(json.data)).toBe(true)
  })

  test('POST /api/loyalty/cross-actions без авторизации → 401 или 403', async () => {
    const response = await fetch('/api/loyalty/cross-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_id: '00000000-0000-0000-0000-000000000001',
        title: 'Test action',
        description: 'Test',
        discount_type: 'percent',
        discount_value: 10,
        start_at: '2026-09-01T00:00:00Z',
        end_at: '2026-10-01T00:00:00Z',
      }),
    })
    expect([401, 403]).toContain(response.status)
  })
})

test.describe('API v2.0 — AI assistant', () => {
  test('POST /api/ai-assistant/chat без авторизации → 401', async () => {
    const response = await fetch('/api/ai-assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Привет' }),
    })
    expect(response.status).toBe(401)
  })

  test('POST /api/ai-assistant/chat без поля message → 422 (с CSRF)', async () => {
    const csrf = await getCsrfToken('')
    const response = await fetch('/api/ai-assistant/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER]: csrf.token,
        cookie: `${CSRF_COOKIE}=${csrf.cookie}`,
      },
      body: JSON.stringify({}),  // пустое тело — без message
    })
    expect(response.status).toBe(422)
  })

  test('POST /api/ai-assistant/chat с слишком длинным message → 422', async () => {
    const csrf = await getCsrfToken('')
    const longMessage = 'а'.repeat(5001)  // > 5000 символов
    const response = await fetch('/api/ai-assistant/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER]: csrf.token,
        cookie: `${CSRF_COOKIE}=${csrf.cookie}`,
      },
      body: JSON.stringify({ message: longMessage }),
    })
    expect(response.status).toBe(422)
  })

  test('POST /api/ai-assistant/feedback без авторизации → 401', async () => {
    const response = await fetch('/api/ai-assistant/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: 1, was_helpful: true }),
    })
    expect(response.status).toBe(401)
  })

  test('POST /api/ai-assistant/feedback с невалидным log_id → 422 (с CSRF)', async () => {
    const csrf = await getCsrfToken('')
    const response = await fetch('/api/ai-assistant/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER]: csrf.token,
        cookie: `${CSRF_COOKIE}=${csrf.cookie}`,
      },
      body: JSON.stringify({ log_id: -1, was_helpful: true }),
    })
    expect(response.status).toBe(422)
  })

  test('GET /api/ai-assistant/conversations без авторизации → 401', async () => {
    const response = await fetch('/api/ai-assistant/conversations')
    expect(response.status).toBe(401)
  })
})

test.describe('API v2.0 — recipes marketplace contract', () => {
  test('GET /api/recipes/marketplace — структура ответа соответствует контракту', async () => {
    const response = await fetch('/api/recipes/marketplace?limit=3')
    expect(response.status).toBe(200)
    const json = await response.json() as {
      data: Array<Record<string, unknown>>
      meta: { limit: number; offset: number; hasMore: boolean }
    }

    expect(json).toHaveProperty('data')
    expect(json).toHaveProperty('meta.limit')
    expect(json).toHaveProperty('meta.offset')
    expect(json).toHaveProperty('meta.hasMore')

    // Если есть данные — проверить поля
    if (json.data.length > 0) {
      const recipe = json.data[0]
      expect(recipe).toHaveProperty('id')
      expect(recipe).toHaveProperty('title')
      expect(recipe).toHaveProperty('slug')
      expect(recipe).toHaveProperty('base_price')
      expect(recipe).toHaveProperty('is_premium')
      expect(recipe).toHaveProperty('royalty_rate')
      expect(recipe).toHaveProperty('is_published')
    }
  })

  test('GET /api/recipes/marketplace/:id с несуществующим id → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099'
    const response = await fetch(`/api/recipes/marketplace/${fakeId}`)
    expect(response.status).toBe(404)
  })
})

test.describe('API v2.0 — venues (мигрировано с @ts-nocheck)', () => {
  test('GET /api/venues — public endpoint возвращает список', async () => {
    const response = await fetch('/api/venues?limit=10')
    expect(response.status).toBe(200)
    const json = await response.json() as { data: unknown[]; meta: { limit: number } }
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.meta.limit).toBe(10)
  })

  test('POST /api/venues без авторизации → 401', async () => {
    const response = await fetch('/api/venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Loft',
        address: 'Moscow',
        capacity: 50,
        price_per_hour: 2500,
      }),
    })
    expect([401, 403]).toContain(response.status)
  })

  test('GET /api/venues с фильтром capacity работает', async () => {
    const response = await fetch('/api/venues?capacity=20&limit=5')
    expect(response.status).toBe(200)
    const json = await response.json() as { data: Array<{ capacity: number }> }
    // Все возвращённые площадки должны иметь capacity >= 20
    for (const v of json.data) {
      expect(v.capacity).toBeGreaterThanOrEqual(20)
    }
  })
})

test.describe('API v2.0 — b2b (мигрировано с @ts-nocheck)', () => {
  test('GET /api/b2b/catalog без авторизации → 401', async () => {
    const response = await fetch('/api/b2b/catalog')
    expect(response.status).toBe(401)
  })

  test('GET /api/b2b/orders без авторизации → 401', async () => {
    const response = await fetch('/api/b2b/orders')
    expect(response.status).toBe(401)
  })

  test('POST /api/b2b/orders без авторизации → 401', async () => {
    const response = await fetch('/api/b2b/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: 'test', quantity: 10 }],
        deliveryDate: '2026-09-15',
      }),
    })
    expect([401, 403]).toContain(response.status)
  })
})

test.describe('API v2.0 — мигрированные cron routes', () => {
  test('GET /api/cron/status без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/status')
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/cleanup без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/cleanup')
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/escrow-release без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/escrow-release')
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/expiring-bonuses без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/expiring-bonuses')
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/subscriptions без X-Cron-Secret → 401 или 405', async () => {
    // POST endpoint — GET должен вернуть 405 (method not allowed) или 401
    const response = await fetch('/api/cron/subscriptions')
    expect([401, 405]).toContain(response.status)
  })

  test('POST /api/cron/subscriptions без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/abandoned-cart без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/abandoned-cart')
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/weekly-digest без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/weekly-digest')
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/backup без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/backup')
    expect(response.status).toBe(401)
  })

  test('POST /api/cron/holiday-reminders без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/holiday-reminders', {
      method: 'POST',
    })
    expect(response.status).toBe(401)
  })

  test('GET /api/cron/payment-reminders без X-Cron-Secret → 401', async () => {
    const response = await fetch('/api/cron/payment-reminders')
    expect(response.status).toBe(401)
  })
})
