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

  it('extracts first IP from comma-separated x-forwarded-for', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' },
    })
    expect(extractIp(req)).toBe('1.2.3.4')
  })

  it('trims whitespace from forwarded IP', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '  1.2.3.4  ' },
    })
    expect(extractIp(req)).toBe('1.2.3.4')
  })

  it('trims whitespace in comma-separated list', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': ' 1.2.3.4 ,  5.6.7.8 ' },
    })
    expect(extractIp(req)).toBe('1.2.3.4')
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

  it('prioritizes x-forwarded-for over x-real-ip', () => {
    const req = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
      },
    })
    expect(extractIp(req)).toBe('1.1.1.1')
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

  it('register: 3/час (строгий лимит от спама регистраций)', () => {
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
