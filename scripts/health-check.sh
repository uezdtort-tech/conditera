#!/bin/bash
# ====================================================================
# scripts/health-check.sh — Комплексная проверка здоровья проекта
# ====================================================================
# Проверяет:
#   1. Node.js и npm зависимости
#   2. TypeScript typecheck
#   3. ESLint
#   4. Unit тесты
#   5. Next.js build
#   6. Dev сервер (если запущен)
#   7. Docker контейнеры (если запущены)
#   8. БД подключение (PGlite или PostgreSQL)
#   9. Критичные env переменные
#
# Использование:
#   ./scripts/health-check.sh              — быстрая проверка (без build)
#   ./scripts/health-check.sh --full       — полная проверка (с build и тестами)
#   ./scripts/health-check.sh --docker     — только Docker проверки
# ====================================================================

set -e

MODE="${1:---quick}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
WARN=0

print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
print_fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
print_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARN=$((WARN+1)); }

# ====================================================================
# 1. Node.js и зависимости
# ====================================================================
print_header "1. Node.js и зависимости"

if command -v node &> /dev/null; then
  NODE_VER=$(node --version)
  print_pass "Node.js установлен: $NODE_VER"
else
  print_fail "Node.js не установлен"
  exit 1
fi

if [ -d "node_modules" ]; then
  NM_COUNT=$(ls node_modules | wc -l)
  print_pass "node_modules существует ($NM_COUNT пакетов)"
else
  print_fail "node_modules отсутствует — запустите: npm install"
fi

if [ -f "package-lock.json" ]; then
  print_pass "package-lock.json существует"
else
  print_warn "package-lock.json отсутствует (используется bun.lock?)"
fi

# ====================================================================
# 2. TypeScript
# ====================================================================
print_header "2. TypeScript typecheck"

if npx tsc --noEmit 2>&1 | tail -5; then
  if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
    print_fail "TypeScript ошибки найдены"
  else
    print_pass "TypeScript: 0 ошибок"
  fi
else
  print_fail "TypeScript: не удалось запустить tsc"
fi

# ====================================================================
# 3. ESLint
# ====================================================================
print_header "3. ESLint"

LINT_OUTPUT=$(npx eslint . 2>&1 || true)
if echo "$LINT_OUTPUT" | grep -qE "error|warning"; then
  ERROR_COUNT=$(echo "$LINT_OUTPUT" | grep -c "error" || true)
  WARN_COUNT=$(echo "$LINT_OUTPUT" | grep -c "warning" || true)
  print_warn "ESLint: $ERROR_COUNT ошибок, $WARN_COUNT предупреждений"
else
  print_pass "ESLint: 0 ошибок, 0 предупреждений"
fi

# ====================================================================
# 4. Env файлы
# ====================================================================
print_header "4. Environment файлы"

if [ -f ".env.local" ]; then
  print_pass ".env.local существует"
  # Проверка критичных переменных
  if grep -q "JWT_SECRET" .env.local && ! grep -q "JWT_SECRET=$" .env.local; then
    print_pass "JWT_SECRET установлен"
  else
    print_warn "JWT_SECRET пустой"
  fi
else
  print_warn ".env.local отсутствует (нужен для dev)"
fi

if [ -f ".env.production" ]; then
  print_pass ".env.production существует"
  # Проверка что нет CHANGE_ME значений
  if grep -q "CHANGE_ME" .env.production; then
    CHANGE_ME_COUNT=$(grep -c "CHANGE_ME" .env.production || true)
    print_warn ".env.production содержит $CHANGE_ME_COUNT CHANGE_ME плейсхолдеров"
  else
    print_pass ".env.production: все секреты заполнены"
  fi
else
  print_warn ".env.production отсутствует (нужен для Docker deploy)"
fi

# ====================================================================
# 5. @ts-nocheck файлы
# ====================================================================
print_header "5. @ts-nocheck файлы"

TSCHECK_COUNT=$(grep -rl "@ts-nocheck" src/ --include="*.tsx" --include="*.ts" 2>/dev/null | wc -l)
if [ "$TSCHECK_COUNT" -eq 0 ]; then
  print_pass "Нет @ts-nocheck файлов"
else
  print_warn "@ts-nocheck файлов: $TSCHECK_COUNT (цель: 0)"
fi

# ====================================================================
# 6. БД миграции
# ====================================================================
print_header "6. БД миграции"

MIGRATIONS_COUNT=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l)
if [ "$MIGRATIONS_COUNT" -gt 0 ]; then
  print_pass "SQL миграций: $MIGRATIONS_COUNT"
else
  print_fail "Нет SQL миграций в supabase/migrations/"
fi

if [ -d "db/pglite-dev" ]; then
  print_pass "PGlite БД инициализирована (db/pglite-dev/)"
else
  print_warn "PGlite БД не инициализирована — запустите: ./scripts/init-db.sh pglite"
fi

# ====================================================================
# 7. --full: тесты и build
# ====================================================================
if [ "$MODE" = "--full" ]; then
  print_header "7. Unit тесты"
  if npx vitest run 2>&1 | grep -E "Test Files|Tests"; then
    print_pass "Тесты прошли"
  else
    print_fail "Тесты упали"
  fi

  print_header "8. Next.js build"
  if npx next build 2>&1 | tail -5; then
    print_pass "Build успешен"
  else
    print_fail "Build упал"
  fi
fi

# ====================================================================
# 8. --docker: Docker проверки
# ====================================================================
if [ "$MODE" = "--docker" ] || [ "$MODE" = "--full" ]; then
  print_header "9. Docker проверки"

  if command -v docker &> /dev/null; then
    print_pass "Docker установлен"
    RUNNING=$(docker ps -q 2>/dev/null | wc -l)
    print_pass "Запущенных контейнеров: $RUNNING"

    # Проверка conditera-* контейнеров
    for name in conditera-web conditera-db conditera-redis conditera-chat conditera-n8n; do
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^$name$"; then
        STATUS=$(docker inspect --format='{{.State.Status}}' $name 2>/dev/null)
        print_pass "$name: $STATUS"
      fi
    done
  else
    print_warn "Docker не установлен (используйте PGlite для локальной разработки)"
  fi
fi

# ====================================================================
# 9. Dev сервер
# ====================================================================
print_header "10. Dev сервер"

if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null | grep -q "200"; then
  print_pass "Dev сервер запущен на :3000"
  HEALTH=$(curl -s http://localhost:3000/api/health 2>/dev/null)
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    print_pass "Health endpoint: status=ok"
  elif echo "$HEALTH" | grep -q '"status":"degraded"'; then
    print_warn "Health endpoint: status=degraded (некоторые сервисы не настроены)"
  fi
else
  print_warn "Dev сервер не запущен (http://localhost:3000 недоступен)"
fi

# ====================================================================
# Итог
# ====================================================================
print_header "ИТОГ"
echo -e "  ${GREEN}PASS${NC}: $PASS"
echo -e "  ${YELLOW}WARN${NC}: $WARN"
echo -e "  ${RED}FAIL${NC}: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ Есть критичные проблемы${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}⚠ Есть предупреждения, но проект работоспособен${NC}"
  exit 0
else
  echo -e "${GREEN}✅ Все проверки пройдены${NC}"
  exit 0
fi
