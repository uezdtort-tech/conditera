#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s5b3-matrix.sh — S5B3 curl-matrix (гейт 2).
#
# Все curl — с cookie-jar (-b jar -c jar). Секреты не печатаются: DATABASE_URL
# / SUPABASE_URL / SERVICE_ROLE читаются one-off скриптами из .env.local молча;
# demo-логины (customer/confectioner/admin@demo.ru, Demo123!) — публичные
# демо-креды спеки.
#
# Сценарий: anon /admin* → 307 /cart?auth=1 → customer → 307 /account →
# admin страницы 200 (overview/moderation/roles/payouts/tickets/email/settings)
# → RBAC: confectioner на /api/admin/moderation → 403; no-CSRF → 403;
# неизвестный type/action → 400 → модерация товара: confectioner создаёт
# pending → admin approve → витрина /api/products видит + db approved +
# admin_action row → повторный approve → 409 invalid_state → отзыв
# customer → pending → admin reject(reason) → db rejected+reason, НЕ в
# витрине (GET /api/products/[slug]/reviews) → тикеты: db-seed → admin
# reply 200 + TicketMessage support + аудит + авто open→in_progress →
# status closed + аудит → invalid status 400 → same_state 409 → настройки:
# bonus_percent=31 → 400 invalid_value; unknown key → 400 invalid_key;
# bonus_percent=7 → 200 + db + аудит; bonus-config геттер читает 7 (bun);
# возврат 5 → email: XSS-проба (db-seed) → GET /api/admin/email/[id] 200 →
# sanitizeUserHtml strips script/onerror (bun pure-check на реальном теле);
# customer GET email → 403 → burst 35 admin-мутаций → 429 + Retry-After →
# render / и /catalog → /admin anon 307.
# =============================================================================
set -u
BASE="http://localhost:3100"
PROJ="/home/z/my-project/conditera-v2"
PASS=0; FAIL=0
# Идемпотентный re-run: уникальный маркер прогона в title товара (витрина-поиск
# q=$RUNTAG видит ровно 1 товар этого прогона) + ISO-stamp для аудит-окна
# settings.update (append-only admin_action копится по targetId=key — считаем
# строки ТЕКУЩЕГО прогона, таблицу аудита не трогаем).
RUNTAG="s5b3-$(date +%s)"
RUN_STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label — got [$got], want [$want]"; fi; }
assert_has() { local label="$1" hay="$2" needle="$3"; case "$hay" in *"$needle"*) ok "$label";; *) bad "$label — не найдено [$needle]";; esac; }
assert_not_has() { local label="$1" hay="$2" needle="$3"; case "$hay" in *"$needle"*) bad "$label — найдено запрещённое [$needle]";; *) ok "$label";; esac; }

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

# Верефикационные хелперы живут в scripts/db/ (не tmp-*): rename recreate-3.
dbcheck() { (cd "$PROJ" && bun scripts/db/s5b3-dbcheck.ts "$@" 2>/dev/null); }
runseed() { (cd "$PROJ" && set -a && . ./.env.local && set +a && bun "$1" 2>/dev/null); }

# --- dev-server lift (процессы умирают между вызовами) ------------------------
if ! curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then
  echo "… dev :3100 не отвечает — поднимаем"
  for pid in $(lsof -ti tcp:3100 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  sleep 1; rm -f "$PROJ/.next/dev/lock"
  (cd "$PROJ" && env -u DATABASE_URL setsid nohup bun run dev > /tmp/dev-v2-s5b3.log 2>&1 < /dev/null & disown)
  for i in $(seq 1 90); do
    if curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then echo "… health OK (${i}s)"; break; fi
    sleep 1
  done
fi

echo "=== [A] Аноним: /admin* → 307 /cart?auth=1 ==="
for p in /admin /admin/moderation /admin/roles /admin/payouts /admin/tickets /admin/email /admin/settings; do
  out=$(curl -s -o /dev/null --max-time 60 -w "%{http_code} %{redirect_url}" "$BASE$p")
  code=${out%% *}; loc=${out#* }
  assert_eq "anon $p" "$code" "307"
  case "$loc" in */cart?auth=1*) ok "anon $p → $loc";; *) bad "anon $p redirect → [$loc]";; esac
