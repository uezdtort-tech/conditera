#!/usr/bin/env bash
# Безопасный read-only preflight/backup двух действующих PostgreSQL-кластеров
# перед объединением в Supabase PostgreSQL 17.
#
# Запуск из корня репозитория на Docker-хосте:
#   bash scripts/ops/backup-dual-postgres-before-pg17.sh
#
# Перед запуском оператор обязан включить maintenance mode и остановить все записи в приложение/Storage.
# Скрипт НЕ останавливает контейнеры, монтирует Storage только для чтения, НЕ меняет БД и НЕ удаляет volumes.
# Он создаёт логические дампы PostgreSQL, отдельную копию файлового volume Supabase Storage и диагностический манифест.
# Секреты подключения берутся из локальной авторизации внутри контейнеров.

set -Eeuo pipefail
umask 077

APP_CONTAINER="${APP_PG_CONTAINER:-conditera-db}"
APP_DATABASE="${APP_PG_DATABASE:-conditera}"
APP_USER="${APP_PG_USER:-conditera}"
SUPABASE_CONTAINER="${SUPABASE_PG_CONTAINER:-conditera-supabase-db}"
SUPABASE_DATABASE="${SUPABASE_PG_DATABASE:-supabase}"
SUPABASE_USER="${SUPABASE_PG_USER:-supabase}"
STORAGE_CONTAINER="${SUPABASE_STORAGE_CONTAINER:-conditera-supabase-storage}"
STORAGE_MOUNT="${SUPABASE_STORAGE_MOUNT:-/mnt/storage}"
STORAGE_IMAGE="${BACKUP_HELPER_IMAGE:-alpine:3.21.3}"
BACKUP_ROOT="${PG_BACKUP_ROOT:-./backups/postgres-pre-pg17}"

fail() { printf 'ОШИБКА: %s\n' "$*" >&2; exit 1; }
[[ "${BACKUP_MAINTENANCE_MODE:-0}" == "1" ]] || fail "Сначала включите maintenance mode и остановите все записи; затем задайте BACKUP_MAINTENANCE_MODE=1."
command -v docker >/dev/null 2>&1 || fail "Docker CLI не найден."
docker info >/dev/null 2>&1 || fail "Docker daemon недоступен."
docker inspect "$APP_CONTAINER" >/dev/null 2>&1 || fail "Не найден контейнер приложения: $APP_CONTAINER"
docker inspect "$SUPABASE_CONTAINER" >/dev/null 2>&1 || fail "Не найден контейнер Supabase: $SUPABASE_CONTAINER"
docker inspect "$STORAGE_CONTAINER" >/dev/null 2>&1 || fail "Не найден контейнер Supabase Storage: $STORAGE_CONTAINER"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_ROOT/$STAMP"
mkdir -p "$OUT"
chmod 700 "$OUT"

container_psql() {
  local container="$1" user="$2" database="$3" sql="$4"
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$user" -d "$database" -Atc "$sql"
}

container_dump() {
  local container="$1" user="$2" database="$3" destination="$4"
  docker exec "$container" pg_dump -U "$user" -d "$database" -Fc --verbose > "$destination"
  test -s "$destination" || fail "Пустой дамп: $destination"
}

printf 'Проверяю доступность источников...\n'
APP_VERSION="$(container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" 'SHOW server_version;')"
SUPABASE_VERSION="$(container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" 'SHOW server_version;')"
APP_SYSTEM_ID="$(container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" 'SELECT system_identifier FROM pg_control_system();')"
SUPABASE_SYSTEM_ID="$(container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" 'SELECT system_identifier FROM pg_control_system();')"
[[ "$APP_SYSTEM_ID" != "$SUPABASE_SYSTEM_ID" ]] || fail "Оба endpoint указывают на один cluster system_identifier; проверьте имена контейнеров."

