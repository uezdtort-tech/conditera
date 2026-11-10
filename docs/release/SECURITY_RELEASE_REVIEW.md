# SECURITY RELEASE REVIEW — Z-v20

Метод: ручной аудит по реальному коду (автономный security-обход Z20-SEC) с личной
проверкой каждого finding'а перед исправлением. Два finding'а суб-аудита НЕ подтвердились
и отклонены: (1) «telegram webhook fail-open» — фактически fail-closed в production
(503 без секрета); (2) «сломанные роуты ediaId]» — артефакт отображения, директории
`[mediaId]` корректны (проверено кодами символов).

## Исправлено в Z-v20

| Severity | Файл | Проблема | Исправление |
|---|---|---|---|
| **P1** | `src/app/api/auth/2fa/login-verify/route.ts` | Верификация TOTP/backup-кода без лимита попыток — брутфорс 6-значного кода в течение жизни temp-токена (5 мин) | Rate-limit: **5 попыток на temp-токен** (окно = TTL токена) + **20/5 мин на IP** через `enforceRateLimit` (единый механизм с login/checkout) |
| **P1** | `src/components/dashboard/n8n-automation-dashboard.tsx` | Пароль n8n-админа отображался в UI | Убран; ссылка на переменную окружения |
| P2 | `src/app/api/auth/callback/route.ts` | `returnTo` не валидировался → условный open-redirect (`https://host@evil.com`) | Guard: только локальные пути (начинается с `/`, не `//`, без `@`), иначе `/dashboard` |
| P2 | `src/app/api/recipes/marketplace/route.ts` | Пользовательский `q` без санитизации в PostgREST `.or()` → filter-injection (`,()`, LIKE-маски) | Вырезание `,()\\%_` из `q` перед интерполяцией |
| P2 | `src/app/api/products/ai-photo/route.ts` | Платная AI-генерация без rate-limit → cost-abuse + заполнение диска | `enforceRateLimit` с пресетом `RATE_LIMITS.ai` (10/мин с IP) — как у ai-description |
| P2 | `src/app/api/webhooks/n8n/route.ts` | Секрет сравнивался не в constant-time (`!==`); `detail: error.message` в 500-ответе | `timingSafeEqualStr` (единый контракт с telegram/chat webhooks); detail убран |
| P2 | `src/app/api/webhooks/n8n/route.ts` | 500-ответ утечкал внутренние сообщения | `detail` удалён из ответа |

## Проверено и подтверждено (без изменений)

- **API-периметр**: 324 route.ts; 32 без auth-маркера — все публичные by design
  (health, csrf-token, каталог GET, AI с rate-limit, telemetry) — подозрительных нет.
- **/api/admin/*** — все 14 файлов проверяют роль (401/403, проверено вживую:
  diagnostics events/incidents/metrics, новый n8n-workflows → 401 без auth).
- **Cron** — 24 роута вызывают `verifyCronSecret` (fail-closed при отсутствии секрета);
  проверено вживую: `/api/cron/abandoned-cart` без секрета → 401.
- **IDOR** — ownership на сервере: orders/[id] (owner/confectioner/назначенный курьер),
  cart (`.eq("user_id", me)` никогда из тела), chat (`canAccessRoom` → 403),
  refund (owner → только заявка), reviews («не ваш заказ» 403).
- **Upload** — magic-byte sniffing, лимит 10 МБ, анти-traversal категории, UUID-имена.
- **YooKassa webhook** — IP-allowlist (production) + обязательная сверка события с
  провайдером (GET /payments/{id}) + сверка сумм + идемпотентность финальных статусов
  и CAS; `mock_*` fail-closed в production.
- **CSRF** — double-submit cookie + timingSafeEqual в proxy; узкий exempt-лист.
- **Cookies** — httpOnly, SameSite=Lax, Secure в prod (cd_session 7d, cd_refresh 30d);
  oauth_handoff — 60 сек, одноразовая.
- **Secrets** — 0 совпадений секретных имён в `NEXT_PUBLIC_*`; SERVICE_ROLE_KEY только
  в серверных файлах; хардкод-секретов в src/ нет; `.env*` в .gitignore.
- **SQL injection** — параметризация повсеместно; `SET LOCAL ROLE` из белого списка.
- **Masking diagnostics** — password/secret/token/cookie/card/ПДн/тела сообщений + лимиты
  длины/глубины + anti-log-injection (проверено diagnostics-verify 16/16).
- **Rate limiting** — 30 файлов с enforceRateLimit; login 20/ч; checkout 5/мин;
  AI 10/мин. (anti-fraud fail-open при недоступности БД — известное задокументированное
  решение, риск остаточный, см. KNOWN_LIMITATIONS.)

## Остаточные риски (принято, задокументировано)

1. anti-fraud fail-open при недоступности БД (документировано ранее; для login
   компенсируется rate-limit в 30 файлах).
2. CSP содержит `'unsafe-inline' 'unsafe-eval'` — ослабленная защита от XSS
   (требует nonce-рефакторинга — после релиза).
3. In-memory троттлинг лайков и rate-limit (без Redis) сбрасывается рестартом и не
   работает мульт-инстансно — для одного инстанса staging приемлемо.
4. `/api/email/health` публично показывает configured: true/false — незначительная
   разведка инфраструктуры.
5. Video AI-photo rate-limit по IP — за общим прокси может агрегировать пользователей
   (для staging приемлемо).