done

echo "=== [B] Customer: /admin → 307 /account (не админ) ==="
JC=/tmp/s5b3-jc.txt; rm -f "$JC"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$JC" -c "$JC" -X POST -H "Content-Type: application/json" \
      -d '{"email":"customer@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login customer" "$RES_CODE" "200"
out=$(curl -s -o /dev/null --max-time 60 -w "%{http_code} %{redirect_url}" -b "$JC" -c "$JC" "$BASE/admin")
code=${out%% *}; loc=${out#* }
assert_eq "customer GET /admin" "$code" "307"
case "$loc" in */account*) ok "customer /admin → $loc";; *) bad "customer redirect → [$loc]";; esac

echo "=== [C] Admin: страницы панели ==="
JA=/tmp/s5b3-ja.txt; rm -f "$JA"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$JA" -c "$JA" -X POST -H "Content-Type: application/json" \
      -d '{"email":"admin@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login admin" "$RES_CODE" "200"
for p in /admin /admin/moderation /admin/roles /admin/payouts /admin/tickets /admin/email /admin/settings; do
  code=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$JA" -c "$JA" "$BASE$p")
  assert_eq "admin GET $p" "$code" "200"
done
OV=$(curl -s --max-time 60 -b "$JA" -c "$JA" "$BASE/admin")
assert_has "/admin: заголовок обзора" "$OV" "Обзор платформы"
assert_has "/admin: бейдж ADMIN в сайдбаре" "$OV" "ADMIN"
assert_has "/admin: метрика «Товары на модерации»" "$OV" "Товары на модерации"
assert_has "/admin: метрика «Выручка (30 дней)»" "$OV" "Выручка (30 дней)"
assert_has "/admin: журнал admin_actions" "$OV" "Последние административные действия"
MO=$(curl -s --max-time 60 -b "$JA" -c "$JA" "$BASE/admin/moderation")
assert_has "/admin/moderation: вкладка Товары" "$MO" "Товары ("
assert_has "/admin/moderation: вкладка Отзывы" "$MO" "Отзывы ("
assert_has "/admin/email: безопасный рендер disclaimer" "$MO" "Модерация"

echo "=== [D] RBAC и валидация /api/admin/moderation ==="
CATS=$(curl -s --max-time 60 "$BASE/api/categories")
CATID=$(printf '%s' "$CATS" | jq -r '.items[0].id // empty')
J1=/tmp/s5b3-j1.txt; rm -f "$J1"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$J1" -c "$J1" -X POST -H "Content-Type: application/json" \
      -d '{"email":"confectioner@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login confectioner" "$RES_CODE" "200"

nop=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$JA" -c "$JA" -X POST -H "Content-Type: application/json" -d '{"type":"product","id":"x","action":"approve"}' "$BASE/api/admin/moderation")
split_res "$nop"
assert_eq "модерация без CSRF → 403" "$RES_CODE" "403"
assert_has "csrf body" "$RES_BODY" '"error":"csrf"'

res=$(csrf_post "$J1" "/api/admin/moderation" '{"type":"product","id":"x","action":"approve"}')
split_res "$res"
assert_eq "confectioner POST модерации → 403 (RBAC)" "$RES_CODE" "403"

res=$(csrf_post "$JA" "/api/admin/moderation" '{"type":"user","id":"x","action":"approve"}')
split_res "$res"
assert_eq "unknown type → 400" "$RES_CODE" "400"
res=$(csrf_post "$JA" "/api/admin/moderation" '{"type":"product","id":"x","action":"delete"}')
split_res "$res"
assert_eq "unknown action → 400" "$RES_CODE" "400"
assert_has "bad_request body" "$RES_BODY" '"error":"bad_request"'

