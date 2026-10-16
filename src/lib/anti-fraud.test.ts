import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashIp, extractIp, LIMITS } from './anti-fraud'

describe('hashIp', () => {
  it('returns a 64-char hex string for valid IP', () => {
    const result = hashIp('1.2.3.4')
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns consistent hash for same IP', () => {
    const a = hashIp('192.168.1.1')
    const b = hashIp('192.168.1.1')
    expect(a).toBe(b)
  })

  it('returns different hashes for different IPs', () => {
    const a = hashIp('1.1.1.1')
    const b = hashIp('2.2.2.2')
    expect(a).not.toBe(b)
  })

  it('handles IPv6 addresses', () => {
    const result = hashIp('2001:db8::1')
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles empty string', () => {
    const result = hashIp('')
    expect(result).toHaveLength(64)
    // Should still produce a valid hash (of salt + ':')
  })

  it('uses salt from env if set', () => {
    const originalSalt = process.env.IP_HASH_SALT
    process.env.IP_HASH_SALT = 'custom-test-salt-123'
    const a = hashIp('1.2.3.4')
    process.env.IP_HASH_SALT = 'different-salt-456'
    const b = hashIp('1.2.3.4')
    expect(a).not.toBe(b)
    process.env.IP_HASH_SALT = originalSalt
  })

  it('uses default salt when env not set', () => {
    const originalSalt = process.env.IP_HASH_SALT
    delete process.env.IP_HASH_SALT
    const result = hashIp('1.2.3.4')
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]{64}$/)
    process.env.IP_HASH_SALT = originalSalt
  })

  it('does not leak the IP in the hash output', () => {
    const ip = '1.2.3.4'
    const result = hashIp(ip)
    // Hash is hex, IP "1.2.3.4" contains dots and digits but hash should be hex only
    expect(result).not.toContain('.')
  })
})

describe('extractIp', () => {
  it('extracts IP from x-forwarded-for header', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(extractIp(req)).toBe('1.2.3.4')
  })

  it('takes LAST hop from comma-separated x-forwarded-for (trusted proxy appends client)', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' },
    })
    expect(extractIp(req)).toBe('9.10.11.12')
  })

  it('trims whitespace from forwarded IP', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '  1.2.3.4  ' },
    })
    expect(extractIp(req)).toBe('1.2.3.4')
  })

  it('trims whitespace in comma-separated list (tail is client)', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': ' 1.2.3.4 ,  5.6.7.8 ' },
    })
    expect(extractIp(req)).toBe('5.6.7.8')
  })

  it('falls back to x-real-ip when x-forwarded-for missing', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-real-ip': '9.9.9.9' },
    })
    expect(extractIp(req)).toBe('9.9.9.9')
  })

  it('trims x-real-ip value', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-real-ip': '  9.9.9.9  ' },
    })
    expect(extractIp(req)).toBe('9.9.9.9')
  })

  it('returns "0.0.0.0" when no IP headers present', () => {
    const req = new Request('https://example.com')
    expect(extractIp(req)).toBe('0.0.0.0')
  })

  it('returns "0.0.0.0" when headers are empty', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '', 'x-real-ip': '' },
    })
    expect(extractIp(req)).toBe('0.0.0.0')
  })

  it('prioritizes x-real-ip over x-forwarded-for (trusted proxy header wins)', () => {
    const req = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
      },
    })
    expect(extractIp(req)).toBe('2.2.2.2')
  })

  it('handles IPv6 in x-forwarded-for', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '2001:db8::1' },
    })
    expect(extractIp(req)).toBe('2001:db8::1')
  })

  it('handles headers case-insensitively (Request normalizes)', () => {
    const req = new Request('https://example.com', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    })
    expect(extractIp(req)).toBe('1.2.3.4')
  })
})

