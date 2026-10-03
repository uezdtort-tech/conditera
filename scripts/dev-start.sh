#!/usr/bin/env bash
# ============================================================================
# scripts/dev-start.sh — ЕДИНЫЙ dev-старт «Уездного кондитера».
#
# Одна команда поднимает согласованную среду:
#   1. Dev-секреты (JWT_SECRET/JWT_REFRESH_SECRET/BOT_SECRET/CRON_SECRET) —
#      генерируются в .env при отсутствии. ВАЖНО: один и тот же JWT_SECRET
#      получают Next API (getUserFromRequest) и socket.io чат-сервер
#      (handshake auth) — иначе real-time чат отбивает токены.
#   2. Локальный Supabase — если установлен supabase CLI и запущен Docker:
#      `supabase start` (без Studio) + выгрузка ключей в .env.local.
#      Если НЕ доступен — честный WARN и работа в dev-fallback режиме:
#      demo-вход через /api/auth/login (настоящая JWT-сессия, src/lib/dev-auth.ts).
#   3. Socket.io чат-сервер (mini-services/chat-server, порт 3030).
#   4. Next.js dev-сервер (bun run dev:local, порт 3000).
#   5. Health-проверки и сводка.
#
# Запуск:  bash scripts/dev-start.sh
# Остановка: kill по PID из .zscripts/dev-start.pids (или Ctrl-C в форграунде)
# ============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
PIDS_FILE="$PROJECT_DIR/.zscripts/dev-start.pids"
mkdir -p .zscripts
: > "$PIDS_FILE"

log()  { printf '\033[1;35m[dev-start]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dev-start][WARN]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[dev-start][OK]\033[0m %s\n' "$*"; }

# --- Генератор случайного hex (openssl или /dev/urandom) --------------------
rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# === Шаг 1. Dev-секреты ======================================================
ensure_secret() {
  local name="$1" len="$2"
  if ! grep -qE "^${name}=" .env 2>/dev/null || \
     [ -z "$(grep -E "^${name}=" .env | head -1 | cut -d= -f2-)" ]; then
    printf '%s=%s\n' "$name" "$(rand_hex "$len")" >> .env
    log "Сгенерирован $name в .env"
  fi
}
ensure_secret JWT_SECRET 32
ensure_secret JWT_REFRESH_SECRET 32
ensure_secret BOT_SECRET 24
ensure_secret CRON_SECRET 24
# Экспортируем секреты в окружение для дочерних процессов (чат-сервер)
set -a; . ./.env 2>/dev/null || true; set +a
ok "JWT-секреты консолидированы (Next API и чат-сервер используют один JWT_SECRET)"

# === Шаг 2. Локальный Supabase (если доступен) ==============================
SUPABASE_AVAILABLE=0
if command -v supabase >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    log "Запуск локального Supabase (supabase start, без Studio)…"
    if supabase start -x studio >/dev/null 2>&1 || supabase start >/dev/null 2>&1; then
      # `supabase status -o env` выдаёт KEY=VALUE — кладём в .env.local
      supabase status -o env 2>/dev/null | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|SUPABASE_ANON_KEY)=' \
        > .env.local || true
      set -a; . ./.env.local 2>/dev/null || true; set +a
      SUPABASE_AVAILABLE=1
      ok "Локальный Supabase запущен, ключи выгружены в .env.local"
      log "Применение миграций supabase/migrations (init-scripts/01-apply-migrations.sh)…"
      bash supabase/init-scripts/01-apply-migrations.sh 2>/dev/null \
        && ok "Миграции применены" \
        || warn "Миграции не применились автоматически — примените вручную по docs/PRODUCTION_MIGRATION_PLAN.md"
    else
      warn "supabase start завершился с ошибкой — продолжаем без Supabase"
    fi
  else
    warn "Docker недоступен — локальный Supabase не запускаем"
  fi
else
  warn "supabase CLI не установлен — локальный Supabase недоступен"
fi

if [ "$SUPABASE_AVAILABLE" -eq 0 ]; then
  warn "DEV-FALLBACK режим: demo-вход customer@demo.ru / demo123 (src/lib/dev-auth.ts)."
  warn "Данные Supabase-стека (заказы/тикеты в БД) в этом режиме недоступны — это среда для UI/чата/auth."
fi

# === Шаг 3. Socket.io чат-сервер (:3030) ====================================
start_chat_server() {
  # Освободить порт 3030
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -ti tcp:3030 2>/dev/null || true)
    if [ -n "$pids" ]; then
      warn "Порт 3030 занят (PIDs: $pids) — перезапускаем чат-сервер с консолидированным JWT_SECRET"
      kill -KILL $pids 2>/dev/null || true
      sleep 1
    fi
  fi
  log "Старт чат-сервера (mini-services/chat-server, :3030, bun --hot)…"
  ( cd "$PROJECT_DIR/mini-services/chat-server" \
      && [ -d node_modules ] || bun install --silent \
      && nohup bun --hot index.ts > "$PROJECT_DIR/.zscripts/chat-server.log" 2>&1 \
      & echo $! >> "$PIDS_FILE" )
  for i in $(seq 1 20); do
    if curl -sf --max-time 2 http://127.0.0.1:3030/health >/dev/null 2>&1; then
      ok "Чат-сервер отвечает на :3030 (/health)"
      return 0
    fi
    sleep 1
  done
  warn "Чат-сервер не поднялся за 20с — лог: .zscripts/chat-server.log"
}
start_chat_server

# === Шаг 4. Next.js dev-сервер (:3000) ======================================
if curl -sf -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
  ok "Next.js уже слушает :3000 — не трогаем (перезапуск вручную, если нужен свежий .env)"
else
  log "Старт Next.js dev (bun run dev:local, :3000)…"
  nohup bun run dev:local >> dev.log 2>&1 &
  echo $! >> "$PIDS_FILE"
  for i in $(seq 1 60); do
    if curl -sf -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
      ok "Next.js отвечает на :3000"
      break
    fi
    sleep 2
  done
fi

# === Шаг 5. Сводка ===========================================================
cat <<EOF

============================================================
 🚀 Среда «Уездного кондитера» запущена
   • Приложение:      http://localhost:3000
   • Чат-сервер:      http://localhost:3030/health (socket.io path "/")
   • Supabase:        $([ "$SUPABASE_AVAILABLE" -eq 1 ] && echo "локальный запущен" || echo "НЕ запущен (dev-fallback auth)")
   • Demo-вход:       customer@demo.ru / demo123 (или кнопки в модалке)
   • Проверка auth:   curl -s http://localhost:3000/api/health
   • PID-файл:        .zscripts/dev-start.pids  |  Логи: dev.log, .zscripts/chat-server.log
============================================================
EOF