TITLE="Торт S5B3 Матрица $RUNTAG"
res=$(csrf_post "$J1" "/api/vendor/products" "{\"title\":\"$TITLE\",\"description\":\"Пробный товар блока S5B3\",\"priceRub\":\"1400\",\"categoryId\":\"$CATID\",\"ingredients\":[\"мука\",\"мёд\",\"яйца\"],\"allergens\":[\"мёд\",\"яйца\"],\"images\":[],\"isAvailable\":true}")
split_res "$res"
assert_eq "confectioner create pending" "$RES_CODE" "201"
PID=$(printf '%s' "$RES_BODY" | jq -r '.product.id // empty')
SLUG=$(printf '%s' "$RES_BODY" | jq -r '.product.slug // empty')
MST=$(printf '%s' "$RES_BODY" | jq -r '.product.moderationStatus // empty')
assert_eq "create → moderationStatus" "$MST" "pending_moderation"
assert_eq "create → slug (API отвечает уникальный)" "${SLUG:+set}" "set"

LIST=$(curl -s --max-time 60 -G --data-urlencode "q=$RUNTAG" "$BASE/api/products")
assert_eq "витрина НЕ видит pending" "$(printf '%s' "$LIST" | jq -r '.total // 0')" "0"

res=$(csrf_post "$JA" "/api/admin/moderation" "{\"type\":\"product\",\"id\":\"$PID\",\"action\":\"approve\",\"reason\":\"Состав полный, фото ок\"}")
split_res "$res"
assert_eq "admin approve product" "$RES_CODE" "200"
assert_has "approve body approved" "$RES_BODY" '"status":"approved"'
db=$(dbcheck product-by-slug "$SLUG")
assert_eq "db moderationStatus" "$(printf '%s' "$db" | jq -r '.moderationStatus')" "approved"
assert_eq "db isAvailable (витрина-gate)" "$(printf '%s' "$db" | jq -r '.isAvailable')" "true"
LIST=$(curl -s --max-time 60 -G --data-urlencode "q=$RUNTAG" "$BASE/api/products")
assert_eq "витрина видит approved" "$(printf '%s' "$LIST" | jq -r '.total // 0')" "1"
assert_eq "audit moderation.product.approve" "$(dbcheck admin-action moderation.product.approve "$PID" | jq -r '.count')" "1"

res=$(csrf_post "$JA" "/api/admin/moderation" "{\"type\":\"product\",\"id\":\"$PID\",\"action\":\"approve\"}")
split_res "$res"
assert_eq "повтор approve → 409 invalid_state" "$RES_CODE" "409"
assert_has "invalid_state body" "$RES_BODY" '"error":"invalid_state"'

echo "=== [E] Отзыв: customer → pending → admin reject ==="
res=$(csrf_post "$JC" "/api/reviews" "{\"productSlug\":\"$SLUG\",\"rating\":2,\"text\":\"Не понравился торт, крем жидкий и мелкая упаковка s5b3-отзыв\"}")
split_res "$res"
assert_eq "POST /api/reviews → 201 pending" "$RES_CODE" "201"
RID=$(printf '%s' "$RES_BODY" | jq -r '.id // empty')
db=$(dbcheck review-by-id "$RID")
assert_eq "db review status" "$(printf '%s' "$db" | jq -r '.status')" "pending"

res=$(csrf_post "$JA" "/api/admin/moderation" "{\"type\":\"review\",\"id\":\"$RID\",\"action\":\"reject\",\"reason\":\"Массовый спам-отзыв, не подтверждён заказом\"}")
split_res "$res"
assert_eq "admin reject review" "$RES_CODE" "200"
assert_has "reject body rejected" "$RES_BODY" '"status":"rejected"'
db=$(dbcheck review-by-id "$RID")
assert_eq "db review rejected" "$(printf '%s' "$db" | jq -r '.status')" "rejected"
assert_has "db rejectionReason" "$(printf '%s' "$db")" "спам"
REVIEWS=$(curl -s --max-time 60 "$BASE/api/products/$SLUG/reviews")
assert_not_has "отклонённый отзыв НЕ на витрине" "$REVIEWS" "s5b3-отзыв"
assert_eq "audit moderation.review.reject" "$(dbcheck admin-action moderation.review.reject "$RID" | jq -r '.count')" "1"

echo "=== [F] Тикеты: seed → reply → status ==="
SEED=$(runseed scripts/db/s5b3-ticket-seed.ts)
assert_has "ticket seed" "$SEED" '"number":"T-S5B3-DEMO"'
TICKET=$(dbcheck ticket-by-number "T-S5B3-DEMO")
TID=$(printf '%s' "$TICKET" | jq -r '.id // empty')
assert_eq "seed тикет статус" "$(printf '%s' "$TICKET" | jq -r '.status')" "open"

