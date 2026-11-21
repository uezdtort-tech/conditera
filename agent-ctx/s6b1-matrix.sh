#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s6b1-matrix.sh — S6B1 HTTP curl-матрица (гейт 2).
#
# Все curl — с cookie-jar (-b jar -c jar). Секреты не печатаются. Демо-креды
# (customer@demo.ru / admin@demo.ru, Demo123!) — публичные спеки.
#
# Сценарий: health chat-service → anon conversations 401 → anon create 403
# (csrf-first) → login customer → socket-token 200 (+anon 401) → create
# без CSRF 403 → create direct 200 (created:true) → повтор → created:false
# → список 200 (беседа + unreadCount) → detail 200 → foreign (admin):
# detail 404 + messages 404 → messages own: limit=10 + nextCursor + asc +
# cursor-страница → create по orderId (single-vendor) 200 → mixed order
# 400 mixed_order → rate 10/мин: 11-й create → 429 + Retry-After →
# grep-гейт портов src/ = 0.
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
csrf_post() {
  local jar="$1" url="$2" body="$3" method="${4:-POST}"
  local token; token=$(csrf_token "$jar")
  local res
  res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$jar" -c "$jar" \
        -X "$method" -H "Content-Type: application/json" -H "X-CSRF-Token: $token" \
        -d "$body" "$BASE$url")
  printf '%s' "$res"
}
plain_post() {
  local jar="$1" url="$2" body="$3"
  curl -s --max-time 60 -w $'\n%{http_code}' -b "$jar" -c "$jar" \
       -X POST -H "Content-Type: application/json" -d "$body" "$BASE$url"
}
split_res() { RES_CODE=$(printf '%s' "$1" | tail -1); RES_BODY=$(printf '%s' "$1" | sed '$d'); }

CJAR="/tmp/s6b1-customer.jar"; AJAR="/tmp/s6b1-admin.jar"
rm -f "$CJAR" "$AJAR"

