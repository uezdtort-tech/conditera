# BACKUP / RECOVERY READINESS — Z-v20

## Проверка (выполнена фактически)

Команда: `bun scripts/ops/backup-verify-restore.mjs` (= `bun run ops:restore-verify`)

1. **Backup**: снимок рабочей dev-БД — 519 записей, 33 таблицы (непустой «успех» проверяется).
2. **Restore**: восстановление в disposable-БД `conditera_restore_verify_<ts>` (отдельный инстанс).
3. **Сверка целостности** источник ↔ backup ↔ restore — 17 ключевых таблиц:

   profiles 19/19/19 · user_roles 24/24/24 · confectioners 5/5/5 · products 12/12/12 ·
   orders 7/7/7 · order_items 2/2/2 · recipes 4/4/4 · recipe_marketplace 3/3/3 ·
   payments 6/6/6 · inventory_items 12/12/12 · inventory_movements 12/12/12 ·
   cms_pages 7/7/7 · notifications 215/215/215 · domain_events 62/62/62 ·
   ops_tasks 3/3/3 · app_incidents 23/23/23 · app_error_events 103/103/103

4. **Cleanup**: disposable-БД удалена, рабочая не тронута.

Вердикт: **RESTORE-VERIFY: PASSED**. Backup без restore-верификации не считается успешным (правило соблюдено).

## Эксплуатационные параметры (документированные)

| Параметр | Значение | Источник |
|---|---|---|
| Периодичность backup | ежедневно (cron) + перед деплоем | docs/operations/BACKUP_RECOVERY.md, maintenance.yml |
| Retention | 90 дней (diagnostics/maintenance_logs — отдельный retention endpoint) | docs/operations/ |
| Место хранения | локальный каталог бэкапов; **внешний storage НЕ настроен** | KNOWN_LIMITATIONS |
| RPO | до 24 ч (при ежедневном cron без внешнего стораджа) | оценка |
| RTO | часы (ручной restore по runbook) | оценка |
| Restore-верификация | обязательный шаг (disposable-БД + сверка количества записей) | scripts/ops/backup-verify-restore.mjs |
| Проверка скриптов через package.json/CI | `bun run ops:backup` / `bun run ops:restore-verify`; maintenance.yml вызывает `/api/cron/backup` c X-Cron-Secret | проверено Z-v20 |

## Незакрытые эксплуатационные пункты (владельцу)

1. **Внешний backup storage не настроен** (S3/Glacier/др.) — локальные бэкапы погибают
   вместе с машиной. Действие: настроить внешнее хранилище + секреты, включить выгрузку
   в maintenance.yml (см. OWNER_ACTIONS_REQUIRED.md).
2. Backup шифрование и проверка восстановления на площадке провайдера — после выбора storage.
