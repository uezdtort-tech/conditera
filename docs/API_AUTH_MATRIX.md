# API Auth Matrix — маршрут → метод → тип авторизации

> Сгенерировано из аудита (сентябрь 2026) + PR «security: C1–C6 hard gate + P0-API».
> Поддерживается вручную; CI-гейт: `scripts/check-api-auth.sh` (mutation-роуты без
> auth/secret/rate-limit → fail).
>
> Легенда: **USER** = сессия пользователя (Supabase/JWT), **SECRET** = shared secret
> (cron/webhook), **RATE** = rate-limit по IP, **PUBLIC** = открыт намеренно.

## 1. Auth flow (PUBLIC по определению + rate-limit)

| Route | Метод | Защита |
|-------|-------|--------|
| `/api/auth/login` | POST | PUBLIC + anti-fraud (20/час/IP) |
| `/api/auth/register` | POST | PUBLIC + anti-fraud (3/час/IP) |
| `/api/auth/refresh` | POST | PUBLIC + rate-limit 10/min/IP |
| `/api/auth/2fa/login-verify` | POST | PUBLIC (шаг login flow, temp-token) |
| `/api/auth/logout`, `session`, `callback`, `oauth/*` | GET | PUBLIC (session/oauth flow) |
| `/api/csrf-token` | GET | PUBLIC (выдача CSRF) |

## 2. AI / тяжёлые POST (RATE — до внедрения обязательной auth в P1+)

| Route | Метод | Защита |
|-------|-------|--------|
| `/api/ai-cake-finder` | POST | RATE 10/min/IP (LLM) |
| `/api/fillings/ai-generate-slice` | POST | RATE 10/min/IP (LLM) |
| `/api/products/ai-description` | POST | RATE 10/min/IP (LLM); GET tones — PUBLIC |
| `/api/visual-search` | POST | RATE 6/min/IP (VLM + base64 ≤5МБ) |
| `/api/slice/export-png` | POST | RATE 20/min/IP (CPU-рендер) |

> Следующий шаг (P1): единый middleware, требующий сессию для `/api/ai-*`,
> кроме явно публичных виджетов (`ai-cake-finder`, `visual-search`).

## 3. Webhooks / machine-to-machine (SECRET обязателен)

| Route | Метод | Секрет |
|-------|-------|--------|
| `/api/telegram/webhook` | POST | `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET`; prod без env → 503 |
| `/api/email/inbound` | POST | `MAILGUN_SIGNING_KEY` (multipart) / `SENDGRID_WEBHOOK_KEY` (JSON); prod без ключей → 503; подпись отсутствует → 401 |
| `/api/webhooks/n8n` | POST | `X-N8N-Secret` = `N8N_WEBHOOK_SECRET`; без env → 503 |
| `/api/payment/webhook` | POST | `verifyWebhook()` (YooKassa HMAC) |
| `/api/simplex/incoming` | POST | `X-Bridge-Api-Key` |
| `/api/chat/bot-trigger` | POST | `X-Bot-Secret` = `BOT_SECRET` (без dev-default в коде; без env → 503) |
| `/api/cron/*` (все 19) | GET/POST | `X-Cron-Secret` = `CRON_SECRET` через `verifyCronSecret` (пустой secret → отказ) |

## 4. User routes (USER)

Реализуют один из паттернов: `getCurrentUser` (Supabase, канон), `getSession`
(SSR), legacy `getUserFromRequest` (JWT — не расширять, см. `docs/AUTH.md`).

Группы: `orders/*`, `profile/*`, `confectioner/*`, `venues/*`, `venues/[id]/bookings/*`,
`services/*`, `stories/*`, `notifications/*`, `loyalty/*`, `crm/*`, `admin/*`,
`moderation/*`, `certification/*`, `b2b/*`, `franchise*/*`, `copywriter/*`, `courier/*`,
`inspector/*`, `nutritionist/*`, `operator/*`, `supplier/*`, `taster/*`, `team/*`,
`tenders/*`, `quotes/*`, `events/*`, `inquiries`, `negotiations/*`, `payment/refund`,
`checkout`, `gamification/*`, `ai-assistant/*`, `channel/*`, `live-streams/*`,
`lessons/*`, `recipes/*`, `fillings/*`, `builder/*`, `video-feed`, `simplex/*`
(личные сообщения), `email/list`, `organization/*`, `payouts/request`, `maintenance/*`.

Полный список ролей и прав — `docs/ROLE_MATRIX.md`.
Использование service_role — `docs/SUPABASE_ADMIN_POLICY.md`.

## 5. Public catalog/info (PUBLIC — оставить, добавить cache)

`/api/confectioners` (verified), `/api/map/confectioners`, `/api/search`,
`/api/search/health`, `/api/promotions`, `/api/loyalty/levels`,
`/api/products/[id]/slice-3d-config`, `/api/recipes/[id]/acceptances`,
`/api/settings/promo-popup`, `/api/notifications/vapid-key`, `/api/simplex/support-address`,
`/api/telegram/webapp`, `/api/payment/webhook` (GET info), health-эндпоинты.

Требования:
- health/info GET — минимальный payload (без версий/внутренностей/секретов);
- `recipes/[id]/acceptances` — проверено: PII (email/телефон) в ответе отсутствует.

## История изменений

| Дата | Изменение |
|------|-----------|
| 2026-09 | Telegram webhook: добавлен secret token (P0) |
| 2026-09 | email/inbound: подпись обязательна в prod (P0) |
| 2026-09 | bot-trigger: убран dev-default BOT_SECRET (P0) |
| 2026-09 | 5 AI/export POST: rate-limit (P0) |
| 2026-09 | auth/refresh: rate-limit 10/min (P1) |
