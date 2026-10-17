#!/bin/bash
# Live anti-fraud probe v4.6 — всё в одной shell-сессии:
# stub → standalone server → probe → kill. Процессы не переживают вызов.
set -u
cd /home/z/my-project

RESULTS=/home/z/my-project/.probe-tmp/probe-result.json
LOG=/home/z/my-project/.probe-tmp/live-probe.log

echo "# Live anti-fraud probe — $(date -u +%FT%TZ)" > "$LOG"
echo "server: standalone production build (см. v46-prod-build-0c97000.log)" >> "$LOG"

# 1) stub
bun .probe-tmp/supabase-stub-probe.mjs > .probe-tmp/stub.log 2>&1 &
STUB_PID=$!
sleep 1

# 2) standalone server
cd .next/standalone
env PORT=3000 HOSTNAME=127.0.0.1 \
  JWT_SECRET="ci_test_jwt_secret_32_chars_min_aaaaaaaaaaaaaa" \
  JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  TFA_ENCRYPTION_KEY="ci_test_tfa_key_64_hex_chars_aaaaaaaaaaaaaaaaaaaaaaaa" \
  CRON_SECRET="ci_test_cron_secret" \
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
  SUPABASE_SERVICE_ROLE_KEY="stub-service-role" \
  IP_HASH_SALT="probe-salt" \
  NODE_ENV=production node server.js >> /home/z/my-project/.probe-tmp/standalone.log 2>&1 &
SRV_PID=$!
cd /home/z/my-project

# 3) readiness poll (до 30с)
READY=""
for i in $(seq 1 60); do
  CODE=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null || true)
  if [ "$CODE" != "000" ] && [ -n "$CODE" ]; then READY="$CODE"; break; fi
  sleep 0.5
done
echo "health readiness: HTTP=$READY (503=degraded expected: stub auth)" >> "$LOG"

if [ -n "$READY" ]; then
  # 4) probe
  node .probe-tmp/probe.mjs > "$RESULTS" 2>>"$LOG"
  echo "probe exit=$?" >> "$LOG"
else
  echo "PROBE SKIPPED: server not ready" >> "$LOG"
  echo '{"error":"server not ready"}' > "$RESULTS"
fi

# 5) cleanup — таргетированно, только наши PID
kill "$SRV_PID" 2>/dev/null
kill "$STUB_PID" 2>/dev/null
wait "$SRV_PID" 2>/dev/null
echo "cleanup done: $(date -u +%FT%TZ)" >> "$LOG"
cat "$RESULTS" | head -5
