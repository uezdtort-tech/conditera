# S8B2-R4 (recreate-3) — zai-code отчёт: n8n-интеграция

Дата: 2026-11-21. Ветка main (conditera-v2), база 9ec7bc0 (S8B1 complete).
Код этого блока: **c27194e**; docs: **af46b2f**; bundle-коммит в root:
**45827ce**. Прошлая попытка S8B2 (постановка до data loss) не пережила
recycle — v2-артефакты блока воссозданы с нуля; остатки старого приёмника
вне v2 (/home/z/my-project/mini-services/n8n-receiver, слушал `*:5678`)
убиты — v2-приёмник живёт в conditera-v2 и bound 127.0.0.1.

## 1. Файлы (код c27194e)

- `mini-services/n8n-receiver/index.ts` — bun-сервер: PORT=5678 (const),
  hostname 127.0.0.1; GET /healthz `{status:"ok",received:N(24ч),uptimeSeconds}`;
  POST /events {task?,status?,meta?} → кольцевой буфер (500) + счётчик 24 ч
  (мусор → 400); GET /events — debug (последние 50). Журнал append
  `.zscripts/mini-service-n8n-receiver.log` (каталог ищется вверх по дереву
  от cwd → /home/z/my-project/.zscripts). dev-keeper внутри: каждые 15 с
  проба `http://127.0.0.1:3100/api/health`, 3 подряд неудач → detached
  `env -u DATABASE_URL bun run dev` (cwd /home/z/my-project/conditera-v2);
  KEEPER=0 → off; NODE_ENV=production → off (NEVER prod); stop-handle
  `.zscripts/dev-keeper.stop` → off; grace 90 с после респауна.
- `mini-services/n8n-receiver/lib.ts` — ЧИСТАЯ логика (vitest): pushEvent,
  countLast24h/pruneTimestamps (инъекция часов), normalizeEventPayload,
  keeperEnabled/keeperShouldRespawn.
- `mini-services/n8n-receiver/package.json` — без зависимостей (bun std);
  `dev = bun --hot index.ts`.
- `scripts/n8n/generate-workflows.ts` — генератор 20 JSON из манифеста.
- `scripts/n8n/validate-workflows.ts` — валидатор (grep-гейты) + pure
  validateWorkflowJson (переиспользуется smoke и vitest).
- `n8n-workflows/{taskId}.json` ×20 — по одному на задачу реестра.
- `scripts/smoke/n8n-simulate.ts` — smoke-симуляция (см. п.4).
- `src/lib/cron/n8n-receiver.ts` — server-only: probeReceiverHealth
  (safeFetch 2.5 с, честный ok:false при недоступности), listWorkflowFiles,
  readWorkflowFile (путь только из манифеста).
- `src/app/api/admin/automation/workflow/[taskId]/route.ts` — GET withAdmin:
  unknown 404, файла нет 404, **литерал CRON_SECRET в содержимом → 500
  secret_leak_detected (fail-closed, не отдаётся)**; Content-Disposition
  attachment; Cache-Control no-store.
- `src/app/(dashboard)/admin/automation/admin-n8n-card.tsx` — серверный
  компонент карточки «n8n-приёмник»; page.tsx дополнен пробой healthz +
  20 строками воркфлоу.

## 2. Воркфлоу (20/20)

