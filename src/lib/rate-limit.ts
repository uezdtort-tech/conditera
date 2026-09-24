/**
 * Rate limiting middleware — sliding window на Redis (production) или in-memory (dev).
 *
 * Использование:
 *   import { rateLimit } from '@/lib/rate-limit'
 *
 *   const { success, remaining, resetAt } = await rateLimit({
 *     key: `login:${ip}`,          // уникальный ключ (IP + userId + action)
 *     limit: 5,                    // максимум запросов
 *     windowMs: 60_000,            // за 60 секунд
 *   })
 *   if (!success) {
 *     return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)) } })
 *   }
 *
 * В production использует REDIS_URL. В dev (или без Redis) — in-memory Map.
 */

type RateLimitResult = {
  success: boolean
  remaining: number
  resetAt: number
  /** Сколько секунд подождать до следующей попытки (для Retry-After header) */
  retryAfterSec: number
}

// ===== In-memory store (fallback для dev / SSR без Redis) =====
type BucketEntry = { timestamps: number[] }
const memoryBuckets = new Map<string, BucketEntry>()

// Периодическая очистка устаревших ключей (раз в 5 минут)
if (typeof global !== 'undefined' && !(global as any).__rateLimitCleanupStarted) {
  ;(global as any).__rateLimitCleanupStarted = true
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of memoryBuckets.entries()) {
      const fresh = v.timestamps.filter((t) => now - t < 60 * 60 * 1000) // 1 час
      if (fresh.length === 0) {
        memoryBuckets.delete(k)
      } else {
        v.timestamps = fresh
      }
    }
  }, 5 * 60 * 1000).unref?.()
}

// ===== Redis client (lazy init, optional) =====
let redisClient: any = null
let redisInitTried = false

async function getRedisClient(): Promise<any | null> {
  if (redisInitTried) return redisClient
  redisInitTried = true

  if (typeof window !== 'undefined') return null // client-side — нет Redis

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return null

  try {
    // Динамический import через eval — vite не резолвит на этапе сборки,
    // поэтому пакет может отсутствовать в dev-окружении
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
    const redisModule = await dynamicImport('redis').catch(() => null)
    if (!redisModule || typeof redisModule.createClient !== 'function') {
      redisClient = null
      return null
    }
    redisClient = redisModule.createClient({ url: redisUrl })
    redisClient.on('error', (err: any) => {
      console.warn('[rate-limit] Redis error, falling back to in-memory:', err.message)
      redisClient = null
    })
    await redisClient.connect()
    return redisClient
  } catch (err: any) {
    console.warn('[rate-limit] Redis init failed, using in-memory:', err.message)
    redisClient = null
    return null
  }
}

/**
 * Применяет rate limit к заданному ключу.
 * @returns { success, remaining, resetAt, retryAfterSec }
 */
export async function rateLimit(opts: {
  key: string
  limit: number
  windowMs: number
}): Promise<RateLimitResult> {
  const { key, limit, windowMs } = opts
  const now = Date.now()
  const windowStart = now - windowMs

  // ===== Попытка Redis =====
  const redis = await getRedisClient()
  if (redis && typeof redis.zAdd === 'function') {
    try {
      const member = `${now}-${Math.random().toString(36).slice(2, 8)}`
      const pipeline = redis.multi()
      // Удаляем старые записи
      pipeline.zRemRangeByScore(key, 0, windowStart)
      // Добавляем текущий запрос
      pipeline.zAdd(key, [{ score: now, value: member }])
      // Считаем сколько осталось
      pipeline.zCard(key)
      // Устанавливаем TTL на ключ (чтобы не копить мусор)
      pipeline.expire(key, Math.ceil(windowMs / 1000) + 10)
      const results = await pipeline.exec()
      const count = results?.[2] ?? 0

      const success = count <= limit
      const remaining = Math.max(0, limit - count)
      const resetAt = now + windowMs
      const retryAfterSec = success ? 0 : Math.ceil(windowMs / 1000)

      return { success, remaining, resetAt, retryAfterSec }
    } catch (err: any) {
      console.warn('[rate-limit] Redis op failed, using in-memory:', err.message)
      // fallthrough to in-memory
    }
  }

  // ===== In-memory fallback =====
  const entry = memoryBuckets.get(key) || { timestamps: [] }
  // Оставляем только запросы в окне
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)
  // Добавляем текущий запрос
  entry.timestamps.push(now)
  memoryBuckets.set(key, entry)

  const count = entry.timestamps.length
  const success = count <= limit
  const remaining = Math.max(0, limit - count)
  // Сброс — когда истечёт самый старый запрос в окне
  const oldestInWindow = entry.timestamps[0] || now
  const resetAt = oldestInWindow + windowMs
  const retryAfterSec = success ? 0 : Math.ceil((resetAt - now) / 1000)

  return { success, remaining, resetAt, retryAfterSec }
}

/**
 * Хелпер для типичных endpoint-ов (auth, registration, password reset).
 * Возвращает null если запрос разрешён, иначе NextResponse-ready объект.
 *
 * Пример:
 *   const blocked = await enforceRateLimit(req, `login:${ip}`, 5, 60_000)
 *   if (blocked) return blocked
 */
export async function enforceRateLimit(
  req: Request,
  key: string,
  limit: number,
  windowMs: number
): Promise<Response | null> {
  const result = await rateLimit({ key, limit, windowMs })
  if (result.success) return null

  return new Response(
    JSON.stringify({
      error: 'Too Many Requests',
      message: `Превышен лимит ${limit} запросов за ${Math.ceil(windowMs / 1000)} сек.`,
      retryAfter: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSec),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(result.resetAt),
      },
    }
  )
}

/**
 * Извлекает IP-адрес клиента из запроса.
 * Учитывает proxy (X-Forwarded-For) и Vercel/Cloudflare заголовки.
 */
export function getClientIP(req: Request): string {
  const headers = req.headers
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    'unknown'
  )
}

/**
 * Пресеты rate-limit для типичных endpoint-ов.
 * Подобраны по best practices: auth — строгий, API — мягкий.
 */
export const RATE_LIMITS = {
  // POST /api/auth/login — 5 попыток в минуту с одного IP
  auth: { limit: 5, windowMs: 60_000 },
  // POST /api/auth/register — 3 попытки в минуту с одного IP
  register: { limit: 3, windowMs: 60_000 },
  // POST /api/auth/reset-password — 3 попытки в час с одного IP
  passwordReset: { limit: 3, windowMs: 60 * 60_000 },
  // POST /api/orders — 10 заказов в минуту (от одного пользователя)
  orders: { limit: 10, windowMs: 60_000 },
  // POST /api/payment/create — 5 попыток в минуту
  payment: { limit: 5, windowMs: 60_000 },
  // GET /api/* — 60 запросов в минуту с одного IP (general API)
  api: { limit: 60, windowMs: 60_000 },
  // POST /api/contact — 3 сообщения в час с одного IP
  contact: { limit: 3, windowMs: 60 * 60_000 },
} as const
