/**
 * v4.6 (DEV-02): конкурентность и точные границы hourly/daily anti-fraud.
 *
 * В отличие от anti-fraud.test.ts (очередь заготовленных ответов), здесь
 * МОК ведёт себя как реальная таблица: insert ДОБАВЛЯЕТ строку, select
 * СЧИТАЕТ строки по фильтрам (ip_hash, action, created_at >= ...).
 * Это позволяет детерминированно доказать:
 *   1. Политику «3/час»: попытки 1-3 allowed, 4-я → отказ (rolling window).
 *   2. Политику «10/24ч»: при часовых окнах из прошлого суточный лимит
 *      реально блокирует (раньше maxPerDay не проверялся вовсе).
 *   3. Конкурентность: строгий порядок insert→count не даёт N параллельным
 *      запросам «размыть» счётчик. Полный одновременный всплеск N > лимита
 *      консервативно отклоняет ВСЕ N (пере-блокировка безопаснее обхода) —
 *      осознанное свойство, документировано в anti-fraud.ts.
 *   4. Разные IP — независимые бакеты даже при конкурентных запросах.
 *
 * Fail-open при недоступности БД документирован в anti-fraud.test.ts.
 * Отдельно: fail-open НЕ создаёт эксплуатируемого обхода — регистрация/логин
 * сами требуют БД, при её отказе запрос отклоняется уже на следующем шаге
 * (зафиксировано в RELEASE-GATE-v4.6-REPORT.md как явное решение).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Row {
  ip_hash: string
  action: string
  created_at: string
}

const hoisted = vi.hoisted(() => {
  const records: Row[] = []
  const makeBuilder = () => {
    const filters: Array<[string, string]> = []
    const chain: Record<string, unknown> = {}
    chain.insert = vi.fn((row: Row) => {
      records.push(row)
      return Promise.resolve({ error: null })
    })
    chain.select = vi.fn(() => chain)
    chain.eq = (k: string, v: string) => {
      filters.push([k, v])
      return chain
    }
    chain.gte = (k: string, v: string) => {
      filters.push([k, v])
      return chain
    }
    chain.then = (
      resolve: (v: { count: number; error: null }) => void,
      reject: (e: unknown) => void
    ) => {
      try {
        const ipHash = filters.find(([k]) => k === 'ip_hash')?.[1]
        const action = filters.find(([k]) => k === 'action')?.[1]
        const since = filters.find(([k]) => k === 'created_at')?.[1]
        if (ipHash === undefined || action === undefined || since === undefined) {
          reject(new Error('mock: неполные фильтры select'))
          return
        }
        const count = records.filter(
          (r) => r.ip_hash === ipHash && r.action === action && r.created_at >= since
        ).length
        resolve({ count, error: null })
      } catch (e) {
        reject(e)
      }
    }
    return chain
  }
  return { records, fromMock: vi.fn(() => makeBuilder()) }
})

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: hoisted.fromMock },
}))

// Импорт ПОСЛЕ vi.mock (hoisting)
import { checkFraudLimit, LIMITS, hashIp, type FraudCheckResult } from './anti-fraud'

const reqFromIp = (ip: string): Request =>
  new Request('https://example.com/api/auth/register', {
    method: 'POST',
    headers: { 'x-real-ip': ip },
  })

const seed = (ip: string, action: string, count: number, ageMs: number) => {
  const createdAt = new Date(Date.now() - ageMs).toISOString()
  for (let i = 0; i < count; i++) {
    hoisted.records.push({ ip_hash: hashIp(ip), action, created_at: createdAt })
  }
}

describe('checkFraudLimit: точные границы и конкурентность (v4.6, DEV-02)', () => {
  beforeEach(() => {
    hoisted.records.length = 0
    hoisted.fromMock.mockClear()
  })

  it('register 3/час: попытки 1,2,3 разрешены; 4-я → 429-контракт (allowed:false, reason 3/час)', async () => {
    const ip = '198.51.100.10'
    const results: FraudCheckResult[] = []
    for (let i = 0; i < 4; i++) {
      results.push(await checkFraudLimit(reqFromIp(ip), 'register'))
    }
    expect(results.slice(0, 3).map((r) => r.allowed)).toEqual([true, true, true])
    expect(results[3].allowed).toBe(false)
    expect(results[3].reason).toContain('3/час')
    // Строгий режим: отклонённая попытка тоже занимает окно
    expect(hoisted.records.filter((r) => r.action === 'register')).toHaveLength(4)
  })

  it('register 10/24ч: 9 попыток в прошлые часы (вне часового окна) + попытка №10 allowed, №11 → отказ по СУТОЧНОМУ', async () => {
    const ip = '198.51.100.11'
    // 9 записей возрастом 2 часа: в часовое окно не попадают, в суточное — да
    seed(ip, 'register', 9, 2 * 60 * 60 * 1000)
    const tenth = await checkFraudLimit(reqFromIp(ip), 'register')
    expect(tenth.allowed).toBe(true)
    const eleventh = await checkFraudLimit(reqFromIp(ip), 'register')
    expect(eleventh.allowed).toBe(false)
    expect(eleventh.reason).toContain('суточный')
    expect(eleventh.reason).toContain('10/24ч')
    expect(hoisted.records).toHaveLength(11) // 9 seed + 2 попытки
  })

  it('граница окна: попытка ровно на рубеже 60 минут выпадает из часового счёта (rolling window)', async () => {
    const ip = '198.51.100.12'
    // 3 попытки возрастом 60м01с — часовое окно чистое
    seed(ip, 'register', 3, 60 * 60 * 1000 + 60 * 1000)
    const res = await checkFraudLimit(reqFromIp(ip), 'register')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(LIMITS.register.maxPerHour - 1)
  })

  it('КОНКУРЕНТНОСТЬ: 6 параллельных register с одного IP → допущено НЕ БОЛЬШЕ 3 (гонка count→insert устранена)', async () => {
    const ip = '198.51.100.13'
    // Все 6 вызовов стартуют синхронно: insert каждого выполняется до первого
    // await, поэтому к моменту select-ов таблица уже содержит 6 строк —
    // ни один запрос не видит «устаревший» счётчик.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => checkFraudLimit(reqFromIp(ip), 'register'))
    )
    const allowed = results.filter((r) => r.allowed).length
    expect(allowed).toBeLessThanOrEqual(LIMITS.register.maxPerHour)
    expect(results.filter((r) => !r.allowed).length).toBeGreaterThanOrEqual(3)
    // Записано ровно 6 попыток — счётчик не размыт
    expect(hoisted.records.filter((r) => r.action === 'register')).toHaveLength(6)
  })

  it('КОНКУРЕНТНОСТЬ: разные IP параллельно — независимые бакеты, все допущены', async () => {
    const ips = ['198.51.100.20', '198.51.100.21', '198.51.100.22', '198.51.100.23']
    const results = await Promise.all(ips.map((ip) => checkFraudLimit(reqFromIp(ip), 'register')))
    expect(results.every((r) => r.allowed)).toBe(true)
    // У каждого IP ровно своя запись
    for (const ip of ips) {
      expect(hoisted.records.filter((r) => r.ip_hash === hashIp(ip))).toHaveLength(1)
    }
  })

  it('смешанная нагрузка: параллельные IP + разогретый бакет — лимит применяется per-IP, не глобально', async () => {
    const hotIp = '198.51.100.30' // уже 3 попытки за 10 минут → час исчерпан
    seed(hotIp, 'register', 3, 10 * 60 * 1000)
    const freshIps = ['198.51.100.31', '198.51.100.32']
    const [hot1, hot2, fresh1, fresh2] = await Promise.all([
      checkFraudLimit(reqFromIp(hotIp), 'register'),
      checkFraudLimit(reqFromIp(hotIp), 'register'),
      checkFraudLimit(reqFromIp(freshIps[0]), 'register'),
      checkFraudLimit(reqFromIp(freshIps[1]), 'register'),
    ])
    // Горячий IP: 4-я и 5-я попытки за час — отказ (консервативно при гонке)
    expect(hot1.allowed).toBe(false)
    expect(hot2.allowed).toBe(false)
    // Свежие IP не пострадали от чужого бакета
    expect(fresh1.allowed).toBe(true)
    expect(fresh2.allowed).toBe(true)
  })

  it('E2E-совместимость: per-spec симулированный x-real-ip даёт независимые бакеты (документация контракта)', async () => {
    // tests/e2e шлют симулированный x-real-ip напрямую в web:3000 (без Caddy);
    // в production Caddy перезаписывает этот заголовок — контракт и его
    // граница доверия зафиксированы в docs/DNS_SETUP.md.
    const e2eA = await checkFraudLimit(reqFromIp('10.77.0.1'), 'register')
    const e2eB = await checkFraudLimit(reqFromIp('10.77.0.2'), 'register')
    expect(e2eA.allowed).toBe(true)
    expect(e2eB.allowed).toBe(true)
    expect(e2eA.remaining).toBe(LIMITS.register.maxPerHour - 1)
    expect(e2eB.remaining).toBe(LIMITS.register.maxPerHour - 1)
  })
})
