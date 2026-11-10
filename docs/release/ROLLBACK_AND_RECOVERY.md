# ROLLBACK_AND_RECOVERY — стратегия отката и восстановления (Z-v21)

**Дата:** 2026-11-10. Фактически проверено: backup→restore на disposable PG18 (RESTORE-VERIFY: PASSED, 15 таблиц сверены источник↔backup↔restore, disposable удалена, рабочая БД не тронута).

## 1. Что резервируется

`scripts/ops/run-backup.mjs` → `runFullBackup` (`src/lib/backup.ts`): JSON-снимок **критичных бизнес-таблиц** (в текущем прогоне: 33 таблицы, 157 записей; profiles, user_roles, confectioners, products, orders, order_items, cart_items, recipes, recipe_marketplace, inventory_*, cms_pages, notifications, domain_events, ops_tasks и др.) → `backups/backup-<ts>.json.gz`.

**Известное ограничение**: 33 из 248 таблиц — справочники/CMS/служебные восстанавливаются пересозданием из миграций+сидов, а не из backup. Полный список таблиц backup — в `src/lib/backup.ts` (BACKUP_TABLES).

## 2. Где хранится и кто имеет доступ

- Локально: `backups/` (git-ignored). В staging/production — задача владельца: каталог на хосте + offsite-копия (S3/Яндекс.Диск), доступ только у админов.
- Срок хранения: рекомендация — 30 дней daily, 6 месяцев monthly (владелец настраивает под требования закона).
- Целостность: gzip + сверка счётчиков строк при restore-verify.

## 3. Порядок восстановления (проверенная процедура)

```
node/bun scripts/ops/backup-verify-restore.mjs
  Шаг 1: runFullBackup → backup-<ts>.json.gz
  Шаг 2: создание DISPOSABLE БД conditera_restore_verify_<ts> → восстановление
  Шаг 3: сверка строк источник ↔ backup ↔ restore (15 ключевых таблиц)
  Шаг 4: удаление disposable
```

При реальном recovery: тот же путь, но restore направляется в целевую БД после остановки приложения (скрипт восстанавливает в новую disposable-БД — при DR переключить connection на неё после сверки). Восстановление идёт через pg-клиент (psql/pg_restore в песочнице отсутствуют).

## 4. Откат приложения при уже применённых миграциях

- Миграции **forward-only** (ledger `schema_migrations`); автоматического down-migration нет.
- Совместимость: деплой приложения N+1 поверх миграций N безопасен; откат кода на N при миграциях N+1 возможен только если миграции N+1 обратно-совместимы (additive). Перед деплоем сверять: новые миграции должны быть additive (без DROP/NOT NULL без default) — это правило код-ревью миграций.
- При несовместимом откате: восстановить БД из backup в disposable, поднять предыдущий SHA против неё, переключить трафик.

## 5. Действия при неуспешном deployment

| Симптом | Действие |
|---|---|
| CI красный на SHA | не публиковать SHA; фикс локально; новый коммит-fix |
| health/ready 503 после деплоя | проверить миграции/БД; при ДБ-проблеме — откат на предыдущий SHA-образ |
| 5xx-шторм | откат образа на предыдущий SHA (данные не трогаются) |
| Порча данных | остановить запись → backup текущего состояния (для форензики) → restore последнего хорошего backup в disposable → сверка → переключение |

## 6. Rollback rehearsal

Требуется отдельное разрешение владельца на staging (RUNBOOK Этап 6). План: поднять предыдущий SHA, подтвердить health + smoke, вернуть текущий. На production не выполняется.
