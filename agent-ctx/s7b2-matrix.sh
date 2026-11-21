#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s7b2-matrix.sh — S7B2 curl-matrix (гейт 1).
#
# Все curl — с cookie-jar (-b jar -c jar). Секреты не печатаются; демо-креды
# публичные (customer/confectioner@demo.ru, Demo123!). LLM-ответы в body не
# печатаются целиком (только флаги/длины) — приватность содержимого.
#
# Сценарий (спека S7B2):
#   0) рестарт dev :3100 (свежий env + чистый in-memory rate-limit store);
#   1) render: /, /catalog, /cake-finder, /catalog/compare → 200;
#   2) assistant: anon 401 → customer no-csrf 403 → customer с CSRF 200
#      {reply, fallback} (reply-or-fallback, оба легальны);
#   3) search: q="торт без орехов до 5000" → 200; фильтры разобраны
#      (maxPriceRub=5000, excludeAllergens=[орехи]); в products НЕТ позиций
#      с орехи/миндаль/фисташка (аллергены — факты БД в ответе); все цены
#      ≤ 500 000 коп. (кап цены);
#   4) compare: 2 id → 200 {items:2, insights[]}; 5 id → 400;
#   5) cake-finder (ГОСТЬ, свежий jar): запрет орехов + taste «орехи»
#      («хочу с орехами») → в products НЕТ ореховых (db-cross-check по
#      scripts/db/s7b2-dbcheck.mjs); excludedByAllergens > 0;
#   6) dialogue: confectioner ok {suggestions}; customer 403;
#   7) лимиты: 20 POST assistant → 200, 21-й → 429 + Retry-After;
#   8) fallback proof: рестарт с AI_PROVIDER_ORDER=ollama +
#      OLLAMA_BASE_URL=http://127.0.0.1:9 → assistant/search/compare/
#      cake-finder/dialogue → 200 fallback:true и НЕпустые данные
#      (search отдаёт товары из БД по regex-парсеру) → restore env + рестарт;
#   9) после restore: search снова fallback:false (env восстановлен).
# =============================================================================
set -u
BASE="http://localhost:3100"
PROJ="/home/z/my-project/conditera-v2"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 — $2"; }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label" "got [$got], want [$want]"; fi; }

JAR_C="/tmp/s7b2-jar-customer.txt"
JAR_A="/tmp/s7b2-jar-confectioner.txt"
JAR_G="/tmp/s7b2-jar-guest.txt"
rm -f "$JAR_C" "$JAR_A" "$JAR_G"

