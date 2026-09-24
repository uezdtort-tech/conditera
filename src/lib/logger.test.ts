import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger, sanitizeLogContext, captureError } from './logger'

describe('logger', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stdoutWrite.mockRestore()
  })

  it('logger.info writes to stdout', () => {
    logger.info('Test message', { userId: 'u123' })
    expect(stdoutWrite).toHaveBeenCalled()
    const output = stdoutWrite.mock.calls[0][0] as string
    expect(output).toContain('Test message')
  })

  it('logger.error writes error message', () => {
    logger.error('Something failed', { code: 500 })
    expect(stdoutWrite).toHaveBeenCalled()
    const output = stdoutWrite.mock.calls[0][0] as string
    expect(output).toContain('Something failed')
  })

  it('logger.debug does not throw', () => {
    expect(() => logger.debug('debug message')).not.toThrow()
  })

  it('logger.child merges context', () => {
    const child = logger.child({ requestId: 'req-abc' })
    child.info('Child message', { userId: 'u1' })
    expect(stdoutWrite).toHaveBeenCalled()
    const output = stdoutWrite.mock.calls[0][0] as string
    expect(output).toContain('Child message')
  })

  it('logger.warn works', () => {
    logger.warn('Warning message')
    expect(stdoutWrite).toHaveBeenCalled()
  })

  it('logger.fatal works', () => {
    logger.fatal('Fatal message')
    expect(stdoutWrite).toHaveBeenCalled()
  })

  it('logger.info includes context fields', () => {
    logger.info('User action', { userId: 'u123', action: 'login' })
    const output = stdoutWrite.mock.calls[0][0] as string
    // В dev — pretty print, контекст идёт после сообщения
    expect(output).toContain('userId')
    expect(output).toContain('u123')
    expect(output).toContain('action')
    expect(output).toContain('login')
  })

  it('logger.redacts sensitive fields in context', () => {
    logger.info('Auth attempt', { email: 'test@test.ru', password: 'secret123' })
    const output = stdoutWrite.mock.calls[0][0] as string
    expect(output).not.toContain('secret123')
    expect(output).toContain('[REDACTED]')
  })
})

describe('sanitizeLogContext', () => {
  it('redacts password field', () => {
    const result = sanitizeLogContext({ password: 'secret123' })
    expect(result.password).toBe('[REDACTED]')
  })

  it('redacts passwordHash field', () => {
    const result = sanitizeLogContext({ passwordHash: 'hash-abc' })
    expect(result.passwordHash).toBe('[REDACTED]')
  })

  it('redacts accessToken field', () => {
    const result = sanitizeLogContext({ accessToken: 'token-xyz' })
    expect(result.accessToken).toBe('[REDACTED]')
  })

  it('redacts refreshToken field', () => {
    const result = sanitizeLogContext({ refreshToken: 'refresh-xyz' })
    expect(result.refreshToken).toBe('[REDACTED]')
  })

  it('redacts csrfToken field', () => {
    const result = sanitizeLogContext({ csrfToken: 'csrf-xyz' })
    expect(result.csrfToken).toBe('[REDACTED]')
  })

  it('redacts tfaSecret field', () => {
    const result = sanitizeLogContext({ tfaSecret: 'base32-secret' })
    expect(result.tfaSecret).toBe('[REDACTED]')
  })

  it('redacts apiKey field', () => {
    const result = sanitizeLogContext({ apiKey: 'key-abc' })
    expect(result.apiKey).toBe('[REDACTED]')
  })

  it('preserves non-sensitive fields', () => {
    const result = sanitizeLogContext({
      userId: 'u123',
      orderId: 'o456',
      email: 'test@test.ru',
    })
    expect(result.userId).toBe('u123')
    expect(result.orderId).toBe('o456')
    expect(result.email).toBe('test@test.ru')
  })

  it('redacts nested sensitive fields', () => {
    const result = sanitizeLogContext({
      user: {
        id: 'u123',
        password: 'secret',
        profile: { accessToken: 'token' },
      },
    })
    expect(result.user.id).toBe('u123')
    expect(result.user.password).toBe('[REDACTED]')
    expect(result.user.profile.accessToken).toBe('[REDACTED]')
  })

  it('redacts sensitive fields in arrays', () => {
    const result = sanitizeLogContext([
      { id: 1, password: 'p1' },
      { id: 2, password: 'p2' },
    ])
    expect(result[0].id).toBe(1)
    expect(result[0].password).toBe('[REDACTED]')
    expect(result[1].password).toBe('[REDACTED]')
  })

  it('handles primitives', () => {
    expect(sanitizeLogContext('string')).toBe('string')
    expect(sanitizeLogContext(42)).toBe(42)
    expect(sanitizeLogContext(null)).toBe(null)
  })

  it('case-insensitive redaction', () => {
    const result = sanitizeLogContext({
      Password: 'p1',
      PASSWORD: 'p2',
      apiKey: 'k1',
      APIKEY: 'k2',
    })
    expect(result.Password).toBe('[REDACTED]')
    expect(result.PASSWORD).toBe('[REDACTED]')
    expect(result.apiKey).toBe('[REDACTED]')
    expect(result.APIKEY).toBe('[REDACTED]')
  })
})

describe('captureError', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stdoutWrite.mockRestore()
  })

  it('logs error message to stdout', async () => {
    const err = new Error('Test error')
    await captureError(err, { userId: 'u123' })
    expect(stdoutWrite).toHaveBeenCalled()
    const output = stdoutWrite.mock.calls[0][0] as string
    expect(output).toContain('Test error')
  })

  it('handles non-Error throwables', async () => {
    await captureError('string error', { context: 'test' })
    expect(stdoutWrite).toHaveBeenCalled()
    const output = stdoutWrite.mock.calls[0][0] as string
    expect(output).toContain('string error')
  })

  it('logs error name and message', async () => {
    const err = new Error('Custom error message')
    await captureError(err)
    const output = stdoutWrite.mock.calls[0][0] as string
    expect(output).toContain('Custom error message')
  })

  it('does not throw if Sentry unavailable', async () => {
    const originalDsn = process.env.SENTRY_DSN
    process.env.SENTRY_DSN = 'https://example@sentry.io/test'
    const err = new Error('Test')
    // Не должно падать даже если @sentry/nextjs не установлен
    await expect(captureError(err)).resolves.not.toThrow()
    process.env.SENTRY_DSN = originalDsn
  })

  it('does not throw when SENTRY_DSN is not set', async () => {
    const originalDsn = process.env.SENTRY_DSN
    delete process.env.SENTRY_DSN
    const err = new Error('Test without Sentry')
    await expect(captureError(err)).resolves.not.toThrow()
    process.env.SENTRY_DSN = originalDsn
  })
})
