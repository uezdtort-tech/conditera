#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s7b1-matrix.sh — S7B1 curl-matrix (гейт 1).
#
# Все curl — с cookie-jar (-b jar -c jar). Секреты читаются из .env.local
# молча и НЕ печатаются (используются только для negative-grep утечек).
# Демо-креды — публичные спеки (customer/admin@demo.ru, Demo123!).
#
# Сценарий (спека S7B1):
#   0) рестарт dev :3100 (свежий env + чистый in-memory rate-limit store);
#   1) GET /api/ai/config: anon 401 → customer 403 → admin 200
#      (order=zai,ollama; availability; actions/limits; НЕТ секретных полей
#      и НЕТ реальных значений секретов .env.local в теле);
#   2) POST /api/ai/selftest default → 200 {ok:true, provider:zai, model, ms};
#   3) POST /api/ai/selftest override {providers:[ollama], baseUrl
#      http://127.0.0.1:9, timeoutMs:3000} → 200 {ok:false} за ≤15s (не hang);
#   4) таймаут-пруф D12: nc-blackhole :9990 (accept, не отвечает) +
#      override {providers:[ollama], baseUrl http://127.0.0.1:9990,
#      timeoutMs:3000} → ok:false за ≤15s (1 ретрай на таймауте = ~6s);
#   5) лимиты: рестарт dev → 21 selftest/min: первые 20 → 200, 21-й → 429
#      + Retry-After;
#   6) логи /tmp/dev-v2.log: provider=/action=/ms= присутствуют;
#      содержимое («пинг», тексты промптов) ОТСУТСТВУЕТ;
#   7) sanity render: / 200, /catalog 200.
# =============================================================================
set -u
BASE="http://localhost:3100"
PROJ="/home/z/my-project/conditera-v2"
LOG="/tmp/dev-v2.log"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 — $2"; }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label" "got [$got], want [$want]"; fi; }

JAR_C="/tmp/s7b1-jar-customer.txt"
JAR_A="/tmp/s7b1-jar-admin.txt"
rm -f "$JAR_C" "$JAR_A"