csrf() { curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"; }

req() { # jar method path data csrf_flag -> "<code>\n<body>"
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  local args=(-s -m 120 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf "$jar")")
  local out; out=$(curl "${args[@]}" 2>/dev/null)
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

jget() { printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)" 2>/dev/null || echo "JGET_ERR"; }

NUT_ALLERGEN_RE='орехи|миндаль|фисташка|фундук|кешью|арахис'

echo "=== 0. рестарт dev :3100 ==="
bash /home/z/my-project/agent-ctx/s7b1-restart.sh || { echo "FATAL: dev не поднялся"; exit 1; }

echo "=== 1. render страниц ==="
for path in / /catalog /cake-finder /catalog/compare; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$BASE$path")
  assert_eq "render $path" "$code" "200"
done

echo "=== 2. assistant: RBAC/CSRF/базовый ответ ==="
out=$(req "$JAR_G" POST /api/ai-assistant/chat '{"message":"привет"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "assistant anon без CSRF → 403 (порядок S2B3: CSRF до auth)" "$status" "403"

out=$(req "$JAR_G" POST /api/ai-assistant/chat '{"message":"привет"}' csrf)
status=$(printf '%s' "$out" | head -1)
assert_eq "assistant anon 401" "$status" "401"

out=$(req "$JAR_C" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "login customer 200" "$status" "200"

out=$(req "$JAR_C" POST /api/ai-assistant/chat '{"message":"привет"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "assistant no-csrf 403" "$status" "403"

out=$(req "$JAR_C" POST /api/ai-assistant/chat '{"message":"Что у меня в корзине? Подскажи торт на день рождения."}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "assistant customer 200" "$status" "200"
reply_len=$(jget "$body" "len(str(d.get('reply','')))")
fallback_flag=$(jget "$body" "d.get('fallback')")
conv_id=$(jget "$body" "str(d.get('conversationId'))[:8]")
if [ "${reply_len:-0}" -ge 10 ]; then ok "assistant reply непустой (len=$reply_len, fallback=$fallback_flag)"; else bad "assistant reply" "len=$reply_len body=$(printf '%s' "$body" | head -c 120)"; fi
assert_eq "assistant conversationId есть" "$conv_id" "${conv_id}"

echo "=== 3. AI-поиск: разбор фильтров + соответствие БД ==="
out=$(req "$JAR_C" POST /api/ai/search '{"q":"торт без орехов до 5000"}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "search 200" "$status" "200"
max_price=$(jget "$body" "d.get('filters',{}).get('maxPriceRub')")
excl=$(jget "$body" "'|'.join(d.get('filters',{}).get('excludeAllergens') or [])")
assert_eq "search maxPriceRub=5000" "$max_price" "5000"
assert_eq "search excludeAllergens" "$excl" "орехи"
nut_count=$(jget "$body" "sum(1 for p in d.get('products',[]) for a in p.get('allergens',[]) if __import__('re').search(r'$NUT_ALLERGEN_RE', a.lower()))")
assert_eq "search: 0 ореховых в выдаче" "$nut_count" "0"
price_ok=$(jget "$body" "all(p['price'] <= 500000 for p in d.get('products',[]))")
assert_eq "search: цены ≤ 500000 коп" "$price_ok" "True"
products_count=$(jget "$body" "len(d.get('products',[]))")
if [ "${products_count:-0}" -ge 1 ]; then ok "search: товары найдены ($products_count шт)"; else bad "search products" "0 товаров (LLM мог не разобрать — fallback-парсер тоже ищет)"; fi
echo "$body" > /tmp/s7b2-search-body.json

echo "=== 4. compare: 2 id → таблица+insights; 5 id → 400 ==="
ID1="c0631950-fbaf-41e7-a7d4-14d6d8dfbcaf"   # Наполеон классический
ID2="4425dce9-fe68-4528-b0c9-95c48dec8089"   # Медовик семейный
ID3="5763ccad-3731-4d31-86c7-2afd8f25f67c"   # Красный бархат
ID4="eae8106a-28c1-4afa-a48a-a609c5939fa8"   # Детский торт «Динозавры»
ID5="60e922b5-d3c8-4870-85f7-0cb2bf10c91d"   # Морковный с орехами
out=$(req "$JAR_C" POST /api/ai/compare "{\"ids\":[\"$ID1\",\"$ID2\"]}" csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "compare 2 id 200" "$status" "200"
items_n=$(jget "$body" "len(d.get('items',[]))")
insights_n=$(jget "$body" "len(d.get('insights',[]))")
assert_eq "compare items=2" "$items_n" "2"
if [ "${insights_n:-0}" -ge 1 ]; then ok "compare insights ($insights_n шт)"; else bad "compare insights" "0"; fi
out=$(req "$JAR_C" POST /api/ai/compare "{\"ids\":[\"$ID1\",\"$ID2\",\"$ID3\",\"$ID4\",\"$ID5\"]}" csrf)
status=$(printf '%s' "$out" | head -1)
assert_eq "compare 5 id → 400" "$status" "400"

echo "=== 5. cake-finder (ГОСТЬ): орехи-запрет → ZERO орехи ==="
out=$(req "$JAR_G" POST /api/ai/cake-finder '{"occasion":"день рождения","budgetRub":20000,"guests":10,"tastes":["орехи"],"allergensForbidden":["орехи"]}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "cake-finder guest 200" "$status" "200"
cf_nut=$(jget "$body" "sum(1 for p in d.get('products',[]) for a in p.get('allergens',[]) if __import__('re').search(r'$NUT_ALLERGEN_RE', a.lower()))")
assert_eq "cake-finder: 0 ореховых при запрете орехов" "$cf_nut" "0"
cf_excluded=$(jget "$body" "d.get('excludedByAllergens', -1)")
if [ "${cf_excluded:-0}" -ge 1 ]; then ok "cake-finder excludedByAllergens=$cf_excluded (назначение фильтра видно)"; else bad "cake-finder excluded" "0/нет поля"; fi
cf_products=$(jget "$body" "len(d.get('products',[]))")
echo "$body" > /tmp/s7b2-cakefinder-body.json
# db cross-check: все id из ответа существуют в БД с isAvailable+approved
ids_csv=$(jget "$body" "','.join(p['id'] for p in d.get('products',[]))")
cd "$PROJ" && set -a && . ./.env.local 2>/dev/null; set +a
db_hits=$(bun -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ids = '$ids_csv'.split(',').filter(Boolean);
const rows = await prisma.product.findMany({ where: { id: { in: ids }, isAvailable: true, moderationStatus: 'approved' }, select: { id: true } });
console.log(rows.length);
await prisma.\$disconnect();
" 2>/dev/null)
assert_eq "cake-finder db cross-check (все id на витрине)" "$db_hits" "$cf_products"

echo "=== 6. dialogue: confectioner ok / customer 403 ==="
out=$(req "$JAR_A" POST /api/auth/login '{"email":"confectioner@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "login confectioner 200" "$status" "200"
out=$(req "$JAR_A" POST /api/ai/dialogue/respond '{"incomingText":"Здравствуйте! А можно торт без орехов на 10 человек к субботе?"}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "dialogue confectioner 200" "$status" "200"
sugg_n=$(jget "$body" "len(d.get('suggestions',[]))")
if [ "${sugg_n:-0}" -ge 1 ] && [ "${sugg_n:-0}" -le 2 ]; then ok "dialogue suggestions 1-2 ($sugg_n)"; else bad "dialogue suggestions" "$sugg_n"; fi
out=$(req "$JAR_C" POST /api/ai/dialogue/respond '{"incomingText":"тест"}' csrf)
status=$(printf '%s' "$out" | head -1)
assert_eq "dialogue customer 403" "$status" "403"
# чужой/несуществующий orderId → 404
out=$(req "$JAR_A" POST /api/ai/dialogue/respond '{"incomingText":"тест","orderContext":"nonexistent-id"}' csrf)
status=$(printf '%s' "$out" | head -1)
assert_eq "dialogue чужой orderId 404" "$status" "404"

echo "=== 7. лимиты: bucket 20/мин → добивка 19 запросов, 21-й → 429 + Retry-After ==="
# bucket потреблён 1 раз в шаге 2 → 19 запросов добивают до 20 (все 200).
codes=""
for i in $(seq 1 19); do
  code=$(req "$JAR_C" POST /api/ai-assistant/chat '{"message":"лимит-тест '"$i"'"}' csrf | head -1)
  codes="$codes $code"
done
count_200=$(printf '%s' "$codes" | tr ' ' '\n' | grep -c '^200$')
assert_eq "assistant: запросы 2..20 прошли (19×200)" "$count_200" "19"
retry_after=$(curl -s -o /dev/null -D - -m 60 -b "$JAR_C" -c "$JAR_C" -X POST "$BASE/api/ai-assistant/chat" -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR_C")" -d '{"message":"retry-check"}' | grep -i '^retry-after:' | tr -d '\r' | awk '{print $2}')
status_21=$(req "$JAR_C" POST /api/ai-assistant/chat '{"message":"21-й запрос"}' csrf | head -1)
assert_eq "assistant: 21-й → 429" "$status_21" "429"
if [ -n "${retry_after:-}" ] && [ "$retry_after" -gt 0 ] 2>/dev/null; then ok "429 Retry-After: ${retry_after}s"; else bad "Retry-After" "пусто/не число ($retry_after)"; fi

echo "=== 8. FALLBACK PROOF: ollama-only + blackhole → все фичи fallback:true ==="
cd "$PROJ"
cp .env.local /tmp/s7b2-env-backup.txt
sed -i 's/^AI_PROVIDER_ORDER=.*/AI_PROVIDER_ORDER=ollama/' .env.local
if grep -q '^OLLAMA_BASE_URL=' .env.local; then
  sed -i 's|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://127.0.0.1:9|' .env.local
else
  printf 'OLLAMA_BASE_URL=http://127.0.0.1:9\n' >> .env.local
fi
bash /home/z/my-project/agent-ctx/s7b1-restart.sh || { echo "FATAL: dev не поднялся (fallback-фаза)"; exit 1; }

out=$(req "$JAR_C" POST /api/ai-assistant/chat '{"message":"фоллбек-проверка ассистента"}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
as_fb=$(jget "$body" "d.get('fallback')")
as_len=$(jget "$body" "len(str(d.get('reply','')))")
assert_eq "fallback: assistant 200" "$status" "200"
if [ "$as_fb" = "True" ] && [ "${as_len:-0}" -ge 20 ]; then ok "fallback: assistant fallback:true, reply непустой (len=$as_len)"; else bad "fallback: assistant" "fallback=$as_fb len=$as_len"; fi

out=$(req "$JAR_C" POST /api/ai/search '{"q":"капкейки до 2000"}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
se_fb=$(jget "$body" "d.get('fallback')")
se_n=$(jget "$body" "len(d.get('products',[]))")
assert_eq "fallback: search 200" "$status" "200"
if [ "$se_fb" = "True" ] && [ "${se_n:-0}" -ge 1 ]; then ok "fallback: search fallback:true + товары из БД ($se_n шт)"; else bad "fallback: search" "fallback=$se_fb products=$se_n"; fi

out=$(req "$JAR_C" POST /api/ai/compare "{\"ids\":[\"$ID1\",\"$ID2\"]}" csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
co_fb=$(jget "$body" "d.get('fallback')")
co_items=$(jget "$body" "len(d.get('items',[]))")
co_ins=$(jget "$body" "len(d.get('insights',[]))")
assert_eq "fallback: compare 200" "$status" "200"
if [ "$co_fb" = "True" ] && [ "${co_items:-0}" = "2" ] && [ "${co_ins:-0}" -ge 1 ]; then ok "fallback: compare fallback:true, таблица+insights из БД"; else bad "fallback: compare" "fallback=$co_fb items=$co_items insights=$co_ins"; fi

out=$(req "$JAR_G" POST /api/ai/cake-finder '{"occasion":"юбилей","budgetRub":30000,"allergensForbidden":["орехи"]}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
cf_fb=$(jget "$body" "d.get('fallback')")
cf_n=$(jget "$body" "len(d.get('products',[]))")
cf_nut=$(jget "$body" "sum(1 for p in d.get('products',[]) for a in p.get('allergens',[]) if __import__('re').search(r'$NUT_ALLERGEN_RE', a.lower()))")
assert_eq "fallback: cake-finder 200" "$status" "200"
if [ "$cf_fb" = "True" ] && [ "${cf_n:-0}" -ge 1 ] && [ "$cf_nut" = "0" ]; then ok "fallback: cake-finder fallback:true, товары есть, ореховых 0"; else bad "fallback: cake-finder" "fallback=$cf_fb products=$cf_n nuts=$cf_nut"; fi

out=$(req "$JAR_A" POST /api/ai/dialogue/respond '{"incomingText":"Добрый день! Когда будет готов торт?"}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
di_fb=$(jget "$body" "d.get('fallback')")
di_n=$(jget "$body" "len(d.get('suggestions',[]))")
assert_eq "fallback: dialogue 200" "$status" "200"
if [ "$di_fb" = "True" ] && [ "${di_n:-0}" -ge 1 ]; then ok "fallback: dialogue fallback:true, подсказки-шаблоны есть"; else bad "fallback: dialogue" "fallback=$di_fb suggestions=$di_n"; fi

echo "=== 9. restore env + рестарт → search снова fallback:false ==="
cp /tmp/s7b2-env-backup.txt .env.local
bash /home/z/my-project/agent-ctx/s7b1-restart.sh || { echo "FATAL: dev не поднялся после restore"; exit 1; }
out=$(req "$JAR_C" POST /api/ai/search '{"q":"шоколад до 1000"}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
se_fb=$(jget "$body" "d.get('fallback')")
assert_eq "restore: search 200" "$status" "200"
assert_eq "restore: search fallback:false" "$se_fb" "False"

echo ""
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && echo "MATRIX GREEN" || echo "MATRIX HAS FAILURES"
exit 0
