/**
 * Zod-схемы валидации входных данных для API endpoints.
 *
 * Зачем: защита от SSRF, injection, malformed payload.
 * Все входные данные от пользователя/внешнего API валидируются перед использованием.
 *
 * Использование:
 *   import { loginSchema } from '@/lib/validation-schemas'
 *
 *   const parse = loginSchema.safeParse(await request.json())
 *   if (!parse.success) {
 *     return NextResponse.json({ errors: parse.error.flatten() }, { status: 400 })
 *   }
 *   const { email, password } = parse.data  // типизировано
 */
import { z } from 'zod'

// ===== AUTH =====
export const loginSchema = z.object({
  email: z.string().email('Некорректный email').max(255),
  password: z.string().min(8, 'Пароль минимум 8 символов').max(128),
  captchaToken: z.string().optional(),
})

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string()
    .min(8, 'Пароль минимум 8 символов')
    .max(128)
    .regex(/[A-Z]/, 'Нужна минимум 1 заглавная буква')
    .regex(/[a-z]/, 'Нужна минимум 1 строчная буква')
    .regex(/\d/, 'Нужна минимум 1 цифра'),
  name: z.string().min(2, 'Имя минимум 2 символа').max(100),
  phone: z.string()
    .regex(/^\+?[\d\s\-()]{10,18}$/, 'Некорректный телефон')
    .optional(),
  city: z.string().max(100).optional(),
  role: z.enum(['CUSTOMER', 'CONFECTIONER', 'SUPPLIER', 'COURIER']).optional(),
})

export const passwordResetRequestSchema = z.object({
  email: z.string().email().max(255),
})

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(16, 'Некорректный токен').max(255),
  password: z.string().min(8).max(128),
})

export const tfaVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Код состоит из 6 цифр'),
  loginToken: z.string().min(16).max(255).optional(),
})

// ===== ORDERS =====
export const createOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(100),
    customization: z.object({
      filling: z.string().max(200).optional(),
      coating: z.string().max(200).optional(),
      decoration: z.string().max(200).optional(),
      inscription: z.string().max(500).optional(),
    }).optional(),
  })).min(1, 'Минимум 1 товар в заказе').max(50, 'Максимум 50 товаров'),
  deliveryAddress: z.string().min(10, 'Адрес слишком короткий').max(500),
  deliveryDate: z.string().datetime().or(z.string().min(8).max(20)),
  deliveryTime: z.string().max(20).optional(),
  paymentMethod: z.enum(['card', 'cash', 'split']),
  comment: z.string().max(2000).optional(),
  promoCode: z.string().max(50).optional(),
  bonusPointsRedeemed: z.number().int().min(0).max(100000).optional(),
})

// ===== PAYMENT =====
export const createPaymentSchema = z.object({
  orderId: z.string().min(1).max(100),
  installmentPlanId: z.string().max(100).optional(),
  returnUrl: z.string()
    .url('Некорректный URL возврата')
    .refine(
      (url) => {
        // Защита от SSRF: returnUrl должен быть на наш домен
        const allowed = ['conditera.ru', 'localhost']
        try {
          const u = new URL(url)
          return allowed.some(d => u.hostname === d || u.hostname.endsWith('.' + d))
        } catch {
          return false
        }
      },
      'URL возврата должен указывать на conditera.ru'
    )
    .optional(),
})

// ===== YOOKASSA WEBHOOK (входящий) =====
export const yookassaWebhookSchema = z.object({
  event: z.enum([
    'payment.waiting_for_capture',
    'payment.succeeded',
    'payment.canceled',
    'refund.succeeded',
    'refund.canceled',
  ]),
  object: z.object({
    id: z.string().min(1),
    status: z.string(),
    paid: z.boolean().optional(),
    amount: z.object({
      value: z.string(),
      currency: z.string(),
    }).optional(),
    metadata: z.object({
      orderId: z.string().min(1),
    }).passthrough(), // пропускаем остальные поля metadata
  }).passthrough(),
})

// ===== DADATA =====
// Входящие параметры для запроса к DaData API (например, suggest address)
export const dadataSuggestSchema = z.object({
  query: z.string().min(2, 'Минимум 2 символа').max(500),
  count: z.number().int().min(1).max(20).default(10),
  // Только разрешённые типы (защита от SSRF через подмену endpoint)
  type: z.enum([
    'address',     // адреса
    'party',       // организации по ИНН
    'fio',         // ФИО
    'email',       // email
    'phone',       // телефон
    'bank',        // банки по БИК
  ]).default('address'),
})

// Валидация ответа от DaData (защита от malformed-ответа)
export const dadataResponseSchema = z.object({
  suggestions: z.array(z.object({
    value: z.string(),
    unrestricted_value: z.string().optional(),
    data: z.record(z.string(), z.any()).optional(),
  })).default([]),
}).passthrough()

