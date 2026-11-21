# HANDOVER — S9B2-R3 (запись после прерывания по протоколу)

Дата: 2026-11-21 (сессия S9B2-R3). Статус: S9B2 НЕ начат; выполнено
восстановление до фактического последнего долговечного состояния и
передача эстафеты. Читать вместе с: agent-ctx/S9B2-R3-zai-code.md,
worklog.md (v2, запись «S9B2-R3 (перехват)»).

## 1. Почему перехват (форензика, факты, проверено командами)

Инструкция сессии требовала клонировать
`backups/conditera-v2-S9B1-cb11b51.bundle` (main=3b07a57). Проверка
`ls -la /home/z/my-project/backups/ | grep S9B1` — ПУСТО. Дополнительно
проверено исчерпывающе (все отрицательно):

- `find / -name "*S9B1*" / "*cb11b51*" / "*.bundle" новее S5B3` — ничего
  (backups, /tmp/my-project-снапшот `.initial_snapshot.json` от 06:03
  содержит бандлы только до `conditera-v2-S5B3-25ac7d2.bundle`);
- `/tmp/my-project/conditera-v2` — пустой каталог (git-объектов нет);
- корневой репо my-project: индивидуальные S5-коммиты (f442c16 и др.)
  исчезли как объекты, HEAD 59a8249 — amend-коммит [S4B2], поглотивший
  файловое состояние эры S6B1 (это артефакт восстановления песочницы,
  НЕ история v2 — v2 живёт отдельным репо);
- agent-ctx: есть артефакты сессии S6B1 (s6b1-socket-probe-output.txt:
  PASS=13 FAIL=1; скриншоты; браузер-скрипт), но БЕЗ бандла и без
  worklog/отчёта — код S6B1 потерян вместе с сессией; следов сессий
  S6B2…S9B1 не существует.

ВЫВОД: последняя настоящая точка восстановления — S5B3
(`conditera-v2-S5B3-25ac7d2.bundle`, 1 308 204 B, complete history,
main=1f10791). Карта 26 блоков: долговечно закрыты S0B1, S0B2 (docs
корня) и S1B1…S5B3 (16 бандлов) = 18/26; отсутствуют и требуют
выполнения 8 блоков: S6B1 (повторно), S6B2, S7B1, S7B2, S8B1, S8B2,
S9B1, S9B2.

## 2. Что сделано в этой сессии (всё закоммичено и забандлено)

- Клон S5B3 → `/home/z/my-project/conditera-v2` (38 коммитов,
  main=1f10791), `bun install` — 504 пакета.
- `.env.local` пересоздан по `.env.local.example` (dev: шим :3040,
  STORAGE_MODE=local, PG :54330, PAYMENT_MODE=STUB, PAYMENTS_MODE=mock,
  случайные CRON_SECRET / SUPABASE_JWT_SECRET / SUPABASE_SERVICE_ROLE_KEY;
  значения НИКОГДА не печатались).
- Embedded PostgreSQL :54330 поднят (scripts/db/setup.mjs, свежий .pgdata).
- ИСПРАВЛЕН баг сида на свежей БД (коммит v2 31b7aaf): lgr-demo-04
  ссылался на customer@demo.ru, профиль которого сид не создавал →
  «Профиль customer@demo.ru для ledger не найден». Добавлен PROFILES-
  элемент; сид теперь: profiles=9, products=23, orders=1, ledger=4.
- Шим :3040 + setup.mjs повторно: 4 демо-учётки @demo.ru (Demo123!)
  созданы в шиме, userId привязан по email.
- Dev :3100 поднят (`env -u DATABASE_URL bun run dev`): `/` 200,
  `/catalog` 200, `/api/health` — контракт S1B1 цел (status/app/database/
  auth/storage/n8n/version; chat/cron-полей ещё нет по карте — они
  появляются в S6B1/S8B1).
- Гейты: `bun run lint` 0, `bunx tsc --noEmit` 0. `logs/agent/`
  пересоздан.
