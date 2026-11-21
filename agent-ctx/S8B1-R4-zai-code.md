# S8B1-R4 (recreate-3) — zai-code отчёт: Cron-ядро, единый реестр задач

Дата: 2026-11-21. Ветка main (conditera-v2), база 061046a (S7B2 complete,
dev :3100 healthy). Код этого блока: **cc37bcc**; docs: **9ec7bc0**;
bundle-коммит в root: 7758a6a.

## 1. Реестр (код cc37bcc)

20 задач = 11 REAL (enabled) + 9 честно disabled:

- **REAL 11** — abandoned-cart, weekly-digest, expiring-bonuses,
  escrow-auto-release, payment-reminders, cleanup, sitemap-refresh,
  review-analysis, content-moderation, user-reengagement, backup
  (REAL-light: счётчик-снапшот, pg_dump = S9B2, не имитируется). Все
  идемпотентны: дедуп уведомлений по refId (data JSON — паттерн S6B2),
  суточный guard бонусов, полные пересчёты, возрастные пороги чисток.
- **disabled 9** — holiday-reminders, franchisee-reports, crm-integration,
  demand-forecasting, certification-reminders, pp-certification-check,
  quality-inspections, taster-assignment, subscriptions. 409 до всякого
  прогона; fn бросает CronTaskNotImplemented (vitest-гейт на честность).

Структура: `src/lib/cron/manifest.ts` — ЧИСТЫЙ (без server-only): типы,
манифест, rotateHistoryIds/findStaleRunning/truncateError (vitest);
`src/lib/cron/tasks.ts` — реализации; `src/lib/cron/registry.ts` — CRON_TASKS
+ runCronTask. Вынесения: `src/lib/payments/bonus-expiry.ts` (из
expiring-bonuses роута), `src/lib/storage/cleanup.ts` (из storage-cleanup
роута), `sweepCsrfStore()` в csrf.ts.

## 2. Исполнитель и журнал

POST /api/cron/run/[taskId]: rate 20/мин/IP → 429 + Retry-After; секрет
X-Cron-Secret (constant-time sha256; не задан → 503 fail-closed; неверный →
401) ИЛИ админ-сессия + одноразовый CSRF (порядок: сессия → CSRF → RBAC;
аноним → 401). unknown 404; disabled 409; running <15 мин → 409 locked;
running ≥15 мин → dead-reap (failed + errorMessage) и продолжение. CronRun:
trigger (схема расширена db:push), startedAt/finishedAt, durationMs, stats →
metadata, errorMessage ≤500. Ротация 50/задача. Прогон с ошибкой fn = 200
failed (сбой исполнения ≠ сбой API). GET-запуск запрещён (405).

GET /api/cron/status: секрет ИЛИ админ (customer 403, anon 401): манифест 20
+ lastRun каждой + 10 последних прогонов; ?taskId= — история до 50.

Легаси-делегации (контракты сохранены): auto-complete (POST),
expiring-bonuses (POST), payment-reminders (GET), storage-cleanup (POST —
исходные поля S2B4 + superset csrfSwept/staleCartsPurged/totalDeleted).
HTTP-самовызовов нет (старый проект делал self-fetch — убрано).

## 3. UI /admin/automation

Каркас S5B3 + пункт «Автоматизация» (Bot-иконка в nav-items/admin-sidebar-
nav). Таблица 20 задач: название+id, расписание RU+cron, бейдж
Активна/Не реализована, последний прогон (статус+ago), длительность, триггер;
«Запустить» — confirm Dialog + csrfFetch + тосты; раскрытие строки — 10
прогонов + stats preview; Skeleton при перезагрузке истории; EmptyState
«Прогонов ещё не было»; мобильный <md — карточки + Sheet (детали/история).
Страница — серверный requireAccess(ADMIN_ADMIN_ROLES), данные из БД напрямую.

## 4. Гейт 1 — curl-матрица

