#!/bin/bash
# scripts/dev-watchdog.sh — авторестарт dev-сервера, если среда его убила.
# Появился из-за особенности песочницы: фоновые процессы периодически
# умирают между командами (см. worklog: OOM-класс + sandbox process reaping).
# Запуск: setsid nohup bash scripts/dev-watchdog.sh > .zscripts/watchdog.log 2>&1 &
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

while true; do
  if ! curl -sf -o /dev/null --max-time 5 http://localhost:3000/; then
    echo "[$(date '+%F %T')] dev server down — restarting (dev:local)"
    # Убрать зомби на порту, если есть
    fuser -k 3000/tcp 2>/dev/null || true
    sleep 1
    setsid nohup bun run dev:local >> dev.log 2>&1 < /dev/null &
    # Ждать готовности до ~90с (первая компиляция turbopack медленная)
    for i in $(seq 1 45); do
      sleep 2
      curl -sf -o /dev/null --max-time 5 http://localhost:3000/ && break
    done
    curl -sf -o /dev/null --max-time 5 http://localhost:3000/ \
      && echo "[$(date '+%F %T')] dev server UP" \
      || echo "[$(date '+%F %T')] dev server STILL DOWN"
  fi
  sleep 15
done
