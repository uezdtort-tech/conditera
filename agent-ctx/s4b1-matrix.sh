#!/bin/bash
# S4B1 curl-matrix (gates). ALWAYS curl -b jar -c jar (lesson: -c без -b
# стирает jar → ложные 401). Каждый чек печатает [PASS]/[FAIL].
set -u
BASE="http://127.0.0.1:3100"
JAR="/tmp/s4b1-matrix-jar.txt"
rm -f "$JAR"
PASS=0; FAIL=0; SKIP=0

PROD1="013c31ba-7e06-48d6-93d3-6546b395c3d0"          # prod-demo-03, 340000 kop
PROD2="0bdf541b-af0d-40cd-b80f-e3cbc5e911a6"          # prod-demo-15, 69000 kop
PROD_UNAV="14fe9792-9da8-4a29-b245-3c3cd58210ef"      # prod-demo-22, unavailable
PROD1_PRICE=340000

ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }
skip() { SKIP=$((SKIP+1)); echo "[SKIP] $1"; }

csrf() {
  local jar="${ANON_JAR:-$JAR}"
  curl -s -b "$jar" -c "$jar" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"
}

req() { # method path data csrf_flag -> prints "STATUS\nBODY"
  local jar="${ANON_JAR:-$JAR}"   # ANON_JAR — проверки анонима на чистой кущей
  local method="$1" path="$2" data="${3:-}" use_csrf="${4:-no}"
  local args=(-s -m 20 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf)")
  local out; out=$(curl "${args[@]}")
  local body status
  status=$(printf '%s' "$out" | tail -1)
  body=$(printf '%s' "$out" | sed '$d')
  printf '%s\n%s\n' "$status" "$body"
}

check() { # name expected_status haystack status body
  local name="$1" expected="$2" haystack="$3" status="$4" body="$5"
  if [ "$status" = "$expected" ] && printf '%s' "$body" | grep -q "$haystack"; then
    ok "$name"
  else
    bad "$name" "status=$status body=$(printf '%s' "$body" | head -c 220)"
  fi
}

extract() { # json-field-expr via python from LAST line of out
  printf '%s' "$1" | tail -1 | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)"
}

TOMORROW=$(date -u -d "+1 day" +%F)
YESTERDAY=$(date -u -d "-1 day" +%F)

echo "=== 1. health ==="
read -r st b <<<"$(req GET /api/health | tr '\n' ' ')"
st=$(printf '%s' "$st" | head -1)
out=$(req GET /api/health); status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "health 200 ok/database ok" 200 '"database":"ok"' "$status" "$body"

echo "=== 2. guest-validate: без CSRF → 403 csrf ==="
out=$(req POST /api/cart/guest-validate "{\"items\":[{\"productId\":\"$PROD1\",\"quantity\":2}]}" no)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "guest-validate no-csrf 403" 403 '"error":"csrf"' "$status" "$body"