Структура каждого: scheduleTrigger (cron ИЗ реестра) → HTTP Request POST
`={{ $env.BASE_URL }}/api/cron/run/{taskId}` (headers X-Cron-Secret
`={{ $env.CRON_SECRET }}`, X-Cron-Source: n8n; retryOnFail 3 × 5000 мс;
onError continueErrorOutput) → error-ветка HTTP POST
`={{ $env.RECEIVER_URL }}/events` (task/status/meta). Канон n8n HTTP
Request v4: retry — node-свойства. Выключенные задачи имеют файл: их запуск
даёт честный 409 task_disabled. КАРТА «файл → задача» 20/20 —
docs/AUTOMATION.md (раздел S8B2). Старые шаблоны
/home/z/my-project/n8n-workflows/*.json — READ-ONLY, не тронуты.

## 3. Гайд по импорту (дублируется в docs/AUTOMATION.md и карточке)

1. Скачать JSON: /admin/automation → карточка «n8n-приёмник» → «Скачать
   JSON» (только админ; аноним 401, покупатель 403; fail-closed проверка
   литерала секрета перед отдачей).
2. n8n: Workflows → «…» → **Import from File** (или drag-n-drop на канвас).
3. Переменные окружения n8n (self-hosted — env процесса; Cloud — Settings
   → Variables): `BASE_URL` (публичный URL v2), `CRON_SECRET` (тот же, что
   в окружении сервера v2; в репозитории его нет), `RECEIVER_URL` (URL
   приёмника; dev — хост, где поднят mini-services/n8n-receiver).
4. Включить каждый воркфлоу (Active) — расписания вшиты из реестра.

## 4. Запуск приёмника и smoke

- Приёмник: `cd mini-services/n8n-receiver && (bun run dev >
  /tmp/n8n-receiver.log 2>&1 &)` → слушает 127.0.0.1:5678; healthz зелёный;
  журнал в .zscripts/mini-service-n8n-receiver.log append. Keeper:
  proability — положить `.zscripts/dev-keeper.stop` или KEEPER=0.
- Smoke: `bun scripts/smoke/n8n-simulate.ts` — структура 20 JSON (grep-гейты)
  + один HTTP-шаг каждого vs http://127.0.0.1:3100 (секрет из env/.env.local,
  НЕ печатается; X-Forwarded-For уникален на запрос — изоляция rate-limit
  20/мин/IP, повтор в течение минуты не ловит 429).

## 5. Гейт 1 — curl-матрица (agent-ctx/s8b2-matrix.sh → s8b2-matrix-output.txt)

**PASS=29, FAIL=0.** lint 0; tsc 0; vitest **203/203** (из них +16 новых
tests/s8b2-n8n.test.ts: ring cap 500 + вытеснение + immutability; счётчик
24 ч с инъекцией часов — полуоткрытый интервал; normalizeEventPayload;
keeper guard KEEPER=0/prod/stop-handle/порог 3 + grace; 20 файлов на диске —
структура/grep-гейты/валидатор ловит localhost-порчу и подмену cron).
Матрица: healthz 200 (received=0, uptime есть) → POST /events ×2 →
received=2 (counter+2) → GET /events показывает оба → мусор 400; render
/ 200, /catalog 200, /admin/automation anon 307; sitemap-refresh с секретом
200 success trigger=cron; download воркфлоу: аноним 401 / customer 403 /
admin 200 == файл (byte-compare) + attachment-заголовок / unknown 404;
grep 20 JSON: localhost/127.0.0.1/0.0.0.0 = 0 файлов, литералов секрета =
0, $env.CRON_SECRET = 20; bun validate-workflows OK; smoke: **сводка 20/20
(REAL 11/11 → 200, disabled 9/9 → 409 task_disabled), exit 0**.

Итерация: один фикс до коммита — селектор error-ветки в валидаторе
(`={{ $env.RECEIVER_URL }}` содержит пробел после `=`); после фикса все
гейты зелёные с первого прогона.

## 6. Гейт 2 — браузер (agent-browser, 1 батч)

admin@demo.ru (cookie из curl-логина) → /admin/automation: карточка
«n8n-приёмник» — бейдж «Доступен» (received=2, аптайм 4 мин, файлов 20/20),
20 строк «Скачать JSON» (downloads=20 через DOM-eval), инструкция импорта
видна (Import from File + env-переменные), клик «Скачать JSON» без ошибок;
консоль 0 ошибок, page errors 0; мобильный 390: scrollWidth == 390; тёмная
тема. Скрины agent-ctx/: s8b2-r4-n8n-card.png, s8b2-r4-workflow-list.png,
s8b2-r4-mobile-390.png, s8b2-r4-dark.png.

## 7. Артефакты

- Код: c27194e «[S8B2] n8n-integration: receiver :5678 (healthz/events/
  dev-keeper), 20 workflow JSONs placeholders+env secret, smoke simulator
  20/20, admin n8n card (recreate-3-r4)».
- Docs: af46b2f «[S8B2] docs: worklog + AUTOMATION.md mapping (sha/bundle
  pinned)» (worklog v2 prose-only + карта 20/20 и импорт в AUTOMATION.md).
- **Bundle: /home/z/my-project/backups/conditera-v2-S8B2-c27194e.bundle —
  1 591 234 bytes; verify: complete history, main = af46b2f (docs на базе
  c27194e).** Root-коммит 45827ce «backup: conditera-v2 S8B2 bundle
  c27194e» (add -f ONLY bundle).
- Матрица: agent-ctx/s8b2-matrix.sh + s8b2-matrix-output.txt (PASS=29/0).
- Скрины: s8b2-r4-{n8n-card,workflow-list,mobile-390,dark}.png.
- Рендеры после коммита: / 200, /catalog 200.

## 8. Отклонения (осознанные)

- n8n-движок в песочнице НЕ запускается (ограничение блока): проверка
  воркфлоу структурная (валидатор + vitest + grep-гейты) и через
  smoke-симуляцию HTTP-шага против dev:3100; живой импорт — инструкция.
- Smoke ожидает 409 `{"error":"task_disabled"}` — фактический контракт
  исполнителя S8B1 (в спесе кратко «disabled»; литерал из манифеста/роута).
- Retry 3×5 с — node-свойства n8n HTTP Request v4 (retryOnFail/maxTries/
  waitBetweenTries), не parameters.options.
- dev-keeper получил grace-период 90 с после респауна (свежему dev нужно
  время подняться, иначе цикл respawn-циклов) — policy в pure-функции.
- Smoke изолирует rate-limit уникальным X-Forwarded-For на запрос
  (паттерн s8b1-матрицы): 20 POST-ов одного прогона не вытесняют друг
  друга и не зависят от предыдущего прогона.
- Каждая загрузка страницы /admin/automation делает пробу healthz
  (2.5 с timeout, safeFetch): приёмник недоступен → честный бейдж
  «Недоступен» с причиной; UI не кэширует статус.

## 9. TODO владельцу (outside sandbox)

1. Развернуть n8n (docker или cloud), импортировать 20 воркфлоу по гайду
   (п.3), задать BASE_URL/CRON_SECRET/RECEIVER_URL и включить Active.
2. В n8n self-hosted убедиться, что переменные окружения читаются как
   $env.* (env-переменные процесса; в n8n Cloud — Variables).
3. RECEIVER_URL должен указывать на запущенный mini-services/n8n-receiver
   (или настоящий приёмник событий prod-контуре); bound 127.0.0.1 —
   наружу только через реверс-прокси при необходимости.
4. KEEPER/dev-keeper — только dev: в prod-развёртывании процесс держит
   systemd/supervisor, keeper выключить (KEEPER=0 или NODE_ENV=production).
5. S9B1: crontab-развёртывание без n8n + полный файл-дамп базы (pg_dump)
   вместо счётчик-снапшота backup.

Следующий блок: **S9B1** (crontab + полный дамп БД).
