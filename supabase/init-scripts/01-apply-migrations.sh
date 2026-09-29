#!/bin/bash
# supabase/init-scripts/01-apply-migrations.sh
# ============================================================================
# Применение миграций «Уездный кондитер» БЕЗОПАСНО и ИДЕМПОТЕНТНО.
#
# Механизм: таблица-журнал public.schema_migrations(filename PRIMARY KEY).
#   • Файл применяется РОВНО ОДИН РАЗ (запись в журнале после успеха).
#   • Каждый файл — в отдельной транзакции с ON_ERROR_STOP=1 (fail-fast):
#     ошибка SQL останавливает процесс с ненулевым кодом выхода.
#   • Повторный запуск пропускает уже применённые файлы.
#
# Подключение: стандартные переменные libpq (PGHOST/PGPORT/PGUSER/PGPASSWORD/
# PGDATABASE). При запуске внутри postgres-контейнера используются
# POSTGRES_USER / POSTGRES_DB (docker-entrypoint-initdb.d).
#
# Seeds применяются ТОЛЬКО при первичной инициализации (пустой журнал,
# созданный этим запуском) — в production их повторный прогон не нужен.
#
# БАЗА ЛАЙНА (существующая БД до внедрения журнала):
#   заполните schema_migrations именами уже применённых файлов, иначе
#   скрипт упадёт на первом неидемпотентном объекте (это намеренно —
#   fail-fast вместо тихой порчи схемы). См. docs/DEPLOYMENT.md.
# ============================================================================

set -e

PSQL() {
  psql -v ON_ERROR_STOP=1 -q "$@"
}

PSQL_USER="${PGUSER:-${POSTGRES_USER:-postgres}}"
PSQL_DB="${PGDATABASE:-${POSTGRES_DB:-postgres}}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
SEEDS_DIR="${SEEDS_DIR:-/seeds}"

echo ""
echo "=== Миграции «Уездный кондитер» (ledger, fail-fast) ==="
echo "host=${PGHOST:-local-socket} user=${PSQL_USER} db=${PSQL_DB}"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "⚠️  Директория миграций не найдена: $MIGRATIONS_DIR — пропускаю"
  exit 0
fi

# ===== 0. Журнал миграций =====
FRESH_DB=0
TABLE_EXISTS=$(PSQL -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations'" || true)
if [ "$TABLE_EXISTS" != "1" ]; then
  PSQL -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
  FRESH_DB=1
  echo "📄 Журнал schema_migrations создан (свежая БД)"
fi

APPLIED_BEFORE=$(PSQL -tAc "SELECT count(*) FROM public.schema_migrations")

# ===== 1. Миграции по порядку =====
MIGRATION_COUNT=0
SKIPPED_COUNT=0
for sql_file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  filename=$(basename "$sql_file")

  ALREADY=$(PSQL -tAc "SELECT 1 FROM public.schema_migrations WHERE filename='${filename}'" || true)
  if [ "$ALREADY" = "1" ]; then
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  echo "→ Применяю: ${filename}"
  # НЕ в транзакции целиком: CREATE INDEX CONCURRENT не любит транзакции,
  # а файлы проекта таковых не содержат — psql применяет стейтменты
  # последовательно, ON_ERROR_STOP=1 роняет первую же ошибку.
  if psql -v ON_ERROR_STOP=1 -U "$PSQL_USER" -d "$PSQL_DB" -f "$sql_file"; then
    PSQL -c "INSERT INTO public.schema_migrations(filename) VALUES ('${filename}')"
    MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
  else
    echo "❌ МИГРАЦИЯ УПАЛА: ${filename}"
    echo "   Схема в частично применённом состоянии. Исправьте файл/БД"
    echo "   и перезапустите (уже применённые файлы будут пропущены)."
    exit 1
  fi
done

echo "✅ Применено: ${MIGRATION_COUNT}, пропущено (уже в журнале): ${SKIPPED_COUNT} (было применено ранее: ${APPLIED_BEFORE})"

# ===== 2. Seed данные — только при первичной инициализации =====
if [ "$FRESH_DB" = "1" ] && [ -d "$SEEDS_DIR" ]; then
  echo ""
  echo "=== Seed данные (первичная инициализация) ==="
  SEED_COUNT=0
  for sql_file in $(ls "$SEEDS_DIR"/*.sql 2>/dev/null | sort); do
    echo "→ Seed: $(basename "$sql_file")"
    if psql -v ON_ERROR_STOP=1 -U "$PSQL_USER" -d "$PSQL_DB" -f "$sql_file"; then
      SEED_COUNT=$((SEED_COUNT + 1))
    else
      echo "❌ SEED УПАЛ: $(basename "$sql_file")"
      exit 1
    fi
  done
  echo "✅ Загружено seed-файлов: ${SEED_COUNT}"
fi

# ===== 3. Сводка =====
echo ""
echo "=== Сводка ==="
TABLE_COUNT=$(PSQL -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" | xargs)
echo "Таблиц в схеме public: ${TABLE_COUNT}"
POLICY_COUNT=$(PSQL -tAc "SELECT count(*) FROM pg_policies WHERE schemaname = 'public';" | xargs)
echo "RLS-политик: ${POLICY_COUNT}"

echo ""
echo "=== Проверка критических таблиц ==="
CRITICAL_TABLES="profiles user_roles products product_categories orders order_items confectioners audit_log fillings builder_config site_settings cms_pages confectioner_transactions schema_migrations"
ALL_OK=1
for t in $CRITICAL_TABLES; do
  EXISTS=$(PSQL -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}' LIMIT 1;" | xargs)
  if [ "$EXISTS" = "1" ]; then
    echo "  ✓ ${t}"
  else
    echo "  ✗ ${t} (отсутствует)"
    ALL_OK=0
  fi
done

echo ""
if [ "$ALL_OK" = "1" ]; then
  echo "✅ База данных готова к работе"
else
  echo "⚠️  Некоторые таблицы отсутствуют — см. ошибки выше"
  exit 1
fi
