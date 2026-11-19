# Supabase runtime Conditera — PostgreSQL 17

## Архитектура текущей ветки

Conditera и self-hosted Supabase подключаются к **одному PostgreSQL 17**:

- единственный DB-контейнер: `conditera-db` (Compose service `db`);
- единственная рабочая БД: `conditera`;
- административная роль: `supabase_admin`;
- прикладная роль: `conditera`;
- Supabase Auth, PostgREST, Realtime, Storage, Kong, Studio, postgres-meta, imgproxy и Logflare остаются отдельными сервис-контейнерами и используют тот же DB endpoint;
- файлы Supabase Storage хранятся отдельно в постоянном volume `supabase_storage_data`.

Отдельной БД `supabase` и отдельного контейнера `supabase-db` в новой конфигурации нет. Это **единая БД**, но пока ещё не единый контейнер для всех сервисов Supabase.

## Критически важно перед запуском

Ветка PG17 использует отдельный новый volume `conditera_postgres_data_pg17`. Он не открывает и не преобразует существующие PG15/PG18 volumes.

До production cutover необходимо:
1. сделать проверенные резервные копии обеих действующих БД и Storage files;
2. инвентаризировать таблицы и строки в обеих БД, включая бизнес-данные, Auth, Storage, журналы и фоновые задания;
3. восстановить и сверить данные в PostgreSQL 17;
4. подтвердить проверками приложения и затем отдельно разрешить переключение.

**Не запускайте новый production Compose поверх старых контейнеров до выполнения этого переноса.** Не выполняйте `docker compose down -v`, `docker volume rm` и не переиспользуйте PG15/PG18 data directories под PG17. Этот проект не выполняет автоматический production cutover.

## Переменные окружения

Для Compose используется корневой `.env.production`. В нём должны быть как минимум:

- `POSTGRES_PASSWORD` — пароль административной роли Supabase;
- `CONDITERA_DB_PASSWORD` — пароль прикладной роли (может быть равен POSTGRES_PASSWORD, если отдельный пароль не задан);
- `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`;
- `ENCRYPTOR_KEY`, `SECRET_KEY_BASE`;
- переменные SMTP, OAuth providers, Redis/Meilisearch и прочие обязательные значения из `.env.production.example`.

Не помещайте реальные production-секреты в Git.

## Проверка Compose без запуска контейнеров

Из корня репозитория:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml config --quiet
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml config --services
```

Это проверяет синтаксис и объединение Compose-файлов, но не запускает сервисы и не проверяет сетевое взаимодействие.

## Локальная разработка

Отдельная dev-БД PostgreSQL 17 запускается командой:

```bash
./scripts/init-db.sh
```

Полный Supabase + Conditera dev stack:

```bash
./scripts/init-db.sh supabase
```

Режим `supabase` использует общий Compose-проект и общий DB endpoint. Запускайте его на отдельной dev-среде, а не поверх действующего production PG15/PG18 окружения.

## Миграции

Миграции применяются штатным одноразовым сервисом migrator с журналом `public.schema_migrations`. Не используйте `supabase db push` к случайно привязанному удалённому проекту и не запускайте SQL-файлы вручную с игнорированием ошибок.

После того как единая БД PG17 восстановлена и проверена, штатный запуск migrator выполняется через объединённый Compose-проект:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml run --rm migrator
```

Перед миграциями требуется резервная копия БД и файлов Storage. Скрипты `scripts/deploy.sh` и `scripts/update-from-archive.sh` проверяют версию PG17 и делают backup до migrator; они **не выполняют перенос PG15/PG18**.

## Резервное копирование

Резервная копия общей БД:

```bash
mkdir -p backups
docker exec conditera-db pg_dump -U supabase_admin -d conditera --format=custom --no-owner --no-acl > backups/conditera-$(date +%Y%m%d_%H%M%S).dump
docker run --rm -i --entrypoint pg_restore supabase/postgres:17.6.1.136 --list < backups/conditera-YYYYMMDD_HHMMSS.dump
```

Резервная копия файлов Storage:

```bash
docker exec conditera-supabase-storage tar -C /mnt/storage -czf - . > backups/storage-$(date +%Y%m%d_%H%M%S).tar.gz
tar -tzf backups/storage-YYYYMMDD_HHMMSS.tar.gz
```

Проверка каталога dump и tar не заменяет пробное восстановление. Восстанавливайте backup сначала в отдельную изолированную БД/среду и сверяйте контрольные количества, внешние ключи, роли, grants и доступ к файлам. Не восстанавливайте тестовый dump поверх рабочей БД.

## Порты и сервисы

| Компонент | Compose service | Внутренний порт | Назначение |
|---|---|---:|---|
| PostgreSQL 17 | `db` | 5432 | Единственная БД `conditera` |
| PgBouncer | `pgbouncer` | 5432 | Пул соединений приложения |
| GoTrue | `supabase-auth` | 9999 | Аутентификация |
| PostgREST | `supabase-rest` | 3000 | REST API |
| Realtime | `supabase-realtime` | 4000 | WebSocket подписки |
| Storage API | `supabase-storage` | 5000 | Хранилище файлов |
| Kong | `supabase-kong` | 8000 | API gateway |
| postgres-meta | `supabase-meta` | 8080 | Управление схемой |
| Supabase Studio | `supabase-studio` | 3000 | Панель управления |
| imgproxy | `supabase-imgproxy` | 5001 | Изображения |
| Logflare | `supabase-analytics` | 4000 | Логи |
| Vector | `supabase-vector` | 9001 | Сбор логов |

На хост проброшены web :3000, Kong :8000 и Studio :8100; другие service ports остаются внутри общей Docker-сети, если Compose не задаёт иное.

## Управление сервисами

Во всех командах используйте оба Compose-файла:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml ps
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml logs -f --tail=100 db
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml logs -f supabase-auth
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.supabase.yml stop
```

Не используйте `down -v`: эта команда удаляет persistent volumes. Для остановки сервисов достаточно `stop`.

## Ограничения, которые ещё остаются

- Supabase API services пока работают в отдельных контейнерах; требование собрать полный Supabase Runtime в один контейнер ещё не реализовано.
- Edge Runtime / Edge Functions не включены в этот Compose overlay. Нельзя считать Edge Functions развёрнутыми или отправлять их через Supabase CLI в удалённый проект как часть local deploy.
- Успешный CI merge проверяет тестовые данные и структуру. Он не является разрешением на перенос фактических production-данных и не заменяет инвентаризацию старых томов.