csrf() { curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"; }

req() { # jar method path data csrf_flag -> "<code>\n<body>"
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  local args=(-s -m 90 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf "$jar")")
  local out; out=$(curl "${args[@]}")
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

jget() { printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)"; }

echo "=== 0. рестарт dev :3100 (свежий env, чистый store) ==="
bash /home/z/my-project/agent-ctx/s7b1-restart.sh || { echo "FATAL: dev не поднялся"; exit 1; }

echo "=== 1. GET /api/ai/config — RBAC и состав ==="
out=$(req "$JAR_C" GET /api/ai/config)
status=$(printf '%s' "$out" | head -1)
assert_eq "config anon 401" "$status" "401"

out=$(req "$JAR_C" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "login customer 200" "$status" "200"

out=$(req "$JAR_C" GET /api/ai/config)
status=$(printf '%s' "$out" | head -1)
assert_eq "config customer 403" "$status" "403"

out=$(req "$JAR_A" POST /api/auth/login '{"email":"admin@demo.ru","password":"Demo123!"}')
status=$(printf '%s' "$out" | head -1)
assert_eq "login admin 200" "$status" "200"

out=$(req "$JAR_A" GET /api/ai/config)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
assert_eq "config admin 200" "$status" "200"
assert_eq "config order zai,ollama" "$(jget "$body" "d['config']['order']")" "['zai', 'ollama']"
assert_eq "config availability.zai.reachable" "$(jget "$body" "d['availability']['zai']['reachable']")" "True"
assert_eq "config actions count" "$(jget "$body" "len(d['actions'])")" "5"
assert_eq "config assistant limit" "$(jget "$body" "[a for a in d['actions'] if a['action']=='assistant'][0]['limit']")" "20"

# Секретные поля: значения секретов .env.local не должны просочиться в тело.
LEAK=0
while IFS= read -r secret; do
  [ -n "$secret" ] || continue
  if printf '%s' "$body" | grep -qF "$secret"; then LEAK=1; break; fi
done < <(python3 - <<'PYEOF'
import re
env = {}
for line in open("/home/z/my-project/conditera-v2/.env.local"):
    line = line.strip()
    m = re.match(r"^([A-Z_]+)=(.*)$", line)
    if m and ("SECRET" in m.group(1) or "TOKEN" in m.group(1) or "KEY" in m.group(1)):
        v = m.group(2).strip()
        if len(v) >= 16:
            print(v)
PYEOF
)
assert_eq "config no secret values" "$LEAK" "0"
# Ключевых секретных полей-объектов в ответе нет.
if printf '%s' "$body" | grep -qiE '"(serviceRoleKey|apiKey|accessToken|password)"'; then
  bad "config no secret fields" "найдено секретное поле"
else
  ok "config no secret fields"
fi

echo "=== 2. POST /api/ai/selftest — default (zai) ==="
out=$(req "$JAR_A" POST /api/ai/selftest '{}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
assert_eq "selftest default 200" "$status" "200"
assert_eq "selftest ok:true" "$(jget "$body" "d['ok']")" "True"
assert_eq "selftest provider zai" "$(jget "$body" "d['provider']")" "zai"
assert_eq "selftest model" "$(jget "$body" "d['model']")" "glm-4"
MS=$(jget "$body" "d['ms']")
if [ -n "$MS" ] && [ "$MS" -ge 0 ] 2>/dev/null; then ok "selftest ms present ($MS)"; else bad "selftest ms" "$body"; fi
printf '%s' "$body" | grep -q '"text"' && ok "selftest text present" || bad "selftest text" "$body"

echo "=== 3. POST /api/ai/selftest — override port 9 (refused, не hang) ==="
T0=$(date +%s%3N)
out=$(req "$JAR_A" POST /api/ai/selftest '{"providers":["ollama"],"baseUrl":"http://127.0.0.1:9","timeoutMs":3000}' csrf)
T1=$(date +%s%3N); ELAPSED=$((T1-T0))
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
assert_eq "selftest refused 200" "$status" "200"
assert_eq "selftest refused ok:false" "$(jget "$body" "d['ok']")" "False"
if [ "$ELAPSED" -le 15000 ]; then ok "selftest refused ≤15s (${ELAPSED}ms)"; else bad "selftest refused elapsed" "${ELAPSED}ms > 15000ms"; fi

echo "=== 4. таймаут-пруф D12: blackhole :9990 (accept без ответа) ==="
python3 - <<'PYEOF' &
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 9990))
s.listen(5)
time.sleep(45)
PYEOF
NC_PID=$!
sleep 1
T0=$(date +%s%3N)
out=$(req "$JAR_A" POST /api/ai/selftest '{"providers":["ollama"],"baseUrl":"http://127.0.0.1:9990","timeoutMs":3000}' csrf)
T1=$(date +%s%3N); ELAPSED=$((T1-T0))
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
kill "$NC_PID" 2>/dev/null || true
assert_eq "selftest blackhole 200" "$status" "200"
assert_eq "selftest blackhole ok:false" "$(jget "$body" "d['ok']")" "False"
if [ "$ELAPSED" -le 15000 ] && [ "$ELAPSED" -ge 5000 ]; then
  ok "selftest blackhole timeout fired 5..15s (${ELAPSED}ms, 2 попытки × 3s)"
else
  bad "selftest blackhole elapsed" "${ELAPSED}ms (ожидалось 5000..15000 — таймаут×2 ретрая)"
fi

echo "=== 5. лимиты: 21 selftest/min → 429 + Retry-After ==="
bash /home/z/my-project/agent-ctx/s7b1-restart.sh >/dev/null || { echo "FATAL: рестарт не удался"; exit 1; }
COUNT_OK=0; FIRST_BAD=""
for i in $(seq 1 21); do
  out=$(req "$JAR_A" POST /api/ai/selftest '{}' csrf)
  status=$(printf '%s' "$out" | head -1)
  if [ "$i" -le 20 ]; then
    if [ "$status" = "200" ]; then COUNT_OK=$((COUNT_OK+1)); else FIRST_BAD="call#$i status=$status"; fi
  else
    LAST_STATUS="$status"
    LAST_HEADERS=$(curl -s -m 30 -o /dev/null -D - -b "$JAR_A" -c "$JAR_A" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR_A")" -d '{}' "$BASE/api/ai/selftest")
    RETRY=$(printf '%s' "$LAST_HEADERS" | grep -i '^retry-after:' | tr -d '\r' | awk '{print $2}')
    LIMIT_BODY=$(curl -s -m 30 -b "$JAR_A" -c "$JAR_A" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR_A")" -d '{}' "$BASE/api/ai/selftest")
  fi
done
assert_eq "selftest burst 20 x 200" "$COUNT_OK" "20"
[ -n "$FIRST_BAD" ] && bad "selftest burst" "$FIRST_BAD" || ok "selftest burst без сбоев до 20"
assert_eq "selftest 21st 429" "$LAST_STATUS" "429"
[ -n "$RETRY" ] && [ "$RETRY" -ge 1 ] 2>/dev/null && ok "429 Retry-After present (${RETRY}s)" || bad "429 Retry-After" "$LAST_HEADERS"
printf '%s' "$LIMIT_BODY" | grep -q "rate_limited" && ok "429 body rate_limited" || bad "429 body" "$LIMIT_BODY"

echo "=== 6. логи: метаданные есть, содержимого нет ==="
sleep 1
if grep -q "provider=zai action=selftest" "$LOG"; then ok "log provider=zai action=selftest"; else bad "log provider/action" "нет строки provider=zai action=selftest"; fi
if grep -qE "provider=zai action=selftest ok=true ms=[0-9]+" "$LOG"; then ok "log ms= present"; else bad "log ms" "нет ms="; fi
if grep -qi "пинг" "$LOG"; then bad "log contents absent" "'пинг' найден в логе"; else ok "log contents absent (пинг)"; fi
if grep -q "OLLAMA_BASE_URL=http" "$LOG" 2>/dev/null; then bad "log env leak" "env в логе"; else ok "log env не печатается"; fi

echo "=== 7. sanity render ==="
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -H "User-Agent: Mozilla/5.0" "$BASE/")
assert_eq "render / 200" "$code" "200"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -H "User-Agent: Mozilla/5.0" "$BASE/catalog")
assert_eq "render /catalog 200" "$code" "200"

echo ""
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
