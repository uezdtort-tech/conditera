#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s6b2-matrix.sh — S6B2 curl-matrix (гейт 2).
#
# Все curl — с cookie-jar (-b jar -c jar). Секреты (CRON_SECRET, INBOUND_SECRET)
# читаются из .env.local молча и НЕ печатаются. Демо-креды — публичные спеки
# (customer/confectioner/admin@demo.ru, Demo123!).
#
# Сценарий (спека S6B2): health → 3 логина → заказ (POST /api/orders) → pay
# mock → Notification order_paid + .outbox без <script> → переход вендора
# (CONFIRMED→PREPARING) → order_status_changed покупателю → переход админа
# (PREPARING→READY) → второй order_status_changed → inbound: нет заголовка
# 401 / неверный секрет 403 / верный секрет + script-html 200 + БД-строка
# sanitized (no "<script") → тикеты: create → foreign 404 (GET/reply/close) →
# admin reply 200 + ticket_replied уведомление + outbox → thread 200 → user
# reply → close → read-all → unread 0 → cron reminders: без секрета 403 / с
# секретом 200 + backdate-заказ → reminded ≥1 → повтор → dedupe (reminded 0) →
# burst: 6-й create подряд → 429 + Retry-After → render / /catalog /support.
# =============================================================================
set -u
BASE="http://localhost:3100"
PROJ="/home/z/my-project/conditera-v2"
PASS=0; FAIL=0
RUN_EPOCH=$(date +%s000)
RUN_STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 — $2"; }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label" "got [$got], want [$want]"; fi; }

# --- dev-server lift (процессы умирают между вызовами) ------------------------
bash /home/z/my-project/.zscripts/s6b2-ensure.sh

JAR_C="/tmp/s6b2-jar-customer.txt"
JAR_V="/tmp/s6b2-jar-vendor.txt"
JAR_A="/tmp/s6b2-jar-admin.txt"
rm -f "$JAR_C" "$JAR_V" "$JAR_A"

