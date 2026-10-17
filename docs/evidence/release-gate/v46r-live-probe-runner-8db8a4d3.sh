#!/bin/bash
# Live anti-fraud probe (resume session v4.6, ЭТАП 2) — всё в одной shell-сессии:
# stub → standalone (port 3100, dev на 3000 не трогаем) → probe → kill.
# Процессы не переживают вызов (sandbox reaping — см. worklog прошлой сессии).
set -u
cd /home/z/my-project

SHA=8db8a4d3
OUT=/home/z/my-project/docs/evidence/release-gate/v46r-live-probe-raw-$SHA.json
LOG=/home/z/my-project/.probe-tmp/v46r-live-probe-runner.log

echo "# v4.6 resume live probe — $(date -u +%FT%TZ), SHA=$SHA" > "$LOG"

# 1) standalone static assets (требование standalone-режима Next)
cp -r .next/static .next/standalone/.next/static 2>/dev/null || echo "static copy skipped (already present?)" >> "$LOG"
mkdir -p .next/standalone/public && cp -r public/. .next/standalone/public/ 2>/dev/null || true

# 2) stub (supabase REST emulator, 127.0.0.1:54321)
bun .probe-tmp/supabase-stub-probe-v46r.mjs > .probe-tmp/v46r-stub.log 2>&1 &
STUB_PID=$!
sleep 1

# 3) standalone server на 3100
cd .next/standalone
env PORT=3100 HOSTNAME=127.0.0.1 \
  JWT_SECRET="probe-jwt-<redacted>" `# [REDACTED BY V46 HYGIENE]` \
  JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  TFA_ENCRYPTION_KEY="probe-tfa-<redacted>" `# [REDACTED BY V46 HYGIENE]` \
  CRON_SECRET="probe-cron-<redacted>" `# [REDACTED BY V46 HYGIENE]` \
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
  SUPABASE_SERVICE_ROLE_KEY="probe-service-role-<redacted>" `# [REDACTED BY V46 HYGIENE]` \
  IP_HASH_SALT="probe-salt" \
  NODE_ENV=production node server.js >> /home/z/my-project/.probe-tmp/v46r-standalone.log 2>&1 &
SRV_PID=$!
cd /home/z/my-project

# 4) readiness poll (до 30с)
READY=""
for i in $(seq 1 60); do
  CODE=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/api/health 2>/dev/null || true)
  if [ "$CODE" != "000" ] && [ -n "$CODE" ]; then READY="$CODE"; break; fi
  sleep 0.5
done
echo "health readiness: HTTP=$READY (503=degraded expected: stub auth)" >> "$LOG"

if [ -n "$READY" ]; then
  # 5) probe
  node .probe-tmp/probe-v46r.mjs > "$OUT" 2>>"$LOG"
  PROBE_EXIT=$?
  echo "probe exit=$PROBE_EXIT" >> "$LOG"
else
  echo "PROBE SKIPPED: server not ready" >> "$LOG"
  echo '{"error":"server not ready"}' > "$OUT"
fi

# 6) cleanup — таргетированно, только наши PID
kill "$SRV_PID" 2>/dev/null
kill "$STUB_PID" 2>/dev/null
wait "$SRV_PID" 2>/dev/null
echo "cleanup done: $(date -u +%FT%TZ)" >> "$LOG"

# 7) вердикт
node -e "const r=require('$OUT'); console.log('VERDICT:', JSON.stringify(r.verdict||r), 'ALL_PASS:', r.allPass)" 2>/dev/null || head -5 "$OUT"
