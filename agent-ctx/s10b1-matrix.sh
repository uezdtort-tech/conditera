#!/bin/bash
# S10B1 curl-матрица (СЦ-02 password reset / СЦ-61 idempotency / СЦ-09 webhook
# amount+currency / СЦ-54 спор-гейт + auto-complete skip). Паттерн s4b2-matrix.sh:
# всегда curl -b jar -c jar; каждый чек печатает [PASS]/[FAIL]; финальный счёт.
# XFF-изоляция rate-limit-бакетов pwreset (5/час/IP): сброс пароля гоняется с
# подменой X-Forwarded-For по секциям (клиентский IP-ключ rate-limit — по спеке).
set -u
BASE="http://127.0.0.1:3100"
ROOT="/home/z/my-project/conditera-v2"
DB="$ROOT/scripts/db/s10b1-dbcheck.mjs"
JAR="/tmp/s10b1-jar-customer.txt"
JAR_ADMIN="/tmp/s10b1-jar-admin.txt"
JAR_ANON="/tmp/s10b1-jar-anon.txt"
rm -f "$JAR" "$JAR_ADMIN" "$JAR_ANON"
PASS=0; FAIL=0
TOMORROW=$(date -u -d "+1 day" +%F)
CRON_SECRET=$(node -e "const fs=require('fs');const l=fs.readFileSync('$ROOT/.env.local','utf8').split('\n').find(x=>x.startsWith('CRON_SECRET='));process.stdout.write(l.slice('CRON_SECRET='.length).trim())")

