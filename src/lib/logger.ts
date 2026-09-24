/**
 * Structured JSON logger для production.
 *
 * В dev: pretty-print в консоль (colorized).
 * В prod: JSON в stdout (для Loki/Datadog/CloudWatch).
 *
 * Уровни логов (по возрастанию приоритета):
 *   debug → info → warn → error → fatal
 *
 * В production debug-логи не выводятся (только info+).
 *
 * Использование:
 *   import { logger } from '@/lib/logger'
 *   logger.info('User logged in', { userId: 'u123', ip: '1.2.3.4' })
 *   logger.error('Payment failed', { orderId: 'o456', error: err.message })
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  service?: string
  version?: string
  environment?: string
  requestId?: string
  userId?: string
  ip?: string
  [key: string]: any
}

const SERVICE = 'conditera'
const VERSION = process.env.npm_package_version || '1.0.0'
const ENV = process.env.NODE_ENV || 'development'

/**
 * Базовая функция логирования.
 * В production — JSON в stdout.
 * В dev — colorized pretty-print.
 */
function log(level: LogLevel, message: string, context: Record<string, any> = {}) {
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: SERVICE,
    version: VERSION,
    environment: ENV,
    ...context,
  }

  // Сенсор: убираем известные чувствительные поля из контекста
  const sanitized = sanitize(entry)

  if (process.env.NODE_ENV === 'production') {
    // Production: JSON в stdout (одна строка — один лог)
    process.stdout.write(JSON.stringify(sanitized) + '\n')
  } else {
    // Dev: pretty print
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[90m',   // gray
      info: '\x1b[36m',    // cyan
      warn: '\x1b[33m',    // yellow
      error: '\x1b[31m',   // red
      fatal: '\x1b[35m',   // magenta
    }
    const reset = '\x1b[0m'
    const color = colors[level]
    const time = sanitized.timestamp.split('T')[1]?.split('.')[0] || ''
    // Используем sanitized (а не raw context) — чтобы не выводить пароли в лог
    const sanitizedContext = { ...sanitized }
    delete sanitizedContext.timestamp
    delete sanitizedContext.level
    delete sanitizedContext.message
    delete sanitizedContext.service
    delete sanitizedContext.version
    delete sanitizedContext.environment
    const ctxStr = Object.keys(sanitizedContext).length > 0
      ? ' ' + JSON.stringify(sanitizedContext)
      : ''
    process.stdout.write(`${color}[${time}] ${level.toUpperCase().padEnd(5)}${reset} ${message}${ctxStr}\n`)
  }
}

/**
 * Удаляет чувствительные поля из лог-контекста.
 * Список полей — в SENSITIVE_KEYS.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'tfasecret',
  'tfabackupcodes',
  'refreshtoken',
  'accesstoken',
  'apikey',
  'secretkey',
  'privatekey',
  'sessiontoken',
  'csrftoken',
  'authorization',
  'cookie',
  'cookies',
])

function sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sanitize)
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitize(value)
    } else {
      result[key] = value
    }
  }
  return result
}

// ===== Public API =====
export const logger = {
  debug: (message: string, context?: Record<string, any>) => log('debug', message, context),
  info: (message: string, context?: Record<string, any>) => log('info', message, context),
  warn: (message: string, context?: Record<string, any>) => log('warn', message, context),
  error: (message: string, context?: Record<string, any>) => log('error', message, context),
  fatal: (message: string, context?: Record<string, any>) => log('fatal', message, context),

  /**
   * Создать child-logger с предустановленным контекстом (например, requestId).
   *
   * @example
   *   const log = logger.child({ requestId: 'req-abc', userId: 'u123' })
   *   log.info('Order created', { orderId: 'o456' })
   *   // → { requestId: 'req-abc', userId: 'u123', message: 'Order created', orderId: 'o456' }
   */
  child: (defaultContext: Record<string, any>) => ({
    debug: (message: string, context?: Record<string, any>) => log('debug', message, { ...defaultContext, ...context }),
    info: (message: string, context?: Record<string, any>) => log('info', message, { ...defaultContext, ...context }),
    warn: (message: string, context?: Record<string, any>) => log('warn', message, { ...defaultContext, ...context }),
    error: (message: string, context?: Record<string, any>) => log('error', message, { ...defaultContext, ...context }),
    fatal: (message: string, context?: Record<string, any>) => log('fatal', message, { ...defaultContext, ...context }),
  }),
}

// ===== Sentry integration (опционально, если установлен) =====
/**
 * Логирует ошибку в Sentry (если SENTRY_DSN задан) + в logger.
 * Использовать для критических ошибок, которые должен видеть дежурный.
 *
 * @example
 *   try {
 *     await processPayment(order)
 *   } catch (err) {
 *     logger.captureError(err, { orderId: order.id })
 *     return NextResponse.json({ error: 'Payment failed' }, { status: 500 })
 *   }
 */
export async function captureError(
  error: Error | unknown,
  context?: Record<string, any>
): Promise<void> {
  // Логируем локально
  logger.error(error instanceof Error ? error.message : String(error), {
    ...context,
    stack: error instanceof Error ? error.stack : undefined,
  })

  // Отправляем в Sentry (если установлен и есть DSN)
  if (process.env.SENTRY_DSN) {
    try {
      // Динамический import через new Function — vite не резолвит на этапе сборки,
      // поэтому пакет может отсутствовать в dev-окружении
      const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
      const Sentry = await dynamicImport('@sentry/nextjs').catch(() => null)
      if (Sentry?.captureException) {
        Sentry.captureException(error, {
          extra: context,
        })
      }
    } catch {
      // Sentry недоступен — игнорируем, лог уже записан
    }
  }
}

export { sanitize as sanitizeLogContext }