{
  printf 'backup_utc=%s\n' "$STAMP"
  printf 'app_container=%s\napp_database=%s\napp_user=%s\napp_version=%s\napp_system_identifier=%s\n' "$APP_CONTAINER" "$APP_DATABASE" "$APP_USER" "$APP_VERSION" "$APP_SYSTEM_ID"
  printf 'supabase_container=%s\nsupabase_database=%s\nsupabase_user=%s\nsupabase_version=%s\nsupabase_system_identifier=%s\n' "$SUPABASE_CONTAINER" "$SUPABASE_DATABASE" "$SUPABASE_USER" "$SUPABASE_VERSION" "$SUPABASE_SYSTEM_ID"
  printf '\n[app_extensions]\n'
  container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" "SELECT extname || '=' || extversion FROM pg_extension ORDER BY extname;"
  printf '\n[supabase_extensions]\n'
  container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "SELECT extname || '=' || extversion FROM pg_extension ORDER BY extname;"
  printf '\n[app_roles]\n'
  container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" "SELECT rolname || ':' || rolsuper || ':' || rolbypassrls || ':' || rolcanlogin FROM pg_roles ORDER BY rolname;"
  printf '\n[supabase_roles]\n'
  container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "SELECT rolname || ':' || rolsuper || ':' || rolbypassrls || ':' || rolcanlogin FROM pg_roles ORDER BY rolname;"
  printf '\n[app_schemas]\n'
  container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' ORDER BY nspname;"
  printf '\n[supabase_schemas]\n'
  container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' ORDER BY nspname;"
  printf '\n[app_table_estimates]\n'
  container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" "SELECT schemaname || '.' || relname || '|' || n_live_tup || '|' || pg_total_relation_size(relid) FROM pg_stat_user_tables ORDER BY schemaname, relname;"
  printf '\n[supabase_table_estimates]\n'
  container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "SELECT schemaname || '.' || relname || '|' || n_live_tup || '|' || pg_total_relation_size(relid) FROM pg_stat_user_tables ORDER BY schemaname, relname;"
  printf '\n[app_migration_ledger]\n'
  if [[ "$(container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" "SELECT to_regclass('public.schema_migrations') IS NOT NULL;")" == "t" ]]; then
    container_psql "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" "SELECT filename FROM public.schema_migrations ORDER BY filename;"
  else
    printf '<schema_migrations absent>\n'
  fi
  printf '\n[supabase_migration_ledger]\n'
  if [[ "$(container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "SELECT to_regclass('public.schema_migrations') IS NOT NULL;")" == "t" ]]; then
    container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "SELECT filename FROM public.schema_migrations ORDER BY filename;"
  else
    printf '<schema_migrations absent>\n'
  fi
} > "$OUT/manifest.txt"

printf 'Снимаю дампы БД и глобальных ролей...\n'
container_dump "$APP_CONTAINER" "$APP_USER" "$APP_DATABASE" "$OUT/app-$APP_DATABASE.dump"
container_dump "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "$OUT/supabase-$SUPABASE_DATABASE.dump"
docker exec "$APP_CONTAINER" pg_dump -U "$APP_USER" -d "$APP_DATABASE" --schema-only > "$OUT/app-schema.sql"
docker exec "$SUPABASE_CONTAINER" pg_dump -U "$SUPABASE_USER" -d "$SUPABASE_DATABASE" --schema-only > "$OUT/supabase-schema.sql"
docker exec "$APP_CONTAINER" pg_restore --list < "$OUT/app-$APP_DATABASE.dump" > "$OUT/app-restore-toc.txt"
docker exec "$SUPABASE_CONTAINER" pg_restore --list < "$OUT/supabase-$SUPABASE_DATABASE.dump" > "$OUT/supabase-restore-toc.txt"

docker exec "$APP_CONTAINER" sh -lc 'pg_dumpall -U "$POSTGRES_USER" --globals-only' > "$OUT/app-globals.sql"
docker exec "$SUPABASE_CONTAINER" sh -lc 'pg_dumpall -U "$POSTGRES_USER" --globals-only' > "$OUT/supabase-globals.sql"

# Storage files are not inside PostgreSQL: back up the named volume separately.
# Mount it read-only in a short-lived helper container; never stop or mutate Storage.
STORAGE_VOLUME="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$STORAGE_MOUNT\"}}{{.Name}}{{end}}{{end}}" "$STORAGE_CONTAINER")"
[[ -n "$STORAGE_VOLUME" ]] || fail "Не найден named volume Storage на ${STORAGE_CONTAINER}:${STORAGE_MOUNT}; резервирование неполное."
docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || fail "Docker volume Storage не найден: $STORAGE_VOLUME"
printf 'Резервирую Storage volume %s (read-only)...\n' "$STORAGE_VOLUME"
docker run --rm --network none -v "$STORAGE_VOLUME:/source:ro" "$STORAGE_IMAGE" \
  tar -C /source -czf - . > "$OUT/storage-files.tar.gz"
test -s "$OUT/storage-files.tar.gz" || fail "Пустой архив Storage."
docker run --rm -i --network none "$STORAGE_IMAGE" tar -tzf - < "$OUT/storage-files.tar.gz" >/dev/null || fail "Архив Storage не прошёл проверку tar."
printf 'storage_container=%s\nstorage_volume=%s\nstorage_mount=%s\n' "$STORAGE_CONTAINER" "$STORAGE_VOLUME" "$STORAGE_MOUNT" >> "$OUT/manifest.txt"

# pgsodium key is essential when the extension and Vault data are in use.
HAS_PGSODIUM="$(container_psql "$SUPABASE_CONTAINER" "$SUPABASE_USER" "$SUPABASE_DATABASE" "SELECT count(*) FROM pg_extension WHERE extname='pgsodium';")"
if [[ "$HAS_PGSODIUM" == "1" ]]; then
  KEY_FOUND=0
  for key_path in /etc/postgresql-custom/pgsodium_root.key /var/lib/postgresql/data/pgsodium_root.key; do
    if docker exec "$SUPABASE_CONTAINER" test -s "$key_path" >/dev/null 2>&1; then
      docker exec "$SUPABASE_CONTAINER" cat "$key_path" > "$OUT/pgsodium_root.key"
      chmod 600 "$OUT/pgsodium_root.key"
      KEY_FOUND=1
      break
    fi
  done
  [[ "$KEY_FOUND" == "1" ]] || fail "pgsodium установлен, но ключ не найден. Дамп уже создан; миграцию/переключение НЕ выполнять до резервирования ключа."
fi

(
  cd "$OUT"
  sha256sum ./* > SHA256SUMS
)

printf '\nРезервирование завершено: %s\n' "$OUT"
printf 'Версии: app=%s; Supabase=%s\n' "$APP_VERSION" "$SUPABASE_VERSION"
printf 'Проверка целостности: (cd "%s" && sha256sum -c SHA256SUMS)\n' "$OUT"
printf '\nВАЖНО: дампы сохранены отдельно. Скрипт ничего не восстанавливает и не переключает.\n'
