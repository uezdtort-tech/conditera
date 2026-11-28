# BACKUP_RECOVERY — резервное копирование и восстановление (DEPLOY-01 §10)

**DEPLOY-01 EXTENDED (§10) · Дата: 2026-11-10**
Исходники: `src/lib/backup.ts`, `scripts/ops/run-backup.mjs`, `scripts/ops/backup-verify-restore.mjs`, `src/app/api/cron/backup/route.ts`, `.github/workflows/maintenance.yml`.

**Железное правило §10: доказательство бэкапа — успешное восстановление, а не «файл создан».** Бэкап, который ни разу не был развёрнут, считается непроверенным.

---

## 1. Два пути создания бэкапа (`runFullBackup`, src/lib/backup.ts)

| Путь | Условие | Механика |
|---|---|---|
| **1. Полный pg_dump → gzip** (production) | `DIRECT_DATABASE_URL` задан и доступны оба бинаря `pg_dump` + `psql`; подключение идёт напрямую, не через PgBouncer | Plain SQL dump через `pg_dump --no-owner --no-privileges`, потоково сжимается в `backup-<ts>.sql.gz`; число таблиц берётся из каталога PostgreSQL |
| **2. JSON-экспорт** (только development/явное разрешение) | Вне production либо `BACKUP_ALLOW_JSON_FALLBACK=true` | `SELECT * FROM public."<t>" LIMIT 200000` по явному списку **33 таблиц** (`BACKUP_TABLES`); файл `backup-<ts>.json.gz` с `metadata {timestamp, version:"2.0", format:"json-tables", tablesCount, tablesRequested, totalRecords, databaseType, warnings}`; это частичный снимок, не полный backup |

Список `BACKUP_TABLES` (33): profiles, user_roles, confectioners, products, orders, order_items, cart_items, reviews, video_reviews, promotions, recipes, recipe_marketplace, recipe_purchases, chat_rooms, chat_messages, payments, financial_audit_log, inventory_items, inventory_movements, stock_movements, cms_pages, cms_blocks, banners, site_settings, nav_menu_items, loyalty_transactions, notifications, audit_log, domain_events, ops_tasks, maintenance_logs, app_incidents, app_error_events.

Честный итог (§19): отсутствующая таблица → `warnings` + пропущенная (не «успех с 0»); если **ни одна** таблица не прочитана — throw/`success:false`. Исторический баг закрыт: прежний fallback использовал Prisma-синтаксис на supabase-js и возвращал «успех» с 0 записей; теперь данные реально читаются из БД.

Каталог: `BACKUP_DIR` (по умолчанию `./backups` от корня проекта). Ретеншн: `cleanupOldBackups()` удаляет файлы старше **30 дней** (`BACKUP_RETENTION_DAYS`). Служебные API: `listBackups()` — для админ-панели.

### 1.1 Артефакты и покрытие

| Аспект | Факт |
|---|---|
| Имена файлов | `backup-<ISO-timestamp>.sql.gz` (pg_dump-путь) / `backup-<ISO-timestamp>.json.gz` (JSON-путь) |
| Расположение | `BACKUP_DIR`; в production Compose постоянный named volume `conditera_backups` монтируется в `/app/backups`; внешний офсайт-хранитель не реализован — решение владельца вместе с RPO/RTO (D-EXT-5) |
| Покрытие | только таблицы БД из §1 (33 таблицы для JSON-пути; pg_dump — вся БД) |
| **Не покрывается** | объектные файлы (медиа/загрузки во внешнем хранилище) — кода бэкапа хранилища файлов в репозитории нет; учитывать при оценке RPO |
| Журнал | `maintenance_logs (BACKUP_FULL)`: статус/длительность/путь/размер/таблицы/удалённые старые бэкапы |

### 1.2 Типовые ситуации

| Ситуация | Поведение кода |
|---|---|
| `pg_dump` или `psql` не найден в production runner | `success:false`; JSON fallback запрещён по умолчанию, чтобы не выдавать частичный экспорт за полный backup |
| pg_dump упал (ошибка/таймаут) | в production — `success:false`; в development допускается JSON fallback |
| Таблицы нет в схеме (например старая среда) | `warnings: "<t>: skipped (…)"`, таблица пустая в файле, итог не «успех-пустышка» |
| Ни одна таблица не прочитана | throw → `maintenance_logs.status = failed` → HTTP 500 |
| Неверный `X-Cron-Secret` | 401 `cronUnauthorized` до любых операций |

## 1.3. Отдельный backup Supabase PostgreSQL (PG15 → PG17)

Backup приложения из `src/lib/backup.ts` покрывает только БД приложения PG18 (`DIRECT_DATABASE_URL`). Он **не покрывает** self-hosted Supabase database, которая хранит Auth/Storage metadata и работает отдельным PostgreSQL-контейнером.

Для Supabase DB предусмотрен отдельный host-side скрипт:

```bash
SUPABASE_DB_CONTAINER=conditera-supabase-db \
SUPABASE_DB_NAME=supabase \
SUPABASE_DB_USER=supabase \
SUPABASE_BACKUP_DIR=/var/backups/conditera/supabase \
bash scripts/ops/backup-supabase-db.sh
```

Скрипт:
- проверяет, что исходный контейнер существует и работает;
- читает server version, pg_dump version и число пользовательских таблиц;
- выполняет полный plain SQL `pg_dump` внутри исходного контейнера, сжимает gzip;
- проверяет gzip integrity, сохраняет файл и SHA-256 manifest с правами 0600/0700;
- не останавливает контейнер и не изменяет исходную БД.

