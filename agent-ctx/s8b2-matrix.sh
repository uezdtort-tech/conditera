#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s8b2-matrix.sh — S8B2 curl-матрица (гейт 1).
#
# Все curl — с cookie-jar (-b jar -c jar). Секрет CRON_SECRET читается из
# .env.local и НИКОГДА не печатается (только длина для диагностики).
#
# Сценарий (гейт S8B2):
#   0) рестарт dev :3100 (свежий env + чистый in-memory rate-limit store);
#      приёмник n8n :5678 уже должен работать (healthz опрашивается без
#      рестарта — receiver с рестартом dev не связан);
#   1) receiver: GET /healthz 200 → запомнить received; POST /events ×2 →
#      healthz received = старое + 2; GET /events показывает события;
#      POST /events мусором → 400;
#   2) render: / 200, /catalog 200;
#   3) sitemap-refresh с секретом → 200 success (HTTP-шаг воркфлоу вручную);
#   4) download воркфлоу: аноним 401 / customer 403 / admin 200, тело == файл
#      (byte-compare c n8n-workflows/abandoned-cart.json); unknown → 404;
#   5) grep-гейты по всем 20 JSON: localhost=0, литералов секрета=0,
#      файлов с $env.CRON_SECRET=20;
#   6) bun scripts/smoke/n8n-simulate.ts → сводка 20/20 (11+9), exit 0;
#   7) render /admin/automation anon → 307 (гвард).
# =============================================================================
set -u
BASE="http://localhost:3100"
RECEIVER="http://127.0.0.1:5678"
PROJ="/home/z/my-project/conditera-v2"
CTX="/home/z/my-project/agent-ctx"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 — $2"; }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label" "got [$got], want [$want]"; fi; }

JAR_A="/tmp/s8b2-jar-admin.txt"
JAR_C="/tmp/s8b2-jar-customer.txt"
rm -f "$JAR_A" "$JAR_C"

# Секрет из .env.local (не печатается).
CRON_SECRET_VALUE=$(grep "^CRON_SECRET=" "$PROJ/.env.local" | cut -d= -f2- | tr -d '\r\n')
[ -n "$CRON_SECRET_VALUE" ] && echo "cron secret loaded (len=${#CRON_SECRET_VALUE})" || { echo "FATAL: CRON_SECRET не найден"; exit 1; }

csrf() { curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"; }

# raw <method> <path> [extra curl args...] -> "<code>\n<body>"
raw() {
  local method="$1" path="$2"; shift 2
  local out; out=$(curl -s -m 180 -X "$method" -w '\n%{http_code}' "$BASE$path" "$@" 2>/dev/null)
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

req() { # jar method path data csrf_flag -> "<code>\n<body>"
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  local args=(-s -m 180 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf "$jar")")
  local out; out=$(curl "${args[@]}" 2>/dev/null)
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

jget() { printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)" 2>/dev/null || echo "JGET_ERR"; }

echo "=== 0. рестарт dev :3100 (scoped, env из .env.local) ==="
pkill -f "next dev -H 0.0.0.0 -p 3100" 2>/dev/null || true
pkill -f "conditera-v2.*next-server" 2>/dev/null || true
for i in $(seq 1 15); do ss -ltn 2>/dev/null | grep -q ":3100 " || break; sleep 1; done
cd "$PROJ"
set -a; . ./.env.local; set +a
setsid nohup bun run dev >> /tmp/dev-v2.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3100/ 2>/dev/null)
  if [ "$code" != "000" ] && [ "$code" != "" ]; then echo "dev :3100 ready after $((i*2))s ($code)"; break; fi
done
curl -s -o /dev/null -w "" --max-time 3 http://localhost:3100/ || { echo "FATAL: dev не поднялся"; exit 1; }
ss -ltn | grep -q "127.0.0.1:5678" || { echo "FATAL: приёмник :5678 не слушает"; exit 1; }
echo "receiver :5678 listening (127.0.0.1)"

echo "=== 1. receiver: healthz → POST /events ×2 → counter+2 ==="
out=$(curl -s -m 10 -w '\n%{http_code}' "$RECEIVER/healthz")
hcode=$(printf '%s' "$out" | tail -1); hbody=$(printf '%s' "$out" | sed '$d')
assert_eq "healthz 200" "$hcode" "200"
assert_eq "healthz status=ok" "$(jget "$hbody" "d.get('status')")" "ok"
RECEIVED0=$(jget "$hbody" "d.get('received')")
if [ "${RECEIVED0:-x}" != "x" ] && [ "${RECEIVED0:-x}" != "JGET_ERR" ]; then ok "healthz received=$RECEIVED0 (24ч)"; else bad "healthz received" "got [$RECEIVED0]"; fi
if [ -n "${RECEIVED0:-}" ] && [ "${RECEIVED0:-}" != "JGET_ERR" ]; then uptime=$(jget "$hbody" "d.get('uptimeSeconds')"); [ "${uptime:-0}" -ge 0 ] && ok "healthz uptimeSeconds=$uptime"; else bad "healthz uptime" "нет числа"; fi

curl -s -o /dev/null -m 10 -X POST "$RECEIVER/events" -H "Content-Type: application/json" \
  -d '{"task":"sitemap-refresh","status":"smoke","meta":{"src":"matrix","i":1}}'
curl -s -o /dev/null -m 10 -X POST "$RECEIVER/events" -H "Content-Type: application/json" \
  -d '{"task":"cleanup","status":"smoke","meta":{"src":"matrix","i":2}}'
out=$(curl -s -m 10 -w '\n%{http_code}' "$RECEIVER/healthz")
hcode=$(printf '%s' "$out" | tail -1); hbody=$(printf '%s' "$out" | sed '$d')
RECEIVED1=$(jget "$hbody" "d.get('received')")
assert_eq "healthz после ×2 200" "$hcode" "200"
assert_eq "counter+2" "$RECEIVED1" "$((RECEIVED0 + 2))"
out=$(curl -s -m 10 "$RECEIVER/events")
assert_eq "GET /events показывает 2 события" "$(jget "$out" "sum(1 for e in d.get('events',[]) if e.get('meta',{}).get('src')=='matrix')")" "2"
ecode=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X POST "$RECEIVER/events" -H "Content-Type: application/json" -d 'not-json')
assert_eq "POST /events мусором 400" "$ecode" "400"

echo "=== 2. render ==="
code=$(curl -s -o /dev/null -w "%{http_code}" -m 60 "$BASE/")
assert_eq "render /" "$code" "200"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 60 "$BASE/catalog")
assert_eq "render /catalog" "$code" "200"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 90 "$BASE/admin/automation")
assert_eq "render /admin/automation anon -> 307" "$code" "307"

