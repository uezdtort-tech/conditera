# Консолидация PostgreSQL — Conditera

## Каноническая целевая архитектура

Целевая конфигурация интеграционной ветки:

- PostgreSQL **17.12** (`supabase/postgres:17.12.0.001`).
- Одна рабочая база данных: **`conditera`**.
- Один Supabase runtime container: PostgreSQL, GoTrue, PostgREST, Realtime, Storage, Postgres Meta, imgproxy, Kong и Edge Runtime.
- Next.js использует ту же БД `conditera` через отдельную роль `conditera_app`.
- Один рабочий named volume: `conditera_supabase_runtime_pg17_data`.
- Multi-container fallback и single-container runtime используют этот volume поочерёдно; одновременный запуск запрещён.
- Старые volumes остаются отдельно до подтверждения backup/restore и rollback.

Каноническая команда:

```bash
docker compose --env-file .env.supabase-runtime \
  -f docker-compose.yml \
  -f docker-compose.supabase.yml \
  -f docker-compose.supabase-single-container.yml \
  up -d
```

## Исторические источники данных

До консолидации репозиторий содержал два независимых PostgreSQL-кластера:

1. Прикладной PG18: БД `conditera`, пользователь `conditera`, прежний volume `postgres_data_v18`.
2. Supabase PG15: БД `supabase`, пользователь `supabase`, прежний volume `conditera_supabase_db_data`.

Это были разные postmaster-процессы, базы, роли и data directories. Простое изменение тега образа не переносит данные. PostgreSQL PG15 volume нельзя монтировать в PG17; PG18 data directory также нельзя подключать напрямую к PG17.

В интеграционной ветке Compose направлен на PG17.12 и БД `conditera`. Старый PG15 volume сохранён под отдельным именем и не подключается к PG17. Старый app PG18 volume также не удаляется.

**Фактический production backup/restore и слияние содержимого двух прежних источников ещё не выполнены.** Репозиторная конфигурация и CI на disposable volumes не являются доказательством переноса production-данных.

## Роли PostgreSQL

| Роль | Назначение |
|---|---|
| `supabase_admin` | Bootstrap/superuser, Realtime, Postgres Meta, мигратор и администрирование |
| `supabase_auth_admin` | GoTrue/Auth |
| `authenticator` | PostgREST; переключение на `anon`, `authenticated` и `service_role` |
| `supabase_storage_admin` | Supabase Storage |
| `conditera_app` | Доверенные серверные запросы Next.js; отдельный пароль, не superuser, `BYPASSRLS` по принятой модели приложения |
| `anon`, `authenticated`, `service_role` | API роли Supabase |

Пароли внутренних service roles задаются init-скриптом. В Compose проверяются не только имена образов, но и соответствие каждого сервиса своей роли. Не заменять все service URLs одним пользователем `supabase`.

## Volumes

| Volume | Назначение |
|---|---|
| `conditera_supabase_runtime_pg17_data` | Единственный рабочий PG17.12 data directory |
| `conditera_supabase_db_data` | Legacy PG15; не монтировать в PG17 |
| `conditera_supabase_pg17_migration_data` | Временный изолированный shadow для миграционных репетиций |
| `supabase_runtime_storage_data` | Storage objects и доступ imgproxy |
| `supabase_runtime_deno_cache` | Deno/Edge Runtime cache |

Не выполнять `docker compose down -v`, `docker volume rm`, `rm -rf PGDATA` или очистку Storage при обычном обновлении.

## Порядок реального переноса

1. Зафиксировать остановку записи в оба прежних источника и получить согласованные полные backup.
2. Supabase PG15: сохранить SQL dump, cluster-global roles/grants, extensions, RLS, Storage metadata и все Storage objects.
3. App PG18: получить полный dump прикладной БД; использовать `scripts/ops/restore-app-dump-to-pg17-shadow.sh` для восстановления в отдельный PG17.12 shadow database.
4. Свести таблицы и конфликты идентичности: `auth.users` ↔ `profiles` ↔ `user_roles` ↔ `confectioners`. Не объединять аккаунты только по email.
5. Сверить отдельно заказы, order_items, payment ledger, YooKassa payment IDs, refunds, payouts, disputes/evidence, recipes, ingredient stock, warehouse movements, reservations, CMS и audit events.
6. Проверить RLS, grants, extensions, functions, triggers, sequences, ownership и Storage object references.
7. Сверить counts и контрольные суммы критичных таблиц, провести сценарии регистрации → оплаченного заказа → производства → передачи, возврата и dispute.
8. Только после успешной репетиции переключить рабочий runtime на восстановленный PG17 volume. Старые volumes оставить нетронутыми для rollback.

## Backup и восстановление

- `scripts/ops/backup-supabase-db.sh` делает logical SQL backup через TCP/password auth, проверяет gzip и сохраняет SHA-256 manifest.
- SQL dump не включает Storage objects и cluster-global roles. Для полного восстановления нужны отдельные артефакты и проверки.
- `scripts/ops/restore-app-dump-to-pg17-shadow.sh` — инструмент репетиции app PG18 dump → PG17 shadow; `postgres:18-alpine` используется как клиент/source fixture, а не как целевой runtime.
- Backup нельзя считать проверенным, пока он не восстановлен в изолированную БД и не прошёл контрольные запросы.

## Защита от возврата конфликта

- `scripts/verify/pg-version-gate.mjs` проверяет runtime Compose, migration overlay, local Compose и workflow service images на PG17.
- `.github/workflows/postgres17-compose-validation.yml` проверяет PG17.12 runtime image, shared рабочий volume, изоляцию shadow volume и роли Auth/REST/Realtime/Storage/Meta/migrator.
- `docker-compose.supabase.yml` содержит legacy multi-container fallback; canonical single-container запуск всегда использует `docker-compose.supabase-single-container.yml`.
- Не создавать второй активный app DB и не направлять часть сценариев в PG18, а часть в Supabase PG17.

## Что не подтверждено

На момент подготовки интеграционной ветки не выполнены SSH/Windows Docker операции, production backup/restore, сверка реальных данных и production cutover. Ни один из этих пунктов не объявляется завершённым.