import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyCronSecret, cronUnauthorized } from './cron-auth'

describe('verifyCronSecret', () => {
  const originalSecret = process.env.CRON_SECRET

  afterEach(() => {
    // Восстанавливаем оригинальное значение
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalSecret
    }
  })

  it('returns false when CRON_SECRET is not set', () => {
    delete process.env.CRON_SECRET
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': 'any-value' },
    })
    expect(verifyCronSecret(req)).toBe(false)
  })

  it('returns false when CRON_SECRET is empty string', () => {
    process.env.CRON_SECRET = ''
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': '' },
    })
    expect(verifyCronSecret(req)).toBe(false)
  })

  it('returns false when header is missing', () => {
    process.env.CRON_SECRET = 'my-secret'
    const req = new Request('https://example.com/api/cron/test')
    expect(verifyCronSecret(req)).toBe(false)
  })

  it('returns false when header is empty', () => {
    process.env.CRON_SECRET = 'my-secret'
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': '' },
    })
    expect(verifyCronSecret(req)).toBe(false)
  })

  it('returns false when header does not match secret', () => {
    process.env.CRON_SECRET = 'correct-secret'
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': 'wrong-secret' },
    })
    expect(verifyCronSecret(req)).toBe(false)
  })

  it('returns true when header matches secret', () => {
    process.env.CRON_SECRET = 'my-cron-secret-123'
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': 'my-cron-secret-123' },
    })
    expect(verifyCronSecret(req)).toBe(true)
  })

  it('is case-sensitive (header name is case-insensitive in Request)', () => {
    process.env.CRON_SECRET = 'my-secret'
    // Headers в Request нормализуются, так что "x-cron-secret" == "X-Cron-Secret"
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'x-cron-secret': 'my-secret' },
    })
    expect(verifyCronSecret(req)).toBe(true)
  })

  it('rejects partial match', () => {
    process.env.CRON_SECRET = 'my-secret-123'
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': 'my-secret' },
    })
    expect(verifyCronSecret(req)).toBe(false)
  })

  it('handles whitespace (Request trims headers automatically)', () => {
    // Замечание: fetch Request автоматически убирает leading/trailing whitespace
    // из header values, поэтому ' my-secret ' становится 'my-secret'
    process.env.CRON_SECRET = 'my-secret'
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': ' my-secret ' },
    })
    expect(verifyCronSecret(req)).toBe(true)
  })

  it('handles long secrets', () => {
    const longSecret = 'a'.repeat(256)
    process.env.CRON_SECRET = longSecret
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': longSecret },
    })
    expect(verifyCronSecret(req)).toBe(true)
  })

  it('handles secrets with special characters', () => {
    process.env.CRON_SECRET = 'secret!@#$%^&*()_+-={}[]|\\:";\'<>?,./'
    const req = new Request('https://example.com/api/cron/test', {
      headers: { 'X-Cron-Secret': 'secret!@#$%^&*()_+-={}[]|\\:";\'<>?,./' },
    })
    expect(verifyCronSecret(req)).toBe(true)
  })
})

describe('cronUnauthorized', () => {
  it('returns a Response object', () => {
    const res = cronUnauthorized()
    expect(res).toBeInstanceOf(Response)
  })

  it('returns 401 status', () => {
    const res = cronUnauthorized()
    expect(res.status).toBe(401)
  })

  it('returns JSON content-type header', () => {
    const res = cronUnauthorized()
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('returns error message in JSON body', async () => {
    const res = cronUnauthorized()
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('error message mentions X-Cron-Secret', async () => {
    const res = cronUnauthorized()
    const body = await res.json()
    expect(body.error).toContain('X-Cron-Secret')
  })
})
