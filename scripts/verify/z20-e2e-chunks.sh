#!/bin/bash
# Z-v20: порционный прогон chromium E2E в 4GB-песочнице (обход kernel-OOM).
# Между порциями — пауза (release памяти), проверка health, респаун при смерти.
cd /home/z/my-project
SPECS=(smoke.spec.ts api-v2.spec.ts auth-flow.spec.ts integration-auth-flow.spec.ts payment-webhook-idempotency.spec.ts recipe-purchase-flow.spec.ts regional-pricing.spec.ts onboarding-flow.spec.ts full-flow.spec.ts)
TOTAL_PASS=0; TOTAL_FAIL=0; TOTAL_SKIP=0
for spec in "${SPECS[@]}"; do
  # health-check, при смерти — ждём keeper/стартуем
  if ! curl -s -m 5 -o /dev/null http://127.0.0.1:3000/api/health; then
    echo ">>> server down before $spec — restarting"
    pkill -f "next-server" 2>/dev/null; pkill -f "next dev" 2>/dev/null; sleep 4
    nohup bun run dev:local >> /tmp/z20-dev-chunks.log 2>&1 &
    disown
    for i in $(seq 1 25); do sleep 4; curl -s -m 5 -o /dev/null http://127.0.0.1:3000/api/health && break; done
  fi
  curl -s -m 30 -o /dev/null "http://127.0.0.1:3000/" 2>/dev/null
  OUT=$(bunx playwright test --project=chromium --workers=1 --reporter=line "tests/e2e/$spec" 2>&1)
  P=$(echo "$OUT" | rg -o '^\s+(\d+) passed' -r '$1' | tail -1)
  F=$(echo "$OUT" | rg -o '^\s+(\d+) failed' -r '$1' | tail -1)
  S=$(echo "$OUT" | rg -o '^\s+(\d+) did not run' -r '$1' | tail -1)
  P=${P:-0}; F=${F:-0}; S=${S:-0}
  echo "$spec: passed=$P failed=$F skipped=$S"
  TOTAL_PASS=$((TOTAL_PASS+P)); TOTAL_FAIL=$((TOTAL_FAIL+F)); TOTAL_SKIP=$((TOTAL_SKIP+S))
  sleep 12
done
echo "=================================="
echo "AGGREGATE: passed=$TOTAL_PASS failed=$TOTAL_FAIL skipped=$TOTAL_SKIP"
