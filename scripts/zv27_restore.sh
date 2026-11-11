#!/usr/bin/env bash
# Z-v27 cron restore: bring up n8n-receiver (with dev-keeper), dev server, verify chat.
set -u
LOG=/home/z/my-project/agent-ctx/zv27/n8n-receiver.log
DEVLOG=/home/z/my-project/dev.log

listening() { ss -ltn 2>/dev/null | grep -qE ":$1\b"; }

# Step 1: n8n receiver on 5678
if ! listening 5678; then
  cd /home/z/my-project/mini-services/n8n-receiver || exit 1
  setsid nohup bun --hot index.ts >> "$LOG" 2>&1 < /dev/null &
  sleep 4
fi

# Step 2: dev server on 3000 (keeper probes every 15s; give it a chance first)
if ! listening 3000; then
  for i in 1 2 3 4; do
    sleep 5
    listening 3000 && break
  done
fi
if ! listening 3000; then
  cd /home/z/my-project || exit 1
  setsid nohup bun run dev:local >> "$DEVLOG" 2>&1 < /dev/null &
fi

# Step 3: wait up to 30s for dev, then verify all endpoints
DEV=000
for i in $(seq 1 15); do
  DEV=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/ 2>/dev/null)
  [ "$DEV" = "200" ] && break
  sleep 2
done

if curl -s --max-time 10 http://127.0.0.1:5678/healthz 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
  N8N=ok
else
  N8N=fail
fi

if curl -s --max-time 10 http://127.0.0.1:3030/health 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
  CHAT=ok
else
  CHAT=fail
fi

echo "RESTORE RESULT: dev=$DEV n8n=$N8N chat=$CHAT"
