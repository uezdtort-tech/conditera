# BACKUP_RECOVERY — резервное копирование и восстановление (DEPLOY-01 §10)

**DEPLOY-01 EXTENDED (§10) · Дата: 2026-11-10**
Исходники: `src/lib/backup.ts`, `scripts/ops/run-backup.mjs`, `scripts/ops/backup-verify-restore.mjs`, `src/app/api/cron/backup/route.ts`, `.github/workflows/maintenance.yml`.

**Железное правило §10: доказательство бэкапа — успешное восстановление, а не «файл создан».** Бэкап, который ни разу не был развёрнут, считается непроверенным.

---

## 1. Два пути создания бэкапа (`runFullBackup`, src/lib/backup.ts)

| Путь | Условие | Механика |
|---|---|---|
| **1. pg_dump → gzip** (основной) | `DATABASE_URL` начинается с `postgresql://` И бинарь `pg_dump` доступен (`which pg_dump`, таймаут 5s) | `pg_dump "<DATABASE_URL>" --no-owner --no-privileges \| gzip > backups/backup-<ts>.sql.gz`, таймаут 5 мин; счётчик таблиц через `pg_dump --list` |
| **2. JSON-экспорт** (деградация/альтернатива) | pg_dump недоступен (embedded PG, Supabase-окружения без бинаря) или pg_dump упал | SQL `SELECT * FROM public."<t>" LIMIT 200000` по явному списку **33 таблиц** (`BACKUP_TABLES`) через pg-пул; файл `backup-<ts>.json.gz` с `metadata {timestamp, version:"2.0", format:"json-tables", tablesCount, tablesRequested, totalRecords, databaseType, warnings}` |

Список `BACKUP_TABLES` (33): profiles, user_roles, confectioners, products, orders, order_items, cart_items, reviews, video_reviews, promotions, recipes, recipe_marketplace, recipe_purchases, chat_rooms, chat_messages, payments, financial_audit_log, inventory_items, inventory_movements, stock_movements, cms_pages, cms_blocks, banners, site_settings, nav_menu_items, loyalty_transactions, notifications, audit_log, domain_events, ops_tasks, maintenance_logs, app_incidents, app_error_events.

Честный итог (§19): отсутствующая таблица → `warnings` + пропущенная (не «успех с 0»); если **ни одна** таблица не прочитана — throw/`success:false`. Исторический баг закрыт: прежний fallback использовал Prisma-синтаксис на supabase-js и возвращал «успех» с 0 записей; теперь данные реально читаются из БД.

Каталог: `BACKUP_DIR` (по умолчанию `./backups` от корня проекта). Ретеншн: `cleanupOldBackups()` удаляет файлы старше **30 дней** (`BACKUP_RETENTION_DAYS`). Служебные API: `listBackups()` — для админ-панели.

### 1.1 Артефакты и покрытие

| Аспект | Факт |
|---|---|
| Имена файлов | `backup-<ISO-timestamp>.sql.gz` (pg_dump-путь) / `backup-<ISO-timestamp>.json.gz` (JSON-путь) |
| Расположение | `BACKUP_DIR` локальной ФС среды (контейнер/хост); внешний офсайт-хранитель не реализован — решение владельца вместе с RPO/RTO (D-EXT-5) |
| Покрытие | только таблицы БД из §1 (33 таблицы для JSON-пути; pg_dump — вся БД) |
| **Не покрывается** | объектные файлы (медиа/загрузки во внешнем хранилище) — кода бэкапа хранилища файлов в репозитории нет; учитывать при оценке RPO |
| Журнал | `maintenance_logs (BACKUP_FULL)`: статус/длительность/путь/размер/таблицы/удалённые старые бэкапы |

### 1.2 Типовые ситуации

| Ситуация | Поведение кода |
|---|---|
| `pg_dump` не найден в контейнере | автоматический переход на JSON-путь (реальные SELECT из БД) |
| pg_dump упал (ошибка/таймаут 5 мин) | лог `[backup] pg_dump failed, falling back to JSON export` → JSON-путь |
| Таблицы нет в схеме (например старая среда) | `warnings: "<t>: skipped (…)"`, таблица пустая в файле, итог не «успех-пустышка» |
| Ни одна таблица не прочитана | throw → `maintenance_logs.status = failed` → HTTP 500 |
| Неверный `X-Cron-Secret` | 401 `cronUnauthorized` до любых операций |

## 2. Запуск по cron

`GET /api/cron/backup` (`runtime=nodejs`):
- аутентификация — `verifyCronSecret(req)` (заголовок `X-Cron-Secret` = `CRON_SECRET`), иначе 401 (`cronUnauthorized`);
- сначала запись `maintenance_logs` (`type: BACKUP_FULL`, `status: running`, `triggeredBy: cron`), после выполнения — обновление до `success`/`failed` с `durationMs`, `backup_path`, `backup_size_bytes`, `tables_count`, `recordsAffected`, `details.oldBackupsDeleted`, `error_message`;
- ответ 200: `{success, backupPath, backupSizeBytes, tablesCount, recordsExported, durationMs, oldBackupsDeleted, logId}`; ошибка → запись `failed` + 500 `{error:"Backup failed", detail}`.

