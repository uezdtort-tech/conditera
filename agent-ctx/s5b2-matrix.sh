#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s5b2-matrix.sh — S5B2 curl-matrix (гейт 2).
#
# Все curl — с cookie-jar (-b jar -c jar). Секреты не печатаются: DATABASE_URL
# / SUPABASE_URL / SERVICE_ROLE читаются one-off скриптами из .env.local молча;
# demo-логины (customer/confectioner/admin@demo.ru, Demo123!) — публичные
# демо-креды спеки.
#
# Сценарий: anon-редиректы → customer → /vendor 307 → login confectioner →
# страницы кабинета 200 → POST create (pending_moderation) → publish-
# validation 400 → bad_request 400 → csrf 403 → роль customer 403 → витрина
# НЕ видит pending (api+страница) → db-approve (moderation stub) → витрина
# видит (+ состав на карточке) → owner PATCH хранит approved → vendor2
# (helper) foreign PATCH/DELETE/status/print → 404 → заказ покупателя → pay
# → CONFIRMED → vendor PREPARING/READY/IN_DELIVERY (OrderEvent via=vendor) →
# invalid jump 400 → customer confirm → COMPLETED + эскроу released →
# verify-ledger OK → календарь месяца → аналитика == db-истина →
# delete hard/soft → burst 429 + Retry-After → render / и /catalog.
# =============================================================================
set -u
BASE="http://localhost:3100"
PROJ="/home/z/my-project/conditera-v2"
PASS=0; FAIL=0

ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label — got [$got], want [$want]"; fi; }
assert_has() { local label="$1" hay="$2" needle="$3"; case "$hay" in *"$needle"*) ok "$label";; *) bad "$label — не найдено [$needle]";; esac; }

csrf_token() { curl -s -b "$1" -c "$1" "$BASE/api/csrf" | jq -r '.token // empty'; }
csrf_post() { # $1=jar $2=url $3=body [$4=method] -> "<code>|<body>"
  local jar="$1" url="$2" body="$3" method="${4:-POST}"
  local token; token=$(csrf_token "$jar")
  local res
  res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$jar" -c "$jar" \
        -X "$method" -H "Content-Type: application/json" -H "X-CSRF-Token: $token" \
        -d "$body" "$BASE$url")
  printf '%s' "$res"
}
split_res() { RES_CODE=$(printf '%s' "$1" | tail -1); RES_BODY=$(printf '%s' "$1" | sed '$d'); }

dbcheck() { (cd "$PROJ" && bun scripts/tmp-dbcheck.ts "$@" 2>/dev/null); }

# --- dev-server lift (если умер между вызовами; см. урок №11) -----------------
if ! curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then
  echo "… dev :3100 не отвечает — поднимаем"
  for pid in $(lsof -ti tcp:3100 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  sleep 1; rm -f "$PROJ/.next/dev/lock"
  (cd "$PROJ" && env -u DATABASE_URL nohup bun run dev > /tmp/dev-v2.log 2>&1 &)
  for i in $(seq 1 90); do
    if curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then echo "… health OK (${i}s)"; break; fi
    sleep 1
  done
fi

echo "=== [A] Аноним: /vendor* → 307 /cart?auth=1 ==="
for p in /vendor /vendor/products /vendor/orders /vendor/calendar /vendor/analytics; do
  out=$(curl -s -o /dev/null --max-time 60 -w "%{http_code} %{redirect_url}" "$BASE$p")
  code=${out%% *}; loc=${out#* }
  assert_eq "anon $p" "$code" "307"
  case "$loc" in */cart?auth=1*) ok "anon $p → $loc";; *) bad "anon $p redirect → [$loc]";; esac
done

echo "=== [B] Customer: /vendor → 307 /account (не вендор) ==="
JC=/tmp/s5b2-jc.txt; rm -f "$JC"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$JC" -c "$JC" -X POST -H "Content-Type: application/json" \
      -d '{"email":"customer@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login customer" "$RES_CODE" "200"
out=$(curl -s -o /dev/null --max-time 60 -w "%{http_code} %{redirect_url}" -b "$JC" -c "$JC" "$BASE/vendor")
code=${out%% *}; loc=${out#* }
assert_eq "customer GET /vendor" "$code" "307"
case "$loc" in */account*) ok "customer /vendor → $loc";; *) bad "customer redirect → [$loc]";; esac

