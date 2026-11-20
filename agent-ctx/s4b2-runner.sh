#!/bin/bash
# S4B2 runner: restart dev → pre-warm → curl-matrix → yookassa fail-closed
# → финальный рестарт (сброс limiter) → browser-гейт. ОДИН вызов (урок №1).
set -u
cd /home/z/my-project/conditera-v2
CTX="/home/z/my-project/agent-ctx"
BASE="http://127.0.0.1:3100"

restart_dev() {
  # Убиваем ТОЛЬКО dev conditera-v2 (:3100) — не трогаем :3000 системного
  # my-project (урок R-CONT: pkill -f "next dev" убивает чужие процессы).
  for pid in $(ss -ltnp 2>/dev/null | grep ':3100' | grep -oP 'pid=\K[0-9]+' | sort -u); do
    pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  done
  sleep 3
  rm -f .next/dev/lock
  env -u DATABASE_URL bun run dev > /tmp/dev-v2.log 2>&1 &
  for i in $(seq 1 90); do
    if curl -sf -m 3 "$BASE/api/health" > /dev/null 2>&1; then echo "[runner] dev healthy (attempt $i)"; return 0; fi
    sleep 2
  done
  echo "[runner] dev FAILED to become healthy"; tail -20 /tmp/dev-v2.log; return 1
}

echo "=== R1. restart dev ==="
restart_dev || exit 1

echo "=== R2. pre-warm роутов (Turbopack компиляция до матрицы) ==="
for p in "/api/health" "/api/csrf" "/api/orders" "/api/orders/00000000-0000-0000-0000-000000000000" "/api/orders/00000000-0000-0000-0000-000000000000/pay" "/api/webhooks/yookassa" "/api/admin/payments/00000000-0000-0000-0000-000000000000/refund"; do
  code=$(curl -s -o /dev/null -m 120 -w '%{http_code}' "$BASE$p")
  echo "  warm $p → $code"
done
for p in "/account/orders" "/checkout/success?orderId=00000000-0000-0000-0000-000000000000"; do
  code=$(curl -s -o /dev/null -m 120 -w '%{http_code}' "$BASE$p")
  echo "  warm $p → $code"
done
curl -s -o /dev/null -m 30 -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"customer@demo.ru","password":"Demo123!"}' && echo "  warm login done"

echo "=== R3. curl-matrix ==="
bash "$CTX/s4b2-matrix.sh" 2>&1 | tee /tmp/s4b2-matrix-out.log
MATRIX_TAIL=$(tail -1 /tmp/s4b2-matrix-out.log)
echo "[runner] $MATRIX_TAIL"

echo "=== R4. yookassa fail-closed (PAYMENTS_MODE=yookassa без ключей) ==="
sed -i 's/^PAYMENTS_MODE=mock/PAYMENTS_MODE=yookassa/' .env.local
restart_dev || exit 1
bash "$CTX/s4b2-yookassa-failclosed.sh" 2>&1 | tee /tmp/s4b2-failclosed-out.log
sed -i 's/^PAYMENTS_MODE=yookassa/PAYMENTS_MODE=mock/' .env.local
echo "[runner] env restored: $(grep -c '^PAYMENTS_MODE=mock' .env.local) mock-lines"

echo "=== R5. финальный рестарт (сброс in-memory limiter) ==="
restart_dev || exit 1

echo "=== R6. browser-гейт ==="
bash "$CTX/s4b2-browser.sh" 2>&1 | tee /tmp/s4b2-browser-out.log
BROWSER_TAIL=$(tail -1 /tmp/s4b2-browser-out.log)
echo "[runner] $BROWSER_TAIL"

echo "=== R7. dev.log ошибки ==="
grep -iE "error|unhandled|panicked" /tmp/dev-v2.log | grep -v "Compiled" | tail -8 || echo "(нет error-строк)"
echo "=== RUNNER DONE ==="
