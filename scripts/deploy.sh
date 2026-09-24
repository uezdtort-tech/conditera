#!/bin/bash
# ============================================================
# deploy.sh — Production deploy скрипт
# ============================================================
# Запуск на сервере: bash scripts/deploy.sh
# Запуск локально: bash scripts/deploy.sh --remote
# ============================================================

set -euo pipefail

# Конфигурация
PROJECT_DIR="/opt/conditera"
COMPOSE_FILE="docker-compose.yml"
SUPABASE_COMPOSE_FILE="docker-compose.supabase.yml"

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +'%H:%M:%S')] WARN:${NC} $1"; }
err() { echo -e "${RED}[$(date +'%H:%M:%S')] ERROR:${NC} $1"; exit 1; }

# Проверка что мы в правильной директории
check_dir() {
  if [ ! -f "package.json" ] || [ ! -f "docker-compose.yml" ]; then
    err "Не в корне проекта. Запустите из директории проекта."
  fi
}

# 1. Pull latest code
pull_code() {
  log "Pulling latest code..."
  git pull origin main
}

# 2. Check .env.production
check_env() {
  if [ ! -f ".env.production" ]; then
    err ".env.production не найден! Создайте его:"
    echo "  bash scripts/setup-env.sh prod"
    echo "  ИЛИ скопируйте: cp .env.production.example .env.production"
    exit 1
  fi

  # Делегируем в env-check.sh — он проверяет ВСЕ переменные с понятными сообщениями
  log "Running env-check.sh production..."
  bash scripts/env-check.sh production || err ".env.production не прошёл проверку. Заполните недостающие переменные: bash scripts/setup-env.sh prod"

  log "✓ .env.production проверен"
}

# 3. Apply Supabase migrations
apply_migrations() {
  log "Applying Supabase migrations..."

  # Проверка что Supabase запущен
  if ! docker ps --format '{{.Names}}' | grep -q "conditera-supabase-db"; then
    warn "Supabase DB не запущен. Запускаю..."
    docker-compose -f $SUPABASE_COMPOSE_FILE up -d
    sleep 30
  fi

  # Применяем миграции по порядку
  for migration in 0001_init 0002_marketplace 0003_search_function 0004_cake_builder_chat 0005_crm_cms; do
    local SQL_FILE="supabase/migrations/${migration}.sql"
    if [ -f "$SQL_FILE" ]; then
      log "  Applying ${migration}.sql..."
      docker exec -i conditera-supabase-db psql -U supabase -d supabase < "$SQL_FILE" || warn "Migration ${migration} failed (might already be applied)"
    fi
  done

  # Seed данные (только при первом запуске)
  if [ ! -f ".seed-applied" ]; then
    log "Applying seed data..."
    for seed in seed seed_cms_crm; do
      local SEED_FILE="supabase/${seed}.sql"
      if [ -f "$SEED_FILE" ]; then
        docker exec -i conditera-supabase-db psql -U supabase -d supabase < "$SEED_FILE" || warn "Seed ${seed} failed"
      fi
    done
    touch .seed-applied
    log "✓ Seed данные применены"
  fi

  log "✓ Миграции применены"
}

# 4. Deploy Edge Functions
deploy_functions() {
  log "Deploying Edge Functions..."

  if command -v supabase &> /dev/null; then
    for func in telegram-webhook send-notification yookassa-webhook abandoned-cart daily-digest bonus-expiry; do
      local FUNC_DIR="supabase/functions/${func}"
      if [ -d "$FUNC_DIR" ]; then
        log "  Deploying ${func}..."
        supabase functions deploy "$func" --project-ref conditera || warn "Function ${func} deploy failed"
      fi
    done
    log "✓ Edge Functions deployed"
  else
    warn "Supabase CLI не установлен — пропускаю deploy функций"
  fi
}

