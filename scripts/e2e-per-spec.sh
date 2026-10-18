#!/bin/bash
# scripts/e2e-per-spec.sh — per-spec E2E runner with dev-server hygiene
# for memory-constrained sandbox (4 GB). Operational tool: см. worklog Этап 9.
#
# Перезапускает dev-сервер перед каждым спеком: долго живущий dev-сервер
# накапливает память компиляции Turbopack (~60-100 MB на маршрут, весь граф
# приложения ~1.25 GB уже на `/`) и получает OOM-kill посреди прогона, когда
# браузер делит с ним один 4 GB бюджет. Рестарты дёшевы: Turbopack FS-кэш
# отключён (next.config.ts), ensure-dev.sh чистит разросшийся кэш.
#
# Использование:
#   bash scripts/e2e-per-spec.sh                          # все 9 спеков
#   bash scripts/e2e-per-spec.sh smoke auth-flow          # подмножество
set -u
cd /home/z/my-project

if [ $# -gt 0 ]; then
  SPECS=("$@")
else
  SPECS=(smoke auth-flow full-flow integration-auth-flow onboarding-flow recipe-purchase-flow regional-pricing payment-webhook-idempotency api-v2)
fi
OOM_BEFORE=$(dmesg 2>/dev/null | grep -c "Out of memory: Killed process")

for spec in "${SPECS[@]}"; do
  echo "=== SPEC $spec ==="
  # Свежий сервер на каждый спек (managed lifecycle сохраняет chat-server)
  pkill -f "next-server" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  sleep 2
  bash scripts/ensure-dev.sh > /dev/null 2>&1
  # Прогрев графа приложения до старта браузера (каждый тест открывает /)
  curl -s -o /dev/null --max-time 90 http://127.0.0.1:3000/ || { echo "SPEC $spec: SERVER FAILED TO START (see dev.log)"; continue; }

  bunx playwright test --project=chromium "tests/e2e/$spec.spec.ts" > "/tmp/e2e-$spec.log" 2>&1
  rc=$?
  summary=$(grep -E "[0-9]+ (passed|failed|skipped|did not run)" "/tmp/e2e-$spec.log" | tail -2 | tr '\n' ' ')
  pid=$(pgrep -f "next-server" | head -1)
  rss=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{print int($1/1024)}')
  echo "SPEC $spec: exit=$rc | $summary| server RSS=${rss:-DEAD} MB"
done

OOM_AFTER=$(dmesg 2>/dev/null | grep -c "Out of memory: Killed process")
echo "=== OOM kills: before=$OOM_BEFORE after=$OOM_AFTER ==="