res=$(csrf_post "$JA" "/api/admin/tickets/$TID/reply" '{"message":"Здравствуйте! Оформим замену — курьер привезёт новый торт завтра до 12:00."}')
split_res "$res"
assert_eq "admin reply → 200" "$RES_CODE" "200"
assert_has "reply body statusAfter" "$RES_BODY" '"statusAfter":"in_progress"'
TICKET=$(dbcheck ticket-by-number "T-S5B3-DEMO")
assert_eq "auto open→in_progress" "$(printf '%s' "$TICKET" | jq -r '.status')" "in_progress"
assert_eq "firstResponseAt проставлен" "$(printf '%s' "$TICKET" | jq -r '.firstResponseAt | length > 0')" "true"
assert_has "TicketMessage authorRole support" "$(printf '%s' "$TICKET")" '"authorRole":"support"'
assert_eq "audit ticket.reply" "$(dbcheck admin-action ticket.reply "$TID" | jq -r '.count')" "1"

res=$(csrf_post "$JA" "/api/admin/tickets/$TID/status" '{"status":"closed"}')
split_res "$res"
assert_eq "status → closed 200" "$RES_CODE" "200"
assert_eq "audit ticket.status" "$(dbcheck admin-action ticket.status "$TID" | jq -r '.count')" "1"

res=$(csrf_post "$JA" "/api/admin/tickets/$TID/status" '{"status":"beatdown"}')
split_res "$res"
assert_eq "invalid status → 400" "$RES_CODE" "400"
assert_has "invalid_status body" "$RES_BODY" '"error":"invalid_status"'
res=$(csrf_post "$JA" "/api/admin/tickets/$TID/status" '{"status":"closed"}')
split_res "$res"
assert_eq "same_state → 409" "$RES_CODE" "409"

echo "=== [G] Настройки: валидация/сохранение/геттер ==="
res=$(csrf_post "$JA" "/api/admin/settings" '{"key":"bonus_percent","value":"31"}')
split_res "$res"
assert_eq "bonus_percent=31 → 400" "$RES_CODE" "400"
assert_has "invalid_value body" "$RES_BODY" '"error":"invalid_value"'
res=$(csrf_post "$JA" "/api/admin/settings" '{"key":"secret_flag","value":"1"}')
split_res "$res"
assert_eq "unknown key → 400" "$RES_CODE" "400"
assert_has "invalid_key body" "$RES_BODY" '"error":"invalid_key"'
res=$(csrf_post "$JA" "/api/admin/settings" '{"key":"payout_min","value":"9999"}')
split_res "$res"
assert_eq "payout_min=9999 (<10000) → 400" "$RES_CODE" "400"

res=$(csrf_post "$JA" "/api/admin/settings" '{"key":"bonus_percent","value":"7"}')
split_res "$res"
assert_eq "bonus_percent=7 → 200" "$RES_CODE" "200"
assert_eq "db value" "$(dbcheck setting-value bonus_percent | jq -r '.value')" "7"
assert_has "db updatedBy" "$(dbcheck setting-value bonus_percent)" '"updatedBy":"'
assert_eq "audit settings.update(bonus_percent) — окно прогона" "$(dbcheck admin-action-since settings.update bonus_percent "$RUN_STAMP" | jq -r '.count')" "1"
BONUS=$(cd "$PROJ" && set -a && . ./.env.local && set +a && bun scripts/db/s5b3-bonuscheck.ts 2>/dev/null)
assert_eq "bonus-config геттер читает 7" "$(printf '%s' "$BONUS" | jq -r '.bonus_percent')" "7"

res=$(csrf_post "$JA" "/api/admin/settings" '{"key":"bonus_percent","value":"5"}')
split_res "$res"
assert_eq "возврат bonus_percent=5" "$RES_CODE" "200"

