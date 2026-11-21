#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s8b1-matrix.sh — S8B1 curl-матрица (гейт 1).
#
# Все curl — с cookie-jar (-b jar -c jar). Секрет CRON_SECRET читается из
# .env.local и НИКОГДА не печатается (только длина для диагностики).
# Демо-креды публичные (admin/customer@demo.ru, Demo123!).
#
# Сценарий (гейт S8B1):
#   0) рестарт dev :3100 (свежий env + чистый in-memory rate-limit store);
#   1) render: / 200, /catalog 200, /admin/automation anon 307;
#   2) unknown taskId 404 (секрет); GET-запуск запрещён (405 — только POST);
#   3) sitemap-refresh: аноним 401 → с секретом 200 success + stats.urlCount;
#      CronRun-строка в БД (bun dbcheck: success, trigger=cron, stats есть);
#   4) cleanup с секретом 200 + stats (csrfSwept/storage/staleCartsPurged);
#   5) disabled (subscriptions) с секретом → 409 task_disabled;
#   6) admin manual (без секрета, одноразовый CSRF) → 200 trigger=manual
#      + CronRun-строка trigger=manual;
#   7) status: секрет 200 (20 задач) / admin 200 / customer 403;
#   8) легаси-контракты с секретом: auto-complete POST, expiring-bonuses POST,
#      payment-reminders GET, storage-cleanup POST → 200 + ключи контрактов;
#   9) rate-limit: уникальный X-Forwarded-For, 20× POST → 404, 21-й → 429
#      + Retry-After.
# =============================================================================
set -u
BASE="http://localhost:3100"
PROJ="/home/z/my-project/conditera-v2"
CTX="/home/z/my-project/agent-ctx"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 — $2"; }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label" "got [$got], want [$want]"; fi; }

JAR_A="/tmp/s8b1-jar-admin.txt"
JAR_C="/tmp/s8b1-jar-customer.txt"
rm -f "$JAR_A" "$JAR_C"

# Секрет из .env.local (не печатается).
CRON_SECRET_VALUE=$(grep "^CRON_SECRET=" "$PROJ/.env.local" | cut -d= -f2- | tr -d '\r\n')
[ -n "$CRON_SECRET_VALUE" ] && echo "cron secret loaded (len=${#CRON_SECRET_VALUE})" || { echo "FATAL: CRON_SECRET не найден"; exit 1; }