describe('LIMITS config', () => {
  it('содержит конфиги для всех FraudAction', () => {
    expect(LIMITS.order_create).toBeDefined()
    expect(LIMITS.register).toBeDefined()
    expect(LIMITS.login).toBeDefined()
    expect(LIMITS.review).toBeDefined()
  })

  it('order_create: 5/час, 20/день', () => {
    expect(LIMITS.order_create.maxPerHour).toBe(5)
    expect(LIMITS.order_create.maxPerDay).toBe(20)
  })

  it('register: 3/час (решение владельца 2026-10-17 — исходный лимит сохранён)', () => {
    // Владелец: повышение 3→10 не считать автоматически одобренным; исходный
    // лимит сохраняется до подтверждения, что увеличение необходимо и
    // достаточно защищено от злоупотреблений (RELEASE-GATE-v4.5 §решения).
    // E2E-совместимость достигнута per-spec симулированным x-real-ip
    // (доверенный канал, в prod перезаписывается Caddy), а не повышением лимита.
    expect(LIMITS.register.maxPerHour).toBe(3)
    expect(LIMITS.register.maxPerDay).toBe(10)
  })

  it('login: 20/час (умеренный лимит, защита от brute-force)', () => {
    expect(LIMITS.login.maxPerHour).toBe(20)
  })

  it('review: 10/час (защита от накруток отзывов)', () => {
    expect(LIMITS.review.maxPerHour).toBe(10)
  })

  it('maxPerHour всегда <= maxPerDay', () => {
    for (const action of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
      expect(LIMITS[action].maxPerHour).toBeLessThanOrEqual(LIMITS[action].maxPerDay)
    }
  })

  it('все лимиты — положительные числа', () => {
    for (const action of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
      expect(LIMITS[action].maxPerHour).toBeGreaterThan(0)
      expect(LIMITS[action].maxPerDay).toBeGreaterThan(0)
    }
  })
})

// ===== checkFraudLimit: часовое И суточное окна (v4.6, P0-antifraud) =====
// Дневной лимит maxPerDay до v4.6 был объявлен в конфиге, но НЕ проверялся:
// checkFraudLimit сравнивал счётчик только с maxPerHour, и атакующий мог
// держать ровно maxPerHour попыток КАЖДЫЙ час (до 24*maxPerHour в сутки).
// Эти тесты фиксируют контракт ОБЕИХ проверок на моке supabaseAdmin.
const hoisted = vi.hoisted(() => {
  // Очередь ответов select-запросов (час → сутки), вызовы вставляются тестом.
  const selectQueue: Array<{ count: number | null; error: { message: string } | null }> = []
  const calls: string[] = []
  const makeBuilder = () => {
    const builder: Record<string, unknown> = {}
    builder.insert = vi.fn(() => {
      calls.push('insert')
      return Promise.resolve({ error: null })
    })
    builder.select = vi.fn(() => {
      calls.push('select')
      const chain: Record<string, unknown> = {}
      const passthrough = (): Record<string, unknown> => chain
      chain.eq = passthrough
      chain.gte = passthrough
      chain.not = passthrough
      chain.limit = passthrough
      chain.then = (
        resolve: (v: { count: number | null; error: { message: string } | null }) => void,
        reject: (e: unknown) => void
      ) => {
        const next = selectQueue.shift()
        if (!next) {
          reject(new Error('selectQueue exhausted — тест не задал ответ для этого select-запроса'))
          return
        }
        resolve(next)
      }
      return chain
    })
    return builder
  }
  return {
    selectQueue,
    calls,
    fromMock: vi.fn(() => makeBuilder()),
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: hoisted.fromMock,
  },
}))

// Импорт ПОСЛЕ vi.mock (hoisting): anti-fraud получит замоканный admin-клиент
import { checkFraudLimit } from './anti-fraud'

