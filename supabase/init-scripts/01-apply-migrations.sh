#!/bin/bash
# supabase/init-scripts/01-apply-migrations.sh
# ============================================================================
# Автоматически применяется при ПЕРВОМ запуске контейнера PostgreSQL
# (когда data volume пустой). Запускается из /docker-entrypoint-initdb.d/.
#
# Что делает:
#   1. Применяет все SQL миграции из /migrations/ в алфавитном порядке
#   2. Применяет seed-данные из /seeds/
#   3. Выводит сводку: количество таблиц, ключевые счётчики
#
# Для повторного применения миграций используйте:
#   ./scripts/init-db.sh          # Docker
#   ./scripts/init-db.sh pglite   # без Docker (PGlite)
# ============================================================================

set -e

echo ""
echo "=== Применение миграций «Уездный кондитер» ==="
echo ""

# Миграции монтируются в /migrations (см. docker-compose.dev.yml)
MIGRATIONS_DIR="/migrations"
SEEDS_DIR="/seeds"

# Если директории нет — пропускаем (контейнер запущен без volume mount)
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "⚠️  Директория миграций не найдена: $MIGRATIONS_DIR"
  echo "    Проверьте volume mount в docker-compose.dev.yml"
  exit 0
fi

# ===== 1. Применяем миграции по порядку =====
MIGRATION_COUNT=0
for sql_file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  filename=$(basename "$sql_file")
  echo "→ Применение: $filename"
  # -v ON_ERROR_STOP=0 — не падать на ошибки (миграции могут содержать
  # IF NOT EXISTS, но некоторые statement могут падать на дубликатах)
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=0 -f "$sql_file" 2>&1 \
    | grep -E "^ERROR|^FATAL" || true
  MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
done

echo ""
echo "✅ Применено миграций: $MIGRATION_COUNT"

# ===== 2. Seed данные =====
if [ -d "$SEEDS_DIR" ]; then
  echo ""
  echo "=== Загрузка seed данных ==="
  SEED_COUNT=0
  for sql_file in $(ls "$SEEDS_DIR"/*.sql 2>/dev/null | sort); do
    filename=$(basename "$sql_file")
    echo "→ Seed: $filename"
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=0 -f "$sql_file" 2>&1 \
      | grep -E "^ERROR|^FATAL" || true
    SEED_COUNT=$((SEED_COUNT + 1))
  done
  echo "✅ Загружено seed-файлов: $SEED_COUNT"
fi

# ===== 3. Сводка =====
echo ""
echo "=== Сводка ==="

# Количество таблиц
TABLE_COUNT=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs)
echo "Таблиц в схеме public: $TABLE_COUNT"

# Количество RLS-политик
POLICY_COUNT=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
  "SELECT count(*) FROM pg_policies WHERE schemaname = 'public';" 2>/dev/null | xargs)
echo "RLS-политик: $POLICY_COUNT"

# Количество категорий товаров
CAT_COUNT=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
  "SELECT count(*) FROM public.product_categories;" 2>/dev/null | xargs)
echo "Категорий товаров: $CAT_COUNT"

# Количество начинок
FILLING_COUNT=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
  "SELECT count(*) FROM public.fillings;" 2>/dev/null | xargs)
echo "Начинок: $FILLING_COUNT"

# Количество CMS-страниц
CMS_COUNT=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
  "SELECT count(*) FROM public.cms_pages;" 2>/dev/null | xargs)
echo "CMS-страниц: $CMS_COUNT"

# Проверка критических таблиц
echo ""
echo "=== Проверка критических таблиц ==="
CRITICAL_TABLES="profiles user_roles products product_categories orders order_items confectioners audit_log fillings builder_config site_settings cms_pages"
ALL_OK=1
for t in $CRITICAL_TABLES; do
  EXISTS=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1;" 2>/dev/null | xargs)
  if [ "$EXISTS" = "1" ]; then
    echo "  ✓ $t"
  else
    echo "  ✗ $t (отсутствует)"
    ALL_OK=0
  fi
done

echo ""
if [ "$ALL_OK" = "1" ]; then
  echo "✅ База данных готова к работе"
else
  echo "⚠️  Некоторые таблицы отсутствуют — см. ошибки выше"
fi
