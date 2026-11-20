#!/usr/bin/env bash
# S3B2 CONT — curl-матрица гейтов (v2 :3100). Jar: ВСЕГДА -b jar -c jar вместе.
set -u
BASE="http://localhost:3100"
JAR="/tmp/s3b2-jar.txt"
rm -f "$JAR"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
chk()  {
  if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else bad "$1 — expected=$2 actual=$3"; fi
}
jsonget() { jq -r "$1" 2>/dev/null || echo "JQ_ERR"; }

echo "== A. GET /api/products (page 1) =="
A=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/api/products")
A_CODE="${A##*$'\n'}"; A_BODY="${A%$'\n'*}"
chk "A1 status" "200" "$A_CODE"
chk "A2 items=20 (20 per page)" "20" "$(echo "$A_BODY" | jsonget '.items | length')"
chk "A3 total=23" "23" "$(echo "$A_BODY" | jsonget '.total')"
chk "A4 pageCount=2" "2" "$(echo "$A_BODY" | jsonget '.pageCount')"
chk "A5 pageSize=20" "20" "$(echo "$A_BODY" | jsonget '.pageSize')"

echo "== B. GET /api/products?page=2 =="
B=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/api/products?page=2")
B_CODE="${B##*$'\n'}"; B_BODY="${B%$'\n'*}"
chk "B1 status" "200" "$B_CODE"
chk "B2 items=3 (rest)" "3" "$(echo "$B_BODY" | jsonget '.items | length')"
chk "B3 page=2" "2" "$(echo "$B_BODY" | jsonget '.page')"
A_FIRST=$(echo "$A_BODY" | jsonget '.items[0].id')
B_FIRST=$(echo "$B_BODY" | jsonget '.items[0].id')
if [ "$A_FIRST" != "$B_FIRST" ]; then ok "B4 page2 set differs from page1"; else bad "B4 page2 set identical to page1"; fi

echo "== C. GET /api/products?category=torty =="
C=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/api/products?category=torty")
C_CODE="${C##*$'\n'}"; C_BODY="${C%$'\n'*}"
chk "C1 status" "200" "$C_CODE"
C_N=$(echo "$C_BODY" | jsonget '.total')
C_BAD=$(echo "$C_BODY" | jsonget '[.items[] | select(.category.slug != "torty")] | length')
chk "C2 all items category.slug=torty (0 mismatches)" "0" "$C_BAD"
C3_VAL=$(python3 -c "print(str(0 < int('$C_N') < 23).lower())")
chk "C3 filtered subset (0<N<23)" "true" "$C3_VAL"

echo "== C2b. category by NAME must NOT match (D11: categoryId-only) =="
CNAME=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/products?category=%D0%A2%D0%BE%D1%80%D1%82%D1%8B")
chk "C2a title-name filter yields 0 (strict slug)" "0" "$(echo "$CNAME" | jsonget '.total')"

echo "== D. GET /api/products?q=медовик =="
D=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" --get --data-urlencode "q=медовик" "$BASE/api/products")
D_CODE="${D##*$'\n'}"; D_BODY="${D%$'\n'*}"
chk "D1 status" "200" "$D_CODE"
chk "D2 finds prod-demo-02 (Медовик)" "true" "$(echo "$D_BODY" | jsonget '[.items[].slug] | index("prod-demo-02") != null')"

echo "== E. GET /api/products?minPrice=1000&maxPrice=2000 =="
E=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/api/products?minPrice=1000&maxPrice=2000")
E_CODE="${E##*$'\n'}"; E_BODY="${E%$'\n'*}"
chk "E1 status" "200" "$E_CODE"
E_OUT=$(echo "$E_BODY" | jsonget '[.items[] | select(.price < 100000 or .price > 200000)] | length')
chk "E2 all prices within [100000..200000] kop" "0" "$E_OUT"
E_TOTAL=$(echo "$E_BODY" | jsonget '.total')
E3_VAL=$(python3 -c "print(str(int('$E_TOTAL') > 0).lower())")
chk "E3 some items found" "true" "$E3_VAL"