Расписание: `maintenance.yml` вызывает эндпоинт ежедневно в 04:00 UTC — **пока READY FOR OWNER APPROVAL** (`MAINTENANCE_APP_URL`/`MAINTENANCE_CRON_SECRET` не настроены, job честно SKIPPED; OWNER_DECISIONS.md D-EXT-3). Staging-путь — `backup-staging.sh` на хосте перед каждым деплоем (STAGING_DEPLOYMENT.md §3). Где физически лежат бэкапы: `./backups` рабочей директории приложения соответствующей среды (каталог локальный для контейнера/хоста — вынос на внешнее хранилище не реализован и остаётся за владельцем).

## 3. Верификация восстановления (`scripts/ops/backup-verify-restore.mjs`)

Скрипт **только читает** рабочую БД и пишет в новую одноразовую БД; destructive-операции против production запрещены by design. Шаги:

1. **Бэкап** реальным кодом приложения: `runFullBackup()` через `scripts/ops/run-backup.mjs` (bun резолвит `@/lib/backup`); сбой → прерывание до восстановления.
2. Проверка непустоты: `totalRecords > 0` (не «успех с 0 записей»).
3. **Disposable-БД** `conditera_restore_verify_<timestamp>` (DROP IF EXISTS + CREATE; рабочая БД не трогается): каждая непустая таблица → `restore_<table> (data jsonb)`, построчный INSERT.
4. **Трёхсторонняя сверка** количества строк: источник ↔ backup-JSON ↔ восстановленная копия (`src=N backup=N restore=N`); допуск: `srcN >= jsonN` либо `jsonN === 200000` (потолок LIMIT на таблицу).
5. **Удаление** disposable-БД и подтверждение (`pg_database`), рабочая БД не тронута.

Exit: 0 = PASSED, 1 = FAILED (счётчик failures по каждой проверке). Ограничение честности: JSON-восстановление доказывает построчную читаемость/целостность данных; полный подъём схемы в production — pg_dump-путь либо ledger-миграции на чистой БД + перенос данных. В maintenance.yml скрипт — шаг `restore-verify` по SSH на staging-хосте (ежедневно после бэкапа; без secrets — честный SKIPPED).

## 4. Измеренное доказательство (локальная среда, 2026-11-10)

```
bun scripts/ops/backup-verify-restore.mjs
# Source DB: 127.0.0.1:54329/conditera (embedded PostgreSQL)
# Результат: RESTORE-VERIFY: PASSED (exit code 0)
# 13 таблиц / 736 записей восстановлено и сверено
# контрольные сверки: app_incidents   735 = 735 = 735
#                     app_error_events  1 =  1 =  1
# disposable-БД conditera_restore_verify_<ts> удалена
```

Это **единственное на 2026-11-10 зафиксированное доказательство** пригодности бэкапа (локальная среда). Регулярная автоматическая проверка начнёт работать после настройки staging-инфраструктуры (D-EXT-1) и maintenance-секретов (D-EXT-3).

## 5. Процедура восстановления в production (ручная)

1. Зафиксировать инцидент в реестре (INCIDENT_MANAGEMENT.md §4.2), приоритет P0 по умолчанию.
2. Остановить запись данных: `docker compose stop web` (и chat-server) — новых транзакций нет.
3. Выбрать последний проверенный бэкап: `listBackups()` (src/lib/backup.ts), каталог `./backups` на хосте, журнал `maintenance_logs (BACKUP_FULL)`.
4. Поднять восстановленную копию в **новую** БД: для `.sql.gz` — `gunzip -c backup-<ts>.sql.gz | psql "<NEW_DB_URL>"`; для `.json.gz` — тем же путём, что restore-verify (шаги 3–4); сверить счётчики ключевых таблиц с ожиданиями владельца.
5. Переключить `DATABASE_URL` на восстановленную БД → `docker compose up -d web` → `/api/health` → smoke.
6. **Потеря данных после точки бэкапа** неизбежна и оценивается владельцем (RPO — решение D-EXT-5).

## 6. RPO/RTO — не устанавливаются этим документом

RPO/RTO **не придумываются**: их значения — бизнес-решение владельца (OWNER_DECISIONS.md **D-EXT-5**). Факты для принятия решения: автоматический триггер — ежедневный cron 04:00 UTC (после D-EXT-3); ретеншн файлов — 30 дней; restore-verify — ежедневно на staging (после D-EXT-1); время восстановления ограничено размером БД и ручными шагами §5; внешний офсайт-хранитель бэкапов — не реализован (входит в решение владельца вместе с RPO/RTO).