echo "=== 3. guest-validate с CSRF: цена из БД ==="
out=$(req POST /api/cart/guest-validate "{\"items\":[{\"productId\":\"$PROD1\",\"quantity\":2}]}" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "guest-validate 200 unitPrice=DB price" 200 "\"unitPrice\":$PROD1_PRICE" "$status" "$body"
check "guest-validate lineTotal 2x" 200 '"lineTotal":680000' "$status" "$body"
check "guest-validate itemsTotal 680000" 200 '"itemsTotal":680000' "$status" "$body"

echo "=== 4. guest-validate: not_found / unavailable ==="
out=$(req POST /api/cart/guest-validate "{\"items\":[{\"productId\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}]}" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "guest-validate unknown → issue not_found" 200 '"issue":"not_found"' "$status" "$body"
out=$(req POST /api/cart/guest-validate "{\"items\":[{\"productId\":\"$PROD_UNAV\",\"quantity\":1}]}" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "guest-validate unavailable → issue unavailable" 200 '"issue":"unavailable"' "$status" "$body"
check "guest-validate itemsTotal excludes invalid" 200 '"itemsTotal":0' "$status" "$body"

echo "=== 5. /api/cart аноним → 401 (ОТДЕЛЬНАЯ чистая кука — урок: сессия в общем jar делает запрос authed) ==="
ANON_JAR=/tmp/s4b1-anon-jar.txt; rm -f "$ANON_JAR"
out=$(req GET /api/cart)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "GET /api/cart anon 401" 401 'error' "$status" "$body"
out=$(req POST /api/cart "{\"productId\":\"$PROD1\"}" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "POST /api/cart anon (с CSRF) → 401" 401 'error' "$status" "$body"
out=$(req POST /api/cart "{\"productId\":\"$PROD1\"}" no)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "POST /api/cart anon без CSRF → 403 (S2B3: CSRF раньше auth)" 403 '"error":"csrf"' "$status" "$body"
unset ANON_JAR

echo "=== 6. login customer@demo.ru ==="
out=$(req POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "login 200 role CUSTOMER" 200 '"role":"CUSTOMER"' "$status" "$body"

echo "=== 7. очистка серверной корзины ==="
out=$(req GET /api/cart)
ids=$(extract "$out" "' '.join(i['id'] for i in d.get('items',[]))")
for id in $ids; do req DELETE "/api/cart/$id" "{}" csrf >/dev/null; done
out=$(req GET /api/cart)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "GET /api/cart → пусто" 200 '"items":\[\]' "$status" "$body"

echo "=== 8. POST /api/cart ==="
out=$(req POST /api/cart "{\"productId\":\"$PROD1\",\"quantity\":2}" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "POST /api/cart line qty=2" 200 '"quantity":2' "$status" "$body"
check "POST /api/cart unitPrice DB" 200 "\"unitPrice\":$PROD1_PRICE" "$status" "$body"
LINE_ID=$(extract "$out" "d['items'][0]['id']")

echo "=== 9. PATCH qty=0 → удаление ==="
out=$(req PATCH "/api/cart/$LINE_ID" '{"quantity":0}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "PATCH qty0 → items empty" 200 '"items":\[\]' "$status" "$body"

echo "=== 10. POST без quantity → +1 ==="
req POST /api/cart "{\"productId\":\"$PROD1\"}" csrf >/dev/null
out=$(req GET /api/cart)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "POST без qty → quantity 1" 200 '"quantity":1' "$status" "$body"

echo "=== 11. merge: sum semantics ==="
out=$(req POST /api/cart/merge "{\"items\":[{\"productId\":\"$PROD1\",\"quantity\":2},{\"productId\":\"$PROD2\",\"quantity\":1}]}" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "merge PROD1 qty sum→3" 200 '"quantity":3' "$status" "$body"
check "merge itemsTotal 3x340000+69000" 200 '"itemsTotal":1089000' "$status" "$body"

echo "=== 12-16. POST /api/orders ==="
# Анонимные проверки на ЧИСТОЙ куке (ANON_JAR): 401 с токеном, 403 без.
ORDER_ANON_BODY="{\"contact\":{\"name\":\"Тест\",\"phone\":\"+79001234567\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$TOMORROW\",\"slot\":\"10:00–13:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}]}"
ANON_JAR=/tmp/s4b1-anon-jar.txt; rm -f "$ANON_JAR"
out=$(req POST /api/orders "$ORDER_ANON_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "orders anon (с CSRF) → 401" 401 'error' "$status" "$body"
unset ANON_JAR

out=$(req POST /api/orders "$ORDER_ANON_BODY" no)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "orders без CSRF → 403 csrf" 403 '"error":"csrf"' "$status" "$body"

ORDER_BODY_COURIER_NO_ADDR="{\"contact\":{\"name\":\"Тест Покупатель\",\"phone\":\"+79001234567\",\"email\":\"test@demo.ru\"},\"delivery\":{\"method\":\"courier\",\"date\":\"$TOMORROW\",\"slot\":\"13:00–16:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}]}"
out=$(req POST /api/orders "$ORDER_BODY_COURIER_NO_ADDR" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "orders courier без address → 400" 400 'delivery.address' "$status" "$body"

ORDER_BODY_YESTERDAY="{\"contact\":{\"name\":\"Тест Покупатель\",\"phone\":\"+79001234567\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$YESTERDAY\",\"slot\":\"10:00–13:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}]}"
out=$(req POST /api/orders "$ORDER_BODY_YESTERDAY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "orders дата вчера → 400" 400 'delivery.date' "$status" "$body"

ORDER_BODY_FAKE="{\"contact\":{\"name\":\"Тест Покупатель\",\"phone\":\"+79001234567\",\"email\":\"test@demo.ru\"},\"delivery\":{\"method\":\"courier\",\"address\":\"ул Ленина 1, кв 2, Москва\",\"date\":\"$TOMORROW\",\"slot\":\"13:00–16:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":2,\"price\":1,\"unitPrice\":1,\"total\":1,\"deliveryCost\":1,\"discountTotal\":999}]}"
out=$(req POST /api/orders "$ORDER_BODY_FAKE" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "orders 201 PENDING" 201 '"status":"PENDING"' "$status" "$body"
check "orders payment null" 201 '"payment":null' "$status" "$body"
check "orders itemsTotal recalc (2x340000)" 201 '"itemsTotal":680000' "$status" "$body"
check "orders deliveryCost server (courier 30000)" 201 '"deliveryCost":30000' "$status" "$body"
check "orders total recalc 710000" 201 '"total":710000' "$status" "$body"
check "orders number CD-2026-" 201 'CD-2026-' "$status" "$body"
NUM1=$(extract "$out" "d['number']")
ORDER1_ID=$(extract "$out" "d['orderId']")
echo "  order1: $NUM1 ($ORDER1_ID)"

echo "=== 17. второй заказ — номер инкремент ==="
ORDER_BODY_2="{\"contact\":{\"name\":\"Тест Покупатель\",\"phone\":\"+79001234567\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$TOMORROW\",\"slot\":\"16:00–19:00\"},\"items\":[{\"productId\":\"$PROD2\",\"quantity\":1}]}"
out=$(req POST /api/orders "$ORDER_BODY_2" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "orders 201 (второй)" 201 '"status":"PENDING"' "$status" "$body"
NUM2=$(extract "$out" "d['number']")
ORDER2_ID=$(extract "$out" "d['orderId']")
python3 - "$NUM1" "$NUM2" <<'PY'
import sys
n1, n2 = sys.argv[1], sys.argv[2]
inc = int(n1.split("-")[-1]) + 1 == int(n2.split("-")[-1])
print(("[PASS] number increment %s → %s" % (n1, n2)) if inc else ("[FAIL] number increment %s → %s" % (n1, n2)))
PY

echo "=== 18. GET /api/orders содержит оба ==="
out=$(req GET /api/orders)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "orders list contains NUM1" 200 "$NUM1" "$status" "$body"
check "orders list contains NUM2" 200 "$NUM2" "$status" "$body"

echo "=== 19. burst: 6-й запрос заказа в минуту → 429 + Retry-After ==="
# Потребление ORDER_USER_RULE ДО валидации: courier-400(1), date-400(2),
# fake-valid(3), второй(4) → burst-первый = 5-я попытка (201), 6-я → 429.
# (CSRF-403 и auth-401 запросы consume НЕ делают — CSRF раньше rate-limit.)
BURST_BODY="{\"contact\":{\"name\":\"Burst\",\"phone\":\"+79001234567\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$TOMORROW\",\"slot\":\"19:00–21:00\"},\"items\":[{\"productId\":\"$PROD2\",\"quantity\":1}]}"
out=$(req POST /api/orders "$BURST_BODY" csrf)
st=$(printf '%s' "$out" | head -1)
if [ "$st" = "201" ]; then ok "burst попытка 5 → 201"; else bad "burst попытка 5" "status=$st body=$(printf '%s' "$out" | tail -n +2 | head -c 140)"; fi
ra=$(curl -s -o /tmp/s4b1-burst-body.json -D - -b "$JAR" -c "$JAR" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf)" -d "$BURST_BODY" "$BASE/api/orders" | grep -i "retry-after" | tr -d '\r' | head -1)
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf)" -d "$BURST_BODY" "$BASE/api/orders")
if [ "$code" = "429" ] && [ -n "$ra" ]; then ok "burst попытка 6 → 429 ($ra)"; else bad "burst 429" "code=$code retry-after=$ra"; fi

echo "=== 20. GUEST-роль → 403 ==="
skip "GUEST-аккаунт не посеян (admin/support/confectioner/customer) — ROLE-фильтр покрыт кодом и 401-гейтами"

echo "=== 21. order_events (DB) ==="
# bun -e с cwd проекта: локальный @prisma/client 6.x (скрипт-файл из /tmp
# резолвит ГЛОБАЛЬНЫЙ client 7.x — несовместим; lesson).
(cd /home/z/my-project/conditera-v2 && DATABASE_URL_PLACEHOLDER=1 EVT_ORDER_ID="$ORDER1_ID" bun -e "
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const envUrl = fs.readFileSync('.env.local','utf8').split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice(13);
const prisma = new PrismaClient(envUrl ? { datasources: { db: { url: envUrl } } } : undefined);
const orderId = process.env.EVT_ORDER_ID;
const events = await prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
const dp = events.find(e => e.from === 'DRAFT' && e.to === 'PENDING');
console.log(events.length >= 1 && dp
  ? '[PASS] order_events: ' + events.length + ' шт., есть DRAFT→PENDING (actorRole=' + (dp.actorRole ?? 'null') + ')'
  : '[FAIL] order_events: total=' + events.length + ' DRAFT→PENDING=' + (dp ? 'yes' : 'no'));
await prisma.\$disconnect();
")
echo
echo "RESULT: PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