echo "== F. sort=price_asc =="
F=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/products?sort=price_asc")
F_MIN=$(echo "$F" | jsonget '[.items[].price] | min')
F_FIRST=$(echo "$F" | jsonget '.items[0].price')
F_VAL=$(python3 -c "print(str(int('$F_FIRST') == int('$F_MIN')).lower())")
chk "F1 first price == min" "true" "$F_VAL"

echo "== G. sort=newest =="
G=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/products?sort=newest")
chk "G1 first item isNew=true" "true" "$(echo "$G" | jsonget '.items[0].isNew')"

echo "== H. invalid params -> 400 =="
chk "H1 sort=bogus" "400" "$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" "$BASE/api/products?sort=bogus")"
chk "H2 page=0" "400" "$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" "$BASE/api/products?page=0")"
chk "H3 page=abc" "400" "$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" "$BASE/api/products?page=abc")"
chk "H4 minPrice=-5" "400" "$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" "$BASE/api/products?minPrice=-5")"

echo "== I. GET /api/categories =="
I=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/api/categories")
I_CODE="${I##*$'\n'}"; I_BODY="${I%$'\n'*}"
chk "I1 status" "200" "$I_CODE"
chk "I2 8 categories" "8" "$(echo "$I_BODY" | jsonget '.items | length')"
chk "I3 counters present" "true" "$(echo "$I_BODY" | jsonget '.items[0].productsCount != null')"

echo "== K. GET /api/products/prod-demo-01 =="
K=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/api/products/prod-demo-01")
K_CODE="${K##*$'\n'}"; K_BODY="${K%$'\n'*}"
chk "K1 status" "200" "$K_CODE"
chk "K2 ingredients non-empty" "true" "$(echo "$K_BODY" | jsonget '.product.ingredients | length > 0')"
chk "K3 allergens non-empty" "true" "$(echo "$K_BODY" | jsonget '.product.allergens | length > 0')"
chk "K4 categoryId present" "true" "$(echo "$K_BODY" | jsonget '.product.categoryId != null')"
chk "K5 reviewStats count=6 (approved)" "6" "$(echo "$K_BODY" | jsonget '.product.reviewStats.count')"
K_AVG=$(echo "$K_BODY" | jsonget '.product.reviewStats.average')
K_VAL=$(python3 -c "print(str(float('$K_AVG') > 4).lower())")
chk "K6 average>4" "true" "$K_VAL"

echo "== L. GET /api/products/prod-demo-01/reviews (anon) =="
L=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/api/products/prod-demo-01/reviews")
L_CODE="${L##*$'\n'}"; L_BODY="${L%$'\n'*}"
chk "L1 status" "200" "$L_CODE"
chk "L2 total=6 approved" "6" "$(echo "$L_BODY" | jsonget '.total')"
chk "L3 items=5 (5 per page)" "5" "$(echo "$L_BODY" | jsonget '.items | length')"
chk "L4 pageCount=2" "2" "$(echo "$L_BODY" | jsonget '.pageCount')"
chk "L5 anon ownPending=0" "0" "$(echo "$L_BODY" | jsonget '.ownPending | length')"
chk "L6 404 unknown slug" "404" "$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" "$BASE/api/products/no-such-slug")"

echo "== M. POST /api/reviews WITHOUT csrf -> 403 csrf =="
M=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X POST "$BASE/api/reviews" \
  -H "Content-Type: application/json" \
  -d '{"productSlug":"prod-demo-02","rating":5,"text":"тест без токена"}')
M_CODE="${M##*$'\n'}"; M_BODY="${M%$'\n'*}"
chk "M1 status" "403" "$M_CODE"
chk "M2 error=csrf" "csrf" "$(echo "$M_BODY" | jsonget '.error')"

