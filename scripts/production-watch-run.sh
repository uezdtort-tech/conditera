#!/usr/bin/env bash
# production-watch: один обход, только GET, суммарно <=14 запросов
set -u
OUT=/tmp/pw; rm -rf "$OUT"; mkdir -p "$OUT"
BASE=https://conditera.ru

echo "=== [1] health JSON ==="
curl -sS --max-time 30 "$BASE/api/health" -o "$OUT/health.json" -w "health code=%{http_code} time=%{time_total}\n"
python3 - <<'PY' 2>/dev/null || echo "(health JSON parse failed)"
import json
try:
    d = json.load(open('/tmp/pw/health.json'))
    print("parsed:", {k: d.get(k) for k in ('status','app','database','auth','storage','n8n','environment','version')})
except Exception as e:
    print("parse error:", e)
    try:
        print("raw head:", open('/tmp/pw/health.json').read()[:500])
    except Exception:
        pass
PY

echo "=== [2] www health + home ==="
curl -sS --max-time 30 -o /dev/null -w "www_health code=%{http_code} time=%{time_total}\n" https://www.conditera.ru/api/health
curl -sS --max-time 30 -o /dev/null -w "home code=%{http_code} time=%{time_total}\n" "$BASE/"

echo "=== [3] пять критичных API (один ретрай при сбое, ~15с) ==="
FAILED=0
for p in /api/products /api/decor/products /api/services /api/builder/decor-shops /api/recipes/marketplace; do
  r=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code} %{time_total}" "$BASE$p" 2>"$OUT/err.txt"); rc=$?
  code=${r%% *}
  if [ "$rc" -ne 0 ] || ! printf '%s' "$code" | grep -qE '^[23]'; then
    err=$(tr -d '\n' < "$OUT/err.txt" | cut -c1-100)
    echo "  $p first-try: rc=$rc r='$r' err='$err' -> retry in 15s"
    sleep 15
    r=$(curl -sS --max-time 30 -o /dev/null -w "%{http_code} %{time_total}" "$BASE$p" 2>"$OUT/err.txt"); rc=$?
    code=${r%% *}
    if [ "$rc" -ne 0 ] || ! printf '%s' "$code" | grep -qE '^[23]'; then FAILED=$((FAILED+1)); fi
  fi
  echo "  $p final: rc=$rc $r"
done
echo "FAILED_APIS=$FAILED"
if [ "$FAILED" -ge 3 ]; then
  echo "=== [3b] контрольная проверка главной ==="
  curl -sS --max-time 30 -o /dev/null -w "home_control code=%{http_code} time=%{time_total}\n" "$BASE/"
fi

echo "=== [4] TLS ==="
ENDDATE=$(echo | openssl s_client -connect conditera.ru:443 -servername conditera.ru 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
echo "cert_enddate: $ENDDATE"
if [ -n "$ENDDATE" ]; then
  EXP=$(date -d "$ENDDATE" +%s 2>/dev/null); NOW=$(date +%s)
  if [ -n "$EXP" ]; then echo "tls_days_left=$(( (EXP - NOW) / 86400 ))"; fi
fi

echo "=== [5] timestamps ==="
date -u +"log_ts=%Y-%m-%dT%H:%MZ"
