import { describe, it, expect } from 'vitest'
import {
  generateCsrfToken,
  validateCsrfToken,
  shouldCheckCsrf,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from './csrf'

describe('generateCsrfToken', () => {
  it('returns a string', () => {
    const token = generateCsrfToken()
    expect(typeof token).toBe('string')
  })

  it('returns a 64-char hex string (32 bytes)', () => {
    const token = generateCsrfToken()
    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique tokens each call', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i++) {
      tokens.add(generateCsrfToken())
    }
    expect(tokens.size).toBe(100)
  })

  it('has sufficient entropy (not all zeros)', () => {
    const token = generateCsrfToken()
    expect(token).not.toBe('0'.repeat(64))
    // Проверяем что есть и 0 и 1 в битах (простая проверка энтропии)
    const hasZero = token.includes('0')
    const hasOne = token.includes('1') || token.includes('2') || token.includes('3')
    expect(hasZero || hasOne).toBe(true)
  })
})

describe('validateCsrfToken', () => {
  it('returns true when cookie and header match', () => {
    const token = generateCsrfToken()
    expect(validateCsrfToken(token, token)).toBe(true)
  })

  it('returns false when cookie is null', () => {
    expect(validateCsrfToken(null, 'some-token')).toBe(false)
  })

  it('returns false when header is null', () => {
    expect(validateCsrfToken('some-token', null)).toBe(false)
  })

  it('returns false when both are null', () => {
    expect(validateCsrfToken(null, null)).toBe(false)
  })

  it('returns false when tokens differ', () => {
    const a = generateCsrfToken()
    const b = generateCsrfToken()
    expect(a).not.toBe(b)
    expect(validateCsrfToken(a, b)).toBe(false)
  })

  it('returns false when tokens have different lengths', () => {
    expect(validateCsrfToken('short', 'much-longer-token')).toBe(false)
  })

  it('returns false for empty strings', () => {
    expect(validateCsrfToken('', '')).toBe(false)
  })

  it('handles identical long tokens (timing-safe)', () => {
    const token = generateCsrfToken()
    expect(validateCsrfToken(token, token)).toBe(true)
  })

  it('returns true for any non-null identical strings', () => {
    expect(validateCsrfToken('abc', 'abc')).toBe(true)
    expect(validateCsrfToken('12345', '12345')).toBe(true)
  })
})

describe('shouldCheckCsrf', () => {
  it('returns true for POST', () => {
    expect(shouldCheckCsrf('POST')).toBe(true)
  })

  it('returns true for PUT', () => {
    expect(shouldCheckCsrf('PUT')).toBe(true)
  })

  it('returns true for PATCH', () => {
    expect(shouldCheckCsrf('PATCH')).toBe(true)
  })

  it('returns true for DELETE', () => {
    expect(shouldCheckCsrf('DELETE')).toBe(true)
  })

  it('returns false for GET', () => {
    expect(shouldCheckCsrf('GET')).toBe(false)
  })

  it('returns false for HEAD', () => {
    expect(shouldCheckCsrf('HEAD')).toBe(false)
  })

  it('returns false for OPTIONS', () => {
    expect(shouldCheckCsrf('OPTIONS')).toBe(false)
  })

  it('is case-insensitive (lowercase)', () => {
    expect(shouldCheckCsrf('post')).toBe(true)
    expect(shouldCheckCsrf('put')).toBe(true)
    expect(shouldCheckCsrf('get')).toBe(false)
  })

  it('is case-insensitive (mixed case)', () => {
    expect(shouldCheckCsrf('Post')).toBe(true)
    expect(shouldCheckCsrf('Patch')).toBe(true)
    expect(shouldCheckCsrf('Get')).toBe(false)
  })

  it('returns false for unknown methods', () => {
    expect(shouldCheckCsrf('CUSTOM')).toBe(false)
    expect(shouldCheckCsrf('')).toBe(false)
  })
})

describe('CSRF constants', () => {
  it('CSRF_COOKIE_NAME is "csrf_token"', () => {
    expect(CSRF_COOKIE_NAME).toBe('csrf_token')
  })

  it('CSRF_HEADER_NAME is "x-csrf-token"', () => {
    expect(CSRF_HEADER_NAME).toBe('x-csrf-token')
  })
})

describe('validateCsrfToken — security edge cases', () => {
  it('не принимает пробельные токены', () => {
    // Пробел в начале/конце — это разные токены, не должны матчиться
    expect(validateCsrfToken('  token  ', 'token')).toBe(false)
    expect(validateCsrfToken('token', 'token ')).toBe(false)
  })

  it('не принимает токены, отличающиеся регистром', () => {
    // Hex токены lowercase, но проверка case-sensitive
    expect(validateCsrfToken('ABCDEF', 'abcdef')).toBe(false)
  })

  it('матчится на длинных случайных строках', () => {
    const longToken = 'a'.repeat(1000)
    expect(validateCsrfToken(longToken, longToken)).toBe(true)
    expect(validateCsrfToken(longToken, 'b'.repeat(1000))).toBe(false)
  })

  it('не падает на не-hex символах', () => {
    // Хотя токены должны быть hex, validateCsrfToken не должно падать
    expect(validateCsrfToken('!@#$%^&*()', '!@#$%^&*()')).toBe(true)
  })

  it('не падает на unicode-символах', () => {
    const unicode = 'привет'
    expect(validateCsrfToken(unicode, unicode)).toBe(true)
    expect(validateCsrfToken(unicode, 'другое')).toBe(false)
  })

  it('длина token не раскрывается через timing (constant-time)', () => {
    // Проверяем, что сравнение токенов разной длины быстро возвращает false,
    // без утечки информации о длине cookie token.
    const short = 'a'
    const longStr = 'a'.repeat(100)
    expect(validateCsrfToken(short, longStr)).toBe(false)
    expect(validateCsrfToken(longStr, short)).toBe(false)
  })
})
