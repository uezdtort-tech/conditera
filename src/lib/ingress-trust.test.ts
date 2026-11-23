/**
 * v4.6 (DEV-01): регрессионные тесты ДОВЕРЕННОЙ IP-ТОПОЛОГИИ.
 *
 * Приложение (extractIp/getClientIP) доверяет заголовку x-real-ip.
 * Само приложение НЕ может отличить «переписанный Caddy» заголовок от
 * клиентской подделки — доверие обеспечивает ИНФРАСТРУКТУРА:
 *   1. docker-compose.yml: web/pgbouncer/meili/mailu опубликованы ТОЛЬКО на
 *      127.0.0.1 — прямой доступ к web:3000 в обход Caddy извне исключён.
 *   2. Caddyfile: КАЖДЫЙ block-форма reverse_proxy к web:3000 / chat-service:3030
 *      перезаписывает X-Real-IP серверно:
 *        • peer из loopback (Cloudflare Tunnel: cloudflared → localhost:80) →
 *          X-Real-IP := CF-Connecting-IP (ставится CF edge, через туннель
 *          не подделывается);
 *        • иначе (прямой клиент) → X-Real-IP := {remote_host} (реальный TCP-пир),
 *          клиентский CF-Connecting-IP удаляется.
 *   3. Матчер @loopback_peer объявлен (remote_ip 127.0.0.1 ::1).
 *
 * Эти тесты — структурная защита: если кто-то вернёт «3000:3000» или уберёт
 * header_up X-Real-IP из reverse_proxy, suite падает ДО релиза.
 * Уровень доказательства: СТАТИЧЕСКИЙ (файлы конфигурации). Реальная сетевая
 * проверка — DEV-05 live-проба и CI job validate-caddyfile (caddy validate).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { extractIp } from './anti-fraud'
import { getClientIP } from './rate-limit'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../')
const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8')
const caddy = readFileSync(resolve(ROOT, 'Caddyfile'), 'utf8')

describe('ingress trust: docker-compose loopback bindings (v4.6)', () => {
  const cases: Array<[string, string]> = [
    ['web', '127.0.0.1:3000:3000'],
    ['pgbouncer', '127.0.0.1:6432:5432'],
    ['meilisearch', '127.0.0.1:7700:7700'],
    ['mailu webmail', '127.0.0.1:8081:80'],
  ]

  it.each(cases)('%s опубликован только на loopback (%s)', (_, binding) => {
    expect(compose).toContain(`"${binding}"`)
  })

  it('ни один из критичных портов не висит на 0.0.0.0 (голые "порт:порт")', () => {
    // Голая публикация допустима ТОЛЬКО для назначенных точек входа:
    // Caddy 80/443, SMP 5223 (TCP-протокол SimpleX, вне HTTP-цепочки доверия),
    // SMTP/IMAP 25/465/587/993. web/pgbouncer/meili/mailu — запрещены.
    const bareAllowed = new Set([
      '"80:80"', '"443:443"', '"5223:5223"',
      '"25:25"', '"465:465"', '"587:587"', '"993:993"',
    ])
    const portLines = compose
      .split('\n')
      .map((l) => {
        const i = l.indexOf('#')
        return i >= 0 ? l.slice(0, i) : l
      })
      .map((l) => l.trim())
      .filter((l) => /^-\s*"[\d.]+:\d+"/.test(l))
    for (const line of portLines) {
      const binding = line.replace(/^-\s*/, '')
      if (binding.startsWith('"127.0.0.1:')) continue
      expect(bareAllowed.has(binding), `незапланированная публичная привязка: ${binding}`).toBe(true)
    }
  })
})

