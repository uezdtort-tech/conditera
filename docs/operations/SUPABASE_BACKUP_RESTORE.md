# Резервное копирование и проверка восстановления единого Supabase Runtime

## Каноническая конфигурация

- Runtime-контейнер: `conditera-supabase-runtime`.
- Рабочая логическая база: `conditera`.
- Административная роль БД: `supabase_admin`.
- Целевой PostgreSQL: 17.
- Docker volume PostgreSQL: `supabase_runtime_pg17_data` (фактическое имя может включать Compose project prefix).
- Docker volume Storage: `supabase_runtime_storage_data` (фактическое имя может включать Compose project prefix).
- Внутренний путь Storage в runtime-контейнере: `/opt/supabase/services/storage/var/lib/storage`.

Скрипты определяют реальное имя Storage volume по mount point контейнера. При нестандартном Compose project name имя volume не нужно угадывать.

## Что входит в резервную копию

`scripts/ops/backup-supabase-runtime.sh` атомарно создаёт каталог с тремя артефактами:

- `database.sql.gz` — полный логический SQL dump базы `conditera`;
- `storage-objects.tar.gz` — файлы фактического Docker volume Supabase Storage;
- `manifest.txt` — версия PostgreSQL/pg_dump, количество таблиц, размеры и SHA-256 артефактов.

Копия публикуется атомарным переименованием временного каталога только после успешного завершения dump и проверки целостности. Права каталога и артефактов ограничиваются.

**Ограничения:** dump намеренно не содержит cluster globals, роли, пароли ролей и ACL/grants (`--no-owner --no-privileges`). Vault view `vault.decrypted_secrets`, если он присутствует как производное представление расширения, не экспортируется: его определение создаётся расширением на целевой системе. Исходные записи Vault остаются в базе. OAuth credentials, SMTP, DNS, TLS, YooKassa credentials/webhook configuration и прочие внешние секреты этим комплектом не сохраняются.

## Создание копии

Запускать на хосте, где работает единый Compose Runtime:

```bash
export SUPABASE_DB_CONTAINER=conditera-supabase-runtime
export SUPABASE_DB_NAME=conditera
export SUPABASE_DB_USER=supabase_admin
export SUPABASE_STORAGE_CONTAINER=conditera-supabase-runtime
export SUPABASE_STORAGE_MOUNT=/opt/supabase/services/storage/var/lib/storage
export SUPABASE_BACKUP_DIR=/var/backups/conditera/supabase

bash scripts/ops/backup-supabase-runtime.sh
```

Скрипт получает пароль из `POSTGRES_PASSWORD` внутри runtime-контейнера и подключается к PostgreSQL по TCP `127.0.0.1` внутри контейнера. Unix sockets и peer authentication не используются.

После создания каталога его необходимо скопировать на отдельный носитель или хост. Копия в том же Docker host/volume не является независимой резервной копией.

## Проверка восстановления

Проверка требует отдельный PostgreSQL-кластер PG17, не являющийся источником резервной копии. Нельзя указывать production source как restore target.

```bash
export DIRECT_DATABASE_URL='postgresql://supabase_admin:***@SOURCE_HOST:5432/conditera'
export BACKUP_RESTORE_DATABASE_URL='postgresql://restore_admin:***@SEPARATE_PG17_HOST:5432/postgres'
export BACKUP_RESTORE_PSQL_URL='postgresql://restore_admin:***@SEPARATE_PG17_HOST:5432/conditera_restore_verify'

bash scripts/ops/verify-supabase-runtime-backup.sh \
  /var/backups/conditera/supabase \
  conditera-supabase-YYYYMMDDTHHMMSSZ
```

Проверка:
1. сверяет SHA-256 и gzip/tar целостность;
2. восстанавливает SQL dump в отдельную временную БД на отдельном кластере;
3. сравнивает набор пользовательских таблиц и точное число строк;
4. извлекает Storage archive во временный Docker volume;
5. сравнивает SHA-256 каждого файла Storage с исходным volume;
6. удаляет временную БД и volume.

Для успешного восстановления целевой Supabase PG17 должен иметь совместимые расширения и bootstrap-роли. Это условие не заменяется наличием SQL dump.

## Production cutover и откат

1. Назначить окно обслуживания и остановить запись приложения.
2. Убедиться, что runtime и Storage контейнеры работают и имена соответствуют Compose.
3. Создать backup bundle и скопировать его за пределы исходного Docker host.
4. Выполнить полный restore rehearsal на отдельном PG17 кластере.
5. Сверить Auth users, profiles, роли, миграционный ledger, заказы, payments/refunds, recipes, inventory, RLS, функции и реальные Storage objects.
6. Проверить регистрацию, OAuth callback, корзину, checkout, webhook, возврат, загрузку/скачивание медиа, Realtime и CMS.
7. Только после прохождения сверок переключать production traffic.

Старые volumes нельзя удалять до завершения периода наблюдения. Нельзя подключать физический PG15 data directory к серверу PG17. Major upgrade выполняется логическим переносом, а не повторным использованием каталога данных.

**Запрещено** использовать `docker compose down -v`, `docker volume rm` или `docker system prune --volumes` в процессе миграции и восстановления. Не восстанавливать поверх действующего production volume или БД без отдельного проверенного cutover/rollback плана.

## Release gate

Автоматический CI может проверить синтаксис скриптов и отдельные restore-сценарии, но это не доказывает, что резервная копия фактической production-БД создана и восстановлена. Production backup readiness считается подтверждённой только после выполнения этих команд на реальном runtime-хосте и сохранения manifest + restore evidence.
