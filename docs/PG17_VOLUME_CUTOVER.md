# Безопасный переход Supabase PostgreSQL на PG17

## Состояние конфигурации в интеграционной ветке

- Рабочий Supabase DB image: `supabase/postgres:17.11.0.017`.
- Канонический data volume: `conditera_supabase_db_data_v17`.
- Старый volume `conditera_supabase_db_data` остаётся объявленным, но не монтируется в PG17.
- Старый volume не удаляется и не переинициализируется.
- Отдельный `supabase-db-pg17-migration` используется только как изолированный target для репетиции миграций.
- Переключение Compose на новый volume само по себе НЕ переносит данные. Первый запуск на нём создаст новый кластер и применит init/migrations.

**Запрещено** подключать физический PG15 data directory к серверу PG17. Major upgrade выполняется логическим переносом, а не повторным использованием каталога данных.

## Обязательные условия до production cutover

1. Назначить окно обслуживания и остановить записи приложения.
2. Убедиться, что source DB и Storage контейнеры работают и их имена соответствуют фактическому Compose project.
3. Создать полный bundle командой `bash scripts/ops/backup-supabase-db.sh`.
   Bundle включает:
   - `*.sql.gz` — логический dump базы;
   - `*.globals.sql.gz` — cluster-global roles/tablespaces;
   - `*.storage.tar.gz` — файлы Storage volume;
   - `*.manifest.txt` — версии, объём таблиц и SHA-256 каждого артефакта.
4. Скопировать bundle на отдельный носитель/хост. Не считать копию в том же Docker volume независимой резервной копией.
5. Проверить SHA-256 и выполнить restore rehearsal на отдельном чистом PG17 cluster:
   `BACKUP_VERIFY_PATH=/path/to/backup-....sql.gz BACKUP_RESTORE_DATABASE_URL=postgresql://... BACKUP_REQUIRE_FULL_RESTORE=true node scripts/ops/backup-verify-restore.mjs`.
   `BACKUP_RESTORE_DATABASE_URL` обязан указывать на другой PostgreSQL host/cluster, не на исходный сервер.
6. Восстановить database dump на целевой PG17 только после проверки bundle. Dump создаётся с `--clean --if-exists`: применять его можно только к выделенной целевой БД, не к действующей production DB.
7. Восстановить Storage archive в новый Storage volume, сохранив numeric ownership; сверить число файлов и SHA-256.
8. Проверить Supabase Auth users, profiles, роли, миграционный ledger, заказы, payments/refunds, recipes, inventory/warehouses, RLS, функции, Storage metadata и реальные объекты.
9. Запустить smoke/E2E: регистрация и вход, OAuth callback, корзина, checkout, webhook, возврат, загрузка/скачивание файлов, Realtime и CMS.
10. Только после прохождения всех сверок переключать production трафик.

## Откат

- Старый volume остаётся нетронутым до завершения периода наблюдения.
- При откате возвращается предыдущая Compose-конфигурация и исходная версия PostgreSQL, соответствующая старому volume.
- Нельзя запускать PG17 поверх старого PG15 volume даже для «быстрой проверки».
- Не использовать `docker compose down -v`, `docker volume rm`, `docker system prune --volumes` в процессе миграции.

## Что подтверждает автоматическая проверка

CI проверяет, что runtime использует PG17 и изолированный volume, что migration target отделён от рабочего volume, а Compose конфигурация валидна. Это не является доказательством переноса production-данных. Фактический cutover допускается только после отдельного restore rehearsal и сверки данных/Storage.
