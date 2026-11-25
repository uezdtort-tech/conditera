# Self-hosted Supabase runtime — Conditera

## Каноническая конфигурация

Рабочий runtime — один контейнер `supabase-runtime`, внутри которого запускаются PostgreSQL 17.12, GoTrue, PostgREST, Realtime, Storage, Postgres Meta, imgproxy, Kong и Edge Runtime.

- Одна рабочая БД: **`conditera`**.
- Один общий PG17 volume: `conditera_supabase_runtime_pg17_data`.
- Next.js подключается к этой же БД через роль `conditera_app`.
- Supabase API доступен внутри Docker-сети через DNS alias `supabase-kong:8000`.
- Старый PG15 volume `conditera_supabase_db_data` сохраняется отдельно и не подключается к PG17.
- Multi-container Compose остаётся только fallback; два режима нельзя запускать одновременно.

## Запуск

Подготовить заполненный `.env.supabase-runtime` по примеру `.env.supabase-runtime.example`. Примерные и заглушечные значения заменить случайными секретами.

```bash
docker compose --env-file .env.supabase-runtime \
  -f docker-compose.yml \
  -f docker-compose.supabase.yml \
  -f docker-compose.supabase-single-container.yml \
  config --quiet

docker compose --env-file .env.supabase-runtime \
  -f docker-compose.yml \
  -f docker-compose.supabase.yml \
  -f docker-compose.supabase-single-container.yml \
  up -d
```

## Контроль состояния

```bash
docker exec conditera-supabase-runtime supervisorctl -c /etc/supervisord.conf status
docker logs --tail=200 conditera-supabase-runtime
docker exec conditera-supabase-runtime \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 \
  /usr/bin/psql -X -U supabase_admin -d conditera -c 'SELECT version();'
```

## Volumes и rollback

- `conditera_supabase_runtime_pg17_data` — единственный рабочий PG17 volume, общий для single-container runtime и legacy fallback (только поочерёдно).
- `supabase_runtime_storage_data` — Storage и imgproxy objects.
- `supabase_runtime_deno_cache` — Edge Runtime cache.
- `conditera_supabase_db_data` — прежний PG15 volume; хранить отдельно до окончания приёмки.
- `conditera_supabase_pg17_migration_data` — временный shadow volume для миграционной репетиции.

Не выполнять `docker compose down -v`, `docker volume rm` или очистку PGDATA/Storage в production. Для rollback остановить single-container runtime и включить fallback с тем же PG17 volume. Не подключать PG15 volume к PG17.

## Production cutover — незакрытые условия

Наличие PG17.12 Compose и успешный CI на disposable volumes не доказывает перенос реальных данных. До production cutover обязательны:

1. Согласованные backup всех прежних источников и Storage objects.
2. Restore в отдельный PG17.12 shadow volume.
3. Сверка auth.users, profiles, user_roles, products, orders, payments/refunds, recipes, inventory, warehouse movements, CMS, RLS, grants, extensions и функций.
4. Количественные сверки и контрольные суммы критичных таблиц.
5. Проверка Auth, REST, Realtime, Storage, Edge runtime, OAuth, YooKassa и полного жизненного цикла заказа.
6. Проверенный rollback без удаления прежних volumes.

Production backup/restore и cutover в этой интеграционной ветке не выполнялись; их нельзя считать подтверждёнными.

## Принципиальные ограничения

- Не подключать data directory PG15 к серверу PG17.
- Не запускать multi-container и single-container Supabase одновременно на одном volume.
- Не использовать `down -v` в production.
- Не считать SQL dump полным backup: Storage objects и cluster-global roles резервируются отдельно.