# 5. Setup pg_cron schedules
setup_cron() {
  log "Setting up pg_cron schedules..."

  # abandoned-cart (каждый час)
  docker exec conditera-supabase-db psql -U supabase -d supabase -c "
    SELECT cron.schedule('abandoned-cart', '0 * * * *',
      \$\$SELECT net.http_post(
        url := 'http://supabase-kong:8000/functions/v1/abandoned-cart',
        headers := '{\"Content-Type\":\"application/json\"}'::jsonb,
        body := '{}'::jsonb
      )\$\$);
  " 2>/dev/null || warn "cron schedule abandoned-cart failed (might already exist)"

  # daily-digest (9:00 MSK)
  docker exec conditera-supabase-db psql -U supabase -d supabase -c "
    SELECT cron.schedule('daily-digest', '0 9 * * *',
      \$\$SELECT net.http_post(
        url := 'http://supabase-kong:8000/functions/v1/daily-digest',
        headers := '{\"Content-Type\":\"application/json\"}'::jsonb,
        body := '{}'::jsonb
      )\$\$);
  " 2>/dev/null || warn "cron schedule daily-digest failed"

  # bonus-expiry (00:00 MSK)
  docker exec conditera-supabase-db psql -U supabase -d supabase -c "
    SELECT cron.schedule('bonus-expiry', '0 0 * * *',
      \$\$SELECT net.http_post(
        url := 'http://supabase-kong:8000/functions/v1/bonus-expiry',
        headers := '{\"Content-Type\":\"application/json\"}'::jsonb,
        body := '{}'::jsonb
      )\$\$);
  " 2>/dev/null || warn "cron schedule bonus-expiry failed"

  # cleanup-typing (каждую минуту)
  docker exec conditera-supabase-db psql -U supabase -d supabase -c "
    SELECT cron.schedule('cleanup-typing', '* * * * *',
      \$\$DELETE FROM public.chat_typing WHERE expires_at < NOW()\$\$);
  " 2>/dev/null || warn "cron schedule cleanup-typing failed"

  log "✓ pg_cron schedules настроены"
}

# 6. Restart services
restart_services() {
  log "Restarting services..."

  # Pull latest images
  docker-compose -f $SUPABASE_COMPOSE_FILE pull 2>/dev/null || true
  docker-compose pull 2>/dev/null || true

  # Restart Supabase
  docker-compose -f $SUPABASE_COMPOSE_FILE up -d
  sleep 15

  # Restart web
  docker-compose up -d --no-deps web
  sleep 10

  log "✓ Сервисы перезапущены"
}

# 7. Health check
health_check() {
  log "Running health check..."

  local RETRIES=5
  local SLEEP=5

  for i in $(seq 1 $RETRIES); do
    local WEB_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
    local KONG_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:8000/ 2>/dev/null || echo "000")

    if [ "$WEB_STATUS" = "200" ]; then
      log "✓ Web: HTTP 200 (OK)"
      break
    else
      warn "Web: HTTP $WEB_STATUS (attempt $i/$RETRIES)"
      sleep $SLEEP
    fi
  done

  if [ "$WEB_STATUS" != "200" ]; then
    err "Web не отвечает! Проверьте логи: docker-compose logs web"
  fi

  # Запускаем full health-check скрипт
  if [ -f "scripts/health-check.sh" ]; then
    log "Running full health-check.sh..."
    bash scripts/health-check.sh http://localhost:3000 || warn "Some endpoints failed"
  fi
}

# 8. Cleanup
cleanup() {
  log "Cleaning up old Docker images..."
  docker image prune -f 2>/dev/null || true
  log "✓ Cleanup complete"
}

# 9. Summary
summary() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  🎉 DEPLOY SUCCESSFUL!"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "  Web:        https://conditera.ru"
  echo "  Health:     https://conditera.ru/api/health"
  echo "  Studio:     http://localhost:8100"
  echo "  Kong API:   http://localhost:8000"
  echo ""
  echo "  Версия:     $(git rev-parse --short HEAD)"
  echo "  Дата:       $(date)"
  echo ""
  echo "  Команды:"
  echo "    Логи:       docker-compose logs -f --tail=50"
  echo "    Статус:     docker-compose ps"
  echo "    Backup БД: docker exec conditera-supabase-db pg_dump -U supabase supabase > backup_$(date +%Y%m%d).sql"
  echo ""
  echo "═══════════════════════════════════════════════════════════"
}

# ===== Main =====
main() {
  log "Starting production deploy..."

  check_dir
  pull_code
  check_env
  apply_migrations
  deploy_functions
  setup_cron
  restart_services
  health_check
  cleanup
  summary

  log "Deploy completed successfully!"
}

# Run
main "$@"