- Worklog-запись v2 (коммит 355bb23) + бандл
  `backups/conditera-v2-S9B2R3-recovery-355bb23.bundle`
  (1 310 971 B, verify: complete history, main=355bb23) — НОВЫЙ
  последний чекпоинт.

## 3. Точная инструкция следующей сессии (без изменений стека)

Правила неизменны: Next.js 16 + TS strict, bun, RU, секреты через env
(не печатать), коммит-префикс `[S6B1]`…`[S9B2]`, работа только в
`/home/z/my-project/conditera-v2` (корневой my-project не трогать кроме
worklog/agent-ctx/bundle-трекинга), dev :3100 (НЕ :3000), бандл СРАЗУ
после docs-коммита каждого блока (урок этого recycle: сессия без бандла
теряется целиком).

1. Старт: `git clone -b main
   /home/z/my-project/backups/conditera-v2-S9B2R3-recovery-355bb23.bundle
   /home/z/my-project/conditera-v2 && cd
   /home/z/my-project/conditera-v2 && bun install`; `.env.local` — по
   `.env.local.example` (dev-значения как в п.2 выше); boot: `node
   scripts/db/setup.mjs` (PG :54330 + миграции + push + сид + auth-users
   при поднятом шиме), `(bun run shim:dev > /tmp/shim.log 2>&1 &)`,
   `rm -f .next/dev/lock && setsid nohup env -u DATABASE_URL bun run dev
   > /tmp/dev-v2.log 2>&1 < /dev/null &` (setsid/nohup обязателен —
   фоновые процессы без отсоединения гибнут между вызовами агента).
   Проверка: /api/health ok, / 200, /catalog 200.
2. Выполнять блоки КАРТЫ строго по порядку, каждый по своему промпту в
   `docs/rebuild/prompts/` (этот каталог — в корневом my-project, он
   переживает recycle): S6B1-chats.md → S6B2-notifications.md →
   S7B1-llm-core.md → S7B2-ai-features.md → S8B1-cron.md →
   S8B2-n8n.md → S9B1-deploy.md → S9B2-ops.md (финал).
3. Справочные материалы S6B1 прошлой попытки (код потерян, но методика
   и результаты живы): `agent-ctx/s6b1-socket-probe.ts` (проба сокета:
   handshake-токен, presence, join-авторизация, message:new,
   rate-limit), `s6b1-conv-id.ts`, `s6b1-r3-browser.sh`, скриншоты
   s6b1-r3-*.png. Ожидаемая модель S6B1: socket.io мини-сервис :3030
   (mini-services/chat-service), JWT-верификация SUPABASE_JWT_SECRET,
   модели ChatConversation/ChatMessage + Prisma, gateway-прокси
   `?XTransformPort=3030`.
4. В S9B2 помнить зависимость от S8B1 (реестр задач + CronRun для
   health-поля cron) и S9B1 (compose/runtime-рецепты для recover.sh) —
   поэтому строгий порядок п.2.
5. Гейты каждого блока: lint 0 / tsc 0; curl-матрица; коммит кода +
   docs-коммит worklog; `git bundle create
   /home/z/my-project/backups/conditera-v2-<БЛОК>-<SHA>.bundle main`
   + verify + трекинг в корневом my-project (add -f только бандл).

## 4. Открытые риски / замечания

- Миграции v2 отстают от схемы (S4B1+ правки шли через db push) — на
  свежей БД обязателен шаг `prisma db push --accept-data-loss` после
  `migrate deploy` (setup.mjs делает deploy; push — руками, как в п.1).
- Корневой my-project HEAD — amend-коммит песочницы; НЕ пытаться
  «восстанавливать» его историю, работать только с файлами worklog.md,
  agent-ctx/, backups/.
- Папка `logs/agent/` не переживает recycle — пересоздавать при старте
  (`mkdir -p /home/z/my-project/logs/agent`).
- 26/26 НЕ объявлять, пока S6B1…S9B1 не закрыты реальными коммитами и
  бандлами (см. отчёт S9B2-R3-zai-code.md).
