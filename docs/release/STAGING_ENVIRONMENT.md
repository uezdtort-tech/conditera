# STAGING_ENVIRONMENT — целевая конфигурация staging (Z-v21)

**Дата:** 2026-11-10. Документ описывает подготовленную конфигурацию; фактическое развёртывание — ТОЛЬКО после отдельного разрешения владельца (см. OWNER_ACTIONS_REQUIRED.md).

## 1. Принципы изоляции staging от production

| Ресурс | Требование | Как обеспечивается |
|---|---|---|
| БД | отдельная БД/инстанс | отдельный `DATABASE_URL` (staging-хост), никогда production-строка |
| Credentials | отдельные секреты | свой набор env; совпадение значений с production запрещено |
| Storage | отдельные бакеты/корни | `PRODUCT_MEDIA_ROOT` указывает на staging-каталог/бакет |
| OAuth callback | отдельные redirect URI | `YANDEX_OAUTH_REDIRECT=https://<staging-host>/api/auth/oauth/yandex/callback` (+ регистрация в кабинете Яндекса) |
| Webhooks | отдельные URL | YooKassa/Telegram webhook на `<staging-host>`; секреты свои |
| Платежи | только sandbox | тестовые `YOOKASSA_SHOP_ID/SECRET_KEY`; prod-guard тест не пропустит mock в prod |
| Индексация | запрет | см. §4 noindex |

## 2. Обязательные переменные staging (имена; значения НЕ в репозитории)

Источник контракта: `.env.production.example` (64 ключа, скрипт `scripts/verify/production-env-template.mjs` проверяет покрытие required-переменных docker-compose).

Минимальный набор для поднятия staging (app + n8n):
- `DATABASE_URL` — staging Postgres 16/18;
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (32+ симв.), `CRON_SECRET`, `BOT_SECRET`;
- `POSTGRES_PASSWORD`, `MEILI_MASTER_KEY`, `SIMPLEX_BRIDGE_API_KEY`, `N8N_ADMIN_PASSWORD` (required по docker-compose);
- `NEXT_PUBLIC_APP_URL=https://<staging-host>`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (staging-инстанс);
- интеграции (опциональны, деградируют честно): `N8N_BASE_URL`/`N8N_WEBHOOK_BASE_URL`/`N8N_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHANNEL_ID`/`TELEGRAM_WEBHOOK_SECRET`/`TELEGRAM_ADMIN_CHAT_IDS`, `SMTP_*`, `YOOKASSA_*` (sandbox), `YANDEX_CLIENT_ID`/`YANDEX_OAUTH_REDIRECT`(/`YANDEX_CLIENT_SECRET`);
- `TRUSTED_PROXY_HOPS` — число доверенных прокси перед приложением (влияет на клиентский IP для webhook-allowlist и rate-limit).

**Запрет**: использование production-значений любых секретов на staging. Env validation на старте приложения проверяет обязательные ключи и не логирует значения.

## 3. Health/readiness и безопасные defaults

- `GET /api/health` — агрегат: app/database/n8n/auth/telegram; `GET /api/health/live`, `GET /api/health/ready` (для оркестратора/балансера).
- Отсутствие необязательных интеграций: fail-open (n8n, telegram, email — статус в health, не ломают запуск); критичные (БД) — fail-closed (ready 503).
- Секреты в логи не попадают: masking в diagnostics (`src/lib/diagnostics/masking.ts`), evidence-hygiene сканер в CI.
- Staging обязан работать без Docker при локальной конфигурации (embedded PG + `bun run dev`) — так и выполнялась приёмка Z-v21.

## 4. noindex для staging

Страницы отдают `robots`-мета и `robots.txt` (Disallow /dashboard, /api, /checkout, /admin, /profile, /orders). Для staging-хоста дополнительно:
- отдавать `X-Robots-Tag: noindex, nofollow` на уровне Caddy (добавить в Caddyfile staging-хоста):
  ```
  header / X-Robots-Tag "noindex, nofollow"
  ```
- НЕ отправлять sitemap staging в поисковые системы; Search Console не регистрировать.

## 5. Startup checks (что проверить при первом старте)

1. `bun run db:setup` (или ledger-migrator в Docker) применяет 0001..0079 — сверить `schema_migrations=79`.
2. `GET /api/health/ready` → 200 `{"status":"ready","database":"ok"}`.
3. Логин демо-админа → admin ops-центр показывает честные статусы интеграций.
4. Прогнать STAGING_SMOKE_TESTS.md.

## 6. Что НЕ делать на staging

- реальные рассылки клиентам (Telegram/Email только на тестовые адреса/канал);
- реальные платежи (только sandbox/test-shop);
- публикация ссылок на staging во внешних каналах.
