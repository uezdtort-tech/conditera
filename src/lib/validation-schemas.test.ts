import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  registerSchema,
  createOrderSchema,
  createPaymentSchema,
  yookassaWebhookSchema,
  dadataSuggestSchema,
  simplexIncomingSchema,
  createProductSchema,
  createVenueSchema,
  createReviewSchema,
  chatMessageSchema,
  parseBody,
  isUrlAllowed,
  OUTBOUND_URL_ALLOWLIST,
} from './validation-schemas'

describe('loginSchema', () => {
  it('accepts valid email + password', () => {
    const r = loginSchema.safeParse({
      email: 'test@test.ru',
      password: 'password123',
    })
    expect(r.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const r = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    })
    expect(r.success).toBe(false)
  })

  it('rejects password shorter than 8 chars', () => {
    const r = loginSchema.safeParse({
      email: 'test@test.ru',
      password: 'short',
    })
    expect(r.success).toBe(false)
  })

  it('rejects password longer than 128 chars', () => {
    const r = loginSchema.safeParse({
      email: 'test@test.ru',
      password: 'a'.repeat(129),
    })
    expect(r.success).toBe(false)
  })
})

describe('registerSchema', () => {
  it('accepts valid registration with strong password', () => {
    const r = registerSchema.safeParse({
      email: 'test@test.ru',
      password: 'StrongPass1',
      name: 'Иван',
    })
    expect(r.success).toBe(true)
  })

  it('rejects weak password (no uppercase)', () => {
    const r = registerSchema.safeParse({
      email: 'test@test.ru',
      password: 'weakpass1',
      name: 'Иван',
    })
    expect(r.success).toBe(false)
  })

  it('rejects weak password (no digit)', () => {
    const r = registerSchema.safeParse({
      email: 'test@test.ru',
      password: 'StrongPass',
      name: 'Иван',
    })
    expect(r.success).toBe(false)
  })

  it('rejects name shorter than 2 chars', () => {
    const r = registerSchema.safeParse({
      email: 'test@test.ru',
      password: 'StrongPass1',
      name: 'А',
    })
    expect(r.success).toBe(false)
  })

  it('accepts valid phone', () => {
    const r = registerSchema.safeParse({
      email: 'test@test.ru',
      password: 'StrongPass1',
      name: 'Иван',
      phone: '+7 999 123-45-67',
    })
    expect(r.success).toBe(true)
  })

  it('rejects invalid phone', () => {
    const r = registerSchema.safeParse({
      email: 'test@test.ru',
      password: 'StrongPass1',
      name: 'Иван',
      phone: 'not-a-phone-!!!',
    })
    expect(r.success).toBe(false)
  })
})

describe('createOrderSchema', () => {
  it('accepts valid order', () => {
    const r = createOrderSchema.safeParse({
      items: [{ productId: 'p1', quantity: 2 }],
      deliveryAddress: 'г. Москва, ул. Тестовая, д. 1',
      deliveryDate: '2026-08-15T10:00:00Z',
      paymentMethod: 'card',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty items array', () => {
    const r = createOrderSchema.safeParse({
      items: [],
      deliveryAddress: 'г. Москва, ул. Тестовая, д. 1',
      deliveryDate: '2026-08-15T10:00:00Z',
      paymentMethod: 'card',
    })
    expect(r.success).toBe(false)
  })

  it('rejects more than 50 items', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      productId: `p${i}`,
      quantity: 1,
    }))
    const r = createOrderSchema.safeParse({
      items,
      deliveryAddress: 'г. Москва, ул. Тестовая, д. 1',
      deliveryDate: '2026-08-15T10:00:00Z',
      paymentMethod: 'card',
    })
    expect(r.success).toBe(false)
  })

  it('rejects quantity < 1', () => {
    const r = createOrderSchema.safeParse({
      items: [{ productId: 'p1', quantity: 0 }],
      deliveryAddress: 'г. Москва, ул. Тестовая, д. 1',
      deliveryDate: '2026-08-15T10:00:00Z',
      paymentMethod: 'card',
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid paymentMethod', () => {
    const r = createOrderSchema.safeParse({
      items: [{ productId: 'p1', quantity: 1 }],
      deliveryAddress: 'г. Москва, ул. Тестовая, д. 1',
      deliveryDate: '2026-08-15T10:00:00Z',
      paymentMethod: 'crypto',
    })
    expect(r.success).toBe(false)
  })

  it('rejects short delivery address', () => {
    const r = createOrderSchema.safeParse({
      items: [{ productId: 'p1', quantity: 1 }],
      deliveryAddress: 'Москва',
      deliveryDate: '2026-08-15T10:00:00Z',
      paymentMethod: 'card',
    })
    expect(r.success).toBe(false)
  })
})

