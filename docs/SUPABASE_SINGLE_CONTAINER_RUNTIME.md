# Единый Supabase Runtime Conditera на PostgreSQL 17

## Целевая схема

Один runtime-контейнер содержит PostgreSQL 17.12, GoTrue, PostgREST, Realtime, Storage, Postgres Meta, Imgproxy, Kong и Edge Runtime. Next.js работает отдельным контейнером и подключается к тому же кластеру через роль `conditera_app`.

В целевом Compose-графе нет второго app PostgreSQL, PgBouncer или отдельного legacy Supabase PostgreSQL. Старые PG15/PG18 сервисы доступны только через явно включаемые legacy-профили и не входят в штатный запуск.

## Чистая инициализация

Базы пустые; переносить данные не требуется. На свежем volume PostgreSQL 17 runtime запускает Supabase init scripts, создаёт системные схемы и применяет миграции Conditera с `SEED_MODE=none`. Demo seed остаётся только в CI и локальном тестировании.

Overlay: `docker-compose.supabase-single-container.yml`.

Обязательные файлы:
- `.env.production`;
- `.env.supabase-runtime` (пример — `.env.supabase-runtime.example`).

## Запуск

Из корня репозитория:

```bash
node scripts/compose-single-runtime.mjs config
node scripts/compose-single-runtime.mjs up -d --build
node scripts/compose-single-runtime.mjs ps
```

Логи:

```bash
node scripts/compose-single-runtime.mjs logs --tail 200 supabase-runtime
node scripts/compose-single-runtime.mjs logs --tail 200 web
```

Остановка без удаления volumes:

```bash
node scripts/compose-single-runtime.mjs stop
```

Launcher всегда подключает три Compose-файла, проверяет обязательные секреты и итоговый граф сервисов. Он запрещает случайный запуск legacy-профилей и команды удаления volumes. Отдельный флаг cutover approval не нужен: целевая БД инициализируется с нуля, данных для переноса нет.

## Volumes

- `supabase_runtime_pg17_data` — единственный PostgreSQL 17 data volume;
- `supabase_runtime_storage_data` — файлы Supabase Storage;
- `supabase_runtime_deno_cache` — cache Edge Runtime.

Не использовать PG15/PG18 data directory как volume PostgreSQL 17. Не удалять volumes при обычном обновлении.

## Проверка

Runtime smoke CI проверяет:
- запуск PostgreSQL 17.12 и готовность внутренних процессов;
- Auth signup;
- REST/OpenAPI и доступность Realtime;
- создание Storage bucket и round-trip upload/download;
- наличие системных схем Supabase и миграций.

PG17 business CI дополнительно проверяет прикладные миграции, RLS, регистрацию, заказы, оплату, чаты, рецептуры, склад, медиа и Playwright.

## Конфигурация

В `.env.supabase-runtime` находятся:
- `APP_DATABASE_PASSWORD` — пароль роли `conditera_app`;
- `SUPABASE_SECRET_KEY_BASE`;
- `PG_META_CRYPTO_KEY`;
- `REALTIME_DB_ENC_KEY`;
- `REALTIME_DB_ENC_KEY_GCM`.

В `.env.production` остаются публичные URL, JWT_SECRET, API keys и прикладные секреты. Не использовать тестовые placeholders. Для домена Conditera должны быть согласованы `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL`, Caddy и OAuth redirect URLs.

## Ограничения

CI подтверждает чистый PG17 bootstrap и тестовые бизнес-сценарии. Реальный production deployment требует целевого компьютера с Docker Desktop, production env-файлов, DNS/TLS и настоящих credentials провайдеров. Некоторые Edge Functions и каналы уведомлений в POC остаются заглушками; YooKassa и Telegram webhooks должны обслуживаться защищёнными Next.js API routes.