echo "=== [C] Confectioner: страницы кабинета ==="
J1=/tmp/s5b2-j1.txt; rm -f "$J1"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$J1" -c "$J1" -X POST -H "Content-Type: application/json" \
      -d '{"email":"confectioner@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login confectioner" "$RES_CODE" "200"
for p in /vendor /vendor/products /vendor/orders /vendor/calendar /vendor/analytics; do
  code=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$J1" -c "$J1" "$BASE$p")
  assert_eq "confectioner GET $p" "$code" "200"
done
OV=$(curl -s --max-time 60 -b "$J1" -c "$J1" "$BASE/vendor")
assert_has "/vendor: бейдж кабинета" "$OV" "Уездный кондитер"
assert_has "/vendor: сайдбар «Товары»" "$OV" "Товары"
assert_has "/vendor: сайдбар «Календарь»" "$OV" "Календарь"
assert_has "/vendor: сайдбар «Выплаты»" "$OV" "Выплаты"
assert_has "/vendor: карточка «Выручка 30 дней»" "$OV" "Выручка 30 дней"

echo "=== [D] Vendor2 helper (foreign-вендор для 404-тестов) ==="
V2SETUP=$(cd "$PROJ" && bun scripts/tmp-vendor2.ts 2>/dev/null)
assert_has "vendor2 setup" "$V2SETUP" '"ok":true'
J2=/tmp/s5b2-j2.txt; rm -f "$J2"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$J2" -c "$J2" -X POST -H "Content-Type: application/json" \
      -d '{"email":"confectioner2@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login confectioner2" "$RES_CODE" "200"
code=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$J2" -c "$J2" "$BASE/vendor")
assert_eq "confectioner2 GET /vendor" "$code" "200"

echo "=== [E] POST /api/vendor/products — создание/валидация ==="
CONFID=$(dbcheck conf-id "confectioner@demo.ru" | jq -r '.confId')
CATS=$(curl -s --max-time 60 "$BASE/api/categories")
# /api/categories возвращает {"items":[…]} (S3B1) — берём первый items[].id.
CATID=$(printf '%s' "$CATS" | jq -r '.items[0].id // empty')
echo "… confId=$CONFID categoryId=$CATID"

SLUG="tort-s5b2-matrix"
# Витрина = approved + isAvailable (S5B2): создаём СРАЗУ доступным (как из UI
# «Сохранить и опубликовать»), чтобы после db-approve гейт [G] видел товар.
res=$(csrf_post "$J1" "/api/vendor/products" "{\"title\":\"Торт S5B2 Матрица\",\"description\":\"Пробный товар\",\"priceRub\":\"1200\",\"categoryId\":\"$CATID\",\"ingredients\":[\"мука\",\"мёд\",\"яйца\"],\"allergens\":[\"мёд\",\"яйца\"],\"images\":[],\"isAvailable\":true}")
split_res "$res"
assert_eq "POST create pending (isAvailable)" "$RES_CODE" "201"
PID=$(printf '%s' "$RES_BODY" | jq -r '.product.id // empty')
PSLUG=$(printf '%s' "$RES_BODY" | jq -r '.product.slug // empty')
MST=$(printf '%s' "$RES_BODY" | jq -r '.product.moderationStatus // empty')
assert_eq "create → moderationStatus" "$MST" "pending_moderation"
db=$(dbcheck product-by-slug "$PSLUG")
assert_eq "db moderationStatus" "$(printf '%s' "$db" | jq -r '.moderationStatus')" "pending_moderation"
assert_eq "db isAvailable" "$(printf '%s' "$db" | jq -r '.isAvailable')" "true"
assert_eq "db владелец" "$(printf '%s' "$db" | jq -r '.confectioner.slug')" "uezdny-konditer"

res=$(csrf_post "$J1" "/api/vendor/products" "{\"title\":\"Торт без состава\",\"description\":\"\",\"priceRub\":\"900\",\"categoryId\":\"$CATID\",\"ingredients\":[],\"allergens\":[],\"images\":[],\"isAvailable\":true}")
split_res "$res"
assert_eq "POST без состава → publish_validation" "$RES_CODE" "400"
assert_has "publish_validation body" "$RES_BODY" '"error":"publish_validation"'