echo "=== 3. HTTP-шаг воркфлоу вручную: sitemap-refresh с секретом ==="
out=$(raw POST "/api/cron/run/sitemap-refresh" -H "X-Cron-Secret: $CRON_SECRET_VALUE" -H "X-Cron-Source: n8n")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "sitemap-refresh с секретом 200" "$status" "200"
assert_eq "sitemap-refresh status=success" "$(jget "$body" "d.get('status')")" "success"
assert_eq "sitemap-refresh trigger=cron" "$(jget "$body" "d.get('trigger')")" "cron"

echo "=== 4. download воркфлоу: anon 401 / customer 403 / admin 200 == файл ==="
out=$(raw GET "/api/admin/automation/workflow/abandoned-cart")
assert_eq "download аноним 401" "$(printf '%s' "$out" | head -1)" "401"
out=$(req "$JAR_C" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
assert_eq "login customer 200" "$(printf '%s' "$out" | head -1)" "200"
out=$(req "$JAR_C" GET "/api/admin/automation/workflow/abandoned-cart")
assert_eq "download customer 403" "$(printf '%s' "$out" | head -1)" "403"
out=$(req "$JAR_A" POST /api/auth/login '{"email":"admin@demo.ru","password":"Demo123!"}')
assert_eq "login admin 200" "$(printf '%s' "$out" | head -1)" "200"
code=$(curl -s -o /tmp/s8b2-dl-abandoned-cart.json -w "%{http_code}" -m 30 -b "$JAR_A" -c "$JAR_A" \
  -D /tmp/s8b2-dl-headers.txt "$BASE/api/admin/automation/workflow/abandoned-cart")
assert_eq "download admin 200" "$code" "200"
if diff -q /tmp/s8b2-dl-abandoned-cart.json "$PROJ/n8n-workflows/abandoned-cart.json" >/dev/null 2>&1; then
  ok "download admin == файл (byte-compare)"
else
  bad "download admin == файл" "тело отличается от n8n-workflows/abandoned-cart.json"
fi
disposition=$(tr -d '\r' < /tmp/s8b2-dl-headers.txt | grep -i "^content-disposition:" || true)
case "$disposition" in *attachment*conditera-v2-abandoned-cart*) ok "Content-Disposition attachment";; *) bad "Content-Disposition" "got [$disposition]";; esac
out=$(req "$JAR_A" GET "/api/admin/automation/workflow/never-existed-task")
assert_eq "download unknown 404" "$(printf '%s' "$out" | head -1)" "404"

echo "=== 5. grep-гейты по 20 JSON ==="
cd "$PROJ"
loc=$(grep -l -E 'localhost|127\.0\.0\.1|0\.0\.0\.0' n8n-workflows/*.json 2>/dev/null | wc -l)
assert_eq "файлов с localhost/127.0.0.1/0.0.0.0 = 0" "$loc" "0"
leaks=$(grep -l "$CRON_SECRET_VALUE" n8n-workflows/*.json 2>/dev/null | wc -l)
assert_eq "файлов с литералом секрета = 0" "$leaks" "0"
envsec=$(grep -l '\$env\.CRON_SECRET' n8n-workflows/*.json 2>/dev/null | wc -l)
assert_eq "файлов с \$env.CRON_SECRET = 20" "$envsec" "20"
files=$(ls n8n-workflows/*.json | wc -l)
assert_eq "файлов воркфлоу = 20" "$files" "20"
bun scripts/n8n/validate-workflows.ts >/dev/null 2>&1 && ok "bun validate-workflows OK" || bad "validate-workflows" "валидатор нашёл нарушения"

echo "=== 6. smoke-симуляция n8n: 20/20 ==="
smoke_out=$(bun scripts/smoke/n8n-simulate.ts 2>&1)
smoke_code=$?
summary=$(printf '%s' "$smoke_out" | grep "СВОДКА" | tail -1)
echo "$smoke_out" | tail -3
assert_eq "smoke exit 0" "$smoke_code" "0"
case "$summary" in *"20/20 (REAL 11/11, disabled 9/9)"*) ok "smoke сводка 20/20 (11+9)";; *) bad "smoke сводка" "got [$summary]";; esac

echo ""
echo "==================================="
echo "S8B2 matrix: PASS=$PASS FAIL=$FAIL"
echo "==================================="
[ "$FAIL" -eq 0 ] || exit 1
