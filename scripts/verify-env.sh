#!/bin/bash
# ============================================================
# verify-env.sh — быстрая проверка что .env настроен правильно
# для работы с docker-compose.dev.yml
# ============================================================
# Запуск из корня проекта: bash scripts/verify-env.sh
# (на Windows: git bash или wsl bash scripts/verify-env.sh)
# ============================================================

set -e
cd "$(dirname "$0")/.."

echo "=== Проверка .env ==="

if [ ! -f .env ]; then
  echo "❌ .env не найден! Создайте его или скопируйте из примера в README."
  exit 1
fi

# Загружаем .env
set -a
. .env
set +a

errors=0

check_var() {
  local name="$1"
  local expected_prefix="$2"
  local val="${!name}"
  if [ -z "$val" ]; then
    echo "❌ $name не задан"
    errors=$((errors + 1))
  elif [ -n "$expected_prefix" ] && [[ ! "$val" == "$expected_prefix"* ]]; then
    echo "❌ $name должен начинаться с '$expected_PREFIX' (сейчас: ${val:0:40}...)"
    errors=$((errors + 1))
  else
    echo "✅ $name = ${val:0:60}..."
  fi
}

check_var DATABASE_URL "postgresql://"
check_var DIRECT_DATABASE_URL "postgresql://"
check_var REDIS_URL "redis://"
check_var MEILI_URL "http"
check_var MEILI_MASTER_KEY ""
check_var SMTP_HOST ""
check_var SMTP_PORT ""
check_var JWT_SECRET ""
check_var NEXT_PUBLIC_APP_URL "http"

echo ""
echo "=== Проверка Docker dev-контейнеров ==="

for svc in uyezdny-db-dev uyezdny-redis-dev uyezdny-meilisearch-dev uyezdny-mailpit-dev; do
  if docker ps --format '{{.Names}}' | grep -q "^${svc}$"; then
    echo "✅ $svc — running"
  else
    echo "❌ $svc — НЕ запущен (docker-compose -f docker-compose.dev.yml up -d)"
    errors=$((errors + 1))
  fi
done

echo ""
echo "=== Проверка доступности PostgreSQL ==="

if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h localhost -p 5433 -U uyezdny -d uyezdny_konditer_dev >/dev/null 2>&1; then
    echo "✅ PostgreSQL на localhost:5433 доступен"
  else
    echo "❌ PostgreSQL на localhost:5433 НЕ доступен"
    errors=$((errors + 1))
  fi
else
  echo "⚠️  pg_isready не установлен — пропускаю проверку БД"
fi

echo ""
if [ "$errors" -eq 0 ]; then
  echo "🎉 Всё готово! Можно запускать:"
  echo "   npx prisma db push        # создать таблицы"
  echo "   npm run dev:local         # запустить Next.js на http://localhost:3000"
else
  echo "❌ Найдено $errors проблем. Исправьте их перед запуском."
  exit 1
fi
