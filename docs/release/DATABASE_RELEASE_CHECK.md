# DATABASE RELEASE CHECK — Z-v20

## Общие сведения

| Параметр | Значение |
|---|---|
| Всего миграций | **79** (0001–0079, `supabase/migrations/`) |
| Канонический путь применения | файл → dollar-quote-aware сплиттер → statement-by-statement autocommit (как psql) |
| Ledger | `public.schema_migrations(filename, applied_at)` |
| Dev-БД | embedded PostgreSQL, порт 54329, ledger до 0079 включительно |
| Производственная БД | НЕ ТРОНУТА (запрещено; проверки — только на disposable-инстансах) |

## PG18 migration harness (чистая disposable PostgreSQL 18)

Команда: `node scripts/verify/prodpath-release03-verify.mjs`
Порт 54351, data-dir `/tmp/prodpath-r03-<ts>` (удалена после прогона), dev-БД :54329 гвардится.

Результат: **PRODPATH SUMMARY — SUCCESS**

- Bootstrap Supabase-совместимой среды (роли anon/authenticated/service_role/supabase_admin,
  схема auth, storage, бакеты): 27/27 statements.
- Все 79 миграций применены по порядку: 0 ошибок.
- Ledger == файлам на диске; lineage 0001..0078 полон (0056/0073 отсутствуют на диске
  и в ledger — консистентно).
- **STRICT RERUN** 0075–0078 целиком: 0 ошибок (идемпотентность).
- **PARTIAL FAILURE**: первые 2 statement 0076/0077 отдельно → затем файл целиком → успех
  (корректная обработка частичного применения).
- GRANT-assertions: 10 table checks + 3 function checks + прямые пробы `SET ROLE authenticated`.
- Модерация 0076: колонки moderated_by/moderated_at/moderation_reason у recipes — на месте.
- RLS: политики проверяются в рамках harness и юнит-набора (recipe purchases автор-политика
  0078, user_roles recursion fix 0074, diagnostics 0079).

## Соответствие схемы коду

- Проверено прогонами: order-lifecycle (orders/order_items/order_production/capacity_reservations/
  purchase_drafts/inventory_movements/ops_tasks/domain_events), checkout-idempotency
  (metadata->>idempotency_key), backup-verify (сверка 17 ключевых таблиц), diagnostics
  (app_error_events/app_incidents).
- Prisma удалён (v2.0 Supabase) — скрипты db:* — no-op с подсказками (см. package.json).

## Rollback-стратегия

- Миграции прямые (без down-файлов); откат на уровне релиза — см. ROLLBACK_RUNBOOK.md
  (восстановление из backup + предыдущий образ приложения).
- Перед production-применением: обязательный backup (scripts/ops/run-backup.mjs) и
  restore-verify на disposable-БД.

## Рекомендация перед production

1. Применять миграции тем же statement-by-statement путём (ops-apply-скрипты/CI job).
2. После применения — прогнать `scripts/verify/prodpath-release03-verify.mjs` на
   disposable-копии production (не на самой production!).
3. Убедиться, что `CRON_SECRET`, `N8N_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET` заданы
   ДО открытия публичного трафика (fail-closed эндпоинты останутся 503 — это ожидаемо).
