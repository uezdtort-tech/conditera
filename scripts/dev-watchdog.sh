#!/bin/bash
# scripts/dev-watchdog.sh — авторестарт dev-сервера, если среда его убила.
# Появился из-за особенности песочницы: фоновые процессы периодически
# умирают между командами (см. worklog: OOM-класс + sandbox process reaping).
# Запуск: setsid nohup bash scripts/dev-watchdog.sh > .zscripts/watchdog.log 2>&1 &
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

while true; do
  # deploy-gate: пока идёт деплой (маркер от .zscripts/start.sh, TTL 20 мин),
  # watchdog не трогает порт 3000 — иначе гонка с production server.js
  if [ -f /tmp/.deploy-in-progress ]; then
    now=$(date +%s); mark=$(stat -c %Y /tmp/.deploy-in-progress 2>/dev/null || echo 0)
    if [ $((now - mark)) -lt 1200 ]; then
      sleep 15; continue
    fi
    rm -f /tmp/.deploy-in-progress
  fi
  if ! curl -sf -o /dev/null --max-time 5 http://localhost:3000/; then
    echo "[$(date '+%F %T')] dev server down — restarting (dev:local)"
    # Убрать зомби на порту, если есть (fuser отсутствует в контейнере — lsof)
    for p in $(lsof -ti tcp:3000 2>/dev/null || true); do kill -KILL "$p" 2>/dev/null || true; done
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
