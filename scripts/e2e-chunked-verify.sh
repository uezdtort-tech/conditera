#!/bin/bash
# scripts/e2e-chunked-verify.sh — Этап 10 (повторная верификация):
# чанковый прогон описаний (test.describe) с рестартом dev-сервера перед каждым
# чанком. Причина: в текущем состоянии sandbox (меньше свободной памяти, чем в
# Этапе 9/10) dev-сервер получает OOM-kill посреди полного спека — все падения
# ECONNREFUSED, не продуктовые. Метод из worklog Этапа 9 («smoke 8+3,
# full-flow 7+3+20+6»), воспроизводимый и без правок тестов.
#
# Использование:
#   bash scripts/e2e-chunked-verify.sh <spec> "<grep1>" "<grep2>" ...
#   bash scripts/e2e-chunked-verify.sh smoke "Smoke tests" "Mobile responsive"
#
# Gate 16 (фикс harness): --grep у Playwright — РЕГУЛЯРНОЕ ВЫРАЖЕНИЕ; неэкранированные
# скобки/символы в названиях describe (например «(контракт)») ломали матчинг →
# «No tests found» и ложный exit=1 (наблюдалось в Gate 15 дважды). Паттерн теперь
# экранируется (см. grep_escaped). Также исправлен итоговый echo ($spec → $SPEC,
# «unbound variable» — скрипт падал в конце даже на зелёном прогоне).
set -u
cd /home/z/my-project
SPEC="$1"; shift
CHUNKS=("$@")
TOTAL_P=0; TOTAL_F=0; TOTAL_S=0

for c in "${CHUNKS[@]}"; do
  echo "=== CHUNK: $c ==="
  pkill -f "next-server" 2>/dev/null; pkill -f "next dev" 2>/dev/null
  sleep 2
  bash scripts/ensure-dev.sh > /dev/null 2>&1
  curl -s -o /dev/null --max-time 90 http://127.0.0.1:3000/ || { echo "SERVER FAILED TO START (see dev.log)"; TOTAL_F=$((TOTAL_F+1)); continue; }
  safe=$(echo "$c" | tr -c 'a-zA-Z0-9' '_' | cut -c1-40)
  logf="/tmp/e2e-chunk-${SPEC}-${safe}.log"
  # Экранирование regex-метасимволов: ( ) [ ] . * + ? ^ $ { } | \
  grep_escaped=$(printf '%s' "$c" | sed -e 's/[][\.*^$()+?{|}]/\\&/g')
  bunx playwright test --project=chromium "tests/e2e/$SPEC.spec.ts" --grep "$grep_escaped" > "$logf" 2>&1
  rc=$?
  summary=$(grep -E "[0-9]+ (passed|failed|skipped|flaky)" "$logf" | tail -1 | tr '\n' ' ')
  oom=$(dmesg 2>/dev/null | grep -c "Out of memory: Killed process")
  echo "CHUNK '$c': exit=$rc | $summary| OOM-total=$oom | log=$logf"
  p=$(grep -oE "[0-9]+ passed" "$logf" | grep -oE "[0-9]+" | head -1); p=${p:-0}
  f=$(grep -oE "[0-9]+ failed" "$logf" | grep -oE "[0-9]+" | head -1); f=${f:-0}
  s=$(grep -oE "[0-9]+ skipped" "$logf" | grep -oE "[0-9]+" | head -1); s=${s:-0}
  TOTAL_P=$((TOTAL_P+p)); TOTAL_F=$((TOTAL_F+f)); TOTAL_S=$((TOTAL_S+s))
done
echo "=== SPEC $SPEC TOTAL: passed=$TOTAL_P failed=$TOTAL_F skipped=$TOTAL_S ==="
if [ "$TOTAL_F" -gt 0 ]; then exit 1; fi
exit 0
