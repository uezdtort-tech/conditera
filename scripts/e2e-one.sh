#!/bin/bash
# scripts/e2e-one.sh — воспроизводимый запуск одного E2E-спека (TZ §3.4):
# сервер запускается ЗАНОВО в том же вызове, что и тест.
#
# Почему PROD-режим по умолчанию: dev-сервер (Turbopack) в песочнице
# компилирует страницы on-demand и упирается в OOM контейнера (4 GB):
# dmesg — "Killed process next-server, anon-rss:3.0 GB". Production
# `next start` не компилирует on-demand и держит RSS в разы ниже.
# E2E_SERVER_MODE=dev откатывает прежнее поведение.
#
# Использование:
#   bash scripts/e2e-one.sh <spec-name> [доп. аргументы playwright...]
set -u
cd /home/z/my-project
SPEC="$1"; shift || true
MODE="${E2E_SERVER_MODE:-prod}"

# 1. Убить ПРЕЖНИЙ web-сервер ЦЕЛИКОМ (дерево процессов), не только слушателя:
# убитый fuser-ом next-server не освобождает RAM мгновенно — новый сервер
# при старте попадает под OOM (свидетельство: dmesg "Killed process
# next-server anon-rss:3.0GB" при лимите контейнера 4GB).
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3000/tcp >/dev/null 2>&1 || true
else
  PIDS=$(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -o 'pid=[0-9]*' | cut -d= -f2)
  for p in $PIDS; do kill "$p" >/dev/null 2>&1 || true; done
fi
pkill -f 'next dev' >/dev/null 2>&1 || true
pkill -f 'next-server' >/dev/null 2>&1 || true
pkill -f 'next start' >/dev/null 2>&1 || true
# дождаться освобождения порта И отдачи памяти (available > 1.5 GB)
for i in $(seq 1 15); do
  (echo > /dev/tcp/127.0.0.1/3000) 2>/dev/null || break
  sleep 1
done
for i in $(seq 1 10); do
  AV=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  [ "$AV" -gt 1500 ] && break
  sleep 1
done

# 2. Свежий стек (PG → .env.local → chat :3030 → web :3000) В ЭТОМ ЖЕ вызове
if [ "$MODE" = "dev" ]; then
  bash scripts/ensure-dev.sh >/dev/null 2>&1
else
  # PG
  (echo > /dev/tcp/127.0.0.1/54329) 2>/dev/null || { node scripts/db/runtime.mjs start >/dev/null 2>&1; sleep 2; }
  # .env.local
  [ -f .env.local ] || bun run db:setup >/dev/null 2>&1
  # chat :3030 (секреты из .env.local, значения не печатаются)
  JWT_SECRET=$(sed -n 's/^JWT_SECRET=//p' .env.local | head -1)
  BOT_SECRET=$(sed -n 's/^BOT_SECRET=//p' .env.local | head -1)
  (echo > /dev/tcp/127.0.0.1/3030) 2>/dev/null || { (cd mini-services/chat-server && JWT_SECRET="$JWT_SECRET" BOT_SECRET="$BOT_SECRET" setsid nohup bun run dev >> /tmp/chat-server.log 2>&1 < /dev/null &); sleep 3; }
  # production-сервер из готового бандла .next (bun run build делается заранее)
  [ -d .next ] || { echo "NO_BUILD — сначала bun run build"; exit 43; }
  setsid nohup bunx next start -H 0.0.0.0 -p 3000 >> /tmp/e2e-start.log 2>&1 < /dev/null &
fi
for i in $(seq 1 60); do
  curl -sf -o /dev/null --max-time 3 http://127.0.0.1:3000/api/health && break
  sleep 2
done
curl -sf -o /dev/null --max-time 4 http://127.0.0.1:3000/api/health || { echo "SERVER_NOT_UP"; exit 42; }

# 3. Спек с первичным JSON-артефактом (E2E_BASE_URL отключает собственный
#    webServer конфига — сервером управляет эта обёртка)
mkdir -p /tmp/e2e
E2E_BASE_URL=http://127.0.0.1:3000 bunx playwright test "tests/e2e/${SPEC}.spec.ts" "$@" --project=chromium --reporter=json > "/tmp/e2e/${SPEC}.json" 2>"/tmp/e2e/${SPEC}.stderr"
EXIT=$?

# 4. Сводка из первичного артефакта
python3 - "$SPEC" "$EXIT" << 'PYEOF'
import json, sys
spec, exit_code = sys.argv[1], sys.argv[2]
try:
    r = json.load(open(f"/tmp/e2e/{spec}.json"))
except Exception as e:
    print(f"{spec}: JSON UNREADABLE ({e}) EXIT={exit_code}"); sys.exit(0)
s = r.get("stats", {})
print(f"{spec}: expected={s.get('expected')} unexpected={s.get('unexpected')} flaky={s.get('flaky')} skipped={s.get('skipped')} EXIT={exit_code}")
PYEOF
exit $EXIT