res=$(csrf_post "$J1" "/api/vendor/products" "{\"title\":\"Торт с мусорной ценой\",\"description\":\"\",\"priceRub\":\"дорого\",\"categoryId\":\"$CATID\",\"ingredients\":[\"мука\"],\"allergens\":[],\"images\":[],\"isAvailable\":false}")
split_res "$res"
assert_eq "POST мусорная цена → 400" "$RES_CODE" "400"
assert_has "bad_request body" "$RES_BODY" '"error":"bad_request"'

nop=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$J1" -c "$J1" -X POST -H "Content-Type: application/json" -d '{}' "$BASE/api/vendor/products")
split_res "$nop"
assert_eq "POST без CSRF → 403" "$RES_CODE" "403"
assert_has "csrf body" "$RES_BODY" '"error":"csrf"'

res=$(csrf_post "$JC" "/api/vendor/products" "{\"title\":\"Клиентский торт\",\"priceRub\":\"100\",\"categoryId\":\"$CATID\",\"ingredients\":[\"мука\"]}")
split_res "$res"
assert_eq "customer POST → 403 (RBAC)" "$RES_CODE" "403"

echo "=== [F] Витрина НЕ видит pending ==="
LIST=$(curl -s --max-time 60 -G --data-urlencode "q=Торт S5B2 Матрица" "$BASE/api/products")
TOTAL=$(printf '%s' "$LIST" | jq -r '.total // 0')
assert_eq "GET /api/products?q= → pending скрыт" "$TOTAL" "0"
pcode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' "$BASE/catalog/$PSLUG")
assert_eq "GET /catalog/[slug] pending → 404" "$pcode" "404"

echo "=== [G] Moderation stub: db-approved → витрина показывает ==="
db=$(dbcheck approve-by-slug "$PSLUG")
assert_eq "approve-by-slug" "$(printf '%s' "$db" | jq -r '.moderationStatus')" "approved"
LIST=$(curl -s --max-time 60 "$BASE/api/products?q=S5B2")
TOTAL=$(printf '%s' "$LIST" | jq -r '.total // 0')
assert_eq "GET /api/products → approved виден" "$TOTAL" "1"
pcode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' "$BASE/catalog/$PSLUG")
assert_eq "GET /catalog/[slug] approved → 200" "$pcode" "200"
PHTML=$(curl -s --max-time 60 "$BASE/catalog/$PSLUG")
assert_has "карточка: состав на витрине" "$PHTML" "мёд"
assert_has "карточка: аллергены на витрине" "$PHTML" "яйца"

echo "=== [H] Owner PATCH: правка хранит approved ==="
res=$(csrf_post "$J1" "/api/vendor/products/$PID" "{\"title\":\"Торт S5B2 Матрица (обновлён)\",\"description\":\"Пробный товар v2\",\"priceRub\":\"1300\",\"categoryId\":\"$CATID\",\"ingredients\":[\"мука\",\"мёд\",\"яйца\",\"сахар\"],\"allergens\":[\"мёд\",\"яйца\",\"глютен\"],\"images\":[],\"isAvailable\":true}" PATCH)
split_res "$res"
assert_eq "PATCH owner" "$RES_CODE" "200"
db=$(dbcheck product-by-slug "$PSLUG")
assert_eq "PATCH: moderationStatus сохранён" "$(printf '%s' "$db" | jq -r '.moderationStatus')" "approved"
assert_eq "PATCH: isAvailable" "$(printf '%s' "$db" | jq -r '.isAvailable')" "true"

echo "=== [I] Foreign vendor → 404 (PATCH/DELETE/status/print) ==="
res=$(csrf_post "$J2" "/api/vendor/products/$PID" "{\"title\":\"Взлом\",\"priceRub\":\"1\",\"categoryId\":\"$CATID\",\"ingredients\":[\"x\"],\"allergens\":[]}" PATCH)
split_res "$res"
assert_eq "foreign PATCH" "$RES_CODE" "404"
assert_has "foreign PATCH body" "$RES_BODY" '"error":"not_found"'
res=$(csrf_post "$J2" "/api/vendor/products/$PID" "" DELETE)
split_res "$res"
assert_eq "foreign DELETE" "$RES_CODE" "404"

