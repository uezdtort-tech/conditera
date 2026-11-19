# План сведения PostgreSQL и Supabase к единому runtime (PostgreSQL 17)

Статус: подготовка безопасного перехода; production-миграция НЕ выполнялась.
Целевая ветка: `fix/postgres17-supabase-consolidation`.

## 1. Подтверждённое состояние репозитория на 2026-11-19

Проверено по файлам `docker-compose.yml`, `docker-compose.supabase.yml`,
`docker-compose.dev.yml` и `supabase/config.toml` в `main`
(commit `022fda21186b1f4ec5e86764015f879051c7dbf2`).

| Контур | Образ | База/пользователь | Volume |
|---|---|---|---|
| Production приложение | `postgres:18-alpine` | `conditera` / `conditera` | `postgres_data_v18` |
| Self-hosted Supabase | `supabase/postgres:15.6.1.141` | `supabase` / `supabase` | `supabase_db_data` |
| Dev | `postgres:18-alpine` | `uyezdny_konditer_dev` / `uyezdny` | `uyezdny-db-dev-data-v18` |
| Supabase CLI | `major_version = 15` | локальный CLI-контур | управляется CLI |

Это три разных PostgreSQL-кластера в Compose-контурах, а не один общий сервер.
Production Compose содержит два разных production PostgreSQL-кластера. `migrator`
получает `DATABASE_URL` на `db:5432/conditera` (PG18), а `web` получает
`DATABASE_URL` через PgBouncer к тому же PG18. При этом `src/lib/supabase/admin.ts`
и SSR-клиент используют Supabase JS, чей серверный URL выбирается через
`SUPABASE_INTERNAL_URL`/`NEXT_PUBLIC_SUPABASE_URL` и ведёт к Supabase Kong,
а его сервисы подключены к `supabase-db:5432/supabase` (PG15). Одновременно
часть серверных API использует собственный SQL/PostgREST-слой:
`src/lib/postgrest/pool.ts` → `DATABASE_URL` (PG18), а `withClaims()` выполняет
`SET LOCAL ROLE anon/authenticated/service_role` и задаёт JWT claims для RLS.
Маршруты `/rest/v1/*`, `/storage/v1/*` и множество `src/lib/ops/*` используют
этот пул напрямую. Кроме того, `supabase-db` монтирует те же
`supabase/migrations` в init scripts, тогда как отдельный `migrator` применяет
их к PG18. Получается не просто два кластера, а две конкурирующие базы данных
для разных частей одного продукта и риск двух расходящихся копий схемы.

## 2. Целевая архитектура

- Единственный PostgreSQL server: официальный образ Supabase
  `supabase/postgres:17.6.1.136` (версия сверена с официальной конфигурацией
  Supabase на момент подготовки).
- Один PostgreSQL cluster и одна целевая база приложения/Supabase.
- Схемы Supabase (`auth`, `storage`, `_realtime`, служебные схемы) и
  прикладная схема `public` сосуществуют в этой базе.
- Next.js Supabase JS-клиенты, Auth, PostgREST, Realtime, Storage, Meta и
  Analytics используют один и тот же PostgreSQL server и одну целевую БД.
- Все прямые SQL-клиенты (`src/lib/postgrest/pool.ts`, migrator,
  backup/maintenance scripts) направляются на ту же БД; пулер является только
  сетевой точкой доступа к тому же серверу.
- Для прямого `pg`-пула нужен отдельный минимально привилегированный login-role,
  которому явно разрешено `SET LOCAL ROLE` только в `anon`, `authenticated` и
  `service_role`. Нельзя использовать superuser или неограниченный
  `supabase_admin` как runtime credentials. Проверить членство ролей, grants,
  RLS и отрицательные сценарии после переноса.
- Prisma не является runtime-слоем: `src/lib/db.ts` экспортирует
  `supabaseAdmin`, а `prisma/schema.prisma` прямо помечен deprecated.
  Не строить план миграции вокруг Prisma.
- Dev/test должны повторять ту же major-версию и структуру схем, но могут
  использовать отдельные изолированные данные и volumes. Они не являются
  дополнительными production-инсталляциями.

## 3. Обязательные запреты и сохранение данных

