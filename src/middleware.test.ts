import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './proxy'

/**
 * Тесты CSRF-защиты в middleware.
 * Проверяем:
 *  1. Запрос без токена к защищённому endpoint → 403
 *  2. Запрос с неверным токеном → 403
 *  3. Запрос с корректным токеном (header == cookie) → 200
 *  4. GET-запрос не требует CSRF
 *  5. Webhook endpoints (CSRF_EXEMPT_PATHS) пропускаются без токена
 *  6. Статические файлы пропускаются
 */

function makeRequest(opts: {
  method?: string
  path: string
  csrfHeader?: string | null
  csrfCookie?: string | null
  proto?: string
}): NextRequest {
  const url = `https://conditera.ru${opts.path}`
  const req = new NextRequest(url, {
    method: opts.method || 'GET',
    headers: opts.csrfHeader ? { 'x-csrf-token': opts.csrfHeader } : {},
  })
  if (opts.csrfCookie !== null && opts.csrfCookie !== undefined) {
    req.cookies.set('csrf_token', opts.csrfCookie)
  }
  return req
}

describe('CSRF middleware', () => {
  describe('blocks state-changing requests without token', () => {
    it('blocks POST /api/orders without CSRF token', async () => {
      const req = makeRequest({ method: 'POST', path: '/api/orders' })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })

    it('blocks PUT /api/products/123 without CSRF token', async () => {
      const req = makeRequest({ method: 'PUT', path: '/api/products/123' })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })

    it('blocks DELETE /api/reviews/456 without CSRF token', async () => {
      const req = makeRequest({ method: 'DELETE', path: '/api/reviews/456' })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })

    it('blocks PATCH /api/profile without CSRF token', async () => {
      const req = makeRequest({ method: 'PATCH', path: '/api/profile' })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })
  })

  describe('blocks requests with mismatched token', () => {
    it('blocks when header token != cookie token', async () => {
      const req = makeRequest({
        method: 'POST',
        path: '/api/orders',
        csrfHeader: 'token-from-header',
        csrfCookie: 'token-from-cookie',
      })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })

    it('blocks when header present but cookie missing', async () => {
      const req = makeRequest({
        method: 'POST',
        path: '/api/orders',
        csrfHeader: 'some-token',
        csrfCookie: null,
      })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })

    it('blocks when cookie present but header missing', async () => {
      const req = makeRequest({
        method: 'POST',
        path: '/api/orders',
        csrfHeader: null,
        csrfCookie: 'some-token',
      })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })
  })

  describe('allows requests with matching token', () => {
    it('allows POST when header == cookie', async () => {
      const token = 'abc123matching-token-xyz789'
      const req = makeRequest({
        method: 'POST',
        path: '/api/orders',
        csrfHeader: token,
        csrfCookie: token,
      })
      const res = await middleware(req)
      // Не 403 — значит CSRF прошёл. Может быть 200 или 307 (Supabase redirect в dev).
      expect(res.status).not.toBe(403)
    })

    it('allows PUT when header == cookie', async () => {
      const token = 'matching-put-token-456'
      const req = makeRequest({
        method: 'PUT',
        path: '/api/products/123',
        csrfHeader: token,
        csrfCookie: token,
      })
      const res = await middleware(req)
      // Не 403 — значит CSRF прошёл. Может быть 200 или 307 (Supabase redirect в dev).
      expect(res.status).not.toBe(403)
    })
  })

  describe('GET requests do not require CSRF', () => {
    it('allows GET /api/products without token', async () => {
      const req = makeRequest({ method: 'GET', path: '/api/products' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('allows GET /api/orders without token', async () => {
      const req = makeRequest({ method: 'GET', path: '/api/orders' })
      const res = await middleware(req)
      // GET не требует CSRF — может быть 200 или 307 (Supabase redirect в dev)
      expect(res.status).not.toBe(403)
    })
  })

  describe('CSRF-exempt endpoints do not require token', () => {
    it('allows POST /api/auth/login without CSRF (auth-internal)', async () => {
      const req = makeRequest({ method: 'POST', path: '/api/auth/login' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('allows POST /api/auth/register without CSRF', async () => {
      const req = makeRequest({ method: 'POST', path: '/api/auth/register' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('allows POST /api/payment/webhook without CSRF (YooKassa webhook)', async () => {
      const req = makeRequest({ method: 'POST', path: '/api/payment/webhook' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('allows POST /api/webhooks/n8n without CSRF', async () => {
      const req = makeRequest({ method: 'POST', path: '/api/webhooks/n8n' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('allows POST /api/cron/cleanup without CSRF', async () => {
      const req = makeRequest({ method: 'POST', path: '/api/cron/cleanup' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('allows GET /api/csrf-token without CSRF (issuing endpoint)', async () => {
      const req = makeRequest({ method: 'GET', path: '/api/csrf-token' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })
  })

  describe('static files bypass middleware', () => {
    it('passes through _next/static files', async () => {
      const req = makeRequest({ method: 'GET', path: '/_next/static/chunk.js' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('passes through image files', async () => {
      const req = makeRequest({ method: 'GET', path: '/logo.png' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })

    it('passes through favicon', async () => {
      const req = makeRequest({ method: 'GET', path: '/favicon.ico' })
      const res = await middleware(req)
      expect(res.status).toBe(200)
    })
  })

  describe('security headers are set', () => {
    it('sets X-Content-Type-Options: nosniff', async () => {
      const req = makeRequest({ method: 'GET', path: '/' })
      const res = await middleware(req)
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })

    it('sets X-Frame-Options: SAMEORIGIN', async () => {
      const req = makeRequest({ method: 'GET', path: '/' })
      const res = await middleware(req)
      expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
    })

    it('sets Permissions-Policy with camera/microphone/geolocation disabled', async () => {
      const req = makeRequest({ method: 'GET', path: '/' })
      const res = await middleware(req)
      const pp = res.headers.get('Permissions-Policy') || ''
      expect(pp).toContain('camera=()')
      expect(pp).toContain('microphone=()')
      expect(pp).toContain('geolocation=()')
      expect(pp).toContain('payment=()')
    })

    it('sets CSP with frame-ancestors allowing space-z.ai', async () => {
      const req = makeRequest({ method: 'GET', path: '/' })
      const res = await middleware(req)
      const csp = res.headers.get('Content-Security-Policy') || ''
      expect(csp).toContain("frame-ancestors 'self' https://*.space-z.ai")
    })

    it('sets Cache-Control: no-store for /api/auth/*', async () => {
      const req = makeRequest({ method: 'GET', path: '/api/auth/me' })
      const res = await middleware(req)
      expect(res.headers.get('Cache-Control')).toContain('no-store')
    })

    it('sets Cache-Control: no-store for /api/payment/*', async () => {
      const req = makeRequest({ method: 'GET', path: '/api/payment/status' })
      const res = await middleware(req)
      expect(res.headers.get('Cache-Control')).toContain('no-store')
    })

    it('sets HSTS for HTTPS requests', async () => {
      const req = makeRequest({ method: 'GET', path: '/' })
      const res = await middleware(req)
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000')
      expect(res.headers.get('Strict-Transport-Security')).toContain('preload')
    })

    it('sets Cross-Origin-Opener-Policy: same-origin', async () => {
      const req = makeRequest({ method: 'GET', path: '/' })
      const res = await middleware(req)
      expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
    })
  })

  describe('timing-safe comparison', () => {
    it('rejects tokens of different lengths', async () => {
      const req = makeRequest({
        method: 'POST',
        path: '/api/orders',
        csrfHeader: 'short',
        csrfCookie: 'much-longer-token-value',
      })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })

    it('accepts identical long tokens', async () => {
      const token = 'a'.repeat(64) // 64-char hex-like token
      const req = makeRequest({
        method: 'POST',
        path: '/api/orders',
        csrfHeader: token,
        csrfCookie: token,
      })
      const res = await middleware(req)
      // Корректный CSRF — не блокируется. Может быть 200 или 307 (Supabase redirect в dev).
      expect(res.status).not.toBe(403)
    })
  })
})