ok()  { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad() { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }

csrf() {
  curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"
}

req() { # jar method path data use_csrf [extra headers...]
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  local n=5
  while [ $n -gt 0 ] && [ $# -gt 0 ]; do shift; n=$((n-1)); done
  local args=(-s -m 60 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf "$jar")")
  [ $# -gt 0 ] && args+=("$@")
  local out; out=$(curl "${args[@]}")
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

reqx() { # jar method path data xff [use_csrf]  — с X-Forwarded-For
  local jar="$1" method="$2" path="$3" data="${4:-}" xff="$5" use_csrf="${6:-no}"
  req "$jar" "$method" "$path" "$data" "$use_csrf" -H "X-Forwarded-For: $xff"
}

check() { # name expected_status haystack status body
  local name="$1" expected="$2" haystack="$3" status="$4" body="$5"
  if [ "$status" = "$expected" ] && printf '%s' "$body" | grep -q "$haystack"; then
    ok "$name"
  else
    bad "$name" "status=$status body=$(printf '%s' "$body" | head -c 220)"
  fi
}

jget() { printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)"; }

echo "=== 0. health ==="
out=$(req "$JAR_ANON" GET /api/health)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "health 200 app+db+auth ok" 200 '"app":"ok"' "$status" "$body"

echo "=== 1. СЦ-02 password reset (XFF 203.0.113.21) ==="
XFF1="203.0.113.21"
out=$(reqx "$JAR_ANON" POST /api/auth/password/reset '{"email":"customer@demo.ru"}' "$XFF1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "reset request 200 ok:true" 200 '"ok":true' "$status" "$body"
if printf '%s' "$body" | grep -q '"devToken"'; then ok "devToken присутствует (DEV_AUTH_SHIM=1)"; else bad "devToken" "body=$(printf '%s' "$body" | head -c 160)"; fi
TOKEN=$(jget "$body" "d.get('devToken','')")
dbout=$(node "$DB" reset-token "$TOKEN")
if printf '%s' "$dbout" | grep -q '"exists":true,"used":false,"expired":false'; then ok "DB: токен существует, не used, не expired (sha256)"; else bad "DB reset-token" "$dbout"; fi

out=$(reqx "$JAR_ANON" POST /api/auth/password/reset/confirm "{\"token\":\"$TOKEN\",\"password\":\"NewPass123!\"}" "$XFF1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "confirm 200 ok:true" 200 '"ok":true' "$status" "$body"
dbout=$(node "$DB" reset-token "$TOKEN")
if printf '%s' "$dbout" | grep -q '"used":true'; then ok "DB: токен помечен usedAt (одноразовость)"; else bad "DB usedAt" "$dbout"; fi

out=$(reqx /tmp/s10b1-jar-login.txt POST /api/auth/login '{"email":"customer@demo.ru","password":"NewPass123!"}' "$XFF1")
status=$(printf '%s' "$out" | head -1)
check "login с НОВЫМ паролем 200" 200 '"email":"customer@demo.ru"' "$status" "$(printf '%s' "$out" | tail -n +2)"

out=$(reqx /tmp/s10b1-jar-login.txt POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}' "$XFF1")
status=$(printf '%s' "$out" | head -1)
check "login со СТАРЫМ паролем 401" 401 'Неверный email' "$status" "$(printf '%s' "$out" | tail -n +2)"

out=$(reqx "$JAR_ANON" POST /api/auth/password/reset/confirm "{\"token\":\"$TOKEN\",\"password\":\"OtherPass456!\"}" "$XFF1")
status=$(printf '%s' "$out" | head -1)
check "повтор ТОГО ЖЕ токена 400 invalid_token" 400 'invalid_token' "$status" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 1b. СЦ-02 анти-перечисление + восстановление пароля (XFF 203.0.113.22) ==="
XFF2="203.0.113.22"
out=$(reqx "$JAR_ANON" POST /api/auth/password/reset '{"email":"nobody-unknown@demo.ru"}' "$XFF2")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "неизвестный email → 200 ok:true (анти-перечисление)" 200 '"ok":true' "$status" "$body"
if printf '%s' "$body" | grep -q '"devToken"'; then bad "анти-перечисление" "devToken не должен выдаваться"; else ok "devToken отсутствует для неизвестного email"; fi

out=$(reqx "$JAR_ANON" POST /api/auth/password/reset '{"email":"customer@demo.ru"}' "$XFF2")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
TOKEN2=$(jget "$body" "d.get('devToken','')")
check "повторный reset 200 (новый токен)" 200 '"ok":true' "$status" "$body"
out=$(reqx "$JAR_ANON" POST /api/auth/password/reset/confirm "{\"token\":\"$TOKEN2\",\"password\":\"Demo123!\"}" "$XFF2")
status=$(printf '%s' "$out" | head -1)
check "пароль восстановлен на Demo123! (confirm 200)" 200 '"ok":true' "$status" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 1c. СЦ-02 rate-limit 5/час/IP (XFF 203.0.113.23): 6-я попытка → 429 ==="
XFF3="203.0.113.23"
LAST_STATUS=""
for i in 1 2 3 4 5 6; do
  out=$(reqx "$JAR_ANON" POST /api/auth/password/reset '{"email":"rl-test@demo.ru"}' "$XFF3")
  LAST_STATUS=$(printf '%s' "$out" | head -1)
done
if [ "$LAST_STATUS" = "429" ]; then
  ok "6-я попытка reset → 429 rate_limited"
else
  bad "rate-limit pwreset" "status=$LAST_STATUS"
fi
RA=$(curl -s -o /dev/null -D - -X POST "$BASE/api/auth/password/reset" -H "X-Forwarded-For: $XFF3" -H "Content-Type: application/json" -d '{"email":"rl-test@demo.ru"}' | grep -i "^retry-after" | tr -d '\r')
if [ -n "$RA" ]; then ok "429 содержит Retry-After ($RA)"; else bad "Retry-After" "заголовок не найден"; fi

echo "=== 2. СЦ-61 idempotency (customer login + POST /api/orders) ==="
out=$(req "$JAR" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
check "login customer (Demo123! восстановлен) 200" 200 '"role":"CUSTOMER"' "$status" "$(printf '%s' "$out" | tail -n +2)"

PROD=$(node "$DB" product-available | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
IDEM_KEY="s10b1-idem-$(date +%s)"
ORD_BODY="{\"contact\":{\"name\":\"Демо Покупатель\",\"phone\":\"+79001234567\",\"email\":\"customer@demo.ru\"},\"delivery\":{\"method\":\"courier\",\"address\":\"Москва, Тверская 1\",\"date\":\"$TOMORROW\",\"slot\":\"13:00–16:00\"},\"items\":[{\"productId\":\"$PROD\",\"quantity\":1}]}"

out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf -H "Idempotency-Key: $IDEM_KEY")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "заказ с ключом (1-й) 201 duplicate:false" 201 '"duplicate":false' "$status" "$body"
ORDER1=$(jget "$body" "d['orderId']")
TOTAL1=$(jget "$body" "d['total']")
echo "    order1=$ORDER1 total=$TOTAL1 key=$IDEM_KEY"

out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf -H "Idempotency-Key: $IDEM_KEY")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
ORDER1B=$(jget "$body" "d['orderId']")
check "заказ с ТОТ ЖЕ ключом (2-й) 200 duplicate:true" 200 '"duplicate":true' "$status" "$body"
if [ "$ORDER1" = "$ORDER1B" ]; then ok "тот же orderId: $ORDER1B"; else bad "orderId разный" "$ORDER1 vs $ORDER1B"; fi

dbout=$(node "$DB" idempotency "$IDEM_KEY")
if printf '%s' "$dbout" | grep -q '"count":1'; then ok "DB: ровно один Order с этим ключом"; else bad "DB idempotency" "$dbout"; fi

out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf -H "Idempotency-Key: BAD KEY!!")
status=$(printf '%s' "$out" | head -1)
check "невалидный ключ → 400 invalid_idempotency_key" 400 'invalid_idempotency_key' "$status" "$(printf '%s' "$out" | tail -n +2)"

out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "без заголовка — как раньше 201" 201 '"status":"PENDING"' "$status" "$body"
ORDER2=$(jget "$body" "d['orderId']")
TOTAL2=$(jget "$body" "d['total']")
echo "    order2=$ORDER2 total=$TOTAL2 (для webhook СЦ-09)"

echo "=== 3. СЦ-09 webhook: amount/currency гейт (XFF 127.0.0.1) ==="
WH1="wh-mismatch-$(date +%s)"
AMOUNT_BAD=$(python3 -c "print(f'{$TOTAL1+12300:.2f}')")
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "{\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$WH1\",\"status\":\"succeeded\",\"amount\":{\"value\":\"$AMOUNT_BAD\",\"currency\":\"RUB\"},\"metadata\":{\"orderId\":\"$ORDER1\"}}}" no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "неверная сумма → 200 ignored:amount_mismatch" 200 '"ignored":"amount_mismatch"' "$status" "$body"
dbout=$(node "$DB" order "$ORDER1")
if printf '%s' "$dbout" | grep -q '"status":"PENDING"'; then ok "DB: заказ остался PENDING (не CONFIRMED)"; else bad "DB order status" "$dbout"; fi
dbout=$(node "$DB" webhook-event "$WH1")
if printf '%s' "$dbout" | grep -q '"reason":"amount_mismatch","hits":1'; then ok "DB: webhook_events amount_mismatch hits=1"; else bad "DB webhook-event" "$dbout"; fi
dbout=$(node "$DB" webhook-payments "$WH1")
if printf '%s' "$dbout" | grep -q '"count":0'; then ok "DB: Payment не создан"; else bad "DB payment" "$dbout"; fi
NOTIF1=$(node "$DB" reset-notifs-admin "$(date -u +%FT%TZ)")

out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "{\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$WH1\",\"status\":\"succeeded\",\"amount\":{\"value\":\"$AMOUNT_BAD\",\"currency\":\"RUB\"},\"metadata\":{\"orderId\":\"$ORDER1\"}}}" no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1)
check "ретрай той же доставки → 200 ignored (дедуп)" 200 'ignored' "$status" "$(printf '%s' "$out" | tail -n +2)"
dbout=$(node "$DB" webhook-event "$WH1")
if printf '%s' "$dbout" | grep -q '"hits":2'; then ok "DB: hits=2 (дедуп-строка та же)"; else bad "DB hits" "$dbout"; fi
NOTIF2=$(node "$DB" reset-notifs-admin "$(date -u +%FT%TZ)")
if [ "$NOTIF1" = "$NOTIF2" ]; then ok "админ-уведомление ТОЛЬКО на первую доставку (count=$NOTIF2)"; else bad "notif dedup" "$NOTIF1 → $NOTIF2"; fi

WH2="wh-currency-$(date +%s)"
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "{\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$WH2\",\"status\":\"succeeded\",\"amount\":{\"value\":\"$AMOUNT_BAD\",\"currency\":\"EUR\"},\"metadata\":{\"orderId\":\"$ORDER1\"}}}" no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "валюта EUR → 200 ignored:currency_mismatch" 200 '"ignored":"currency_mismatch"' "$status" "$body"
dbout=$(node "$DB" webhook-event "$WH2")
if printf '%s' "$dbout" | grep -q '"reason":"currency_mismatch"'; then ok "DB: webhook_events currency_mismatch"; else bad "DB currency" "$dbout"; fi

AMOUNT_OK=$(python3 -c "print(f'{$TOTAL1/100:.2f}')")
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "{\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$WH1\",\"status\":\"succeeded\",\"amount\":{\"value\":\"$AMOUNT_OK\",\"currency\":\"RUB\"},\"metadata\":{\"orderId\":\"$ORDER1\"}}}" no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "верная сумма → 200 ok (полный путь)" 200 '"ok":true' "$status" "$body"
dbout=$(node "$DB" order "$ORDER1")
if printf '%s' "$dbout" | grep -q '"status":"CONFIRMED"'; then ok "DB: заказ CONFIRMED"; else bad "DB order" "$dbout"; fi
dbout=$(node "$DB" webhook-payments "$WH1")
if printf '%s' "$dbout" | grep -q '"succeeded":1'; then ok "DB: Payment succeeded=1"; else bad "DB payment succeeded" "$dbout"; fi

echo "=== 4. СЦ-54 спор-гейт: admin DELIVERED → ticket → confirm 409 → close → 200 ==="
out=$(req "$JAR_ADMIN" POST /api/auth/login '{"email":"admin@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
check "login admin 200" 200 '"role":"ADMIN"' "$status" "$(printf '%s' "$out" | tail -n +2)"

for TO in PREPARING READY DELIVERED; do
  out=$(req "$JAR_ADMIN" POST "/api/admin/orders/$ORDER1/transition" "{\"to\":\"$TO\"}" csrf)
  status=$(printf '%s' "$out" | head -1)
  check "admin transition → $TO" 200 "\"to\":\"$TO\"" "$status" "$(printf '%s' "$out" | tail -n +2)"
done

out=$(req "$JAR" POST /api/tickets "{\"orderId\":\"$ORDER1\",\"category\":\"order_issue\",\"subject\":\"Спор по заказу из матрицы\",\"body\":\"Проверка спор-гейта S10B1: товар повреждён при доставке, требуем разбирательства.\"}" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "создан открытый тикет 201" 201 '"status":"open"' "$status" "$body"
TICKET1=$(jget "$body" "d['id']")

out=$(req "$JAR" POST "/api/orders/$ORDER1/confirm" "" csrf)
status=$(printf '%s' "$out" | head -1)
check "confirm при открытом споре → 409 dispute_open" 409 '"error":"dispute_open"' "$status" "$(printf '%s' "$out" | tail -n +2)"
dbout=$(node "$DB" order "$ORDER1")
if printf '%s' "$dbout" | grep -q '"status":"DELIVERED"'; then ok "DB: заказ остался DELIVERED"; else bad "DB order" "$dbout"; fi

out=$(req "$JAR_ADMIN" POST "/api/admin/orders/$ORDER1/transition" '{"to":"COMPLETED"}' csrf)
status=$(printf '%s' "$out" | head -1)
check "admin COMPLETED при открытом споре → 409 dispute_open (гейт и для админа)" 409 '"error":"dispute_open"' "$status" "$(printf '%s' "$out" | tail -n +2)"

out=$(req "$JAR" POST "/api/tickets/$TICKET1/close" "" csrf)
status=$(printf '%s' "$out" | head -1)
check "тикет закрыт покупателем 200" 200 '"status":"closed"' "$status" "$(printf '%s' "$out" | tail -n +2)"

out=$(req "$JAR" POST "/api/orders/$ORDER1/confirm" "" csrf)
status=$(printf '%s' "$out" | head -1)
check "confirm после закрытия спора → 200 COMPLETED" 200 '"status":"COMPLETED"' "$status" "$(printf '%s' "$out" | tail -n +2)"
dbout=$(node "$DB" escrow "$ORDER1")
if printf '%s' "$dbout" | grep -q '"status":"released"'; then ok "DB: Escrow released (эскроу выпущен)"; else bad "DB escrow" "$dbout"; fi

echo "=== 5. СЦ-54 auto-complete: DELIVERED с открытым спором — skip ==="
out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
ORDER3=$(jget "$body" "d['orderId']")
TOTAL3=$(jget "$body" "d['total']")
WH3="wh-autocomplete-$(date +%s)"
AMOUNT3=$(python3 -c "print(f'{$TOTAL3/100:.2f}')")
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "{\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$WH3\",\"status\":\"succeeded\",\"amount\":{\"value\":\"$AMOUNT3\",\"currency\":\"RUB\"},\"metadata\":{\"orderId\":\"$ORDER3\"}}}" no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1)
check "order3 оплачен webhook → CONFIRMED" 200 '"ok":true' "$status" "$(printf '%s' "$out" | tail -n +2)"
for TO in PREPARING READY DELIVERED; do
  req "$JAR_ADMIN" POST "/api/admin/orders/$ORDER3/transition" "{\"to\":\"$TO\"}" csrf >/dev/null
done
out=$(req "$JAR" POST /api/tickets "{\"orderId\":\"$ORDER3\",\"category\":\"delivery\",\"subject\":\"Спор для auto-complete\",\"body\":\"Проверка skippedDisputes S10B1: заказ не должен завершиться автоматически.\"}" csrf)
TICKET3=$(printf '%s' "$out" | tail -n +2 | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
node "$DB" backdate-order "$ORDER3" 200 >/dev/null
CRON_OUT=$(curl -s -m 60 -X POST "$BASE/api/cron/auto-complete" -H "X-Cron-Secret: $CRON_SECRET" -H "X-Forwarded-For: 127.0.0.1")
if printf '%s' "$CRON_OUT" | grep -q '"skippedDisputes"'; then ok "cron: метрика skippedDisputes присутствует"; else bad "cron skippedDisputes" "$(printf '%s' "$CRON_OUT" | head -c 160)"; fi
SKIPPED=$(printf '%s' "$CRON_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('skippedDisputes',-1))" 2>/dev/null)
if [ "${SKIPPED:-0}" -ge 1 ]; then ok "cron: skippedDisputes=$SKIPPED (>=1)"; else bad "cron skippedDisputes value" "$SKIPPED"; fi
dbout=$(node "$DB" order "$ORDER3")
if printf '%s' "$dbout" | grep -q '"status":"DELIVERED"'; then ok "DB: order3 остался DELIVERED (не завершён cron'ом)"; else bad "DB order3" "$dbout"; fi
dbout=$(node "$DB" cron escrow-auto-release)
if printf '%s' "$dbout" | grep -q 'skippedDisputes'; then ok "DB: CronRun.metadata содержит skippedDisputes"; else bad "DB CronRun.metadata" "$dbout"; fi
node "$DB" ticket-close "$TICKET3" >/dev/null

echo ""
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ]
