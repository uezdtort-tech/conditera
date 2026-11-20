# Единый Supabase runtime на PostgreSQL 17

## Состояние

Реализован единый runtime image: PostgreSQL 17, GoTrue, PostgREST, Realtime, Storage, Postgres Meta, Imgproxy и Kong запускаются под Supervisor внутри **одного контейнера**. Overlay также переводит Next.js на этот же PostgreSQL 17: отдельные app PostgreSQL 18, PgBouncer и внешний migrator выключены профилем `legacy-app-db`; старые Supabase контейнеры выключены профилем `legacy-supabase`.

CI smoke проверяет один контейнер, health всех процессов, Kong endpoints, Auth signup, Storage upload/download и наличие схем/миграций Realtime. Runtime image также включает прикладные миграции Conditera, которые запускаются после готовности PostgreSQL и Storage, и Edge Runtime с service-role-only маршрутом через Kong; полная проверка этих новых частей выполняется актуальным CI.

## Compose overlay

Overlay: `docker-compose.supabase-single-container.yml`.

Запускать только совместно с основными Compose-файлами и production env:

```bash
docker compose --env-file .env.production --env-file .env.supabase-runtime \
  -f docker-compose.yml \
  -f docker-compose.supabase.yml \
  -f docker-compose.supabase-single-container.yml \
  config
```

Перед запуском после backup/restore и проверки данных нужно остановить старые контейнеры, не удаляя их volumes. Иначе старый контейнер `supabase-kong` может продолжить владеть DNS alias и конфликтовать с новым runtime:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.supabase.yml \
  stop db pgbouncer migrator supabase-db supabase-kong supabase-auth \
    supabase-rest supabase-realtime supabase-storage supabase-app-migrator \
    supabase-imgproxy supabase-meta supabase-analytics supabase-vector
```

После проверки конфигурации и отдельного плана переноса данных:

```bash
docker compose --env-file .env.production --env-file .env.supabase-runtime \
  -f docker-compose.yml \
  -f docker-compose.supabase.yml \
  -f docker-compose.supabase-single-container.yml \
  up -d --build
```

Не выполнять `down -v`, `volume rm` или очистку старых volumes. Для rollback остановить `supabase-runtime` и запустить прежний стек без `docker-compose.supabase-single-container.yml`; старые контейнеры и volumes должны быть сохранены до завершения cutover.

Сервисы старого многоконтейнерного Supabase помещены в профиль `legacy-supabase`; без явного включения профиля они не запускаются. Runtime получает сетевой alias `supabase-kong`, поэтому существующий Caddyfile продолжает проксировать `/api/auth/v1`, `/api/rest/v1`, `/api/realtime/v1` и `/api/storage/v1` в Kong единого контейнера.

## Данные и volumes

Runtime использует отдельные именованные volumes:

- `supabase_runtime_pg17_data` — PostgreSQL 17;
- `supabase_runtime_storage_data` — Storage и read-only mount для Imgproxy.

**Не подключать к PostgreSQL 17 volume от старого PostgreSQL 15.** Формат data directory несовместим. Нельзя считать запуск overlay способом автоматического переноса production-данных. До переключения необходимы согласованные backup, логический dump/restore в PG17, проверка владельцев/ролей/extensions/RLS и контрольные суммы критичных таблиц. Текущий CI использует пустые disposable volumes и не доказывает перенос существующих данных.

Миграционный runner внутри runtime ждёт готовности PostgreSQL и Storage API, затем выполняет `supabase/init-scripts/01-apply-migrations.sh` с `SEED_MODE=none`. На пустой БД он создаёт ledger и применяет прикладные миграции. После этого создаёт отдельную роль `conditera_app` (не superuser, но с `BYPASSRLS` и CRUD/EXECUTE на `public`) для доверенного серверного Next.js-контейнера. Её пароль не передаётся chat-service/n8n: он берётся из отдельного `.env.supabase-runtime` и попадает в `web` только внутри `DATABASE_URL`/`DIRECT_DATABASE_URL`. Серверные Supabase-клиенты используют внутренний `SUPABASE_INTERNAL_URL=http://supabase-kong:8000`.

На восстановленной БД ledger должен быть предварительно согласован с фактическим состоянием схемы; запускать полный replay поверх существующей схемы без этого нельзя.

Не удалять volumes при обычном обновлении. Не использовать `down -v` на сервере с данными.

## Новые секреты runtime

Помимо существующих `POSTGRES_PASSWORD`, `JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY` из `.env.production`, файл `.env.supabase-runtime` должен содержать:

- `APP_DATABASE_PASSWORD` — отдельный случайный пароль для роли `conditera_app`;
- `SUPABASE_SECRET_KEY_BASE` — 64 hex characters;
- `PG_META_CRYPTO_KEY` — 32 hex characters;
- `REALTIME_DB_ENC_KEY` — ровно 16 characters;
- `REALTIME_DB_ENC_KEY_GCM` — ровно 32 characters.

Команды генерации приведены в `.env.supabase-runtime.example`. Не добавлять эти секреты в общий `.env.production`: он передаётся также другим контейнерам через `env_file`. Не использовать dev placeholders. Если меняется `JWT_SECRET`, необходимо согласованно перевыпустить ANON/SERVICE_ROLE JWT keys и обновить секреты всех клиентов.

Для внешнего URL использовать `API_EXTERNAL_URL=https://conditera.ru/api`, `SUPABASE_PUBLIC_URL=https://conditera.ru/api`, `SITE_URL=https://conditera.ru`. OAuth-провайдеры включать только после сверки credentials и redirect URLs.

## Ограничения до production cutover

- Edge Runtime включён в единый runtime, но функции Conditera содержат незавершённые реализации/stub-обработчики; до включения бизнес-сценариев требуется отдельная проверка каждой функции и её авторизации. Публичные webhooks YooKassa/Telegram должны оставаться на защищённых Next.js API routes, а не на Edge Functions.
- Не выполнен backup/restore production data и не проверен перенос данных из двух прежних источников (Supabase PG15 и отдельный app PG18) на копии реального объёма. Перед переключением требуется установить фактический источник истины и сверить данные; overlay не сливает две базы автоматически.
- Не проведены нагрузочные, отказоустойчивые и восстановительные испытания.
- Не проверена полная совместимость всех внутренних клиентов Conditera с новым runtime и его секретами.

До закрытия этих пунктов overlay — подготовленная интеграция и путь к переключению, но не разрешение на production cutover. Старый runtime и volumes должны оставаться доступными до завершения приёмки и согласованного rollback-плана.