echo "=== [J] Поток статусов вендора (машина состояний) ==="
tomorrow=$(date -u -d "+1 day" +%F 2>/dev/null || date -u +%F)
res=$(csrf_post "$JC" "/api/orders" "{\"items\":[{\"productId\":\"$PID\",\"quantity\":2}],\"contact\":{\"name\":\"Демо-покупатель\",\"phone\":\"+7 (900) 000-00-00\"},\"delivery\":{\"method\":\"courier\",\"address\":\"Тула, ул. Металлургов, д. 12\",\"date\":\"$tomorrow\",\"slot\":\"10:00–13:00\"},\"comment\":\"Позвонить за час\"}")
split_res "$res"
assert_eq "POST /api/orders (customer)" "$RES_CODE" "201"
ORDER1=$(printf '%s' "$RES_BODY" | jq -r '.orderId // empty')
ONUM=$(printf '%s' "$RES_BODY" | jq -r '.number // empty')
echo "… order=$ORDER1 number=$ONUM"

res=$(csrf_post "$JC" "/api/orders/$ORDER1/pay" "{}")
split_res "$res"
assert_eq "pay (mock)" "$RES_CODE" "200"
assert_has "pay body CONFIRMED" "$RES_BODY" '"orderStatus":"CONFIRMED"'

res=$(csrf_post "$J2" "/api/vendor/orders/$ORDER1/status" "{\"to\":\"PREPARING\"}")
split_res "$res"
assert_eq "foreign vendor status → 404" "$RES_CODE" "404"
ppcode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$J2" -c "$J2" "$BASE/vendor/orders/$ORDER1/print")
assert_eq "foreign print → 404" "$ppcode" "404"

res=$(csrf_post "$J1" "/api/vendor/orders/$ORDER1/status" "{\"to\":\"PREPARING\"}")
split_res "$res"
assert_eq "vendor PREPARING" "$RES_CODE" "200"
db=$(dbcheck order "$ORDER1")
assert_eq "db status" "$(printf '%s' "$db" | jq -r '.status')" "PREPARING"
ev=$(dbcheck event "$ORDER1" CONFIRMED PREPARING)
assert_eq "OrderEvent actorRole" "$(printf '%s' "$ev" | jq -r '.actorRole')" "CONFECTIONER"
assert_eq "OrderEvent meta.via" "$(printf '%s' "$ev" | jq -r '.meta.via')" "vendor"

res=$(csrf_post "$J1" "/api/vendor/orders/$ORDER1/status" "{\"to\":\"READY\"}")
split_res "$res"
assert_eq "vendor READY" "$RES_CODE" "200"
res=$(csrf_post "$J1" "/api/vendor/orders/$ORDER1/status" "{\"to\":\"IN_DELIVERY\"}")
split_res "$res"
assert_eq "vendor IN_DELIVERY" "$RES_CODE" "200"

res=$(csrf_post "$J1" "/api/vendor/orders/$ORDER1/status" "{\"to\":\"COMPLETED\"}")
split_res "$res"
assert_eq "invalid jump COMPLETED → 400" "$RES_CODE" "400"
assert_has "invalid jump body" "$RES_BODY" '"error":"invalid_transition_request"'

ppcode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$J1" -c "$J1" "$BASE/vendor/orders/$ORDER1/print")
assert_eq "owner print → 200" "$ppcode" "200"

res=$(csrf_post "$JC" "/api/orders/$ORDER1/confirm" "{}")
split_res "$res"
assert_eq "customer confirm IN_DELIVERY → COMPLETED" "$RES_CODE" "200"
db=$(dbcheck order "$ORDER1")
assert_eq "db COMPLETED" "$(printf '%s' "$db" | jq -r '.status')" "COMPLETED"
esc=$(dbcheck escrow "$ORDER1")
assert_eq "эскроу released == total" "$(printf '%s' "$esc" | jq -r '.released')" "$(printf '%s' "$esc" | jq -r '.total')"
led=$(cd "$PROJ" && bun scripts/verify-ledger.ts 2>/dev/null | tail -1)
assert_has "verify-ledger" "$led" "OK"

