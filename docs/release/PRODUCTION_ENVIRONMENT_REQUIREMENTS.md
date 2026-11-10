# PRODUCTION ENVIRONMENT REQUIREMENTS — Conditera

Чек-лист окружения для публичного запуска. Проверка наличия — без вывода значений.

## 1. Приложение (runtime)

| Переменная | Назначение | Обязательна |
|---|---|---|
| `DATABASE_URL` | PostgreSQL production | ✅ |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | app-сессии (32+ символов) | ✅ |
| `TFA_ENCRYPTION_KEY` | шифрование 2FA-секретов (64 hex) | ✅ |
| `NEXT_PUBLIC_APP_URL` | канонический домен (sitemap/og/redirects) | ✅ |
| `CRON_SECRET` | cron-эндпоинты (fail-closed без него) | ✅ |
| `N8N_WEBHOOK_BASE_URL`, `N8N_WEBHOOK_SECRET` | n8n: исходящие события + входящий вебхук | ✅ (для автоматизации) |
| `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram-бот и алерты | опционально |
| `BOT_SECRET` | chat bot-trigger | опционально |
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase/PostgREST-шима | ✅ |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | боевые платежи | до включения платежей |
| `YANDEX_CLIENT_ID/SECRET`, `VK_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` | OAuth-провайдеры | до включения соответствующих кнопок |
| `MAILGUN_*` / SMTP | email | до включения email |
| `VAPID_*` | web-push | опционально |

Проверка: `.env.production.example` — полный шаблон с комментариями.

## 2. GitHub Environments / secrets (CI/CD)

- Environment **`staging`**: `STAGING_HOST`, `STAGING_SSH_KEY`, `STAGING_APP_URL`,
  `MAINTENANCE_APP_URL`, `MAINTENANCE_CRON_SECRET`.
- Environment **`production`**: required reviewers (manual approval), те же переменные +
  registry/deploy secrets. Без approval deploy.yml не должен запускаться.
- Notification secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (для e2e/maintenance уведомлений).

## 3. Инфраструктура

- PostgreSQL 18 (совместимость подтверждена prodpath-harness на PG18).
- Reverse-proxy с TLS; заголовки безопасности дублирует приложение (proxy.ts).
- Достаточный объём RAM: рекомендации ≥ 2 GB на инстанс Next.js (production build
  легче dev, но image-обработка и AI-запросы аллоцируют).
- Redis (опционально): для мульт-инстансного rate-limit (сейчас in-memory fallback).
- n8n (опционально): `docker compose up -d n8n` (сервис в docker-compose.yml, порт 5678,
  workflows монтируются из `./n8n-workflows`).

## 4. Перед открытием трафика

1. Применить миграции (statement-by-statement) → проверка ledger.
2. `bun run ops:backup` и `ops:restore-verify` — сохранить первый production-backup.
3. Проверить: `/api/health` → `status: ok`; `/robots.txt` — Disallow: /dashboard, /api;
   `/sitemap.xml` — домен из `NEXT_PUBLIC_APP_URL` (не localhost).
4. Убедиться, что dev-only фолбэки недоступны: `NODE_ENV=production` отключает
   dev-auth (`src/lib/dev-auth.ts` гвардится) и `mock_*` платежи (fail-closed).
