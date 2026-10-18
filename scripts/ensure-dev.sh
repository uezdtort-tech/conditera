#!/bin/bash
# scripts/ensure-dev.sh — self-healing пролог для команд браузерной проверки:
# поднимает embedded PG, dev-сервер (3000) и chat-service (3030), если песочница их убила.
#
# TZ v4.0 §7 (DEV-04): lifecycle chat/next передан scripts/lib/dev-process-manager.mjs —
# управляемые процессы (state: .run/ensure-dev.state.json) рестартуются при смене
# отпечатка секрета; unmanaged-процессы НИКОГДА не убиваются по имени/порту —
# при desync менеджер даёт actionable-сообщение и ensure-dev завершается с кодом 2.
set -u
cd /home/z/my-project

# 1. PostgreSQL (pg_ctl daemon)
(echo > /dev/tcp/127.0.0.1/54329) 2>/dev/null || { node scripts/db/runtime.mjs start >/dev/null 2>&1; sleep 2; }

# 1a. .env.local (gitignored — песочница/drift его удаляет; восстанавливаем штатным db:setup)
if [ ! -f .env.local ]; then
  echo "[ensure] .env.local отсутствует — восстановление через db:setup"
  bun run db:setup >> dev.log 2>&1
fi

# 1b. Гигиена Turbopack dev-кэша (этап 9.1, worklog): .next/dev копится между
# сессиями (замерено до 1.1 GB); его гидрация при старте даёт ~2.4 GB RSS на
# холостом ходу и была главной причиной OOM-kill next-server в 4 GB sandbox.
# Чистим ТОЛЬКО пока сервер :3000 не запущен; кэш пересоздаётся автоматически.
if ! (echo > /dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  cache_kb=$(du -sk .next/dev 2>/dev/null | cut -f1)
  cache_kb=${cache_kb:-0}
  if [ "$cache_kb" -gt 524288 ]; then
    echo "[ensure] .next/dev=${cache_kb}KB > 512MB — очистка dev-кэша (профилактика OOM)"
    rm -rf .next/dev
  fi
fi

# Секреты чата: передаются менеджеру через окружение. Значения НИКОГДА не печатаются.
JWT_SECRET=$(sed -n 's/^JWT_SECRET=//p' .env.local 2>/dev/null | head -1)
BOT_SECRET=$(sed -n 's/^BOT_SECRET=//p' .env.local 2>/dev/null | head -1)
export JWT_SECRET BOT_SECRET

# 2. Chat-service :3030 через менеджер процессов (managed lifecycle, env-fingerprint)
node scripts/lib/dev-process-manager.mjs ensure-chat --port 3030 \
  --cwd mini-services/chat-server \
  --log /tmp/chat-server.log \
  --state .run/ensure-dev.state.json
rc=$?
if [ $rc -ne 0 ]; then
  echo "[ensure] chat desync (exit $rc) — действуй по сообщению выше"
  exit $rc
fi

# 3. Dev-сервер :3000 через менеджер процессов (managed lifecycle, .env.local hash)
node scripts/lib/dev-process-manager.mjs ensure-next --port 3000 \
  --cwd /home/z/my-project \
  --env-local .env.local \
  --start-cmd "bun run dev:local" \
  --log dev.log \
  --state .run/ensure-dev.state.json
rc=$?
if [ $rc -ne 0 ]; then
  echo "[ensure] next desync (exit $rc) — действуй по сообщению выше"
  exit $rc
fi

# Итоговый статус
H=$(curl -s --max-time 6 http://127.0.0.1:3000/api/health | head -c 120)
echo "health: $H"
curl -sf -o /dev/null --max-time 6 http://127.0.0.1:3000/api/health
