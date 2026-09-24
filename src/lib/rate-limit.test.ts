import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, getClientIP, RATE_LIMITS } from './rate-limit'

// Сбрасываем in-memory стор перед каждым тестом
beforeEach(() => {
  // rate-limit использует internal Map, сбросить можно только через повторный import
  // Но т.к. в тестовом окружении REDIS_URL не задан — будет использоваться in-memory
  // и новые ключи начнутся с нуля. Используем уникальные ключи для каждого теста.
})

describe('rateLimit', () => {
  it('allows first request', async () => {
    const result = await rateLimit({
      key: `test-first-${Date.now()}`,
      limit: 5,
      windowMs: 1000,
    })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks request exceeding limit', async () => {
    const key = `test-block-${Date.now()}`
    // Делаем 5 запросов
    for (let i = 0; i < 5; i++) {
      const r = await rateLimit({ key, limit: 5, windowMs: 1000 })
      expect(r.success).toBe(true)
    }
    // 6-й должен быть заблокирован
    const blocked = await rateLimit({ key, limit: 5, windowMs: 1000 })
    expect(blocked.success).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('counts remaining correctly', async () => {
    const key = `test-remaining-${Date.now()}`
    const r1 = await rateLimit({ key, limit: 3, windowMs: 1000 })
    expect(r1.remaining).toBe(2)
    const r2 = await rateLimit({ key, limit: 3, windowMs: 1000 })
    expect(r2.remaining).toBe(1)
    const r3 = await rateLimit({ key, limit: 3, windowMs: 1000 })
    expect(r3.remaining).toBe(0)
    const r4 = await rateLimit({ key, limit: 3, windowMs: 1000 })
    expect(r4.success).toBe(false)
  })

  it('uses separate buckets for different keys', async () => {
    const key1 = `test-sep1-${Date.now()}`
    const key2 = `test-sep2-${Date.now()}`
    await rateLimit({ key: key1, limit: 2, windowMs: 1000 })
    await rateLimit({ key: key1, limit: 2, windowMs: 1000 })
    // key2 должен иметь полный лимит
    const r = await rateLimit({ key: key2, limit: 2, windowMs: 1000 })
    expect(r.success).toBe(true)
    expect(r.remaining).toBe(1)
  })

  it('expires requests after window passes', async () => {
    const key = `test-expire-${Date.now()}`
    // Окно 50мс — короткое, чтобы тест был быстрым
    await rateLimit({ key, limit: 1, windowMs: 50 })
    const blocked = await rateLimit({ key, limit: 1, windowMs: 50 })
    expect(blocked.success).toBe(false)
    // Ждём 80мс чтобы окно прошло
    await new Promise((r) => setTimeout(r, 80))
    const after = await rateLimit({ key, limit: 1, windowMs: 50 })
    expect(after.success).toBe(true)
  })
})

describe('RATE_LIMITS presets', () => {
  it('has auth preset', () => {
    expect(RATE_LIMITS.auth.limit).toBe(5)
    expect(RATE_LIMITS.auth.windowMs).toBe(60_000)
  })

  it('has register preset', () => {
    expect(RATE_LIMITS.register.limit).toBe(3)
  })

  it('has passwordReset preset (per hour)', () => {
    expect(RATE_LIMITS.passwordReset.windowMs).toBe(60 * 60_000)
  })

  it('has orders preset', () => {
    expect(RATE_LIMITS.orders.limit).toBe(10)
  })

  it('has api preset (per minute)', () => {
    expect(RATE_LIMITS.api.windowMs).toBe(60_000)
    expect(RATE_LIMITS.api.limit).toBe(60)
  })
})

describe('getClientIP', () => {
  it('extracts IP from x-forwarded-for', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })
    expect(getClientIP(req)).toBe('1.2.3.4')
  })

  it('extracts IP from x-real-ip', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-real-ip': '9.9.9.9' },
    })
    expect(getClientIP(req)).toBe('9.9.9.9')
  })

  it('extracts IP from cf-connecting-ip (Cloudflare)', () => {
    const req = new Request('https://example.com', {
      headers: { 'cf-connecting-ip': '8.8.8.8' },
    })
    expect(getClientIP(req)).toBe('8.8.8.8')
  })

  it('returns "unknown" if no IP headers present', () => {
    const req = new Request('https://example.com')
    expect(getClientIP(req)).toBe('unknown')
  })

  it('handles single IP in x-forwarded-for', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.1.1.1' },
    })
    expect(getClientIP(req)).toBe('1.1.1.1')
  })
})
