#!/usr/bin/env bash
# Read-only preflight: сравнение двух исторически раздельных PostgreSQL.
# Никаких изменений, миграций, блокировок, очистки или вывода персональных данных.
set -Eeuo pipefail

inspect_db() {
  local container="$1" user="$2" database="$3"
  echo
  echo "===== $container ($user/$database) ====="

  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "container=ABSENT"
    return 0
  fi

  local running
  running="$(docker inspect -f '{{.State.Running}}' "$container")"
  echo "running=$running"
  if [ "$running" != "true" ]; then
    echo "status=NOT_RUNNING (данные volume не трогаются)"
    return 0
  fi

  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$user" -d "$database" -At -F '|' -c "
    SELECT 'server_version', current_setting('server_version');
    SELECT 'database', current_database();
    SELECT 'public_tables', count(*) FROM pg_tables WHERE schemaname='public';
    SELECT 'public_rls_tables', count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity;
    SELECT 'schema_migrations_exists', (to_regclass('public.schema_migrations') IS NOT NULL)::text;
    SELECT 'auth_schema_exists', (EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='auth'))::text;
    SELECT 'auth_users_exists', (to_regclass('auth.users') IS NOT NULL)::text;
    SELECT 'storage_objects_exists', (to_regclass('storage.objects') IS NOT NULL)::text;
    SELECT 'profiles_exists', (to_regclass('public.profiles') IS NOT NULL)::text;
    SELECT 'orders_exists', (to_regclass('public.orders') IS NOT NULL)::text;
    SELECT 'inventory_items_exists', (to_regclass('public.inventory_items') IS NOT NULL)::text;
    SELECT 'chat_channels_exists', (to_regclass('public.chat_channels') IS NOT NULL)::text;
  "
  if [ "$(docker exec "$container" psql -X -U "$user" -d "$database" -At -c "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" = "t" ]; then
    docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$user" -d "$database" -At -F '|' -c "
      SELECT 'migration_count', count(*) FROM public.schema_migrations;
      SELECT 'migration_latest', COALESCE(max(filename), 'none') FROM public.schema_migrations;
    "
  fi
}

echo "Conditera DB preflight — READ ONLY"
echo "Контейнеры проверяются по фактическому состоянию Docker."
inspect_db "conditera-db" "conditera" "conditera"
inspect_db "conditera-supabase-db" "supabase" "supabase"

echo
echo "===== Важно ====="
echo "Этот отчёт не доказывает равенство данных и не выбирает БД автоматически."
echo "Перед объединением нужны резервные копии обоих кластеров, сравнение схем/строк,"
echo "сверка auth.users ↔ profiles/user_roles, Storage и проверенный план отката."