# --- 0. chat-service health ---------------------------------------------------
HEALTH=$(curl -s --max-time 5 http://127.0.0.1:3030/health)
assert_has "chat-service /health status ok" "$HEALTH" '"status":"ok"'

# --- 1. anon GET conversations → 401 -------------------------------------------
C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/chat/conversations")
assert_eq "anon GET conversations → 401" "$C" "401"

# --- 2. anon POST create → 403 (csrf-first порядок гвардов) ---------------------
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" \
     -d '{"directWithConfectionerId":"x"}' "$BASE/api/chat/conversations")
assert_eq "anon POST create → 403 (csrf)" "$C" "403"

# --- 3. логин customer (origin-приложение, jar) ---------------------------------
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$CJAR" -c "$CJAR" -X POST \
     -H "Content-Type: application/json" \
     -d '{"email":"customer@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
assert_eq "login customer → 200" "$C" "200"

# --- 4. socket-token ------------------------------------------------------------
split_res "$(curl -s -w $'\n%{http_code}' -b "$CJAR" -c "$CJAR" "$BASE/api/chat/socket-token")"
assert_eq "socket-token authed → 200" "$RES_CODE" "200"
assert_has "socket-token содержит accessToken" "$RES_BODY" '"accessToken"'
C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/chat/socket-token")
assert_eq "socket-token anon → 401" "$C" "401"

# --- 5. фикстуры (Prisma, молча) ------------------------------------------------
FIXTURE=$("$PROJ/../../home/z/my-project" 2>/dev/null; cd "$PROJ" && bun /home/z/my-project/agent-ctx/s6b1-fixture.ts 2>/dev/null | tail -1)
CONF_ID=$(printf '%s' "$FIXTURE" | jq -r '.confectionerProfileId // empty')
SINGLE_ID=$(printf '%s' "$FIXTURE" | jq -r '.singleOrderId // empty')
MIXED_ID=$(printf '%s' "$FIXTURE" | jq -r '.mixedOrderId // empty')
[ -n "$CONF_ID" ] && ok "fixture: confectionerProfileId получен" || bad "fixture: confectionerProfileId пуст"
[ -n "$SINGLE_ID" ] && ok "fixture: singleOrderId получен" || bad "fixture: singleOrderId пуст"
[ -n "$MIXED_ID" ] && ok "fixture: mixedOrderId получен" || bad "fixture: mixedOrderId пуст"

# --- 6. create direct БЕЗ CSRF (authed) → 403 -----------------------------------
split_res "$(plain_post "$CJAR" "/api/chat/conversations" "{\"directWithConfectionerId\":\"$CONF_ID\"}")"
assert_eq "authed create без CSRF → 403" "$RES_CODE" "403"

# --- 7. create direct С CSRF → 200 ----------------------------------------------
split_res "$(csrf_post "$CJAR" "/api/chat/conversations" "{\"directWithConfectionerId\":\"$CONF_ID\"}")"
assert_eq "create direct (CSRF) → 200" "$RES_CODE" "200"
CONV_ID=$(printf '%s' "$RES_BODY" | jq -r '.conversation.id // empty')
[ -n "$CONV_ID" ] && ok "create direct вернул conversation.id" || bad "create direct: id пуст [$RES_BODY]"

# --- 8. повторный create → created:false (find-or-create) ------------------------
split_res "$(csrf_post "$CJAR" "/api/chat/conversations" "{\"directWithConfectionerId\":\"$CONF_ID\"}")"
assert_eq "повтор create direct → 200" "$RES_CODE" "200"
assert_has "повтор create → created:false" "$RES_BODY" '"created":false'

# --- 9. список бесед -------------------------------------------------------------
split_res "$(curl -s -w $'\n%{http_code}' -b "$CJAR" -c "$CJAR" "$BASE/api/chat/conversations")"
assert_eq "GET conversations → 200" "$RES_CODE" "200"
assert_has "список содержит беседу" "$RES_BODY" "$CONV_ID"
assert_has "список содержит unreadCount" "$RES_BODY" '"unreadCount"'

# --- 10. detail -------------------------------------------------------------------
split_res "$(curl -s -w $'\n%{http_code}' -b "$CJAR" -c "$CJAR" "$BASE/api/chat/conversations/$CONV_ID")"
assert_eq "GET detail own → 200" "$RES_CODE" "200"

# --- 11. foreign (admin): detail 404 + messages 404 -------------------------------
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$AJAR" -c "$AJAR" -X POST \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
assert_eq "login admin → 200" "$C" "200"
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$AJAR" -c "$AJAR" "$BASE/api/chat/conversations/$CONV_ID")
assert_eq "foreign GET detail → 404" "$C" "404"
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$AJAR" -c "$AJAR" "$BASE/api/chat/conversations/$CONV_ID/messages")
assert_eq "foreign GET messages → 404" "$C" "404"

# --- 12. messages own: limit=10, nextCursor, asc, курсор-страница ------------------
split_res "$(curl -s -w $'\n%{http_code}' -b "$CJAR" -c "$CJAR" "$BASE/api/chat/conversations/$CONV_ID/messages?limit=10")"
assert_eq "GET messages → 200" "$RES_CODE" "200"
P1_COUNT=$(printf '%s' "$RES_BODY" | jq '.messages | length')
assert_eq "страница 1: 10 сообщений" "$P1_COUNT" "10"
CURSOR=$(printf '%s' "$RES_BODY" | jq -r '.nextCursor // empty')
[ -n "$CURSOR" ] && ok "nextCursor не пуст (история > 10 — probe-сообщения)" || bad "nextCursor пуст — история < 10 (probe не прогонялся?)"
FIRST_TS=$(printf '%s' "$RES_BODY" | jq -r '.messages[0].createdAt')
LAST_TS=$(printf '%s' "$RES_BODY" | jq -r '.messages[-1].createdAt')
if [ "$FIRST_TS" \< "$LAST_TS" ]; then ok "порядок asc внутри страницы"; else bad "порядок страниц нарушен"; fi

ENC_CURSOR=$(printf '%s' "$CURSOR" | jq -sRr '@uri')
split_res "$(curl -s -w $'\n%{http_code}' -b "$CJAR" -c "$CJAR" "$BASE/api/chat/conversations/$CONV_ID/messages?cursor=$ENC_CURSOR&limit=10")"
assert_eq "страница 2 по курсору → 200" "$RES_CODE" "200"
P2_FIRST=$(printf '%s' "$RES_BODY" | jq -r '.messages[0].createdAt // empty')
if [ -n "$P2_FIRST" ] && [ "$P2_FIRST" \< "$FIRST_TS" ]; then ok "страница 2 — СТАРЕЕ страницы 1"; else bad "страница 2 не старее (cursor broken)"; fi
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$CJAR" -c "$CJAR" "$BASE/api/chat/conversations/$CONV_ID/messages?cursor=broken__cursor")
assert_eq "битый курсор → 400" "$C" "400"

# --- 13. create по orderId (single-vendor) → 200 -----------------------------------
split_res "$(csrf_post "$CJAR" "/api/chat/conversations" "{\"orderId\":\"$SINGLE_ID\"}")"
assert_eq "create order-chat (single-vendor) → 200" "$RES_CODE" "200"
ORDER_CONV=$(printf '%s' "$RES_BODY" | jq -r '.conversation.id // empty')
[ -n "$ORDER_CONV" ] && ok "order-chat вернул id" || bad "order-chat: id пуст"

# --- 14. mixed order → 400 mixed_order ----------------------------------------------
split_res "$(csrf_post "$CJAR" "/api/chat/conversations" "{\"orderId\":\"$MIXED_ID\"}")"
assert_eq "create mixed order → 400" "$RES_CODE" "400"
assert_has "mixed_order в теле ошибки" "$RES_BODY" "mixed_order"

# --- 15. rate 10/мин: догоняем до 10 и ловим 429 на 11-й -----------------------------
# (бакет уже содержит ~3 попытки: п.7,8,13 — добираем 7)
for i in 1 2 3 4 5 6 7; do
  split_res "$(csrf_post "$CJAR" "/api/chat/conversations" "{\"directWithConfectionerId\":\"$CONF_ID\"}")"
done
RATE_RES=$(csrf_post "$CJAR" "/api/chat/conversations" "{\"directWithConfectionerId\":\"$CONF_ID\"}")
split_res "$RATE_RES"
assert_eq "11-й create в минуту → 429" "$RES_CODE" "429"
RA=$(printf '%s' "$RATE_RES" | head -1 >/dev/null; curl -s -o /dev/null -D - -b "$CJAR" -c "$CJAR" \
     -X POST -H "Content-Type: application/json" \
     -H "X-CSRF-Token: $(csrf_token "$CJAR")" \
     -d "{\"directWithConfectionerId\":\"$CONF_ID\"}" "$BASE/api/chat/conversations" \
     | tr -d '\r' | awk 'tolower($1)=="retry-after:"{print $2}' | head -1)
[ -n "$RA" ] && ok "Retry-After присутствует ($RA)" || bad "Retry-After отсутствует"

# --- 16. grep-гейт портов в клиентском коде ------------------------------------------
PORT_HITS=$(rg -n 'localhost:3030|":3030' "$PROJ/src/" | wc -l)
assert_eq "grep-гейт портов в src/ → 0" "$PORT_HITS" "0"

echo "=== итог: PASS=$PASS FAIL=$FAIL ==="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
