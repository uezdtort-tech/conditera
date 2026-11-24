#!/bin/bash
# supabase/init-scripts/01-apply-migrations.sh
# ============================================================================
# Применение миграций «Уездный кондитер» БЕЗОПАСНО и ИДЕМПОТЕНТНО.
#
# Механизм: таблица-журнал public.schema_migrations(filename PRIMARY KEY).
#   • Файл отмечается в журнале только после успешного выполнения.
#   • psql работает с ON_ERROR_STOP=1 (fail-fast); внешняя транзакция не
#     навязывается, поскольку отдельные миграции могут управлять транзакциями.
#   • Повторный запуск пропускает уже отмеченные файлы.
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

PSQL_USER="${PGUSER:-${POSTGRES_USER:-postgres}}"
PSQL_DB="${PGDATABASE:-${POSTGRES_DB:-postgres}}"

# Все операции журнала обязаны идти в ту же БД/под тем же пользователем,
# что и сами SQL-файлы. Раньше PSQL() не передавал -U/-d и мог создать
# schema_migrations в postgres, применяя сами миграции в другой БД.
PSQL() {
  psql -v ON_ERROR_STOP=1 -q -U "$PSQL_USER" -d "$PSQL_DB" "$@"
}


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

# ===== 0.1. Проверка migration ID (Z-v24, backward-compatible) =====
# Новые миграции обязаны иметь уникальный числовой ID. В старом наборе уже
# существуют перечисленные исторические коллизии; имена файлов и журнал
# schema_migrations нельзя переименовывать без отдельной миграции журнала.
# Для этих групп сохраняем детерминированный лексикографический порядок,
# который использовался ранее. Любая новая/неизвестная коллизия блокирует запуск.
DUP_ERRORS=0
for num in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | xargs -n1 basename | sed -n 's/^\([0-9][0-9]*\)_.*/\1/p' | sort -u); do
  DUP_FILES=$(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | xargs -n1 basename | grep -E "^\${num}_" | sort)
  DUP_COUNT=$(echo "$DUP_FILES" | grep -c . || true)
  [ "$DUP_COUNT" -le 1 ] && continue
  case "$num" in
    0061)
      EXPECTED=$(printf '%s\n' 0061_drop_orders_log_status_trigger.sql 0061_user_consent_events.sql)
      ;;
    0062)
      EXPECTED=$(printf '%s\n' 0062_cart_custom_items.sql 0062_cart_sync_custom.sql 0062_reference_catalog.sql)
      ;;
    0063)
      EXPECTED=$(printf '%s\n' 0063_cake_project_spec.sql 0063_financial_ledger.sql)
      ;;
    0064)
      EXPECTED=$(printf '%s\n' 0064_product_slices_rls.sql 0064_supplier_procurement.sql)
      ;;
    0066)
      EXPECTED=$(printf '%s\n' 0066_recipe_children.sql 0066_service_role_default_grants.sql)
      ;;
    0067)
      EXPECTED=$(printf '%s\n' 0067_recipe_ingredients_normalization.sql 0067_repair_updated_at_triggers.sql)
      ;;
    *)
      EXPECTED=""
      ;;
  esac
  if [ -z "$EXPECTED" ] || [ "$DUP_FILES" != "$EXPECTED" ]; then
    echo "❌ НЕОЖИДАННАЯ КОЛЛИЗИЯ MIGRATION ID \${num}:"
    echo "$DUP_FILES" | sed 's/^/    /'
    DUP_ERRORS=$((DUP_ERRORS + 1))
  else
    echo "ℹ️  Историческая коллизия \${num}: применяю уникальные имена файлов в стабильном порядке"
  fi
done
if [ "$DUP_ERRORS" -gt 0 ]; then
  echo "❌ Применение прервано ДО SQL: найдены неизвестные дублирующиеся migration ID."
  exit 1
fi

# ===== 1. Миграции по порядку =====
MIGRATION_COUNT=0
SKIPPED_COUNT=0
DEFERRED_COUNT=0
for sql_file in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$sql_file" ] || continue
  filename=$(basename "$sql_file")

  ALREADY=$(PSQL -tAc "SELECT 1 FROM public.schema_migrations WHERE filename='${filename}'" || true)
  if [ "$ALREADY" = "1" ]; then
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  # 0026 creates RLS policies on storage.objects and inserts storage.buckets.
  # Supabase Storage API creates these tables only after the DB container is healthy.
  # Defer this migration during initdb; the post-Storage migrator reruns this script.
  if [ "$filename" = "0026_storage_buckets_and_confectioners_rls.sql" ]; then
    STORAGE_TABLES_READY=$(PSQL -tAc "SELECT (to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL)" | xargs)
    if [ "$STORAGE_TABLES_READY" != "t" ]; then
      echo "⏭ Откладываю ${filename}: таблицы Supabase Storage ещё не созданы"
      DEFERRED_COUNT=$((DEFERRED_COUNT + 1))
      continue
    fi
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

echo "✅ Применено: ${MIGRATION_COUNT}, пропущено: ${SKIPPED_COUNT}, отложено до готовности Storage: ${DEFERRED_COUNT} (было применено ранее: ${APPLIED_BEFORE})"

# ===== 2. Seed данные — только явный opt-in для локальной демонстрации =====
# По умолчанию НИЧЕГО из demo seed не загружается в production.
# Базовые категории и начинки перенесены в 0062_reference_catalog.sql.
SEED_MODE="${SEED_MODE:-none}"
if [ "$SEED_MODE" = "demo" ] && [ "$FRESH_DB" = "1" ] && [ -d "$SEEDS_DIR" ]; then
  echo ""
  echo "=== DEMO seed включён явно (SEED_MODE=demo) ==="
  SEED_COUNT=0
  for sql_file in "$SEEDS_DIR"/*.sql; do
    [ -e "$sql_file" ] || continue
    echo "→ DEMO seed: $(basename "$sql_file")"
    if psql -v ON_ERROR_STOP=1 -U "$PSQL_USER" -d "$PSQL_DB" -f "$sql_file"; then
      SEED_COUNT=$((SEED_COUNT + 1))
    else
      echo "❌ DEMO SEED УПАЛ: $(basename "$sql_file")"
      exit 1
    fi
  done
  echo "Загружено demo seed-файлов: ${SEED_COUNT}"
elif [ "$SEED_MODE" != "none" ] && [ "$SEED_MODE" != "demo" ]; then
  echo "❌ Неизвестный SEED_MODE='$SEED_MODE' (допустимы none или demo)"
  exit 1
else
  echo "Demo seed пропущен (SEED_MODE=$SEED_MODE)"
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
ALL_OK=1
AUTH_USERS_EXISTS=$(PSQL -tAc "SELECT to_regclass('auth.users') IS NOT NULL" | xargs)
if [ "$AUTH_USERS_EXISTS" = "t" ]; then
  echo "  ✓ auth.users"
else
  echo "  ✗ auth.users (отсутствует)"
  ALL_OK=0
fi
# storage.objects создаётся миграциями Storage API после старта DB-контейнера.
# Его наличие проверяется поздним runtime preflight, а не initdb-скриптом.
CRITICAL_TABLES="profiles user_roles products product_categories orders order_items confectioners audit_log fillings builder_config site_settings cms_pages confectioner_transactions payments refunds inventory_items inventory_movements inventory_write_offs chat_channels oauth_identity_links user_consent_events schema_migrations"
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