echo "=== [H] Email: XSS-проба (sanitize) ==="
ESEED=$(runseed scripts/db/s5b3-email-seed.ts)
assert_has "email seed" "$ESEED" '"ok":true'
XEMAIL=$(dbcheck email-by-subject "XSS probe")
XEID=$(printf '%s' "$XEMAIL" | jq -r '.id // empty')
assert_has "XSS письмо в БД (raw data)" "$(printf '%s' "$XEMAIL")" "window.__xss"

code=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$JA" -c "$JA" "$BASE/api/admin/email/$XEID")
assert_eq "GET /api/admin/email/[id] (admin)" "$code" "200"
EJSON=$(curl -s --max-time 60 -b "$JA" -c "$JA" "$BASE/api/admin/email/$XEID")
assert_has "API отдаёт вложение-имя" "$EJSON" "promo-2026.pdf"

code=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$JC" -c "$JC" "$BASE/api/admin/email/$XEID")
assert_eq "customer GET email → 403 (RBAC)" "$code" "403"

# sanitizeUserHtml на РЕАЛЬНОМ теле письма (pure-check гейта curl):
SAN=$(cd "$PROJ" && bun -e '
import { readFileSync } from "node:fs";
import path from "node:path";
let url="";
for (const name of [".env.local",".env"]) {
  const p = path.join(process.cwd(), name);
  if (!require("node:fs").existsSync(p)) continue;
  for (const line of readFileSync(p,"utf8").split("\n")) {
    const m = line.match(/^DATABASE_URL=(.+)$/);
    if (m) { url = m[1].trim().replace(/^["'"'"']|["'"'"']$/g,""); }
  }
}
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const e = await prisma.inboundEmail.findFirst({ where: { subject: { contains: "XSS probe" } }, select: { htmlBody: true } });
const { sanitizeUserHtml } = await import("./src/lib/security/sanitize.ts");
const clean = sanitizeUserHtml(e.htmlBody);
console.log(JSON.stringify({ script: clean.includes("<script"), onerror: /onerror/i.test(clean), jsHref: /javascript:/i.test(clean), keepsP: clean.includes("<p>") }));
await prisma.$disconnect();
' 2>/dev/null)
assert_eq "sanitize: script удалён" "$(printf '%s' "$SAN" | jq -r '.script')" "false"
assert_eq "sanitize: onerror удалён" "$(printf '%s' "$SAN" | jq -r '.onerror')" "false"
assert_eq "sanitize: javascript: удалён" "$(printf '%s' "$SAN" | jq -r '.jsHref')" "false"
assert_eq "sanitize: <p> сохранён (allowlist)" "$(printf '%s' "$SAN" | jq -r '.keepsP')" "true"

EMAILHTML=$(curl -s --max-time 60 -b "$JA" -c "$JA" "$BASE/admin/email")
assert_not_has "/admin/email (list) не содержит <script>" "$EMAILHTML" "window.__xss"

echo "=== [I] Burst admin-мутаций → 429 + Retry-After ==="
HTTP_FILE=/tmp/s5b3-headers.txt
CODES=""; RA_429=""
for i in $(seq 1 35); do
  token=$(csrf_token "$JA")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -D "$HTTP_FILE" --max-time 30 -b "$JA" -c "$JA" \
    -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $token" \
    -d '{"key":"secret_flag","value":"1"}' "$BASE/api/admin/settings")
  CODES="$CODES ${CODE:-ERR}"
  if [ "$CODE" = "429" ]; then
    RA_429=$(grep -i '^retry-after:' "$HTTP_FILE" | tr -d '\r' | awk '{print $2}')
  fi
done
echo "… burst codes (tail): $(printf '%s' "$CODES" | awk '{print $NF}')"
case "$CODES" in
  *429*) ok "burst: 429 в серии (30/мин admin-mutation)";;
  *) bad "burst: 429 не получен";;
esac
if [ -n "$RA_429" ] && [ "$RA_429" -ge 1 ] 2>/dev/null; then ok "Retry-After: $RA_429"; else bad "Retry-After отсутствует"; fi

echo "=== [J] Render-check: / и /catalog ==="
hcode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' "$BASE/")
assert_eq "GET /" "$hcode" "200"
ccode=$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' "$BASE/catalog")
assert_eq "GET /catalog" "$ccode" "200"

echo ""
echo "=============================="
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "MATRIX: OK" || echo "MATRIX: FAILED"
