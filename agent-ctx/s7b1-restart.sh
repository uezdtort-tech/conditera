#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s7b1-restart.sh — рестарт conditera-v2 dev :3100
# с логом в /tmp/dev-v2.log (гейт S7B1: grep provider/action/ms по этому файлу).
# Окружение: .env.local экспортируется ЦЕЛИКОМ перед стартом (shell-сессия
# несёт мусорный DATABASE_URL, который иначе перебивает .env.local в Next).
# Секреты не печатаются.
# =============================================================================
set -u
CONDITERA="/home/z/my-project/conditera-v2"
LOG="/tmp/dev-v2.log"

# Убить текущий next-server (:3100).
pkill -f "next-server" 2>/dev/null || true
for i in $(seq 1 10); do
  ss -ltn 2>/dev/null | grep -q ":3100 " || break
  sleep 1
done

cd "$CONDITERA"
set -a
. ./.env.local
set +a
setsid nohup bun run dev >> "$LOG" 2>&1 < /dev/null &

for i in $(seq 1 40); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3100/ 2>/dev/null)
  if [ "$code" != "000" ] && [ "$code" != "" ]; then
    echo "dev :3100 ready after $((i*2))s ($code)"
    exit 0
  fi
done
echo "ERROR: dev :3100 failed to start"
exit 1