csrf() { curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"; }

req() { # jar method path data csrf_flag -> "<code>\n<body>"
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  local args=(-s -m 90 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf "$jar")")
  local out; out=$(curl "${args[@]}")
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
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
dbcheck() { (cd "$PROJ" && set -a && . ./.env.local && set +a && bun scripts/db/s6b2-dbcheck.ts "$@" 2>/dev/null); }

TOMORROW=$(date -u -d "+1 day" +%F)
PROD1="013c31ba-7e06-48d6-93d3-6546b395c3d0"  # prod-demo-03 (кондитер demo)

echo "=== 0. health ==="
out=$(req "$JAR_C" GET /api/health)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "health 200 database ok" 200 '"database":"ok"' "$status" "$body"
chat_health=$(curl -s --max-time 5 http://localhost:3030/health)
case "$chat_health" in *'"status":"ok"'*) ok "chat-service :3030 ok";; *) bad "chat-service :3030" "$chat_health";; esac

echo "=== 1. logins ==="
out=$(req "$JAR_C" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "login customer 200" "$status" "200"
out=$(req "$JAR_V" POST /api/auth/login '{"email":"confectioner@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "login vendor 200" "$status" "200"
out=$(req "$JAR_A" POST /api/auth/login '{"email":"admin@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "login admin 200" "$status" "200"

echo "=== 2. заказ + pay mock → order_paid ==="
ORD_BODY="{\"contact\":{\"name\":\"Демо Покупатель\",\"phone\":\"+79001234567\",\"email\":\"customer@demo.ru\"},\"delivery\":{\"method\":\"courier\",\"address\":\"Москва, Тверская 1\",\"date\":\"$TOMORROW\",\"slot\":\"13:00–16:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}]}"
out=$(req "$JAR_C" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "create order 201 PENDING" 201 '"status":"PENDING"' "$status" "$body"
ORDER1=$(jget "$body" "d['orderId']")
echo "    order1=$ORDER1"

out=$(req "$JAR_C" POST "/api/orders/$ORDER1/pay" '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "pay mock 200 succeeded" 200 '"status":"succeeded"' "$status" "$body"

sleep 2
N_PAID=$(dbcheck notif PAYMENT_SUCCEEDED "$RUN_STAMP")
assert_eq "Notification order_paid (PAYMENT_SUCCEEDED) создана" "$N_PAID" "1"
LEAK=$(dbcheck outbox-script order_paid "$RUN_EPOCH")
assert_eq "outbox order_paid: файлов с <script>" "$LEAK" "0"
OUT_FILES=$(dbcheck outbox order_paid "$RUN_EPOCH")
if [ "$OUT_FILES" -ge 1 ]; then ok "outbox order_paid файлов: $OUT_FILES"; else bad "outbox order_paid" "файлы не найдены"; fi

echo "=== 3. переход вендора CONFIRMED→PREPARING → order_status_changed ==="
out=$(req "$JAR_V" POST "/api/vendor/orders/$ORDER1/status" '{"to":"PREPARING"}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "vendor transition 200" 200 '"to":"PREPARING"' "$status" "$body"
sleep 2
N_STATUS=$(dbcheck notif ORDER_STATUS_CHANGED "$RUN_STAMP")
if [ "$N_STATUS" -ge 1 ]; then ok "Notification order_status_changed (vendor): $N_STATUS"; else bad "order_status_changed vendor" "count=$N_STATUS"; fi

echo "=== 4. переход админа PREPARING→READY → второй order_status_changed ==="
out=$(req "$JAR_A" POST "/api/admin/orders/$ORDER1/transition" '{"to":"READY"}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "admin transition 200" 200 '"to":"READY"' "$status" "$body"
sleep 2
N_STATUS2=$(dbcheck notif ORDER_STATUS_CHANGED "$RUN_STAMP")
if [ "$N_STATUS2" -ge 2 ]; then ok "Notification order_status_changed (admin) итого: $N_STATUS2"; else bad "order_status_changed admin" "count=$N_STATUS2"; fi

echo "=== 5. inbound email intake ==="
INBOUND_SECRET=$(rg -N '^INBOUND_SECRET=' "$PROJ/.env.local" | head -1 | cut -d= -f2)
out=$(curl -s -m 30 -w '\n%{http_code}' -X POST -H "Content-Type: application/json" \
  -d '{"from":"scammer@example.ru","subject":"XSS probe","html":"<p>ok</p>"}' "$BASE/api/email/inbound")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
check "inbound без заголовка → 401" 401 '"error":"inbound_unauthorized"' "$status" "$body"

out=$(curl -s -m 30 -w '\n%{http_code}' -X POST -H "Content-Type: application/json" \
  -H "X-Inbound-Secret: test-wrong-secret-value" \
  -d '{"from":"scammer@example.ru","subject":"XSS probe","html":"<p>ok</p>"}' "$BASE/api/email/inbound")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
check "inbound неверный секрет → 403" 403 '"error":"inbound_forbidden"' "$status" "$body"

XSS_HTML='<p>Привет из шлюза</p><script>window.__xss=true;</script><img src=x onerror="window.__xss2=true"><a href="javascript:alert(1)">link</a><b>bold ok</b>'
out=$(curl -s -m 30 -w '\n%{http_code}' -X POST -H "Content-Type: application/json" \
  -H "X-Inbound-Secret: $INBOUND_SECRET" \
  -d "{\"from\":\"sender@example.ru\",\"fromName\":\"Почтовый шлюз\",\"subject\":\"S6B2 intake probe\",\"html\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$XSS_HTML"),\"text\":\"plain variant\",\"attachments\":[\"receipt.pdf\"]}" \
  "$BASE/api/email/inbound")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
check "inbound верный секрет + script-html → 200" 200 '"ok":true' "$status" "$body"
INBOUND_ID=$(jget "$body" "d['id']")
SAN=$(dbcheck inbound-sanitized "$INBOUND_ID")
case "$SAN" in
  *'"hasScript": false'*) ok "DB-строка sanitized (no <script): $SAN";;
  *) bad "inbound sanitized" "$SAN";;
esac
case "$SAN" in
  *'"status": "new"'*|*'"status":"new"'*) ok "inbound status=new";;
  *) bad "inbound status" "$SAN";;
esac

echo "=== 6. тикеты: cycle + foreign 404 ==="
out=$(req "$JAR_C" POST /api/tickets '{"subject":"Не пришёл ответ по заказу","body":"Создаю обращение через curl-matrix S6B2: опишите проблему подробно."}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "ticket create 201" 201 '"ok":true' "$status" "$body"
TICKET_ID=$(jget "$body" "d['id']")
TICKET_NUM=$(jget "$body" "d['number']")
echo "    ticket=$TICKET_ID ($TICKET_NUM)"

out=$(req "$JAR_V" GET "/api/tickets/$TICKET_ID")
status=$(printf '%s' "$out" | head -1)
check "foreign GET ticket → 404" 404 '"error":"not_found"' "$status" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_V" POST "/api/tickets/$TICKET_ID/reply" '{"body":"чужой ответ"}' csrf)
status=$(printf '%s' "$out" | head -1)
check "foreign reply → 404" 404 '"error":"not_found"' "$status" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_V" POST "/api/tickets/$TICKET_ID/close" '{}' csrf)
status=$(printf '%s' "$out" | head -1)
check "foreign close → 404" 404 '"error":"not_found"' "$status" "$(printf '%s' "$out" | tail -n +2)"

out=$(req "$JAR_A" POST "/api/admin/tickets/$TICKET_ID/reply" '{"message":"Ответ поддержки: проверяем заказ, ответим в течение часа."}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "admin reply 200 (open→in_progress)" 200 '"statusAfter":"in_progress"' "$status" "$body"
sleep 2
N_TICKET=$(dbcheck notif-user customer@demo.ru SUPPORT_REPLY)
if [ "$N_TICKET" -ge 1 ]; then ok "Notification ticket_replied у покупателя: $N_TICKET"; else bad "ticket_replied notification" "count=$N_TICKET"; fi
OUT_TICKET=$(dbcheck outbox ticket_replied "$RUN_EPOCH")
if [ "$OUT_TICKET" -ge 1 ]; then ok "outbox ticket_replied файлов: $OUT_TICKET"; else bad "outbox ticket_replied" "файлы не найдены"; fi

out=$(req "$JAR_C" GET "/api/tickets/$TICKET_ID")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "owner GET thread 200 (2 сообщения)" 200 '"authorRole":"support"' "$status" "$body"

out=$(req "$JAR_C" POST "/api/tickets/$TICKET_ID/reply" '{"body":"Спасибо, жду уточнения по срокам."}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "customer reply 200 (staff-last → open)" 200 '"ok":true' "$status" "$body"

out=$(req "$JAR_C" POST "/api/tickets/$TICKET_ID/close" '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "customer close 200" 200 '"status":"closed"' "$status" "$body"

echo "=== 7. unread-count + read-all ==="
out=$(req "$JAR_C" GET /api/notifications/unread-count)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "unread-count 200" 200 '"count"' "$status" "$body"
UNREAD_BEFORE=$(jget "$body" "d['count']")
if [ "$UNREAD_BEFORE" -ge 1 ]; then ok "unread до read-all: $UNREAD_BEFORE"; else bad "unread before" "$UNREAD_BEFORE"; fi

out=$(req "$JAR_C" POST /api/notifications/read-all '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "read-all 200" 200 '"updated"' "$status" "$body"
out=$(req "$JAR_C" GET /api/notifications/unread-count)
body=$(printf '%s' "$out" | tail -n +2)
UNREAD_AFTER=$(jget "$body" "d['count']")
assert_eq "unread после read-all" "$UNREAD_AFTER" "0"

echo "=== 8. cron payment-reminders ==="
out=$(curl -s -m 30 -w '\n%{http_code}' "$BASE/api/cron/payment-reminders")
status=$(printf '%s' "$out" | tail -1)
check "cron без секрета → 403" 403 '"error":"forbidden"' "$status" "$(printf '%s' "$out" | sed '$d')"

CRON_SECRET=$(rg -N '^CRON_SECRET=' "$PROJ/.env.local" | head -1 | cut -d= -f2)
out=$(curl -s -m 30 -w '\n%{http_code}' -H "X-Cron-Secret: $CRON_SECRET" "$BASE/api/cron/payment-reminders")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
check "cron с секретом → 200" 200 '"hours"' "$status" "$body"

# Backdate-заказ → напоминание обязательно создаётся, повтор — дедуп.
out=$(req "$JAR_C" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "order для reminder 201" 201 '"status":"PENDING"' "$status" "$body"
ORDER2=$(jget "$body" "d['orderId']")
dbcheck backdate-order "$ORDER2" 48 > /dev/null
REM0=$(dbcheck notif-reminders customer@demo.ru)
out=$(curl -s -m 60 -w '\n%{http_code}' -H "X-Cron-Secret: $CRON_SECRET" "$BASE/api/cron/payment-reminders")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
check "cron прогон 2 → 200" 200 '"reminded"' "$status" "$body"
REM1=$(dbcheck notif-reminders customer@demo.ru)
if [ "$REM1" -gt "$REM0" ]; then ok "PAYMENT_REMINDER создан ($REM0 → $REM1)"; else bad "reminder создан" "$REM0 → $REM1"; fi
out=$(curl -s -m 60 -w '\n%{http_code}' -H "X-Cron-Secret: $CRON_SECRET" "$BASE/api/cron/payment-reminders")
body=$(printf '%s' "$out" | sed '$d')
REM2=$(dbcheck notif-reminders customer@demo.ru)
DEDUPED=$(jget "$body" "d['skippedDuplicates']")
assert_eq "cron прогон 3 — дедуп (reminders не растут)" "$REM2" "$REM1"
if [ "$DEDUPED" -ge 1 ]; then ok "skippedDuplicates: $DEDUPED"; else bad "skippedDuplicates" "$DEDUPED"; fi

echo "=== 9. burst: 6-й create → 429 + Retry-After ==="
LAST_CODE=""; RETRY=""
for i in 1 2 3 4 5 6; do
  out=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -b "$JAR_C" -c "$JAR_C" -X POST \
    -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR_C")" \
    -d '{"subject":"Burst-тест темы","body":"Тело burst-теста S6B2 — проверка rate-limit."}' \
    "$BASE/api/tickets")
  LAST_CODE=$out
done
RETRY=$(curl -s -m 30 -D - -o /dev/null -b "$JAR_C" -c "$JAR_C" -X POST \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR_C")" \
  -d '{"subject":"Burst-тест темы","body":"Тело burst-теста S6B2 — проверка rate-limit."}' \
  "$BASE/api/tickets" | rg -i '^retry-after:' | head -1)
assert_eq "burst tickets create → 429" "$LAST_CODE" "429"
case "$RETRY" in
  *Retry-After*|*retry-after*) ok "Retry-After присутствует ($RETRY)";;
  *) bad "Retry-After" "заголовок не найден";;
esac

echo "=== 10. render ==="
for path in "/" "/catalog" "/support"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 -b "$JAR_C" -c "$JAR_C" "$BASE$path")
  assert_eq "render $path" "$code" "200"
done

echo ""
echo "=================================="
echo "S6B2 MATRIX: PASS=$PASS FAIL=$FAIL"
echo "=================================="
[ "$FAIL" = "0" ] && exit 0 || exit 1
