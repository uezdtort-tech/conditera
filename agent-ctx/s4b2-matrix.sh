#!/bin/bash
# S4B2 curl-matrix (gates). ALWAYS curl -b jar -c jar together (lesson S4B1).
# Каждый чек печатает [PASS]/[FAIL]; финальный счёт PASS/FAIL.
set -u
BASE="http://127.0.0.1:3100"
JAR="/tmp/s4b2-jar-customer.txt"
JAR_ADMIN="/tmp/s4b2-jar-admin.txt"
JAR_ANON="/tmp/s4b2-jar-anon.txt"
rm -f "$JAR" "$JAR_ADMIN" "$JAR_ANON"
PASS=0; FAIL=0

PROD1="013c31ba-7e06-48d6-93d3-6546b395c3d0"          # prod-demo-03, 340000 kop

ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }

csrf() { # jar -> token
  curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"
}

req() { # jar method path data csrf_flag extra_headers...
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  # сдвигаем РОВНО 5 именованных аргументов (если переданы) — остальное заголовки
  local n=5
  while [ $n -gt 0 ] && [ $# -gt 0 ]; do shift; n=$((n-1)); done
  local args=(-s -m 60 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf "$jar")")
  [ $# -gt 0 ] && args+=("$@")
  local out; out=$(curl "${args[@]}")
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

check() { # name expected_status haystack status body
  local name="$1" expected="$2" haystack="$3" status="$4" body="$5"
  if [ "$status" = "$expected" ] && printf '%s' "$body" | grep -q "$haystack"; then
    ok "$name"
  else
    bad "$name" "status=$status body=$(printf '%s' "$body" | head -c 200)"
  fi
}

jget() { # json -> python expr
  printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)"
}

TOMORROW=$(date -u -d "+1 day" +%F)
echo "=== 0. health ==="
out=$(req "$JAR_ANON" GET /api/health)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "health 200 database ok" 200 '"database":"ok"' "$status" "$body"

echo "=== 1. login customer ==="
out=$(req "$JAR" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
if [ "$status" = "200" ]; then ok "login customer 200"; else bad "login customer" "status=$status body=$(printf '%s' "$out" | tail -n +2 | head -c 150)"; fi

echo "=== 2. POST /api/orders (S4B1 contract) → 201 orderId ==="
ORD_BODY="{\"contact\":{\"name\":\"Демо Покупатель\",\"phone\":\"+79001234567\",\"email\":\"customer@demo.ru\"},\"delivery\":{\"method\":\"courier\",\"address\":\"Москва, Тверская 1\",\"date\":\"$TOMORROW\",\"slot\":\"13:00–16:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}]}"
out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "create order 201 PENDING" 201 '"status":"PENDING"' "$status" "$body"
ORDER1=$(jget "$body" "d['orderId']")
TOTAL1=$(jget "$body" "d['total']")
ORDER_NUM1=$(jget "$body" "d['number']")
echo "    order1=$ORDER1 number=$ORDER_NUM1 total=$TOTAL1"

out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "create order2 201" 201 '"status":"PENDING"' "$status" "$body"
ORDER2=$(jget "$body" "d['orderId']")
TOTAL2=$(jget "$body" "d['total']")
echo "    order2=$ORDER2 total=$TOTAL2"

out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "create order3 201" 201 '"status":"PENDING"' "$status" "$body"
ORDER3=$(jget "$body" "d['orderId']")
echo "    order3=$ORDER3"

out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "create order4 201 (остаётся PENDING для browser-теста)" 201 '"status":"PENDING"' "$status" "$body"
ORDER4=$(jget "$body" "d['orderId']")
echo "    order4=$ORDER4"
echo "$ORDER4" > /tmp/s4b2-order4.txt

echo "=== 3. pay: anon (чистая кука) ==="
out=$(req "$JAR_ANON" POST "/api/orders/$ORDER1/pay" '{}' no)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "pay anon no-csrf → 403 csrf" 403 '"error":"csrf"' "$status" "$body"

out=$(req "$JAR_ANON" POST "/api/orders/$ORDER1/pay" '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "pay anon with-csrf → 401" 401 'error' "$status" "$body"

echo "=== 4. pay: foreign order (seed demo order чужого покупателя) → 404 ==="
FOREIGN=$(export $(grep -E '^DATABASE_URL=' /home/z/my-project/conditera-v2/.env.local | head -1); cd /home/z/my-project/conditera-v2 && bun -e '
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const r = await c.query("SELECT \"orderId\" FROM payments WHERE id = $1", ["pay-demo-0001"]);
  console.log(r.rows[0] ? r.rows[0].orderId : "");
  await c.end();
}).catch(() => console.log(""));')
echo "    foreign order=$FOREIGN"
out=$(req "$JAR" POST "/api/orders/$FOREIGN/pay" '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "pay foreign → 404 not_found" 404 '"error":"not_found"' "$status" "$body"

echo "=== 5. pay: owner + CSRF → 200 succeeded, orderStatus CONFIRMED ==="
out=$(req "$JAR" POST "/api/orders/$ORDER1/pay" '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "pay owner 200 succeeded" 200 '"status":"succeeded"' "$status" "$body"
check "pay owner orderStatus CONFIRMED" 200 '"orderStatus":"CONFIRMED"' "$status" "$body"
check "pay owner confirmationUrl null" 200 '"confirmationUrl":null' "$status" "$body"
PAYMENT1=$(jget "$body" "d['paymentId']")
echo "    payment1=$PAYMENT1"

echo "=== 6. GET /api/orders/[id] ==="
out=$(req "$JAR" GET "/api/orders/$ORDER1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "GET order owner 200 number" 200 "\"number\":\"$ORDER_NUM1\"" "$status" "$body"
check "GET order paymentStatus succeeded" 200 '"paymentStatus":"succeeded"' "$status" "$body"
check "GET order totals.total" 200 "\"total\":$TOTAL1" "$status" "$body"

out=$(req "$JAR_ANON" GET "/api/orders/$ORDER1")
status=$(printf '%s' "$out" | head -1)
check "GET order anon → 401" 401 'error' "$status" "$(printf '%s' "$out" | tail -n +2)"

out=$(req "$JAR" GET "/api/orders/$FOREIGN")
status=$(printf '%s' "$out" | head -1)
check "GET foreign order → 404" 404 '"error":"not_found"' "$status" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 7. DB-проверка оплаты order1 ==="
DBOUT=$(export $(grep -E '^DATABASE_URL=' /home/z/my-project/conditera-v2/.env.local | head -1); cd /home/z/my-project/conditera-v2 && bun -e '
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const pay = await c.query("SELECT id, provider, \"providerPaymentId\", amount, status, \"idempotencyKey\" FROM payments WHERE \"orderId\" = $1 ORDER BY \"createdAt\"", ["'"$ORDER1"'"]);
  const led = await c.query("SELECT kind, amount, \"balanceAfter\" FROM balance_ledger WHERE \"refType\" = $1 AND \"refId\" = $2 ORDER BY \"createdAt\", id", ["order", "'"$ORDER1"'"]);
  const ev = await c.query("SELECT \"from\", \"to\", \"actorRole\", meta FROM order_events WHERE \"orderId\" = $1 ORDER BY \"createdAt\"", ["'"$ORDER1"'"]);
  const ord = await c.query("SELECT status, \"paymentStatus\" FROM orders WHERE id = $1", ["'"$ORDER1"'"]);
  console.log(JSON.stringify({ pay: pay.rows, led: led.rows, ev: ev.rows, ord: ord.rows[0] }));
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });')
echo "$DBOUT" | python3 -c '
import sys, json
d = json.load(sys.stdin)
ok = True
pay = d["pay"]; led = d["led"]; ev = d["ev"]; ordv = d["ord"]
if len(pay) == 1 and pay[0]["provider"] == "mock" and pay[0]["status"] == "succeeded" and pay[0]["idempotencyKey"] == "mock-pay-'"$ORDER1"'" and pay[0]["amount"] == '"$TOTAL1"' and (pay[0]["providerPaymentId"] or "").startswith("mock-"):
    print("[PASS] db: Payment mock/succeeded/idempotencyKey/amount")
else:
    ok = False; print("[FAIL] db: Payment", json.dumps(pay))
# Спека S4B2: пара topup(+total)/payment(-total); balanceAfter = предыдущий
# баланс + amount (непрерывность). Абсолютное значение НЕ фиксируем — у
# демо-пользователя есть история проводок прежних прогонов (инвариант
# баланса — последняя проводка, см. PAYMENTS.md §4).
if (len(led) == 2 and led[0]["kind"] == "topup" and led[0]["amount"] == '"$TOTAL1"'
    and led[1]["kind"] == "payment" and led[1]["amount"] == -'"$TOTAL1"'
    and led[1]["balanceAfter"] == led[0]["balanceAfter"] - '"$TOTAL1"'
    and led[0]["balanceAfter"] >= '"$TOTAL1"'):
    print("[PASS] db: ledger pair topup+payment, amounts+continuity ok (balanceAfter=", led[1]["balanceAfter"], ")")
else:
    ok = False; print("[FAIL] db: ledger", json.dumps(led))
conf = [e for e in ev if e["from"] == "PENDING" and e["to"] == "CONFIRMED" and e["actorRole"] == "CUSTOMER"]
if len(conf) == 1:
    print("[PASS] db: OrderEvent PENDING→CONFIRMED (CUSTOMER, via mock-pay)")
else:
    ok = False; print("[FAIL] db: PENDING→CONFIRMED events", json.dumps(ev))
if ordv and ordv["status"] == "CONFIRMED" and ordv["paymentStatus"] == "succeeded":
    print("[PASS] db: order CONFIRMED/paymentStatus succeeded")
else:
    ok = False; print("[FAIL] db: order", json.dumps(ordv))
sys.exit(0 if ok else 1)'
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

echo "=== 8. повтор pay на том же заказе → 409 invalid_state ==="
out=$(req "$JAR" POST "/api/orders/$ORDER1/pay" '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "repeat pay → 409 invalid_state" 409 '"error":"invalid_state"' "$status" "$body"

echo "=== 9. webhook: источник вне YOOKASSA_WEBHOOK_IPS → 403 ==="
# УНИКАЛЬНЫЙ id платежа на прогон (урок recreate-3: фиксированный wh-test-001
# из прошлого прогона даёт duplicate:true с нулём side-effects — это КОРРЕКТНОЕ
# поведение идемпотентности, но тест не увидит полный путь).
WH_ID="wh-test-$(date +%s)-$RANDOM"
WH_BODY='{"event":"payment.succeeded","object":{"id":"'"$WH_ID"'","status":"succeeded","amount":{"value":"'"$(python3 -c "print(f'{$TOTAL2/100:.2f}')")"'","currency":"RUB"},"metadata":{"orderId":"'"$ORDER2"'"}}}'
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "$WH_BODY" no -H "X-Forwarded-For: 8.8.8.8")
status=$(printf '%s' "$out" | head -1)
check "webhook spoofed 8.8.8.8 → 403 forbidden_source" 403 '"error":"forbidden_source"' "$status" "$(printf '%s' "$out" | tail -n +2)"

# Примечание: прямой curl к dev :3100 идёт через встроенный dev-proxy Next,
# который сам ставит X-Forwarded-For: 127.0.0.1 — кейс «no-XFF/unknown» локально
# невоспроизводим (в prod XFF перезаписывает edge-прокси, см. PAYMENTS.md).

echo "=== 9.5 webhook: payment.canceled ДО существования платежа → 400 missing_order ==="
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa '{"event":"payment.canceled","object":{"id":"wh-test-nopay","status":"canceled"}}' no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1)
check "webhook canceled unknown payment → 400 missing_order" 400 '"error":"missing_order"' "$status" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 10. webhook: payment.succeeded из 127.0.0.1, дважды (идемпотентность) ==="
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "$WH_BODY" no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "webhook ok first" 200 '"ok":true' "$status" "$body"
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa "$WH_BODY" no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "webhook duplicate second" 200 '"duplicate":true' "$status" "$body"

out=$(req "$JAR" GET "/api/orders/$ORDER2")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "webhook order2 paymentStatus succeeded" 200 '"paymentStatus":"succeeded"' "$status" "$body"
check "webhook order2 status CONFIRMED" 200 '"status":"CONFIRMED"' "$status" "$body"

echo "=== 11. webhook: payment.canceled на CONFIRMED-заказе → 200 ignored ==="
out=$(req "$JAR_ANON" POST /api/webhooks/yookassa '{"event":"payment.canceled","object":{"id":"'"$WH_ID"'","status":"canceled"}}' no -H "X-Forwarded-For: 127.0.0.1")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "webhook canceled on CONFIRMED → ignored state" 200 '"ignored":"state"' "$status" "$body"

out=$(req "$JAR" GET "/api/orders/$ORDER2")
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "order2 остаётся CONFIRMED" 200 '"status":"CONFIRMED"' "$status" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 12. webhook: DB — у order2 ровно 1 OrderEvent и пара ledger (без дублей) ==="
DBOUT2=$(export $(grep -E '^DATABASE_URL=' /home/z/my-project/conditera-v2/.env.local | head -1); cd /home/z/my-project/conditera-v2 && bun -e '
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const ev = await c.query("SELECT count(*)::int AS n FROM order_events WHERE \"orderId\" = $1 AND \"from\" = $2 AND \"to\" = $3", ["'"$ORDER2"'", "PENDING", "CONFIRMED"]);
  const led = await c.query("SELECT count(*)::int AS n FROM balance_ledger WHERE \"refType\" = $1 AND \"refId\" = $2", ["order", "'"$ORDER2"'"]);
  const fin = await c.query("SELECT count(*)::int AS n FROM financial_ledger WHERE \"orderId\" = $1", ["'"$ORDER2"'"]);
  const pay = await c.query("SELECT count(*)::int AS n FROM payments WHERE \"providerPaymentId\" = $1", ["'"$WH_ID"'"]);
  console.log(JSON.stringify({ ev: ev.rows[0].n, led: led.rows[0].n, fin: fin.rows[0].n, pay: pay.rows[0].n }));
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });')
echo "$DBOUT2" | python3 -c '
import sys, json
d = json.load(sys.stdin)
ok = d["ev"] == 1 and d["led"] == 2 and d["fin"] == 1 and d["pay"] == 1
print(("[PASS]" if ok else "[FAIL]") + " db: webhook idempotency ev=1 led=2 fin=1 pay=1 → " + json.dumps(d))
sys.exit(0 if ok else 1)'
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

echo "=== 13. admin refund: customer → 403, admin → 200 ==="
out=$(req "$JAR" POST "/api/admin/payments/$PAYMENT1/refund" '{"reason":"тест покупателя"}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "refund by customer → 403" 403 'error' "$status" "$body"

out=$(req "$JAR_ADMIN" POST /api/auth/login '{"email":"admin@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
if [ "$status" = "200" ]; then ok "login admin 200"; else bad "login admin" "status=$status"; fi

out=$(req "$JAR_ADMIN" POST "/api/admin/payments/$PAYMENT1/refund" '{"reason":"Возврат по договорённости"}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "refund admin 200 refunded" 200 '"status":"refunded"' "$status" "$body"
check "refund admin orderStatus REFUNDED" 200 '"orderStatus":"REFUNDED"' "$status" "$body"
REFUND_ID=$(jget "$body" "d['refundId']")
echo "    refundId=$REFUND_ID"

out=$(req "$JAR_ADMIN" POST "/api/admin/payments/$PAYMENT1/refund" '{"reason":"повтор"}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "repeat refund → 409 invalid_state" 409 '"error":"invalid_state"' "$status" "$body"

echo "=== 14. DB-проверка refund ==="
DBOUT3=$(export $(grep -E '^DATABASE_URL=' /home/z/my-project/conditera-v2/.env.local | head -1); cd /home/z/my-project/conditera-v2 && bun -e '
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const rf = await c.query("SELECT id, amount, status, \"idempotencyKey\", \"processedBy\" IS NOT NULL AS has_proc FROM refunds WHERE id = $1", ["'"$REFUND_ID"'"]);
  const pay = await c.query("SELECT status FROM payments WHERE id = $1", ["'"$PAYMENT1"'"]);
  const led = await c.query("SELECT kind, amount, \"balanceAfter\" FROM balance_ledger WHERE \"refType\" = $1 AND \"refId\" = $2 AND kind = $3", ["order", "'"$ORDER1"'", "refund"]);
  const ev = await c.query("SELECT \"from\", \"to\", \"actorRole\" FROM order_events WHERE \"orderId\" = $1 ORDER BY \"createdAt\" DESC LIMIT 1", ["'"$ORDER1"'"]);
  const fin = await c.query("SELECT \"entryType\", amount FROM financial_ledger WHERE \"refundId\" = $1", ["'"$REFUND_ID"'"]);
  const ord = await c.query("SELECT status FROM orders WHERE id = $1", ["'"$ORDER1"'"]);
  console.log(JSON.stringify({ rf: rf.rows[0], pay: pay.rows[0], led: led.rows[0], ev: ev.rows[0], fin: fin.rows[0], ord: ord.rows[0] }));
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });')
echo "$DBOUT3" | python3 -c '
import sys, json
d = json.load(sys.stdin)
ok = True
if d["rf"] and d["rf"]["amount"] == '"$TOTAL1"' and d["rf"]["status"] == "completed" and d["rf"]["idempotencyKey"] == "refund-'"$PAYMENT1"'" and d["rf"]["has_proc"]:
    print("[PASS] db: Refund row completed/idempotencyKey/processedBy")
else:
    ok = False; print("[FAIL] db: refund", json.dumps(d["rf"]))
if d["pay"] and d["pay"]["status"] == "refunded":
    print("[PASS] db: Payment refunded")
else:
    ok = False; print("[FAIL] db: payment", json.dumps(d["pay"]))
if d["led"] and d["led"]["kind"] == "refund" and d["led"]["amount"] == '"$TOTAL1"':
    print("[PASS] db: ledger refund row +" + str('"$TOTAL1"'))
else:
    ok = False; print("[FAIL] db: ledger refund", json.dumps(d["led"]))
if d["ev"] and d["ev"]["from"] == "CONFIRMED" and d["ev"]["to"] == "REFUNDED" and d["ev"]["actorRole"] == "ADMIN":
    print("[PASS] db: OrderEvent CONFIRMED→REFUNDED (ADMIN)")
else:
    ok = False; print("[FAIL] db: event", json.dumps(d["ev"]))
if d["fin"] and d["fin"]["entryType"] == "refund_confirmed" and float(d["fin"]["amount"]) == -'"$TOTAL1"'/100:
    print("[PASS] db: financial refund_confirmed")
else:
    ok = False; print("[FAIL] db: financial", json.dumps(d["fin"]))
if d["ord"] and d["ord"]["status"] == "REFUNDED":
    print("[PASS] db: order REFUNDED")
else:
    ok = False; print("[FAIL] db: order", json.dumps(d["ord"]))
sys.exit(0 if ok else 1)'
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

echo "=== 15. burst pay 11x (ORDERS_PAY_RULE 10/мин/user) → 429 + Retry-After ==="
BURST_429=""
for i in $(seq 1 11); do
  resp=$(curl -s -m 60 -b "$JAR" -c "$JAR" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR")" -D /tmp/s4b2-burst-headers.txt -o /dev/null -w '%{http_code}' "$BASE/api/orders/$ORDER3/pay")
  if [ "$resp" = "429" ] && [ -z "$BURST_429" ]; then
    BURST_429="$i"
  fi
done
RA=$(grep -i '^retry-after:' /tmp/s4b2-burst-headers.txt | tr -d '\r' | awk '{print $2}')
if [ -n "$BURST_429" ] && [ -n "$RA" ]; then
  ok "burst → 429 на попытке #$BURST_429 + Retry-After: $RA"
else
  bad "burst 429" "first429=$BURST_429 retryAfter=$RA"
fi

echo "=== 16. контроль burst-окна: pay order3 после 429 → снова 429 rate_limited ==="
out=$(req "$JAR" POST "/api/orders/$ORDER3/pay" '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "order3 pay в burst-окне → 429 rate_limited" 429 '"error":"rate_limited"' "$status" "$body"

echo ""
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="
exit 0