1. Не выполнять `docker compose down -v`, `docker volume rm`, `rm -rf`
   для любых текущих volumes.
2. Не подключать PostgreSQL 17 к data directory PostgreSQL 15 или 18.
3. Не переименовывать существующие volumes так, чтобы Compose молча создал
   пустую БД и приложение стартовало на пустых данных.
4. Не удалять старый сервис/volume до проверки резервной копии и восстановления.
5. Не выполнять production migration, переключение DNS, deployment или
   публикацию без отдельного подтверждения владельца.
6. Не менять защищённые upload routes и не трогать секреты.

## 4. Порядок технической миграции

### Этап A — инвентаризация до изменения Compose

Снять фактические, а не предполагаемые данные с каждого работающего контура:

- `SELECT version()`, `current_database()`, `current_user`;
- `pg_database`, `pg_extension`, `pg_roles`, `pg_tables`,
  `pg_policies`, `pg_publication`, `pg_replication_slots`;
- количество строк и объём ключевых таблиц;
- `schema_migrations` и любые дополнительные migration ledgers/источники миграций, найденные поиском по репозиторию;
- функции, триггеры, типы, sequence, grants, RLS, публикации Realtime;
- зависимости Storage metadata и файлового volume;
- все фактические connection strings из Compose/env names (значения секретов
  не выводить в логи и отчёты).

Проверить все расширения на совместимость с целевым Supabase PG17. В частности,
официальный upgrade guide предупреждает, что `timescaledb`, `plv8`,
`plcoffee` и `plls` отсутствуют в PG17-образе Supabase.

### Этап B — независимые резервные копии и тест восстановления

- Для PostgreSQL 15 Supabase: физическая копия data directory и отдельный
  логический `pg_dumpall`/дампы БД; отдельно сохранить pgsodium root key
  и все связанные с Vault ключи.
- Для PostgreSQL 18 приложения: логические дампы ролей, схем, данных и
  объектов; отдельно зафиксировать объёмы и контрольные суммы.
- Для Storage: отдельная копия `supabase_storage_data` и сверка metadata
  с файлами.
- Восстановить каждую копию в изолированном временном контуре и выполнить
  контрольные запросы. Бэкап без тестового восстановления не считается
  проверенным.

### Этап C — построение единого PostgreSQL 17

- Использовать Supabase Postgres 17.6.1.136, а не обычный `postgres:17`,
  поскольку Supabase требует собственный набор расширений и init scripts.
- Перенос существующего Supabase PG15 выполнять только официальной
  процедурой Supabase `utils/upgrade-pg17.sh` для соответствующего
  self-hosted release, предварительно проверив требования и extensions.
- PostgreSQL 18 приложения нельзя подключать к PG17 data directory и нельзя
  считать его переносом через `pg_upgrade` как downgrade. Для прикладных
  данных использовать логический экспорт/импорт и предварительную проверку
  DDL/типов/расширений на чистой целевой БД PG17.
- До переключения сравнить схему и данные источника/приёмника. Отдельно
  разрешить конфликты ролей, владельцев, расширений, sequence и миграционных
  журналов; не затирать системные схемы Supabase прикладным дампом.
- Перенести прикладные объекты `public` из PG18 в целевую БД PG17, но не
  переносить поверх целевых `auth`, `storage`, `realtime`, `extensions` и
  других служебных схем Supabase. Отдельно сверить `auth.users` с профилями
  и `user_roles`, не создавать вторую систему идентификации.

### Этап D — один database endpoint для приложения и Supabase

- Зафиксировать одну целевую базу с Supabase-служебными схемами и прикладной
  схемой `public`; не оставлять отдельную БД приложения на другом сервере.
- Настроить `SUPABASE_INTERNAL_URL` на внутренний Kong единого Supabase runtime;
  браузерный `NEXT_PUBLIC_SUPABASE_URL` оставить публичным HTTPS URL.
- Настроить `DATABASE_URL`/`DIRECT_DATABASE_URL` и `src/lib/postgrest/pool.ts`
  на ту же целевую БД. Удалить старую маршрутизацию через отдельные `db` /
  `pgbouncer` только после проверки полного списка SQL-потребителей и
  подтверждения, что все runtime-операции идут в единую базу.