agent-ctx/s8b1-matrix.sh → s8b1-matrix-output.txt: **PASS=42, FAIL=0**.
Рендеры: / 200, /catalog 200, /admin/automation anon 307. unknown 404;
GET-запуск 405; sitemap-refresh anon 401 → с секретом 200 success
(urlCount=35, warmed) + CronRun-строка в БД (dbcheck: success, trigger=cron,
hasStats=yes); cleanup 200 (csrfSwept int, storage.mode local,
staleCartsPurged int); disabled 409 task_disabled; admin@demo.ru manual:
без CSRF 403, с CSRF 200 trigger=manual + CronRun (dbcheck trigger=manual);
raw без сессии → 401; status: секрет 200 (tasks=20) / admin 200 / customer
403 / anon 401; легаси 4 контракта 200 с ключами контрактов; rate: 20× →
404, 21-й → 429 + Retry-After=60.

Итерация: первый прогон 32/10 — перенесён auth до CSRF в ручной ветке
(аноним → 401 по гейт-матрице), existsSync-guard бакет-каталога в
storage-cleanup (dev без загрузок: ENOENT), убрано jar-загрязнение anon-шага
матрицы. Повторный прогон — 42/0.

## 5. Гейт 2 — браузер (1 батч)

admin@demo.ru/Demo123! → /admin/automation: 20 строк (count=20); «Запустить»
«Обновление sitemap» → confirm Dialog → тост «выполнена за 76 мс»; раскрытие
истории: «Последние 10 прогонов», триггер «Вручную», stats urlCount; консоль
0 ошибок (errors+console пусто); мобильный 390: scrollWidth == 390; тёмная
тема. Скрины agent-ctx/: s8b1-r4-automation.png, s8b1-r4-history.png,
s8b1-r4-mobile-390.png, s8b1-r4-dark.png (+ s8b1-r4-toast-run.png,
s8b1-r4-mobile-sheet.png).

## 6. Тесты/статика

vitest +18 pure (tests/s8b1-cron-core.test.ts): манифест (20/11/9, составы
по спеке, cron-формат, findCronTaskMeta, CronTaskNotImplemented), ротация
(keep=50, хвост на удаление, keep=0 no-op), dead-reap (граница 15 мин,
свежие/завершённые исключены, ISO-парсинг), truncateError. Итого 187/187;
lint 0; tsc 0.

## 7. Отклонения (осознанные)

- cleanup объединяет csrf sweep + storage-сироты + протухшие корзины в ОДНУ
  задачу (легаси-роут storage-cleanup сохранён с исходным контрактом);
  «stale guest cart purge» = корзины старше 30 дней (в v2 гостевые корзины —
  localStorage, после слияния становятся строками cart_items; отдельной
  гостевой таблицы нет — интерпретация зафиксирована в docs/AUTOMATION.md).
- content-moderation: флаг — audit-запись cron_review_autoflag (модели
  ModerationQueue в v2 нет; очередь = pending-отзывы /admin/moderation,
  отзыв остаётся непубличным).
- Промежуточный коммит в root «0a942e0…-cron» из прошлой сессии — мусор
  (см. git log root); настоящий пин этого блока — cc37bcc/9ec7bc0.

## 8. Артефакты

- Код: conditera-v2 cc37bcc «[S8B1] cron-core: unified registry 20 tasks,
  idempotent executor with CronRun history, admin automation UI
  (recreate-3-r4)».
- Docs: conditera-v2 9ec7bc0 «[S8B1] docs: worklog + AUTOMATION.md (sha/
  bundle pinned)» (docs/AUTOMATION.md — prose-only, без env-литералов).
- **Bundle: /home/z/my-project/backups/conditera-v2-S8B1-cc37bcc.bundle —
  1 556 186 bytes; verify: complete history, main = 9ec7bc0 (docs на базе
  cc37bcc).** Root-коммит 7758a6a «backup: conditera-v2 S8B1 bundle cc37bcc».
- Матрица: agent-ctx/s8b1-matrix.sh + s8b1-matrix-output.txt (PASS=42/FAIL=0).
- Скрины: s8b1-r4-{automation,history,mobile-390,dark}.png (+toast-run,
  mobile-sheet).
- dbcheck: conditera-v2/scripts/db/s8b1-dbcheck.mjs.

Следующий блок: **S8B2** (n8n-планировщик поверх точек входа реестра).
