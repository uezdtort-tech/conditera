#!/bin/bash
# S4B2 fail-closed check: PAYMENTS_MODE=yookassa без ключей → POST pay → 503.
# Требует запущенный dev :3100 с уже переключённым env (делает runner).
set -u
BASE="http://127.0.0.1:3100"
JAR="/tmp/s4b2-jar-fc.txt"
rm -f "$JAR"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }
csrf() { curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"; }

out=$(curl -s -m 60 -b "$JAR" -c "$JAR" -X POST -H "Content-Type: application/json" -w '\n%{http_code}' "$BASE/api/auth/login" -d '{"email":"customer@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | tail -1)
if [ "$status" = "200" ]; then ok "login 200"; else bad "login" "status=$status"; fi

PROD1="013c31ba-7e06-48d6-93d3-6546b395c3d0"
TOMORROW=$(date -u -d "+1 day" +%F)
ORD_BODY="{\"contact\":{\"name\":\"Демо Покупатель\",\"phone\":\"+79001234567\",\"email\":\"customer@demo.ru\"},\"delivery\":{\"method\":\"courier\",\"address\":\"Москва, Тверская 1\",\"date\":\"$TOMORROW\",\"slot\":\"13:00–16:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}]}"
out=$(curl -s -m 60 -b "$JAR" -c "$JAR" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR")" -w '\n%{http_code}' "$BASE/api/orders" -d "$ORD_BODY")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
ORDER=$(printf '%s' "$body" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('orderId',''))")
if [ "$status" = "201" ] && [ -n "$ORDER" ]; then ok "order created 201 ($ORDER)"; else bad "order" "status=$status"; fi

out=$(curl -s -m 60 -b "$JAR" -c "$JAR" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR")" -w '\n%{http_code}' "$BASE/api/orders/$ORDER/pay" -d '{}')
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
if [ "$status" = "503" ] && printf '%s' "$body" | grep -q '"error":"payment_provider_unavailable"'; then
  ok "pay yookassa без ключей → 503 payment_provider_unavailable (fail-closed)"
else
  bad "pay fail-closed" "status=$status body=$(printf '%s' "$body" | head -c 150)"
fi

echo "=== fail-closed итог: PASS=$PASS FAIL=$FAIL ==="
