#!/bin/bash
# scripts/ensure-dev.sh — self-healing пролог для команд браузерной проверки:
# поднимает embedded PG, dev-сервер (3000) и chat-service (3030), если песочница их убила.
cd /home/z/my-project

# 1. PostgreSQL (pg_ctl daemon)
(echo > /dev/tcp/127.0.0.1/54329) 2>/dev/null || { node scripts/db/runtime.mjs start >/dev/null 2>&1; sleep 2; }

# 1a. .env.local (gitignored — песочница/drift его удаляет; восстанавливаем штатным db:setup)
if [ ! -f .env.local ]; then
  echo "[ensure] .env.local отсутствует — восстановление через db:setup"
  bun run db:setup >> dev.log 2>&1
fi

# Секреты чата: chat-server (bun) НЕ читает .env.local автоматически —
# без совпадающего JWT_SECRET handshake отвергается (auth: unauthorized /
# в браузере «Ошибка подключения: server error»), без BOT_SECRET
# персистенция bot-сообщений отключена.
JWT_SECRET=$(sed -n 's/^JWT_SECRET=//p' .env.local 2>/dev/null | head -1)
BOT_SECRET=$(sed -n 's/^BOT_SECRET=//p' .env.local 2>/dev/null | head -1)

# 2. Dev-сервер :3000
if ! curl -sf -o /dev/null --max-time 4 http://127.0.0.1:3000/api/health; then
  setsid nohup bun run dev:local >> dev.log 2>&1 < /dev/null &
  for i in $(seq 1 60); do
    sleep 5
    curl -sf -o /dev/null --max-time 4 http://127.0.0.1:3000/api/health && break
  done
fi

# 3. Chat-service :3030 (с JWT_SECRET/BOT_SECRET из .env.local — общие с Next)
(echo > /dev/tcp/127.0.0.1/3030) 2>/dev/null || { (cd mini-services/chat-server && JWT_SECRET="$JWT_SECRET" BOT_SECRET="$BOT_SECRET" setsid nohup bun run dev >> /tmp/chat-server.log 2>&1 < /dev/null &); sleep 3; }

# Итоговый статус
H=$(curl -s --max-time 6 http://127.0.0.1:3000/api/health | head -c 120)
echo "health: $H"
curl -sf -o /dev/null --max-time 6 http://127.0.0.1:3000/api/health