echo "== N. csrf token, NO session -> 401 =="
TOKEN=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/csrf" | jsonget '.token')
if [ ${#TOKEN} -ge 32 ]; then ok "N1 csrf token issued (${#TOKEN} chars)"; else bad "N1 csrf token missing"; fi
N=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X POST "$BASE/api/reviews" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -d '{"productSlug":"prod-demo-02","rating":5,"text":"токен без сессии"}')
N_CODE="${N##*$'\n'}"
chk "N2 status (no session)" "401" "$N_CODE"

echo "== O. login customer@demo.ru via /api/auth/login (app origin, jar) =="
O=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@demo.ru","password":"Demo123!"}')
O_CODE="${O##*$'\n'}"; O_BODY="${O%$'\n'*}"
chk "O1 status" "200" "$O_CODE"
O_ROLE=$(echo "$O_BODY" | jq -r '.profile.role // .roles[0] // "none"' 2>/dev/null)
echo "   (info: login role=$O_ROLE)"
if grep -q "auth-token" "$JAR" 2>/dev/null; then ok "O3 session cookie in jar"; else bad "O3 no session cookie in jar"; fi

echo "== P. POST /api/reviews with token+session -> 201 pending =="
T1=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/csrf" | jsonget '.token')
P=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X POST "$BASE/api/reviews" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $T1" \
  -d '{"productSlug":"prod-demo-02","rating":5,"text":"Матричный тест CONT: отзыв уходит на модерацию"}')
P_CODE="${P##*$'\n'}"; P_BODY="${P%$'\n'*}"
chk "P1 status" "201" "$P_CODE"
chk "P2 status=pending" "pending" "$(echo "$P_BODY" | jsonget '.status')"

echo "== Q. burst: posts 2..5 OK, 6th within minute -> 429 + Retry-After =="
Q_OK=0
for i in 2 3 4 5; do
  TI=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/csrf" | jsonget '.token')
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" -X POST "$BASE/api/reviews" \
    -H "Content-Type: application/json" -H "X-CSRF-Token: $TI" \
    -d "{\"productSlug\":\"prod-demo-03\",\"rating\":4,\"text\":\"burst-тест $i лимита отзывов\"}")
  [ "$CODE" = "201" ] && Q_OK=$((Q_OK+1))
done
chk "Q1 posts 2..5 -> 201 (x4)" "4" "$Q_OK"
T6=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/csrf" | jsonget '.token')
Q6=$(curl -s -D /tmp/s3b2-hdrs.txt -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X POST "$BASE/api/reviews" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $T6" \
  -d '{"productSlug":"prod-demo-03","rating":4,"text":"шестой пост за минуту"}')
Q6_CODE="${Q6##*$'\n'}"
chk "Q2 6th post -> 429" "429" "$Q6_CODE"
RA=$(grep -i "^retry-after:" /tmp/s3b2-hdrs.txt | tr -d "\r" | awk '{print $2}')
if [ -n "$RA" ] && [ "$RA" -ge 1 ] 2>/dev/null; then ok "Q3 Retry-After present ($RA s)"; else bad "Q3 Retry-After missing"; fi

echo "== R. (после паузы 65с) XSS material: POST review with script -> 201 pending =="
sleep 65
TX=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/csrf" | jsonget '.token')
R=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X POST "$BASE/api/reviews" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $TX" \
  -d '{"productSlug":"prod-demo-01","rating":3,"text":"<script>alert(\"xss-cont\")</script> Проверка экранирования <img src=x onerror=alert(2)>"}')
R_CODE="${R##*$'\n'}"; R_BODY="${R%$'\n'*}"
chk "R1 status (pending accepted)" "201" "$R_CODE"
chk "R2 stored as pending" "pending" "$(echo "$R_BODY" | jsonget '.status')"

echo "== S. /catalog?category=torty server-render содержит товары категории =="
S=$(curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" "$BASE/catalog?category=torty")
S_CODE="${S##*$'\n'}"; S_BODY="${S%$'\n'*}"
chk "S1 status" "200" "$S_CODE"
S_HAS=$(echo "$S_BODY" | grep -c "/catalog/prod-demo-")
S_VAL=$(python3 -c "print(str(int('$S_HAS') > 0).lower())")
chk "S2 HTML has category product links" "true" "$S_VAL"
S_ALL=$(echo "$S_BODY" | grep -o '/catalog/prod-demo-[0-9]*' | sort -u | wc -l)
echo "   (info: unique product links on filtered page: $S_ALL)"

echo "== T. GET не задет POST-бакетом =="
chk "T1 GET /api/products still 200" "200" "$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" "$BASE/api/products")"

echo ""
echo "=============================="
echo "PASS=$PASS FAIL=$FAIL"