// ===== SIMPLEX (входящий webhook от bridge) =====
export const simplexIncomingSchema = z.object({
  // Тип события
  type: z.enum(['message_received', 'contact_created', 'connection_update']),
  // Отправитель
  senderAddress: z.string()
    .max(255)
    .refine(
      (s) => !s || s.startsWith('smp://'),
      'senderAddress должен быть smp://... формат'
    )
    .optional(),
  senderProfileName: z.string().max(200).optional(),
  // Тело сообщения
  message: z.string().max(10_000, 'Сообщение слишком длинное').optional(),
  // Подпись для верификации (HMAC от bridge)
  signature: z.string().min(16).max(255),
  timestamp: z.number().int(),
}).passthrough()

// ===== PRODUCTS (admin/confectioner CRUD) =====
export const createProductSchema = z.object({
  title: z.string().min(3, 'Минимум 3 символа').max(200),
  description: z.string().max(5000).optional(),
  price: z.number().min(0).max(10_000_000),
  oldPrice: z.number().min(0).max(10_000_000).optional(),
  category: z.string().min(1).max(50),
  images: z.array(z.string().url()).min(1, 'Минимум 1 изображение').max(20),
  weight: z.string().max(50).optional(),
  servings: z.number().int().min(1).max(1000).optional(),
  prepTime: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
})

export const updateProductSchema = createProductSchema.partial()

// ===== VENUES =====
export const createVenueSchema = z.object({
  businessName: z.string().min(3).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug: только строчные буквы, цифры, дефис').max(100),
  description: z.string().max(5000).optional(),
  city: z.string().min(2).max(100),
  region: z.string().max(100).optional(),
  street: z.string().max(200).optional(),
  building: z.string().max(50).optional(),
  floor: z.string().max(20).optional(),
  pavilion: z.string().max(50).optional(),
  fullAddress: z.string().min(10).max(500),
  postalCode: z.string().regex(/^\d{6}$/, 'Индекс — 6 цифр').optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  area: z.number().min(1).max(1_000_000).optional(),
  capacity: z.number().int().min(1).max(100_000).optional(),
  phone: z.string().regex(/^\+?[\d\s\-()]{10,18}$/).optional(),
  email: z.string().email().max(255).optional(),
  website: z.string().url().max(500).optional(),
  venueType: z.string().max(100),
  venueTypeLabel: z.string().max(200).optional(),
})

// ===== REVIEWS =====
export const createReviewSchema = z.object({
  productId: z.string().min(1).max(100),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(10, 'Минимум 10 символов').max(5000),
  images: z.array(z.string().url()).max(10).optional(),
})

// ===== CHAT (входящие сообщения через Socket.IO / SimpleX) =====
export const chatMessageSchema = z.object({
  roomId: z.string().min(1).max(100),
  text: z.string().min(1).max(10_000),
  replyTo: z.string().max(100).optional(),
  // Для голосовых сообщений
  voice: z.object({
    url: z.string().url(),
    durationSec: z.number().int().min(1).max(600),
    waveform: z.array(z.number().min(0).max(1)).max(100).optional(),
  }).optional(),
})

// ===== Helper: safe parse для Next.js API =====
export function parseBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown
):
  | { success: true; data: T }
  | { success: false; errors: z.inferFlattenedErrors<typeof schema> } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return {
    success: false,
    errors: result.error.flatten(),
  }
}

// ===== URL allowlist для исходящих HTTP-запросов (SSRF protection) =====
export const OUTBOUND_URL_ALLOWLIST = [
  'https://cleaner.dadata.ru',          // DaData API
  'https://suggestions.dadata.ru',
  'https://api.yookassa.ru',            // YooKassa
  'https://yoomoney.ru',
  'https://api.telegram.org',           // Telegram bot
  'http://localhost:5225',              // SimpleX bridge (локально)
  'http://localhost:3030',              // chat-service (локально)
  'http://chat-service:3030',           // docker internal
  'http://web:3000',                    // docker internal
] as const

/**
 * Проверяет что URL находится в allowlist.
 * Использовать перед каждым fetch к внешнему API.
 *
 * @example
 *   if (!isUrlAllowed(externalUrl)) {
 *     return NextResponse.json({ error: 'URL not allowed' }, { status: 400 })
 *   }
 */
export function isUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return OUTBOUND_URL_ALLOWLIST.some(allowed => {
      const a = new URL(allowed)
      // protocol должен совпадать (защита от downgrade http:// для https://-only доменов)
      if (u.protocol !== a.protocol) return false
      // hostname должен совпадать
      if (u.hostname !== a.hostname) return false
      // порт должен совпадать (если указан явно в allowlist — проверяем, иначе default)
      const uPort = u.port || (u.protocol === 'https:' ? '443' : '80')
      const aPort = a.port || (a.protocol === 'https:' ? '443' : '80')
      if (uPort !== aPort) return false
      // путь должен начинаться с allowlist path (или быть равным)
      return u.pathname.startsWith(a.pathname)
    })
  } catch {
    return false
  }
}