- Все Supabase services должны продолжать обращаться к тому же серверу и
  правильным служебным схемам.
- Проверить init order, healthchecks, DNS service aliases и отсутствие
  циклических `depends_on`.
- Сверить все миграции до последней включительно, применить их один раз
  управляемым migrator-ом. Не запускать одновременно init-scripts, migrator и Supabase CLI на одних
  и тех же объектах без явного разграничения владельца миграций.
- `supabase/compat/0000_supabase_compat.sql` предназначен для vanilla PG /
  локального PGlite-совместимого контура. Не применять его поверх настоящей
  Supabase-БД: он создаёт stub-объекты `auth.users` и `storage.*`, конфликтующие
  с реальными сервисными схемами.

### Этап E — переключение и приёмка

Переключение разрешено только после тестов на временном окружении:
- прикладные CRUD/транзакции через Supabase JS и прямые SQL-клиенты;
- Supabase Auth signup/signin/refresh/logout и OAuth callback;
- PostgREST с anon/authenticated/service_role;
- RLS положительные и отрицательные сценарии;
- Storage upload/download/delete и проверка физического файла;
- Realtime подписка, публикация и reconnect;
- функции/cron/webhooks;
- восстановление после перезапуска и проверка повторного запуска migrator;
- полный E2E в Chromium/Firefox/WebKit.

Старые PostgreSQL volumes и контейнеры остаются сохранёнными и выключенными
до отдельной приёмки. Откат — возврат connection strings/Compose к исходным
контурам и запуск прежних кластеров; никакого удаления старых данных.

## 5. Исправление, внесённое в этой ветке

В `supabase/config.toml` значение `db.major_version` установлено в `17`,
чтобы CLI target соответствовал выбранной целевой версии. Это локальная
CLI-конфигурация и само по себе не меняет образы или данные production.

Это НЕ означает, что production Compose уже переведён на PG17 или что данные
уже объединены. Production Supabase Compose всё ещё содержит PG15, а
прикладной Compose — PG18. Также не утверждается, что Prisma используется
приложением: текущий runtime использует Supabase JS и отдельные прямые SQL-клиенты. Обновлять эти образы без выполнения этапов A–C
опасно из-за несовместимости data directories.

## 6. Критерии завершения

- Ровно один production PostgreSQL server и одна целевая прикладная база.
- Все приложение и Supabase services подключаются к ней.
- Никакого второго production PostgreSQL сервиса в Compose.
- Совпадение схем, количества строк и контрольных сумм ключевых таблиц.
- Все расширения и миграции проверены на PG17.
- Тест восстановления и все E2E пройдены.
- Старые volumes сохранены до подтверждения владельца.
- Production cutover выполнен только после отдельного разрешения владельца.


## 7. Реальный инструмент резервирования перед объединением

Добавлен исполняемый скрипт
`scripts/ops/backup-dual-postgres-before-pg17.sh`.

Он рассчитан на текущие имена контейнеров и выполняет только чтение:
- проверяет доступность обоих PostgreSQL-контейнеров и что это разные кластеры;
- фиксирует версии PostgreSQL, system_identifier, расширения, роли и схемы;
- снимает отдельные custom-format дампы обеих баз;
- сохраняет глобальные роли отдельно для каждого источника;
- если в Supabase установлено pgsodium, требует сохранить root key;
- создаёт SHA-256 манифест резервных файлов с правами каталога 0700.

Запуск на Docker-хосте из корня репозитория:

```bash
bash scripts/ops/backup-dual-postgres-before-pg17.sh
```

Имена контейнеров/БД можно переопределить переменными
`APP_PG_CONTAINER`, `APP_PG_DATABASE`, `APP_PG_USER`,
`SUPABASE_PG_CONTAINER`, `SUPABASE_PG_DATABASE`,
`SUPABASE_PG_USER`, `PG_BACKUP_ROOT`.

Скрипт не выполняет restore и не переключает приложения. Это намеренно:
два независимых набора ролей и две версии public-схемы нельзя безопасно
слить простым последовательным `pg_restore`. Сначала необходимо сравнить
дампы/роли/объекты и определить, какие данные являются источником истины
для каждого объекта. Исходные volumes остаются нетронутыми.