describe('createPaymentSchema — SSRF protection', () => {
  it('accepts payment without returnUrl', () => {
    const r = createPaymentSchema.safeParse({ orderId: 'o1' })
    expect(r.success).toBe(true)
  })

  it('accepts returnUrl pointing to conditera.ru', () => {
    const r = createPaymentSchema.safeParse({
      orderId: 'o1',
      returnUrl: 'https://conditera.ru/payment/success',
    })
    expect(r.success).toBe(true)
  })

  it('accepts returnUrl pointing to localhost (dev)', () => {
    const r = createPaymentSchema.safeParse({
      orderId: 'o1',
      returnUrl: 'http://localhost:3000/payment/success',
    })
    expect(r.success).toBe(true)
  })

  it('REJECTS returnUrl pointing to external domain (SSRF)', () => {
    const r = createPaymentSchema.safeParse({
      orderId: 'o1',
      returnUrl: 'https://evil.com/steal?data=',
    })
    expect(r.success).toBe(false)
  })

  it('REJECTS returnUrl pointing to attacker-controlled subdomain', () => {
    const r = createPaymentSchema.safeParse({
      orderId: 'o1',
      returnUrl: 'https://conditera.ru.evil.com/',
    })
    expect(r.success).toBe(false)
  })
})

describe('yookassaWebhookSchema', () => {
  it('accepts valid payment.succeeded event', () => {
    const r = yookassaWebhookSchema.safeParse({
      event: 'payment.succeeded',
      object: {
        id: 'pay_123',
        status: 'succeeded',
        metadata: { orderId: 'order_456' },
      },
    })
    expect(r.success).toBe(true)
  })

  it('accepts payment.canceled event', () => {
    const r = yookassaWebhookSchema.safeParse({
      event: 'payment.canceled',
      object: {
        id: 'pay_123',
        status: 'canceled',
        metadata: { orderId: 'order_456' },
      },
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown event type', () => {
    const r = yookassaWebhookSchema.safeParse({
      event: 'payment.fraudulent',
      object: { id: 'pay_123', status: 'fraud', metadata: { orderId: 'o1' } },
    })
    expect(r.success).toBe(false)
  })

  it('rejects payload without orderId in metadata', () => {
    const r = yookassaWebhookSchema.safeParse({
      event: 'payment.succeeded',
      object: { id: 'pay_123', status: 'succeeded', metadata: {} },
    })
    expect(r.success).toBe(false)
  })
})

describe('dadataSuggestSchema', () => {
  it('accepts valid address suggestion query', () => {
    const r = dadataSuggestSchema.safeParse({
      query: 'Москва',
      type: 'address',
    })
    expect(r.success).toBe(true)
  })

  it('uses default count=10', () => {
    const r = dadataSuggestSchema.safeParse({
      query: 'Москва',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.count).toBe(10)
      expect(r.data.type).toBe('address')
    }
  })

  it('rejects query shorter than 2 chars', () => {
    const r = dadataSuggestSchema.safeParse({ query: 'М' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown type (SSRF protection)', () => {
    const r = dadataSuggestSchema.safeParse({
      query: 'Москва',
      type: 'malicious_endpoint',
    })
    expect(r.success).toBe(false)
  })

  it('rejects count > 20', () => {
    const r = dadataSuggestSchema.safeParse({
      query: 'Москва',
      count: 100,
    })
    expect(r.success).toBe(false)
  })
})

describe('simplexIncomingSchema', () => {
  it('accepts valid message_received event', () => {
    const r = simplexIncomingSchema.safeParse({
      type: 'message_received',
      senderAddress: 'smp://abc123@smp.conditera.ru#key',
      message: 'Привет!',
      signature: 'a'.repeat(64),
      timestamp: Date.now(),
    })
    expect(r.success).toBe(true)
  })

  it('rejects message longer than 10 000 chars', () => {
    const r = simplexIncomingSchema.safeParse({
      type: 'message_received',
      message: 'a'.repeat(10_001),
      signature: 'a'.repeat(64),
      timestamp: Date.now(),
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing signature', () => {
    const r = simplexIncomingSchema.safeParse({
      type: 'message_received',
      message: 'hi',
      timestamp: Date.now(),
    } as any)
    expect(r.success).toBe(false)
  })

  it('rejects senderAddress not starting with smp://', () => {
    const r = simplexIncomingSchema.safeParse({
      type: 'message_received',
      senderAddress: 'https://evil.com/',
      message: 'hi',
      signature: 'a'.repeat(64),
      timestamp: Date.now(),
    })
    expect(r.success).toBe(false)
  })
})

describe('createProductSchema', () => {
  it('accepts valid product', () => {
    const r = createProductSchema.safeParse({
      title: 'Торт "Праздничный"',
      price: 1500,
      category: 'cakes',
      images: ['https://images.unsplash.com/photo-1'],
    })
    expect(r.success).toBe(true)
  })

  it('rejects title shorter than 3 chars', () => {
    const r = createProductSchema.safeParse({
      title: 'А',
      price: 1500,
      category: 'cakes',
      images: ['https://example.com/i.jpg'],
    })
    expect(r.success).toBe(false)
  })

  it('rejects negative price', () => {
    const r = createProductSchema.safeParse({
      title: 'Торт',
      price: -100,
      category: 'cakes',
      images: ['https://example.com/i.jpg'],
    })
    expect(r.success).toBe(false)
  })

  it('rejects more than 20 images', () => {
    const r = createProductSchema.safeParse({
      title: 'Торт',
      price: 1500,
      category: 'cakes',
      images: Array.from({ length: 21 }, (_, i) => `https://example.com/${i}.jpg`),
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-URL image', () => {
    const r = createProductSchema.safeParse({
      title: 'Торт',
      price: 1500,
      category: 'cakes',
      images: ['not-a-url'],
    })
    expect(r.success).toBe(false)
  })
})

describe('createVenueSchema', () => {
  it('accepts valid venue', () => {
    const r = createVenueSchema.safeParse({
      businessName: 'Батутный парк',
      slug: 'batutnyy-park',
      city: 'Москва',
      fullAddress: 'Москва, ул. Складочная, 1',
      venueType: 'venue_trampoline',
    })
    expect(r.success).toBe(true)
  })

  it('rejects slug with invalid characters', () => {
    const r = createVenueSchema.safeParse({
      businessName: 'Парк',
      slug: 'Парк с пробелами!',
      city: 'Москва',
      fullAddress: 'Москва, ул. Тестовая, 1',
      venueType: 'venue_trampoline',
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid postal code', () => {
    const r = createVenueSchema.safeParse({
      businessName: 'Парк',
      slug: 'park',
      city: 'Москва',
      fullAddress: 'Москва, ул. Тестовая, 1',
      venueType: 'venue_trampoline',
      postalCode: 'abc123',
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid lat/lng', () => {
    const r = createVenueSchema.safeParse({
      businessName: 'Парк',
      slug: 'park',
      city: 'Москва',
      fullAddress: 'Москва, ул. Тестовая, 1',
      venueType: 'venue_trampoline',
      lat: 999,
      lng: 999,
    })
    expect(r.success).toBe(false)
  })
})

describe('createReviewSchema', () => {
  it('accepts valid review', () => {
    const r = createReviewSchema.safeParse({
      productId: 'p1',
      rating: 5,
      text: 'Отличный торт, всем рекомендую!',
    })
    expect(r.success).toBe(true)
  })

  it('rejects rating > 5', () => {
    const r = createReviewSchema.safeParse({
      productId: 'p1',
      rating: 6,
      text: 'Хорошо',
    })
    expect(r.success).toBe(false)
  })

  it('rejects text shorter than 10 chars', () => {
    const r = createReviewSchema.safeParse({
      productId: 'p1',
      rating: 5,
      text: 'Ок',
    })
    expect(r.success).toBe(false)
  })
})

describe('chatMessageSchema', () => {
  it('accepts valid text message', () => {
    const r = chatMessageSchema.safeParse({
      roomId: 'room-1',
      text: 'Привет!',
    })
    expect(r.success).toBe(true)
  })

  it('accepts voice message', () => {
    const r = chatMessageSchema.safeParse({
      roomId: 'room-1',
      text: '🎤 Голосовое',
      voice: {
        url: 'https://conditera.ru/uploads/voice/123.webm',
        durationSec: 30,
      },
    })
    expect(r.success).toBe(true)
  })

  it('rejects text > 10000 chars', () => {
    const r = chatMessageSchema.safeParse({
      roomId: 'room-1',
      text: 'a'.repeat(10_001),
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty roomId', () => {
    const r = chatMessageSchema.safeParse({
      roomId: '',
      text: 'Привет',
    })
    expect(r.success).toBe(false)
  })
})

describe('parseBody helper', () => {
  it('returns success=true for valid data', () => {
    const r = parseBody(loginSchema, {
      email: 'test@test.ru',
      password: 'password123',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.email).toBe('test@test.ru')
    }
  })

  it('returns success=false with errors for invalid data', () => {
    const r = parseBody(loginSchema, { email: 'bad', password: 'x' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.errors).toBeDefined()
      expect(r.errors.fieldErrors).toBeDefined()
    }
  })
})

describe('isUrlAllowed — SSRF protection', () => {
  it('allows DaData API URL', () => {
    expect(isUrlAllowed('https://cleaner.dadata.ru/api/v1/clean/address')).toBe(true)
  })

  it('allows YooKassa API URL', () => {
    expect(isUrlAllowed('https://api.yookassa.ru/v3/payments')).toBe(true)
  })

  it('allows Telegram API URL', () => {
    expect(isUrlAllowed('https://api.telegram.org/bot123/sendMessage')).toBe(true)
  })

  it('allows localhost chat-service (dev)', () => {
    expect(isUrlAllowed('http://localhost:3030/health')).toBe(true)
  })

  it('allows docker internal web URL', () => {
    expect(isUrlAllowed('http://web:3000/api/health')).toBe(true)
  })

  it('REJECTS evil.com', () => {
    expect(isUrlAllowed('https://evil.com/steal')).toBe(false)
  })

  it('REJECTS file:// scheme', () => {
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false)
  })

  it('REJECTS malformed URL', () => {
    expect(isUrlAllowed('not-a-url')).toBe(false)
  })

  it('REJECTS http:// when only https:// in allowlist', () => {
    expect(isUrlAllowed('http://cleaner.dadata.ru/api')).toBe(false)
  })

  it('OUTBOUND_URL_ALLOWLIST has all expected entries', () => {
    expect(OUTBOUND_URL_ALLOWLIST).toContain('https://cleaner.dadata.ru')
    expect(OUTBOUND_URL_ALLOWLIST).toContain('https://api.yookassa.ru')
    expect(OUTBOUND_URL_ALLOWLIST).toContain('https://api.telegram.org')
  })
})