describe('ingress trust: Caddyfile header_up X-Real-IP (v4.6)', () => {
  // Парсер block-форм reverse_proxy (комментарии вырезаются).
  const parseProxyBlocks = (src: string) => {
    const lines = src.split('\n').map((l) => {
      const i = l.indexOf('#')
      return i >= 0 ? l.slice(0, i) : l
    })
    const blocks: Array<{ line: number; upstream: string; headerUp: string[] }> = []
    let cur: { line: number; upstream: string; headerUp: string[] } | null = null
    lines.forEach((raw, idx) => {
      const l = raw.trim()
      if (l.endsWith('{')) {
        const m = l.match(/^reverse_proxy\s+(?:@\S+\s+)?(\S+)\s*\{$/)
        if (m) cur = { line: idx + 1, upstream: m[1], headerUp: [] }
      }
      if (cur) {
        const h = l.match(/^header_up\s+(.+)$/)
        if (h) cur.headerUp.push(h[1].trim())
      }
      if (l === '}') {
        if (cur) {
          blocks.push(cur)
          cur = null
        }
      }
    })
    return blocks
  }

  it('матчер @loopback_peer объявлен: remote_ip 127.0.0.1 ::1', () => {
    expect(caddy).toMatch(/@loopback_peer\s*\{[^}]*remote_ip\s+127\.0\.0\.1\s+::1/)
  })

  it('каждый block-form reverse_proxy к web:3000 / chat-service:3030 перезаписывает X-Real-IP', () => {
    const proxied = parseProxyBlocks(caddy).filter((b) =>
      b.upstream === 'web:3000' || b.upstream === 'chat-service:3030'
    )
    // Слияние 2026-11-23: канонический Kong занял /api/auth/v1/* (supabase auth),
    // наш отдельный @api_auth-хендле сложился в общий handle /api/* — блоков 7
    // (api×2, ws×2, site×2, localhost×1; n8n — отдельный upstream).
    // Инвариант защиты — второй ассерт: НИ один блок web/chat без перезаписи.
    expect(proxied.length).toBeGreaterThanOrEqual(7)
    const missing = proxied.filter((b) => !b.headerUp.some((h) => h.startsWith('X-Real-IP')))
    expect(missing, `блоки без перезаписи X-Real-IP: строки ${missing.map((b) => b.line).join(', ')}`).toEqual([])
  })

  it('топология A (прямой клиент): X-Real-IP := {remote_host} И клиентский CF-Connecting-IP удаляется', () => {
    // Каждая пара «X-Real-IP {remote_host}» должна сопровождаться удалением
    // CF-Connecting-IP — иначе клиент прямого пути подделывает CF-заголовок,
    // который приложение проверяет ПОСЛЕ x-real-ip (но chat/n8n-логи всё равно
    // получают поддельное значение).
    const blocks = parseProxyBlocks(caddy)
    const direct = blocks.filter((b) => b.headerUp.some((h) => h === 'X-Real-IP {remote_host}'))
    expect(direct.length).toBeGreaterThanOrEqual(4)
    for (const b of direct) {
      expect(
        b.headerUp.some((h) => h === '-CF-Connecting-IP'),
        `блок на строке ${b.line}: {remote_host}-перезапись без удаления CF-Connecting-IP`
      ).toBe(true)
    }
  })

  it('топология B (tunnel): peer loopback → X-Real-IP := CF-Connecting-IP', () => {
    expect(caddy).toContain('header_up X-Real-IP {header.CF-Connecting-IP}')
  })

  it('localhost (дев) тоже перезаписывает X-Real-IP := {remote_host} (паритет политики)', () => {
    const localhostSite = caddy.slice(caddy.indexOf('\nlocalhost {'))
    expect(localhostSite).toContain('header_up X-Real-IP {remote_host}')
    expect(localhostSite).toContain('header_up -CF-Connecting-IP')
  })
})

describe('TRUSTED_PROXY_HOPS: хвост X-Forwarded-For (оба экстрактора)', () => {
  const HOPS = process.env.TRUSTED_PROXY_HOPS
  afterEach(() => {
    if (HOPS === undefined) delete process.env.TRUSTED_PROXY_HOPS
    else process.env.TRUSTED_PROXY_HOPS = HOPS
  })

  it('hops=1 (default): последний элемент XFF — клиент за одним доверенным прокси', () => {
    delete process.env.TRUSTED_PROXY_HOPS
    const req = new Request('https://x', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' } })
    expect(extractIp(req)).toBe('3.3.3.3')
    expect(getClientIP(req)).toBe('3.3.3.3')
  })

  it('hops=2 (CDN → Caddy): предпоследний элемент', () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    const req = new Request('https://x', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' } })
    expect(extractIp(req)).toBe('2.2.2.2')
    expect(getClientIP(req)).toBe('2.2.2.2')
  })

  it('hops больше длины цепочки → безопасный fallback (без выхода за массив)', () => {
    process.env.TRUSTED_PROXY_HOPS = '9'
    const req = new Request('https://x', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } })
    expect(extractIp(req)).toBe('0.0.0.0')
    expect(getClientIP(req)).toBe('unknown')
  })

  it('ДОКУМЕНТАЦИЯ ПОЛИТИКИ: приложение доверяет x-real-ip какому есть — защита обеспечивается инфраструктурой выше', () => {
    // Это НЕ дефект: контракт «x-real-ip ставит только Caddy» закреплён
    // структурными тестами выше (loopback-bindings + header_up). Прямой
    // запрос к web:3000 извне невозможен (127.0.0.1), а через Caddy заголовок
    // всегда перезаписывается. Тест фиксирует контракт явно, чтобы
    // «тихое» удаление инфраструктурных гарантий ломало сборку.
    const req = new Request('https://x', { headers: { 'x-real-ip': '203.0.113.7' } })
    expect(extractIp(req)).toBe('203.0.113.7')
    expect(getClientIP(req)).toBe('203.0.113.7')
  })
})