echo "=== [K] Календарь месяца — заказ виден ==="
CURMONTH=$(date -u +%Y-%m)
CAL=$(curl -s --max-time 60 -b "$J1" -c "$J1" "$BASE/vendor/calendar?month=$CURMONTH")
assert_has "календарь: номер заказа" "$CAL" "$ONUM"

echo "=== [L] Аналитика == db-истина ==="
REV=$(dbcheck vendor-revenue "$CONFID")
FMT=$(printf '%s' "$REV" | jq -r '.fmt')
echo "… db truth: revenue30=$(printf '%s' "$REV" | jq -r '.revenue30') fmt=$FMT orders30=$(printf '%s' "$REV" | jq -r '.orders30')"
AN=$(curl -s --max-time 60 -b "$J1" -c "$J1" "$BASE/vendor/analytics")
assert_has "аналитика: выручка == db" "$AN" "$FMT"
OV=$(curl -s --max-time 60 -b "$J1" -c "$J1" "$BASE/vendor")
assert_has "обзор: выручка == db" "$OV" "$FMT"

echo "=== [M] Delete: hard (без ссылок) / soft (с заказами) ==="
res=$(csrf_post "$J1" "/api/vendor/products" "{\"title\":\"Торт на удаление S5B2\",\"priceRub\":\"500\",\"categoryId\":\"$CATID\",\"ingredients\":[\"мука\"],\"allergens\":[],\"images\":[],\"isAvailable\":false}")
split_res "$res"
assert_eq "create draft2" "$RES_CODE" "201"
PID2=$(printf '%s' "$RES_BODY" | jq -r '.product.id // empty')
res=$(csrf_post "$J1" "/api/vendor/products/$PID2" "" DELETE)
split_res "$res"
assert_eq "DELETE без ссылок → hard" "$RES_CODE" "200"
assert_eq "hard flag" "$(printf '%s' "$RES_BODY" | jq -r '.deleted')" "true"
res=$(csrf_post "$J1" "/api/vendor/products/$PID" "" DELETE)
split_res "$res"
assert_eq "DELETE с заказом → soft" "$RES_CODE" "200"
assert_eq "soft flag" "$(printf '%s' "$RES_BODY" | jq -r '.soft')" "true"
db=$(dbcheck product-by-slug "$PSLUG")
assert_eq "soft: isAvailable=false" "$(printf '%s' "$db" | jq -r '.isAvailable')" "false"
assert_eq "soft: строка жива" "$(printf '%s' "$db" | jq -r '.id' | wc -c | tr -d ' ')" "37"

echo "=== [N] Burst статусов → 429 + Retry-After ==="
sleep 61
HTTP_FILE=/tmp/s5b2-headers.txt
CODES=""; RA_429=""
for i in $(seq 1 16); do
  token=$(csrf_token "$J1")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -D "$HTTP_FILE" --max-time 30 -b "$J1" -c "$J1" \
    -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $token" \
    -d '{"to":"PREPARING"}' "$BASE/api/vendor/orders/$ORDER1/status")
  CODES="$CODES ${CODE:-ERR}"
  if [ "$CODE" = "429" ]; then
    RA_429=$(grep -i '^retry-after:' "$HTTP_FILE" | tr -d '\r' | awk '{print $2}')
  fi
done
echo "… burst codes:$CODES"
case "$CODES" in
  *429*) ok "burst: 429 в серии (лимитер сработал)";;
  *) bad "burst: 429 не получен";;
esac
if [ -n "$RA_429" ] && [ "$RA_429" -ge 1 ] 2>/dev/null; then ok "Retry-After: $RA_429"; else bad "Retry-After отсутствует"; fi

echo "=== [O] Render-check: / и /catalog ==="
hcode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' "$BASE/")
assert_eq "GET /" "$hcode" "200"
ccode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' "$BASE/catalog")
assert_eq "GET /catalog" "$ccode" "200"

echo ""
echo "=============================="
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "MATRIX: OK" || echo "MATRIX: FAILED"
