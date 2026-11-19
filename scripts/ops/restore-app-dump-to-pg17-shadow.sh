#!/usr/bin/env bash
# Восстановление логического дампа PG18 в отдельную теневую БД на целевом PG17.
#
# Это проверка совместимости данных и объектов, НЕ переключение приложения.
# Скрипт не изменяет БД supabase, не подключает сервисы к теневой БД,
# не удаляет исходные данные и не выполняет promotion.
#
# Пример:
#   PG17_MIGRATION_MODE=1 \
#   POSTGRES_PASSWORD='...' \
#   APP_DUMP_FILE='./backups/postgres-pre-pg17/<timestamp>/app-conditera.dump' \
#   bash scripts/ops/restore-app-dump-to-pg17-shadow.sh
#
# Требуется предварительно запустить только целевой сервис:
#   docker compose -f docker-compose.supabase.yml \
#     -f docker-compose.pg17-migration.yml --profile pg17-migration \
#     up -d supabase-db-pg17-migration

set -Eeuo pipefail
umask 077

fail() { printf 'ОШИБКА: %s\n' "$*" >&2; exit 1; }

[[ "${PG17_MIGRATION_MODE:-0}" == "1" ]] || fail "Для защиты от случайного запуска задайте PG17_MIGRATION_MODE=1."
command -v docker >/dev/null 2>&1 || fail "Docker CLI не найден."
docker info >/dev/null 2>&1 || fail "Docker daemon недоступен."

PG17_CONTAINER="${PG17_CONTAINER:-conditera-supabase-db-pg17-migration}"
PG17_USER="${PG17_USER:-supabase}"
PG17_DATABASE="${PG17_DATABASE:-supabase}"
STAGING_DATABASE="${STAGING_DATABASE:-conditera_app_shadow}"
RESTORE_IMAGE="${PG_RESTORE_IMAGE:-postgres:18-alpine}"
APP_DUMP_FILE="${APP_DUMP_FILE:-}"

[[ -n "$APP_DUMP_FILE" ]] || fail "Задайте APP_DUMP_FILE — путь к custom dump исходной БД приложения."
[[ -s "$APP_DUMP_FILE" ]] || fail "Дамп не найден или пуст: $APP_DUMP_FILE"
[[ -n "${POSTGRES_PASSWORD:-}" ]] || fail "Задайте POSTGRES_PASSWORD целевого PG17."
[[ "$STAGING_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "Недопустимое имя теневой БД: $STAGING_DATABASE"

docker inspect "$PG17_CONTAINER" >/dev/null 2>&1 || fail "Не найден целевой контейнер: $PG17_CONTAINER"
HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$PG17_CONTAINER")"
[[ "$HEALTH" == "healthy" ]] || fail "Целевой PostgreSQL не healthy (status=$HEALTH)."

SERVER_VERSION="$(docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$PG17_DATABASE" -Atc 'SHOW server_version_num;')"
[[ "$SERVER_VERSION" =~ ^17[0-9]{4}$ ]] || fail "Ожидался PostgreSQL 17, получен server_version_num=$SERVER_VERSION."

EXISTS="$(docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$STAGING_DATABASE';")"
[[ -z "$EXISTS" ]] || fail "Теневая БД $STAGING_DATABASE уже существует. Скрипт не очищает и не перезаписывает её."

printf 'Целевой кластер: PostgreSQL %s, контейнер %s\n' "$SERVER_VERSION" "$PG17_CONTAINER"
printf 'Проверяю наличие системной и прикладной схем в исходной БД Supabase...\n'
docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$PG17_DATABASE" -Atc \
  "SELECT to_regclass('auth.users') IS NOT NULL AND to_regclass('public.schema_migrations') IS NOT NULL;" \
  | grep -qx t || fail "В целевой БД отсутствует auth.users или журнал public.schema_migrations. Инициализация Supabase/миграций не завершена."

printf 'Создаю новую теневую БД из template0: %s\n' "$STAGING_DATABASE"
docker exec "$PG17_CONTAINER" createdb -U "$PG17_USER" -T template0 "$STAGING_DATABASE"

DUMP_ABS="$(cd "$(dirname "$APP_DUMP_FILE")" && pwd)/$(basename "$APP_DUMP_FILE")"
printf 'Восстанавливаю custom dump в теневую БД с помощью клиента PostgreSQL 18...\n'
docker run --rm \
  --network "container:$PG17_CONTAINER" \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  -v "$DUMP_ABS:/backup/app.dump:ro" \
  "$RESTORE_IMAGE" \
  pg_restore --verbose --no-owner --no-acl --exit-on-error \
    -h 127.0.0.1 -p 5432 -U "$PG17_USER" -d "$STAGING_DATABASE" /backup/app.dump

printf 'Обновляю статистику и формирую отчёт восстановления...\n'
docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -c 'ANALYZE;'

REPORT="${DUMP_ABS%/*}/pg17-shadow-restore-report.txt"
{
  printf 'target_container=%s\nserver_version_num=%s\nstaging_database=%s\nrestore_image=%s\n' \
    "$PG17_CONTAINER" "$SERVER_VERSION" "$STAGING_DATABASE" "$RESTORE_IMAGE"
  printf '\n[schemas]\n'
  docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -Atc \
    "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' ORDER BY nspname;"
  printf '\n[extensions]\n'
  docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -Atc \
    "SELECT extname || '=' || extversion FROM pg_extension ORDER BY extname;"
  printf '\n[public_tables]\n'
  docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
  printf '\n[rls_policies]\n'
  docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -Atc \
    "SELECT count(*) FROM pg_policies WHERE schemaname='public';"
  printf '\n[critical_tables]\n'
  docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -Atc \
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('profiles','user_roles','products','orders','inventory_items','chat_channels','oauth_identity_links','user_consent_events','schema_migrations') ORDER BY tablename;"
  printf '\n[migration_count]\n'
  docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -Atc \
    "SELECT count(*) FROM public.schema_migrations;"
} > "$REPORT"

CRITICAL_COUNT="$(docker exec "$PG17_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG17_USER" -d "$STAGING_DATABASE" -Atc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('profiles','user_roles','products','orders','inventory_items','chat_channels','oauth_identity_links','user_consent_events','schema_migrations');")"
[[ "$CRITICAL_COUNT" == "9" ]] || fail "В теневой БД найдены не все критические таблицы (найдено $CRITICAL_COUNT из 9). Теневая БД сохранена для диагностики."

printf '\nВосстановление в теневую БД завершено. Отчёт: %s\n' "$REPORT"
printf 'Теневая БД: %s. Исходный кластер и БД supabase не изменялись.\n' "$STAGING_DATABASE"
printf 'Не переключайте приложение: требуется отдельная сверка данных, RLS, Auth/Storage и прикладных сценариев.\n'
