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

## 5. Чек-лист production readiness (Z-v33, 2026-11-13)

Статусы: `ГОТОВО В КОДЕ` (реализовано и покрыто проверками; настройка не требуется) · `ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА` (код готов, нужны creds/решение вне песочницы) · `НЕ ПОДКЛЮЧЕНО` (интеграция не активирована). Ничего не подключается из рабочей сессии — только владельцем. Эталон цикла — `docs/release/RELEASE_CANDIDATE.md` §5.

| Компонент | Статус | Действие владельца |
|---|---|---|
| Домен / HTTPS | ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА | прод-домен + TLS reverse-proxy (Caddy prod); заголовки безопасности дублирует приложение (proxy.ts); `NEXT_PUBLIC_APP_URL` = канонический домен |
| Production DB | ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА | `DATABASE_URL` на PostgreSQL 18; применить 85 миграций ledger-мигратором, сверить `schema_migrations` = `ls supabase/migrations \| wc -l` |
| JWT/DB secrets | ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА | `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `TFA_ENCRYPTION_KEY`; при ротации `JWT_SECRET` — перегенерация `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` той же HS256-схемой (iss=local, role claim), иначе PostgREST-шим деградирует их до anon (урок ZV33-3b) |
| Yandex ID OAuth + callback URLs | НЕ ПОДКЛЮЧЕНО | creds `YANDEX_CLIENT_ID/SECRET` + зарегистрировать callback URL(ы) в консоли провайдера |
| VK ID OAuth + callbacks | НЕ ПОДКЛЮЧЕНО | creds `VK_CLIENT_ID/SECRET` + callback URL(ы) |
| YooKassa prod credentials + webhook URL | НЕ ПОДКЛЮЧЕНО | боевые `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY` + webhook URL; идемпотентность вебхука готова в коде (final-status gate, CAS-эскроу, ledger-ключ `pay-succeeded:<providerId>`); проверить повторную доставку после deploy |
| CRON_SECRET (n8n) | ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА | задать `CRON_SECRET`; cron-эндпоинты fail-closed без него; передать в n8n-сервис (`N8N_WEBHOOK_BASE_URL`, `N8N_WEBHOOK_SECRET`) |
| CORS | ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА | ревизия CORS/allowed-origins под прод-домен перед публичным деплоем |
| Secure cookies | ГОТОВО В КОДЕ | сессионные cookie с флагами secure/httpOnly в коде; проверить в prod-https |
| Rate limits | ГОТОВО В КОДЕ | in-memory лимиты работают; Redis — опционально для мульт-инстансной установки |
| Upload storage buckets | ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА | определить хранилище/buckets для загрузок; role-guard маршрутов готов в коде (`src/lib/upload-role-guard.ts`) |
| Backup schedule + тест восстановления | НЕ ПОДКЛЮЧЕНО | maintenance.yml — READY FOR OWNER APPROVAL; утвердить расписание pg_dump, первый бэкап + `ops:restore-verify` на disposable БД (бэкап без доказанного восстановления не считается бэкапом); офсайт-хранитель + RPO/RTO — решение D-EXT-5 |
| Мониторинг/ошибки | ГОТОВО В КОДЕ | diagnostics-канал (app_error_events/incidents/метрики) работает; Telegram-уведомления P0/P1 — опционально по creds |
| Production env vars | ТРЕБУЕТ ДЕЙСТВИЯ ВЛАДЕЛЬЦА | заполнить по §1 (обязательные + условные); шаблон — `.env.production.example`; значения нигде не коммитятся |
