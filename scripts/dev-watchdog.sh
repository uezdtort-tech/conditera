#!/bin/bash
# dev-watchdog.sh — рестарт Next dev при тихой смерти песочницы (reaper/daemon-killer).
# Режимы:
#   ./dev-watchdog.sh loop  — вечный цикл проверки (для ручного запуска)
#   ./dev-watchdog.sh once  — одна проверка: поднять dev, если мёртв, дождаться 200
# Диагноз 2026-11-02: процесс умирает молча (без dmesg-OOM и без лога) за ~минуту
# даже в простое; chat-server (bun --hot) при этом живёт — периодический reaper песочницы.

cd "$(dirname "$0")/.." || exit 1

ensure_dev() {
  if ! pgrep -f "next dev" > /dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] next dev отсутствует — рестарт" >> /tmp/watchdog.log
    NODE_OPTIONS="--max-old-space-size=1792" setsid bun run dev >> /tmp/next-dev.log 2>&1 < /dev/null &
  fi
  # Дождаться готовности (до ~60с)
  for i in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health --max-time 5 2>/dev/null)
    [ "$code" = "200" ] && return 0
    sleep 3
  done
  return 1
}

if [ "${1:-loop}" = "once" ]; then
  ensure_dev
  exit $?
fi

while true; do
  ensure_dev
  sleep 5
done
