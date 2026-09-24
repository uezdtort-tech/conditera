#!/bin/bash
# ====================================================================
# scripts/deploy-docker.sh — Production deploy через Docker
# ====================================================================
# Полный цикл развертывания:
#   1. Проверка .env.production (все секреты заполнены)
#   2. Сборка Docker образов (web + migrator + chat-service)
#   3. Запуск PostgreSQL + Redis + Meilisearch + n8n
#   4. Применение SQL миграций (migrator контейнер)
#   5. Запуск Next.js + chat-service + Caddy
#   6. Healthcheck всех сервисов
#
# Использование:
#   ./scripts/deploy-docker.sh              — полная сборка и запуск
#   ./scripts/deploy-docker.sh --no-build   — без пересборки образов
#   ./scripts/deploy-docker.sh --restart    — только перезапуск
#   ./scripts/deploy-docker.sh --down       — остановка всех сервисов
# ====================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
  echo ""
  echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

print_ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
print_err()  { echo -e "  ${RED}✗${NC} $1"; }
print_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }

# ====================================================================
# Обработка аргументов
# ====================================================================
MODE="up"
NO_BUILD=false

for arg in "$@"; do
  case $arg in
    --no-build)  NO_BUILD=true ;;
    --restart)   MODE="restart" ;;
    --down)      MODE="down" ;;
    --logs)      MODE="logs" ;;
    --ps)        MODE="ps" ;;
  esac
done

# ====================================================================
# --down: остановка
# ====================================================================
if [ "$MODE" = "down" ]; then
  print_step "Остановка всех сервисов"
  docker-compose down
  print_ok "Сервисы остановлены"
  exit 0
fi

# ====================================================================
# --logs: просмотр логов
# ====================================================================
if [ "$MODE" = "logs" ]; then
  print_step "Логи всех сервисов (Ctrl+C для выхода)"
  docker-compose logs -f --tail=50
  exit 0
fi

# ====================================================================
# --ps: статус контейнеров
# ====================================================================
if [ "$MODE" = "ps" ]; then
  print_step "Статус контейнеров"
  docker-compose ps
  exit 0
fi

# ====================================================================
# --restart: перезапуск
# ====================================================================
if [ "$MODE" = "restart" ]; then
  print_step "Перезапуск сервисов"
  docker-compose restart
  print_ok "Сервисы перезапущены"
  docker-compose ps
  exit 0
fi

# ====================================================================
# Полный deploy
# ====================================================================

# 1. Проверка .env.production
print_step "1/6. Проверка .env.production"

if [ ! -f ".env.production" ]; then
  print_err ".env.production не найден"
  echo "    Создайте его из .env.example:"
  echo "    cp .env.example .env.production"
  echo "    # Отредактируйте, заменив все CHANGE_ME_ на реальные значения"
  exit 1
fi

CHANGE_ME_COUNT=$(grep -c "CHANGE_ME" .env.production || true)
if [ "$CHANGE_ME_COUNT" -gt 0 ]; then
  print_err ".env.production содержит $CHANGE_ME_COUNT CHANGE_ME плейсхолдеров"
  echo "    Замените их на реальные значения перед deploy"
  echo "    Строки с CHANGE_ME:"
  grep -n "CHANGE_ME" .env.production | head -10
  exit 1
fi
print_ok ".env.production: все секреты заполнены"

# 2. Проверка Docker
print_step "2/6. Проверка Docker"

if ! command -v docker &> /dev/null; then
  print_err "Docker не установлен"
  exit 1
fi
print_ok "Docker установлен: $(docker --version)"

if ! docker info &> /dev/null; then
  print_err "Docker daemon не запущен"
  echo "    Запустите: sudo systemctl start docker"
  exit 1
fi
print_ok "Docker daemon запущен"

# 3. Сборка образов
if [ "$NO_BUILD" = false ]; then
  print_step "3/6. Сборка Docker образов"

  echo "  Сборка web (Next.js standalone)..."
  if docker-compose build web 2>&1 | tail -5; then
    print_ok "web образ собран"
  else
    print_err "Ошибка сборки web образа"
    exit 1
  fi

  echo "  Сборка migrator..."
  if docker-compose build migrator 2>&1 | tail -3; then
    print_ok "migrator образ собран"
  else
    print_err "Ошибка сборки migrator"
    exit 1
  fi

  echo "  Сборка chat-service..."
  if docker-compose build chat-service 2>&1 | tail -3; then
    print_ok "chat-service образ собран"
  else
    print_warn "chat-service не собран (опциональный сервис)"
  fi
else
  print_step "3/6. Сборка пропущена (--no-build)"
fi

# 4. Запуск базовой инфраструктуры (БД + Redis)
print_step "4/6. Запуск PostgreSQL + Redis + Meilisearch"

echo "  Запуск db + redis + meilisearch..."
docker-compose up -d db redis meilisearch 2>&1 | tail -10

echo "  Ожидание готовности PostgreSQL (30с)..."
for i in {1..30}; do
  if docker-compose exec -T db pg_isready -U conditera -d conditera 2>/dev/null; then
    print_ok "PostgreSQL готов"
    break
  fi
  sleep 1
  if [ $i -eq 30 ]; then
    print_err "PostgreSQL не готов за 30 секунд"
    docker-compose logs db | tail -20
    exit 1
  fi
done

echo "  Ожидание готовности Redis (10с)..."
sleep 5
if docker-compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
  print_ok "Redis готов"
else
  print_warn "Redis не отвечает (продолжаем — не критично)"
fi

# 5. Применение миграций
print_step "5/6. Применение SQL миграций"

echo "  Запуск migrator контейнера..."
if docker-compose up migrator 2>&1 | tail -15; then
  print_ok "Миграции применены"
else
  print_warn "Migrator завершился с ошибкой (возможно миграции уже применены)"
fi

# 6. Запуск приложения
print_step "6/6. Запуск Next.js + chat-service + Caddy"

docker-compose up -d web chat-service n8n caddy 2>&1 | tail -10

echo "  Ожидание готовности Next.js (60с)..."
for i in {1..60}; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null | grep -q "200"; then
    print_ok "Next.js готов на :3000"
    break
  fi
  sleep 2
  if [ $i -eq 60 ]; then
    print_warn "Next.js не ответил за 60 секунд"
    echo "  Проверьте логи: docker-compose logs web"
  fi
done

# Итоговая проверка
print_step "Статус сервисов"
docker-compose ps

echo ""
echo -e "${GREEN}=== Deploy завершен ===${NC}"
echo ""
echo "Endpoints:"
echo "  Web:          http://localhost:3000"
echo "  API health:   http://localhost:3000/api/health"
echo "  n8n:          http://localhost:5678"
echo "  Meilisearch:  http://localhost:7700"
echo "  Mailpit:      http://localhost:8025"
echo ""
echo "Команды:"
echo "  Логи:      ./scripts/deploy-docker.sh --logs"
echo "  Статус:    ./scripts/deploy-docker.sh --ps"
echo "  Перезапуск: ./scripts/deploy-docker.sh --restart"
echo "  Остановка:  ./scripts/deploy-docker.sh --down"
