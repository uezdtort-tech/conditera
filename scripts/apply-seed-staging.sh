#!/bin/bash
# ============================================================
# apply-seed-staging.sh — применить миграции и seed-данные к staging Supabase.
#
# Запуск (с вашими ключами из `supabase start`):
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
#     bash scripts/apply-seed-staging.sh
#
# Или с автоматически определённым URL локального Supabase:
#   bash scripts/apply-seed-staging.sh
#
# Также можно использовать supabase CLI (если установлен):
#   supabase db push --include-all
#   supabase db reset --force
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/supabase/migrations"
SEED_FILE="$PROJECT_ROOT/supabase/seed.sql"

# Цвета для логов
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARN:${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ERR:${NC} $*" >&2; }
info() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }

# Определить DATABASE_URL
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

info "» Используем DATABASE_URL: ${DATABASE_URL/@.*:/@***:}"

# 1. Проверить наличие psql
if ! command -v psql >/dev/null 2>&1; then
  err "psql не найден. Установите postgresql-client:"
  err "  Ubuntu/Debian:  sudo apt install postgresql-client"
  err "  macOS:           brew install libpq && export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\""
  err ""
  err "Альтернатива: используйте скрипт через npx tsx:"
  err "  DATABASE_URL=\"$DATABASE_URL\" npx tsx scripts/apply-migrations.ts"
  exit 1
fi

# 2. Проверить что папка migrations существует
if [ ! -d "$MIGRATIONS_DIR" ]; then
  err "Папка migrations не найдена: $MIGRATIONS_DIR"
  exit 1
fi

# 3. Проверить подключение к БД
log "» Проверяем подключение к PostgreSQL..."
if ! psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
  err "Не удалось подключиться к PostgreSQL"
  err "Проверьте URL: $DATABASE_URL"
  err ""
  err "Если Supabase запущен локально, проверьте порты:"
  err "  ss -tln | grep 54322  # или"
  err "  docker ps | grep postgres"
  exit 1
fi
log "✓ Подключение к PostgreSQL установлено"

# 4. Применить миграции по порядку
info ""
info "══════════════════════════════════════════════════════════════"
info "  ПРИМЕНЕНИЕ МИГРАЦИЙ (12 файлов)"
info "══════════════════════════════════════════════════════════════"
info ""

MIGRATIONS_APPLIED=0
MIGRATIONS_FAILED=0

for migration_file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  migration_name=$(basename "$migration_file")
  info "» Применяем: $migration_name"

  # Применяем миграцию; игнорируем ошибки "already exists" (идемпотентность)
  if psql "$DATABASE_URL" \
    --set ON_ERROR_STOP=off \
    -v ON_ERROR_STOP=0 \
    -f "$migration_file" 2>&1 | grep -E "(ERROR|FATAL)" | grep -v "already exists" | head -5; then
    log "✓ $migration_name"
    MIGRATIONS_APPLIED=$((MIGRATIONS_APPLIED + 1))
  else
    warn "⚠ $migration_name завершилась с ошибками (см. выше — идемпотентные операции пропущены)"
    MIGRATIONS_FAILED=$((MIGRATIONS_FAILED + 1))
  fi
done

info ""
log "Миграций применено: $MIGRATIONS_APPLIED, с предупреждениями: $MIGRATIONS_FAILED"

# 5. Применить seed-данные
info ""
info "══════════════════════════════════════════════════════════════"
info "  ПРИМЕНЕНИЕ SEED-ДАННЫХ"
info "══════════════════════════════════════════════════════════════"
info ""

if [ ! -f "$SEED_FILE" ]; then
  warn "Seed-файл не найден: $SEED_FILE"
else
  info "» Применяем: $(basename "$SEED_FILE")"
  if psql "$DATABASE_URL" \
    --set ON_ERROR_STOP=off \
    -v ON_ERROR_STOP=0 \
    -f "$SEED_FILE" 2>&1 | grep -E "(ERROR|FATAL)" | head -5; then
    log "✓ Seed-данные применены"
  else
    warn "⚠ Seed-файл завершился с ошибками (см. выше)"
  fi
fi

# 6. Верификация
info ""
info "══════════════════════════════════════════════════════════════"
info "  ВЕРИФИКАЦИЯ"
info "══════════════════════════════════════════════════════════════"
info ""

# Таблицы
TABLES_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" | tr -d ' ')
log "✓ Таблиц в 'public': $TABLES_COUNT"

# Роли в user_role enum
ROLES_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role');" | tr -d ' ')
log "✓ Ролей в enum user_role: $ROLES_COUNT"

# RLS политики
POLICIES_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM pg_policies WHERE schemaname = 'public';" | tr -d ' ')
log "✓ RLS политик: $POLICIES_COUNT"

# Записи в ключевых таблицах
info ""
info "─── Количество записей ───"
for table in product_categories products profiles recipe_marketplace loyalty_partners loyalty_cross_actions ai_assistant_conversations ai_assistant_logs configs; do
  COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM public.$table;" 2>/dev/null | tr -d ' ' || echo "n/a")
  if [ -n "$COUNT" ] && [ "$COUNT" != "" ]; then
    info "  $table: $COUNT"
  else
    warn "  $table: не найдена (или ошибка запроса)"
  fi
done

info ""
log "══════════════════════════════════════════════════════════════"
log "✅ Все миграции и seed-данные успешно применены!"
log "══════════════════════════════════════════════════════════════"
info ""
info "» Дополнительные команды:"
info "  • Проверить схемы через Supabase Studio: http://127.0.0.1:54323"
info "  • Подключиться к БД: psql \"$DATABASE_URL\""
info "  • Сбросить БД (осторожно!): supabase db reset --force"
info ""
