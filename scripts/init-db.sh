#!/bin/bash
# scripts/init-db.sh — безопасная инициализация PostgreSQL 17 для Conditera.
#
# Использование:
#   ./scripts/init-db.sh                — отдельная dev-БД на Supabase PostgreSQL 17
#   ./scripts/init-db.sh supabase       — единая БД Conditera + Supabase PostgreSQL 17
#   ./scripts/init-db.sh pglite         — локально без Docker (PGlite WASM)
#   ./scripts/init-db.sh pglite-reset   — сброс только PGlite-файла
#
# ВАЖНО: Docker volumes PostgreSQL этим скриптом не удаляются.

set -Eeuo pipefail

MODE="${1:-dev}"
echo "=== Инициализация БД «Кондитера» ==="
echo "Режим: $MODE"

if [ "$MODE" = "pglite" ] || [ "$MODE" = "pglite-reset" ]; then
  if [ "$MODE" = "pglite-reset" ]; then
    echo "→ Сброс локального PGlite-хранилища..."
    rm -rf ./db/pglite-dev
  fi
  npx tsx ./scripts/init-db-local.ts --pglite
  exit $?
fi

command -v docker >/dev/null 2>&1 || { echo "Docker CLI не найден"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin не найден"; exit 1; }

if [ "$MODE" = "supabase" ]; then
  if [ ! -f .env.production ]; then
    echo "Не найден .env.production; запуск единого Supabase runtime отменён."
    exit 1
  fi
  COMPOSE=(docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml)
  echo "→ Запуск единственного PostgreSQL 17 и штатного Supabase Auth..."
  "${COMPOSE[@]}" up -d db db-bootstrap supabase-auth
  echo "→ Применение SQL-миграций через одноразовый migrator..."
  "${COMPOSE[@]}" run --rm migrator
  echo "→ Запуск Supabase API и PgBouncer..."
  "${COMPOSE[@]}" up -d pgbouncer supabase-kong
  CONTAINER_NAME="conditera-db"
  CHECK_DB_USER="postgres"
  CHECK_DB_NAME="conditera"
  DB_HOST="localhost"
  DB_PORT="6432"
  DB_USER="conditera"
  DB_NAME="conditera"
else
  COMPOSE=(docker compose -f docker-compose.dev.yml)
  echo "→ Запуск dev-БД на Supabase PostgreSQL 17..."
  "${COMPOSE[@]}" up -d db-dev
  CONTAINER_NAME="uyezdny-db-dev"
  CHECK_DB_USER="postgres"
  CHECK_DB_NAME="uyezdny_konditer_dev"
  DB_HOST="localhost"
  DB_PORT="5433"
  DB_USER="supabase_admin"
  DB_NAME="uyezdny_konditer_dev"
fi

CONTAINER_ID="$(docker ps -q --filter "name=^/${CONTAINER_NAME}$" | head -1)"
if [ -z "$CONTAINER_ID" ]; then
  echo "Контейнер $CONTAINER_NAME не запущен"
  exit 1
fi

echo "→ Ожидание готовности PostgreSQL..."
READY=0
for attempt in $(seq 1 40); do
  if docker exec "$CONTAINER_ID" pg_isready -U "$CHECK_DB_USER" -d "$CHECK_DB_NAME" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
if [ "$READY" != "1" ]; then
  echo "PostgreSQL не стал готов за 80 секунд"
  exit 1
fi

if [ "$MODE" != "supabase" ]; then
  echo "→ Применение миграций с журналом и fail-fast..."
  docker exec \
    -e PGHOST=127.0.0.1 \
    -e PGPORT=5432 \
    -e PGUSER="$CHECK_DB_USER" \
    -e PGPASSWORD="$DB_PASS" \
    -e PGDATABASE="$DB_NAME" \
    "$CONTAINER_ID" sh /scripts/01-apply-migrations.sh
fi

echo "→ Проверка критических таблиц..."
TABLE_COUNT="$(docker exec -u postgres "$CONTAINER_ID" psql -U "$CHECK_DB_USER" -d "$DB_NAME" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
MISSING=""
for table in profiles user_roles products product_categories orders order_items confectioners audit_log fillings builder_config site_settings cms_pages confectioner_transactions schema_migrations; do
  exists="$(docker exec "$CONTAINER_ID" psql -U "$CHECK_DB_USER" -d "$DB_NAME" -Atqc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$table' LIMIT 1")"
  if [ "$exists" != "1" ]; then MISSING="$MISSING $table"; fi
done
if [ -n "$MISSING" ]; then
  echo "Отсутствуют критические таблицы:$MISSING"
  exit 1
fi

echo "PostgreSQL готов. Таблиц public: $TABLE_COUNT"
echo "Подключение: host=$DB_HOST port=$DB_PORT user=$DB_USER db=$DB_NAME"
if [ "$MODE" = "supabase" ]; then
  echo "Строка подключения: postgresql://conditera:<CONDITERA_DB_PASSWORD>@localhost:6432/conditera"
else
  echo "Строка подключения: postgresql://supabase_admin:<POSTGRES_PASSWORD>@localhost:5433/uyezdny_konditer_dev"
fi
