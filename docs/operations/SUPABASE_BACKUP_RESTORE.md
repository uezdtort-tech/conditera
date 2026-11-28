# Резервное копирование и проверка восстановления Supabase

## Что входит в комплект

`scripts/ops/backup-supabase-runtime.sh` атомарно создаёт каталог резервной копии с двумя артефактами:

- `database.sql.gz` — логический SQL dump PostgreSQL;
- `storage-objects.tar.gz` — файлы из фактического Docker volume, подключённого к контейнеру `conditera-supabase-storage` по пути `/mnt/storage`;
- `manifest.txt` — версия PostgreSQL/pg_dump, количество таблиц, размеры и SHA-256 обоих артефактов.

Подключение к PostgreSQL выполняется по TCP `127.0.0.1` внутри контейнера с паролем из `POSTGRES_PASSWORD`. Локальные Unix sockets и peer authentication не используются.

## Создание копии

На сервере, где запущен Compose-проект:

```bash
export SUPABASE_DB_CONTAINER=conditera-supabase-db
export SUPABASE_STORAGE_CONTAINER=conditera-supabase-storage
export SUPABASE_DB_NAME=supabase
export SUPABASE_DB_USER=supabase
export SUPABASE_BACKUP_DIR=/var/backups/conditera/supabase

bash scripts/ops/backup-supabase-runtime.sh
```

Если фактические имена контейнеров отличаются, укажите их в переменных окружения. Storage volume скрипт определяет по mount path `/mnt/storage`; при необходимости его можно явно задать через `SUPABASE_STORAGE_VOLUME`.

Каталог и файлы создаются с закрытыми правами. Копия публикуется атомарным переименованием временного каталога только после успешного завершения обоих dump и проверок целостности.

## Проверка восстановления

Проверка требует отдельный PostgreSQL-кластер, который не является источником резервной копии. Нельзя указывать production source как restore target.

```bash
export DIRECT_DATABASE_URL='postgresql://...'
export BACKUP_RESTORE_DATABASE_URL='postgresql://...'
# При необходимости отдельный административный URL:
export BACKUP_RESTORE_PSQL_URL='postgresql://...'

bash scripts/ops/verify-supabase-runtime-backup.sh \
  /var/backups/conditera/supabase \
  conditera-supabase-YYYYMMDDTHHMMSSZ
```

Проверка:
1. сверяет SHA-256 и gzip/tar целостность;
2. восстанавливает SQL dump в отдельную временную БД и сравнивает набор таблиц и точное число строк;
3. извлекает Storage archive во временный Docker volume и сравнивает SHA-256 каждого файла с исходным Storage volume;
4. удаляет временную БД и volume.

## Явные ограничения

Этот комплект **не содержит cluster globals, определения ролей, пароли ролей и ACL/grants**: SQL dump создаётся с `--no-owner --no-privileges`. Перед восстановлением должны быть подняты совместимые роли, расширения и базовые привилегии из контролируемой конфигурации Supabase и миграций проекта.

Проверка восстанавливает схему/данные БД и Storage objects, но не доказывает восстановление внешних секретов, OAuth credentials, SMTP, DNS, n8n, YooKassa webhook configuration или самого production Compose. Эти элементы должны быть сохранены отдельно и проверены в release runbook.

**Запрещено** восстанавливать поверх действующего production volume или БД без отдельного проверенного cutover/rollback плана.
