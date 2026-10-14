#!/bin/bash
# scripts/ensure-dev.sh — self-healing пролог для команд браузерной проверки:
# поднимает embedded PG, dev-сервер (3000) и chat-service (3030), если песочница их убила.
cd /home/z/my-project

# 1. PostgreSQL (pg_ctl daemon)
(echo > /dev/tcp/127.0.0.1/54329) 2>/dev/null || { node scripts/db/runtime.mjs start >/dev/null 2>&1; sleep 2; }

# 2. Dev-сервер :3000
if ! curl -sf -o /dev/null --max-time 4 http://127.0.0.1:3000/api/health; then
  setsid nohup bun run dev:local >> dev.log 2>&1 < /dev/null &
  for i in $(seq 1 60); do
    sleep 5
    curl -sf -o /dev/null --max-time 4 http://127.0.0.1:3000/api/health && break
  done
fi

# 3. Chat-service :3030
(echo > /dev/tcp/127.0.0.1/3030) 2>/dev/null || { (cd mini-services/chat-server && setsid nohup bun run dev >> /tmp/chat-server.log 2>&1 < /dev/null &); sleep 3; }

# Итоговый статус
H=$(curl -s --max-time 6 http://127.0.0.1:3000/api/health | head -c 120)
echo "health: $H"
curl -sf -o /dev/null --max-time 6 http://127.0.0.1:3000/api/health