**Перед PG15→PG17 cutover обязательно** выполнить этот backup именно на работающем старом PG15-контейнере, проверить manifest/checksum и восстановить дамп в отдельный PG17 shadow-кластер с совместимыми Supabase extensions/roles. Не переключать active volume до сверки Auth users, public tables, Storage metadata и реальных пользовательских сценариев.

Ограничения: этот dump не включает cluster-global roles/tablespaces и сами файлы объектов Supabase Storage (внешний object storage). Их нужно экспортировать/сохранить отдельно. Локальный backup без зашифрованной offsite-копии не является полноценной защитой от потери сервера.

## 2. Запуск по cron

`GET /api/cron/backup` (`runtime=nodejs`):
- аутентификация — `verifyCronSecret(req)` (заголовок `X-Cron-Secret` = `CRON_SECRET`), иначе 401 (`cronUnauthorized`);
- сначала запись `maintenance_logs` (`type: BACKUP_FULL`, `status: running`, `triggeredBy: cron`), после выполнения — обновление до `success`/`failed` с `durationMs`, `backup_path`, `backup_size_bytes`, `tables_count`, `recordsAffected`, `details.oldBackupsDeleted`, `error_message`;
- ответ 200: `{success, backupPath, backupSizeBytes, tablesCount, recordsExported, durationMs, oldBackupsDeleted, logId}`; ошибка → запись `failed` + 500 `{error:"Backup failed", detail}`.

Расписание: `maintenance.yml` вызывает эндпоинт ежедневно в 04:00 UTC — **пока READY FOR OWNER APPROVAL** (`MAINTENANCE_APP_URL`/`MAINTENANCE_CRON_SECRET` не настроены, job честно SKIPPED; OWNER_DECISIONS.md D-EXT-3). Staging-путь — `backup-staging.sh` на хосте перед каждым деплоем (STAGING_DEPLOYMENT.md §3). В production Compose `/app/backups` находится на постоянном named volume `conditera_backups`; offsite-копирование этого тома пока не реализовано и остаётся отдельным обязательным решением владельца.

## 3. Верификация восстановления (`scripts/ops/backup-verify-restore.mjs`)

Скрипт **только читает** рабочую БД и пишет в новую одноразовую БД; destructive-операции против production запрещены by design. Шаги:

1. **Бэкап** реальным кодом приложения: `runFullBackup()` через `scripts/ops/run-backup.mjs`; в production используется `DIRECT_DATABASE_URL`, а не transaction-pooling PgBouncer.
2. Для `.sql.gz`: создать одноразовую БД `conditera_restore_verify_<timestamp>`, выполнить потоковый `gunzip | psql --set ON_ERROR_STOP=1`, затем сравнить набор пользовательских таблиц и точные row counts между источником и восстановленной БД.
3. **Удаление** disposable-БД в `finally` и подтверждение через `pg_database`; исходная БД не изменяется.
4. Для `.json.gz`: строки копируются только во временные JSONB staging tables. Результат маркируется `PARTIAL`; он не восстанавливает исходную схему и не является доказательством полного backup.

Production требует полный SQL restore: `NODE_ENV=production` или `BACKUP_REQUIRE_FULL_RESTORE=true` запрещает считать JSON snapshot успешным восстановлением. В CI полный путь проверяется на одноразовом Supabase PostgreSQL 17. Внешний offsite backup и восстановление реального production volume остаются отдельными обязательными операциями.

## 4. Измеренное доказательство (локальная среда, 2026-11-10)

```
bun scripts/ops/backup-verify-restore.mjs
# Source DB: 127.0.0.1:54329/conditera (embedded PostgreSQL)
# Исторический результат старого скрипта: RESTORE-VERIFY: PARTIAL (JSONB staging; exit code 0)
# 13 таблиц / 736 записей восстановлено и сверено
# контрольные сверки: app_incidents   735 = 735 = 735
#                     app_error_events  1 =  1 =  1
# disposable-БД conditera_restore_verify_<ts> удалена
```

Важно: исторический прогон 2026-11-10 выполнял JSONB staging restore, а не восстановление исходной схемы. По новым критериям это только частичная проверка читаемости 13 таблиц / 736 строк, **не доказательство полного production backup**. Полное доказательство появляется только после успешного `.sql.gz` restore с совпадением таблиц и row counts.

## 5. Процедура восстановления в production (ручная)

1. Зафиксировать инцидент в реестре (INCIDENT_MANAGEMENT.md §4.2), приоритет P0 по умолчанию.
2. Остановить запись данных: `docker compose stop web` (и chat-service) — новых транзакций нет.
3. Выбрать последний проверенный бэкап: `listBackups()` (src/lib/backup.ts), каталог `./backups` на хосте, журнал `maintenance_logs (BACKUP_FULL)`.
4. Поднять восстановленную копию в **новую** БД: для `.sql.gz` — `gunzip -c backup-<ts>.sql.gz | psql --set ON_ERROR_STOP=1 "<NEW_DB_URL>"`; `.json.gz` — только частичный перенос allowlist-таблиц, не полный disaster recovery.
5. Переключить `DATABASE_URL` на восстановленную БД → `docker compose up -d web` → `/api/health` → smoke.
6. **Потеря данных после точки бэкапа** неизбежна и оценивается владельцем (RPO — решение D-EXT-5).

## 6. RPO/RTO — не устанавливаются этим документом

RPO/RTO **не придумываются**: их значения — бизнес-решение владельца (OWNER_DECISIONS.md **D-EXT-5**). Факты для принятия решения: автоматический триггер — ежедневный cron 04:00 UTC (после D-EXT-3); ретеншн файлов — 30 дней; restore-verify — ежедневно на staging (после D-EXT-1); время восстановления ограничено размером БД и ручными шагами §5; внешний офсайт-хранитель бэкапов — не реализован (входит в решение владельца вместе с RPO/RTO).
