#!/bin/bash
# S6B2 ensure: поднять conditera-v2 dev :3100 и chat-service :3030, если умерли.
# Паттерн S6B1: bun-процессы сессии периодически убиваются песочницей —
# каждый гейт-вызов начинается с ensure.

LOGDIR=/home/z/my-project/.zscripts
CONDITERA=/home/z/my-project/conditera-v2

ensure_dev() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3100/ 2>/dev/null)
  if [ "$code" != "000" ] && [ "$code" != "" ]; then
    echo "dev :3100 alive ($code)"
    return 0
  fi
  echo "dev :3100 dead — restarting"
  # ВАЖНО: shell-окружение сессии несёт мусорный DATABASE_URL=file:… (скэффолд
  # my-project) — он ПЕРЕБИВАЕТ .env.local в Next. Экспортируем .env.local
  # целиком перед стартом (секреты не печатаются).
  cd "$CONDITERA" && set -a && . ./.env.local && set +a && setsid nohup bun run dev > "$LOGDIR/conditera-dev-3100.log" 2>&1 < /dev/null &
  for i in $(seq 1 40); do
    sleep 2
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3100/ 2>/dev/null)
    if [ "$code" != "000" ] && [ "$code" != "" ]; then
      echo "dev :3100 ready after $((i*2))s ($code)"
      return 0
    fi
  done
  echo "ERROR: dev :3100 failed to start"
  return 1
}

ensure_chat() {
  local health
  health=$(curl -s --max-time 3 http://localhost:3030/health 2>/dev/null)
  if [[ "$health" == *'"status":"ok"'* ]]; then
    echo "chat-service :3030 alive"
    return 0
  fi
  echo "chat-service :3030 dead — restarting"
  cd "$CONDITERA/mini-services/chat-service"
  eval "$(rg -N '^DATABASE_URL=' ../../.env.local | head -1)" setsid nohup bun run dev > "$LOGDIR/mini-service-chat-service.log" 2>&1 < /dev/null &
  for i in $(seq 1 20); do
    sleep 2
    health=$(curl -s --max-time 3 http://localhost:3030/health 2>/dev/null)
    if [[ "$health" == *'"status":"ok"'* ]]; then
      echo "chat-service :3030 ready after $((i*2))s"
      return 0
    fi
  done
  echo "ERROR: chat-service :3030 failed to start"
  return 1
}

ensure_dev
ensure_chat
