#!/bin/bash
# Z-v20: рестарт-плюс-верификация (обход OOM: одна тяжёлая задача на инстанс dev-сервера)
cd /home/z/my-project
restart() {
  pkill -f "next-server" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  sleep 5
  nohup bun run dev:local >> /tmp/z20-cycle-dev.log 2>&1 &
  disown
  for i in $(seq 1 20); do sleep 3; curl -s -m 5 -o /dev/null http://127.0.0.1:3000/api/health && return 0; done
  return 1
}
run() {
  echo "════ $* ════"
  if ! curl -s -m 5 -o /dev/null http://127.0.0.1:3000/api/health; then
    restart || { echo "SERVER-UP-FAILED"; return; }
  fi
  timeout 280 "$@" 2>&1 | tail -4
  echo "--- post: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)"
}
run bun scripts/verify/ops-center-verify.mjs
run bun scripts/verify/upload-oversize-verify.mjs
run bun scripts/verify/u06-three-state-live.mjs
run bun scripts/verify/e2e-tally-contract.mjs
run bun scripts/verify/checkout-idempotency-verify.mjs
