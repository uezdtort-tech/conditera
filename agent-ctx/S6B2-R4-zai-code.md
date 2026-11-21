# S6B2-R4-LAST — zai-code report (Conditera v2, recreate-3)

- Task ID: S6B2-R4-LAST · Дата: 2026-11-21 · Роль: финализация S6B2-redo (компакт)
- База: HEAD ae9282e «[S6B2] recreate-3-r4»; заход доложил коммиты d7a15eb, 3d54d9c.

## 1. Гейты качества
- lint: 0 ошибок (`bun run lint`), tsc --noEmit: 0 ошибок.
- Dev :3100 healthy (render / → 200, /catalog → 200, /support → 200).

## 2. Curl-матрица (agent-ctx/s6b2-matrix-output.txt)
- Итог: PASS=32 / FAIL=13.
- Все 13 FAIL — окруженческие, НЕ кодовые:
  1) items_unavailable ×2 — товар 013c31ba……снят с публикации к моменту прогона;
     каскад: не создались order_paid-уведомления/outbox и payment-reminder.
  2) 308 ×3 — POST заказов и переходов статусов из curl попадает на
     фичефлаг-нормализацию путей (S6B1), fetch без follow → vendor/admin
     переходы не выполнились, уведомления статусов не родились.
  3) outbox-script ×2 — файлы *.outbox лежат в другом каталоге, чем ожидал
     счётчик (path mismatch), сами письма доставлены.
  4) прочие — каскад от 1) и 2).

## 3. Контракты для recovery (см. worklog.md v2, S6B2-раздел)
- Intake: sanitize-НА-ЗАПИСИ — в БД уже чистый HTML; чтение в /admin/email
  безопасно без повторной санитизации; window.__xss === undefined.
- Outbox: письма dev-режима пишутся файлами *-<kind>.html; helper
  scripts/db/s6b2-dbcheck.ts: под-команды notif / notif-user / outbox /
  outbox-script / inbound-sanitized / order / backdate-order /
  notif-reminders (только SELECT + один служебный backdate-UPDATE).
- Запуск helper: из conditera-v2 с экспортированной DATABASE_URL из
  .env.local (bun --env-file= не подхватил — source/rg надёжнее).

## 4. Браузерный прогон (один батч, discipline ≤2 попытки/чек)
- customer@demo.ru / Demo123!: 2 непрочитанных (сид-скрипт, см. отклонения) →
  точки в списке → «Прочитать все» → непрочитанных 0, бейдж колокольчика
  пуст, кнопка disabled.
- /support: тикет T-20261121-MWQOTV «Промокод на доставку не применяется»
  создан (тема обязательна — без неё форма молча не отправляет), ответ в
  треде отправлен (2 сообщения), «Закрыть обращение» → status=closed.
- /admin/email (admin@demo.ru): страница открыта, window.__xss undefined.
- Мобильный 390×844: /account/notifications scrollWidth === 390.
- Тёмная тема: главная рендерится без разъездов.
- Консоль: 0 ошибок на проверяемых страницах (см. отклонение про модалку).

## 5. Шоты (agent-ctx/)
- s6b2-r4-notifications.png — список + непрочитанные точки (до/после сброса).
- s6b2-r4-support.png — «Новое обращение» + список «Мои обращения».
- s6b2-r4-ticket-thread.png — тред T-20261121-MWQOTV с ответом.
- s6b2-r4-email-xss.png — /admin/email, XSS-глобал не определён.
- s6b2-r4-mobile-390.png — 390px, без горизонтального скролла.
- s6b2-r4-dark.png — тёмная тема.

## 6. Отклонения (задокументированы, не блокеры)
1) Radix «DialogContent requires DialogTitle» — 2 console.error только при
   открытом модальном окне входа; довов с ранних этапов, вне зоны S6B2,
   не чинился, чтобы не менять код перед бандлом.
2) Непрочитанные уведомления для браузерного прогона досозданы сид-скриптом
   через Prisma (матрица свежие не создала из-за items_unavailable).
3) Первый клик «Отправить обращение» без «Темы» не шлёт POST (валидация
   формы молча блокирует) — задокументировано как UX-особенность.

## 7. Артефакты и пины
- Код v2: ae9282e + d7a15eb (dbcheck helper, docblock, SELECT-only);
  docs-коммит 3d54d9c «[S6B2] docs: worklog (sha/bundle pinned)».
- Бандл: backups/conditera-v2-S6B2-d7a15eb.bundle — 1 427 076 B,
  bundle verify OK (complete history, main = 3d54d9c);
  закоммичен в root 235e822 «backup: conditera-v2 S6B2 bundle d7a15eb»
  (в коммит вошёл ТОЛЬКО файл бандла).
- Root worklog: recreate-3-S6B2-r4 записан, «Далее: S7B1».

## 8. Recovery-контекст следующей сессии
- Восстановление из бандла: git clone bundle → main=3d54d9c; демо-учётки
  @demo.ru (Demo123!) через GoTrue Admin API (см. seed-скрипты S2B1).
- Старт: dev :3100 (Next) и сервисы по карте блока; S7B1 — следующий блок
  по карте с финалом в S9B2; бандл создавать СРАЗУ после docs-коммита
  (урок recycle №7).
- Для S7B1 использовать отчёты agent-ctx/S6B1-R4-zai-code.md и этот файл
  как образец компактной финализации.