describe('checkFraudLimit — два окна (v4.6)', () => {
  const req = (): Request =>
    new Request('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'x-real-ip': '10.55.0.1' },
    })

  beforeEach(() => {
    hoisted.selectQueue.length = 0
    hoisted.calls.length = 0
    hoisted.fromMock.mockClear()
  })

  it('register: час в норме, сутки в норме → allowed, remaining по часу', async () => {
    hoisted.selectQueue.push({ count: 2, error: null }, { count: 5, error: null })
    const res = await checkFraudLimit(req(), 'register')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(LIMITS.register.maxPerHour - 2)
  })

  it('register: 4-я попытка в час → отказ по часовому лимиту (3/час)', async () => {
    hoisted.selectQueue.push({ count: 4, error: null })
    const res = await checkFraudLimit(req(), 'register')
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('3/час')
    // Дневной select не выполняется на отказном часовом пути (экономия запроса)
    expect(hoisted.selectQueue).toHaveLength(0)
  })

  it('register: час OK (2), сутки 11 > 10 → отказ по СУТОЧНОМУ лимиту (v4.6 — раньше пропускалось)', async () => {
    hoisted.selectQueue.push({ count: 2, error: null }, { count: 11, error: null })
    const res = await checkFraudLimit(req(), 'register')
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('суточный')
    expect(res.reason).toContain('10/24ч')
    expect(res.remaining).toBe(0)
  })

  it('register: ровно 10 за сутки (граница) → allowed (строгое неравенство >)', async () => {
    hoisted.selectQueue.push({ count: 3, error: null }, { count: 10, error: null })
    const res = await checkFraudLimit(req(), 'register')
    expect(res.allowed).toBe(true)
  })

  it('daily-атака «maxPerHour каждый час» теперь закрыта: 5/ч × 5ч = 25 > 20 → отказ', async () => {
    // order_create: атакующий держит ровно 5 заказов в час (часовой лимит
    // проходит), но за 24ч накапливает 25 > 20 → дневной лимит срабатывает.
    hoisted.selectQueue.push({ count: 5, error: null }, { count: 25, error: null })
    const res = await checkFraudLimit(req(), 'order_create')
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('20/24ч')
  })

  it('strict-порядок: попытка записывается ДО подсчёта (insert раньше select)', async () => {
    hoisted.selectQueue.push({ count: 1, error: null }, { count: 1, error: null })
    await checkFraudLimit(req(), 'register')
    expect(hoisted.calls[0]).toBe('insert')
    expect(hoisted.calls).toContain('select')
    expect(hoisted.calls.indexOf('insert')).toBeLessThan(hoisted.calls.indexOf('select'))
  })

  it('ошибка часового подсчёта → fail-open (allow, консистентно с прежним контрактом)', async () => {
    hoisted.selectQueue.push({ count: null, error: { message: 'db down' } })
    const res = await checkFraudLimit(req(), 'register')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(LIMITS.register.maxPerHour)
  })

  it('ошибка дневного подсчёта → fail-open (allow)', async () => {
    hoisted.selectQueue.push({ count: 2, error: null }, { count: null, error: { message: 'db down' } })
    const res = await checkFraudLimit(req(), 'register')
    expect(res.allowed).toBe(true)
  })

  it('ошибка вставки попытки → fail-open (allow, попытка не посчитана)', async () => {
    hoisted.fromMock.mockImplementationOnce(() => ({
      insert: vi.fn(() => Promise.resolve({ error: { message: 'insert failed' } })),
    }))
    const res = await checkFraudLimit(req(), 'register')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(LIMITS.register.maxPerHour)
  })

  it('разные IP → разные бакеты: один insert + два select (час+сутки) на попытку', async () => {
    hoisted.selectQueue.push({ count: 1, error: null }, { count: 1, error: null })
    await checkFraudLimit(
      new Request('https://example.com', { headers: { 'x-real-ip': '10.55.0.2' } }),
      'register'
    )
    expect(hoisted.calls).toEqual(['insert', 'select', 'select'])
    expect(hoisted.fromMock).toHaveBeenCalledTimes(3)
  })
})