csrf() { curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"; }

# raw <method> <path> [extra curl args...] -> "<code>\n<body>"
raw() {
  local method="$1" path="$2"; shift 2
  local out; out=$(curl -s -m 120 -X "$method" -w '\n%{http_code}' "$BASE$path" "$@" 2>/dev/null)
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

req() { # jar method path data csrf_flag -> "<code>\n<body>"
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  local args=(-s -m 120 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
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

echo "=== 1. render ==="
code=$(curl -s -o /dev/null -w "%{http_code}" -m 60 "$BASE/")
assert_eq "render /" "$code" "200"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 60 "$BASE/catalog")
assert_eq "render /catalog" "$code" "200"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 60 "$BASE/admin/automation")
assert_eq "render /admin/automation anon -> 307" "$code" "307"

echo "=== 2. исполнитель: unknown 404 + GET-запуск запрещён ==="
out=$(raw POST "/api/cron/run/nonexistent-task-xyz" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
assert_eq "unknown taskId (секрет) 404" "$(printf '%s' "$out" | head -1)" "404"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 60 -b "$JAR_A" -c "$JAR_A" -X GET "$BASE/api/cron/run/sitemap-refresh" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
assert_eq "GET-запуск запрещён (405)" "$code" "405"

echo "=== 3. sitemap-refresh: 401 -> секрет 200 + CronRun ==="
out=$(raw POST "/api/cron/run/sitemap-refresh")
assert_eq "sitemap-refresh аноним 401" "$(printf '%s' "$out" | head -1)" "401"
out=$(raw POST "/api/cron/run/sitemap-refresh" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "sitemap-refresh с секретом 200" "$status" "200"
assert_eq "sitemap-refresh status=success" "$(jget "$body" "d.get('status')")" "success"
assert_eq "sitemap-refresh trigger=cron" "$(jget "$body" "d.get('trigger')")" "cron"
url_count=$(jget "$body" "d.get('stats',{}).get('urlCount')")
if [ "${url_count:-0}" -ge 1 ]; then ok "sitemap-refresh urlCount=$url_count (>=1)"; else bad "sitemap-refresh urlCount" "got [$url_count]"; fi
db=$(node "$PROJ/scripts/db/s8b1-dbcheck.mjs" sitemap-refresh success cron 2>/dev/null)
case "$db" in FOUND*) ok "dbcheck CronRun sitemap-refresh ($db)";; *) bad "dbcheck CronRun" "got [$db]";; esac

echo "=== 4. cleanup с секретом: 200 + stats ==="
out=$(raw POST "/api/cron/run/cleanup" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "cleanup с секретом 200" "$status" "200"
assert_eq "cleanup status=success" "$(jget "$body" "d.get('status')")" "success"
assert_eq "cleanup stats.csrfSwept есть" "$(jget "$body" "type(d.get('stats',{}).get('csrfSwept')).__name__")" "int"
assert_eq "cleanup stats.storage.mode есть" "$(jget "$body" "d.get('stats',{}).get('storage',{}).get('mode')")" "local"
assert_eq "cleanup stats.staleCartsPurged есть" "$(jget "$body" "type(d.get('stats',{}).get('staleCartsPurged')).__name__")" "int"

echo "=== 5. disabled: subscriptions -> 409 ==="
out=$(raw POST "/api/cron/run/subscriptions" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "disabled 409" "$status" "409"
assert_eq "disabled error=task_disabled" "$(jget "$body" "d.get('error')")" "task_disabled"

echo "=== 6. admin manual (без секрета, CSRF) ==="
out=$(req "$JAR_A" POST /api/auth/login '{"email":"admin@demo.ru","password":"Demo123!"}')
assert_eq "login admin 200" "$(printf '%s' "$out" | head -1)" "200"
out=$(req "$JAR_A" POST "/api/cron/run/backup" '{}' no-csrf)
assert_eq "manual без CSRF 403" "$(printf '%s' "$out" | head -1)" "403"
out=$(req "$JAR_A" POST "/api/cron/run/backup" '{}' csrf)
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "admin manual 200" "$status" "200"
assert_eq "manual trigger=manual" "$(jget "$body" "d.get('trigger')")" "manual"
assert_eq "manual status=success" "$(jget "$body" "d.get('status')")" "success"
db=$(node "$PROJ/scripts/db/s8b1-dbcheck.mjs" backup success manual 2>/dev/null)
case "$db" in FOUND*) ok "dbcheck CronRun backup manual ($db)";; *) bad "dbcheck CronRun manual" "got [$db]";; esac
out=$(raw POST "/api/cron/run/backup" -H "Content-Type: application/json" -d '{}')
assert_eq "сессия без секрета и без CSRF -> 401 (аноним)" "$(printf '%s' "$out" | head -1)" "401"

echo "=== 7. status: секрет/admin/customer ==="
out=$(raw GET "/api/cron/status" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "status секрет 200" "$status" "200"
assert_eq "status tasks=20" "$(jget "$body" "len(d.get('tasks',[]))")" "20"
out=$(req "$JAR_A" GET "/api/cron/status")
assert_eq "status admin 200" "$(printf '%s' "$out" | head -1)" "200"
out=$(req "$JAR_C" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
assert_eq "login customer 200" "$(printf '%s' "$out" | head -1)" "200"
out=$(req "$JAR_C" GET "/api/cron/status")
assert_eq "status customer 403" "$(printf '%s' "$out" | head -1)" "403"
out=$(raw GET "/api/cron/status")
assert_eq "status аноним 401" "$(printf '%s' "$out" | head -1)" "401"

echo "=== 8. легаси-контракты (секрет) ==="
out=$(raw POST "/api/cron/auto-complete" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "legacy auto-complete 200" "$status" "200"
assert_eq "legacy auto-complete ключ checked" "$(jget "$body" "type(d.get('checked')).__name__")" "int"
out=$(raw POST "/api/cron/expiring-bonuses" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
assert_eq "legacy expiring-bonuses 200" "$(printf '%s' "$out" | head -1)" "200"
out=$(raw GET "/api/cron/payment-reminders" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "legacy payment-reminders GET 200" "$status" "200"
assert_eq "legacy payment-reminders ключ hours" "$(jget "$body" "type(d.get('hours')).__name__")" "int"
out=$(raw POST "/api/cron/storage-cleanup" -H "X-Cron-Secret: $CRON_SECRET_VALUE")
status=$(printf '%s' "$out" | head -1)
body=$(printf '%s' "$out" | tail -n +2)
assert_eq "legacy storage-cleanup 200" "$status" "200"
assert_eq "legacy storage-cleanup контракт mode" "$(jget "$body" "d.get('mode')")" "local"
assert_eq "legacy storage-cleanup superset csrfSwept" "$(jget "$body" "type(d.get('csrfSwept')).__name__")" "int"

echo "=== 9. rate-limit: 20/мин/IP -> 429 + Retry-After ==="
XFF="203.0.113.77"
last_code=""
for i in $(seq 1 20); do
  last_code=$(curl -s -o /dev/null -w "%{http_code}" -m 30 -X POST "$BASE/api/cron/run/unknown-task-xyz" -H "X-Cron-Secret: $CRON_SECRET_VALUE" -H "X-Forwarded-For: $XFF")
done
assert_eq "20 первых запросов (404, в лимите)" "$last_code" "404"
rate_out=$(curl -s -m 30 -D - -o /dev/null -X POST "$BASE/api/cron/run/unknown-task-xyz" -H "X-Cron-Secret: $CRON_SECRET_VALUE" -H "X-Forwarded-For: $XFF")
retry_after=$(printf '%s' "$rate_out" | tr -d '\r' | grep -i "^retry-after:" | awk '{print $2}')
assert_eq "21-й запрос 429" "$(printf '%s' "$rate_out" | head -1 | awk '{print $2}')" "429"
if [ -n "${retry_after:-}" ] && [ "${retry_after:-0}" -ge 1 ]; then ok "Retry-After=$retry_after (>=1)"; else bad "Retry-After" "got [$retry_after]"; fi

echo ""
echo "==================================="
echo "S8B1 matrix: PASS=$PASS FAIL=$FAIL"
echo "==================================="
[ "$FAIL" -eq 0 ] || exit 1
