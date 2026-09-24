#!/bin/bash
# scripts/init-db.sh — Инициализация БД для локальной разработки.
#
# Использование:
#   ./scripts/init-db.sh                — Docker: PostgreSQL 18 (порт 5433) + Redis + Meilisearch
#   ./scripts/init-db.sh supabase       — Docker: полный Supabase stack (порт 5432)
#   ./scripts/init-db.sh pglite         — Локально без Docker (PGlite WASM, в /db/pglite-dev)
#   ./scripts/init-db.sh pglite-reset   — То же, но с удалением старого PGlite-файла
#
# Что делает:
#   1. Запускает PostgreSQL (через Docker) ИЛИ открывает PGlite
#   2. Применяет все Supabase миграции (0001–0018) по порядку
#   3. Загружает seed данные (28 категорий, 45 начинок, 7 CMS страниц, 13 пунктов меню)
#   4. Проверяет что БД готова и выводит параметры подключения
#
# PGlite-режим полезен когда Docker недоступен (CI, тесты, smoke-проверки).
# В PGlite пропускаются: CREATE EXTENSION, auth.users FK, RLS-политики с auth.uid().

set -e

MODE="${1:-dev}"

echo "=== Инициализация БД «Уездный кондитер» ==="
echo "Режим: $MODE"
echo ""

# ============================================================================
# 0. PGlite-режим — без Docker
# ============================================================================
if [ "$MODE" = "pglite" ] || [ "$MODE" = "pglite-reset" ]; then
  if [ "$MODE" = "pglite-reset" ]; then
    echo "→ Удаление старого PGlite-файла..."
    rm -rf ./db/pglite-dev
  fi
  echo "→ Запуск PGlite (WASM PostgreSQL, без Docker)..."
  npx tsx ./scripts/init-db-local.ts --pglite
  exit $?
fi

# ============================================================================
# 1. Запуск PostgreSQL через Docker
# ============================================================================
if [ "$MODE" = "supabase" ]; then
  echo "→ Запуск Supabase через docker-compose.supabase.yml..."
  if [ ! -f .env.supabase ]; then
    echo "⚠️  Файл .env.supabase не найден. Создаём из .env.supabase.example..."
    cp .env.supabase .env.supabase.local 2>/dev/null || true
  fi
  export $(grep -v '^#' .env.supabase | xargs)
  docker-compose -f docker-compose.supabase.yml up -d supabase-db
  DB_HOST="localhost"
  DB_PORT="5432"
  DB_USER="supabase"
  DB_NAME="supabase"
  DB_PASS="$POSTGRES_PASSWORD"
  WAIT_TIME=15
  CONTAINER_NAME="supabase-db"
else
  echo "→ Запуск PostgreSQL 18 через docker-compose.dev.yml..."
  docker-compose -f docker-compose.dev.yml up -d db-dev
  DB_HOST="localhost"
  DB_PORT="5433"
  DB_USER="uyezdny"
  DB_NAME="uyezdny_konditer_dev"
  DB_PASS="uyezdny_dev_pass"
  WAIT_TIME=10
  CONTAINER_NAME="db-dev"
fi

echo "→ Ожидание готовности БД (${WAIT_TIME}с)..."
sleep $WAIT_TIME

# ===== 2. Проверка соединения =====
echo "→ Проверка соединения..."
CONTAINER_ID=$(docker ps -q -f "name=$CONTAINER_NAME" | head -1)
if [ -z "$CONTAINER_ID" ]; then
  echo "❌ Контейнер $CONTAINER_NAME не запущен. Проверьте docker-compose logs."
  echo "   Альтернатива: ./scripts/init-db.sh pglite  (без Docker)"
  exit 1
fi

if ! docker exec -i "$CONTAINER_ID" pg_isready -U "$DB_USER" -d "$DB_NAME" 2>/dev/null; then
  echo "❌ БД не готова. Попробуйте: docker-compose -f docker-compose.dev.yml logs db-dev"
  echo "   Альтернатива: ./scripts/init-db.sh pglite  (без Docker)"
  exit 1
fi
echo "✅ PostgreSQL готов"

# ===== 3. Применение миграций =====
echo ""
echo "→ Применение миграций..."
MIGRATIONS_DIR="supabase/migrations"

for sql_file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  filename=$(basename "$sql_file")
  echo "  → $filename"
  docker exec -i "$CONTAINER_ID" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 < "$sql_file" 2>&1 \
    | grep -v "^NOTICE\|^CREATE\|^INSERT\|^UPDATE\|^DELETE\|^ALTER\|^COMMENT\|^GRANT\|^REVOKE\|^SET\|^$\|^psql:" || true
done

echo "✅ Миграции применены"

# ===== 4. Seed данные =====
echo ""
echo "→ Загрузка seed данных..."
for seed_file in supabase/seed.sql supabase/seed_cms_crm.sql supabase/seed_fillings.sql; do
  if [ -f "$seed_file" ]; then
    filename=$(basename "$seed_file")
    echo "  → $filename"
    docker exec -i "$CONTAINER_ID" \
      psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 < "$seed_file" 2>&1 \
      | grep -v "^NOTICE\|^INSERT\|^$\|^psql:" || true
  fi
done

echo "✅ Seed данные загружены"

# ===== 5. Проверка таблиц =====
echo ""
echo "→ Проверка таблиц..."
TABLE_COUNT=$(docker exec -i "$CONTAINER_ID" \
  psql -U "$DB_USER" -d "$DB_NAME" -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs)

echo "✅ Таблиц в БД: $TABLE_COUNT"

# Проверяем критические таблицы
echo ""
echo "→ Проверка критических таблиц..."
CRITICAL_TABLES="profiles user_roles products product_categories orders order_items confectioners audit_log fillings builder_config site_settings cms_pages"
MISSING=""
for t in $CRITICAL_TABLES; do
  EXISTS=$(docker exec -i "$CONTAINER_ID" \
    psql -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1;" 2>/dev/null | xargs)
  if [ "$EXISTS" = "1" ]; then
    echo "  ✓ $t"
  else
    echo "  ✗ $t (отсутствует)"
    MISSING="$MISSING $t"
  fi
done

if [ -n "$MISSING" ]; then
  echo ""
  echo "⚠️  Некоторые критические таблицы отсутствуют:$MISSING"
  echo "   Возможно, миграции применились не полностью. См. логи выше."
fi

echo ""
echo "=== База данных готова к работе ==="
echo ""
echo "Параметры подключения:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  User: $DB_USER"
echo "  DB:   $DB_NAME"
echo ""
if [ "$MODE" = "dev" ]; then
  echo "DATABASE_URL=postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME?schema=public"
  echo ""
  echo "Добавьте в .env.local:"
  echo "  DATABASE_URL=postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME?schema=public"
  echo "  NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000"
  echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY=<см. .env.supabase>"
fi
