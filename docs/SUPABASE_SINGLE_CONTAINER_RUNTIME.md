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

Поскольку прежние БД пустые, перенос и восстановление пользовательских данных не выполняются. Перед первым запуском нужно остановить старые контейнеры, не удаляя их volumes. Иначе старый контейнер `supabase-kong` может продолжить владеть DNS alias и конфликтовать с новым runtime:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.supabase.yml \
  stop db pgbouncer migrator supabase-db supabase-kong supabase-auth \
    supabase-rest supabase-realtime supabase-storage supabase-app-migrator \
    supabase-imgproxy supabase-meta supabase-analytics supabase-vector
```

После заполнения реальных секретов и проверки итоговой конфигурации:

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
- `supabase_runtime_storage_data` — Supabase Storage и read-only mount для Imgproxy;
- `conditera_product_media` — локальные файлы карточек/медиа товаров, `PRODUCT_MEDIA_ROOT=/app/storage`;
- `conditera_backups` — архивы `pg_dump`, `BACKUP_DIR=/app/backups`.

Два последних тома подключены к web-контейнеру отдельно от его writable layer: обновление или пересоздание контейнера не должно удалять медиа и архивы.

**Владелец подтвердил, что обе прежние БД пустые и пользовательских данных нет. Перенос/слияние не выполняется.** На production создаётся новый `supabase_runtime_pg17_data`, инициализируемый PostgreSQL 17 с нуля. Не подключать к нему PGDATA от PostgreSQL 15/18: major-версии несовместимы. Текущий CI проверяет чистые disposable volumes, применение миграций и полные бизнес-сценарии на PostgreSQL 17.

Миграционный runner внутри runtime ждёт готовности PostgreSQL и Storage API, затем выполняет `supabase/init-scripts/01-apply-migrations.sh` с `SEED_MODE=none`. На пустой БД он создаёт ledger и применяет прикладные миграции. После этого создаёт две отдельные роли:
- `conditera_app` — не superuser, но с `BYPASSRLS` и CRUD/EXECUTE на `public`, для доверенного серверного Next.js-контейнера. Её пароль берётся из отдельного `.env.supabase-runtime` и попадает в `web` только внутри `DATABASE_URL`/`DIRECT_DATABASE_URL`.
- `conditera_backup` — не superuser, без прав записи, с `BYPASSRLS` и членством в `pg_read_all_data`. Она используется только `pg_dump`; её пароль передаётся приложению через `BACKUP_DATABASE_URL`, а не через основной app DB URL. Так резервное копирование может читать защищённые схемы Supabase, не раскрывая Next.js пароль суперпользователя PostgreSQL.

Оба пароля находятся в отдельном `.env.supabase-runtime` и не передаются chat-service/n8n. Серверные Supabase-клиенты используют внутренний `SUPABASE_INTERNAL_URL=http://supabase-kong:8000`.

На новой пустой БД runtime создаёт ledger и применяет полный набор прикладных миграций. Повторный запуск `db:setup` проверяется в PG17 E2E job; production seeds выключены.

Не удалять volumes при обычном обновлении. Не использовать `down -v` на сервере с данными.

## Новые секреты runtime

Помимо существующих `POSTGRES_PASSWORD`, `JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY` из `.env.production`, файл `.env.supabase-runtime` должен содержать:

- `APP_DATABASE_PASSWORD` — отдельный случайный пароль для роли `conditera_app`;
- `BACKUP_DATABASE_PASSWORD` — отдельный случайный пароль для read-only роли `conditera_backup`;
- `SUPABASE_SECRET_KEY_BASE` — 64 hex characters;
- `PG_META_CRYPTO_KEY` — 32 hex characters;
- `REALTIME_DB_ENC_KEY` — ровно 16 characters;
- `REALTIME_DB_ENC_KEY_GCM` — ровно 32 characters.

Команды генерации приведены в `.env.supabase-runtime.example`. Не добавлять эти секреты в общий `.env.production`: он передаётся также другим контейнерам через `env_file`. Не использовать dev placeholders. Если меняется `JWT_SECRET`, необходимо согласованно перевыпустить ANON/SERVICE_ROLE JWT keys и обновить секреты всех клиентов.

Для внешнего URL использовать `API_EXTERNAL_URL=https://conditera.ru/api`, `SUPABASE_PUBLIC_URL=https://conditera.ru/api`, `SITE_URL=https://conditera.ru`. OAuth-провайдеры включать только после сверки credentials и redirect URLs.

## Ограничения до production cutover

- Edge Runtime включён в единый runtime, но функции Conditera содержат незавершённые реализации/stub-обработчики; до включения бизнес-сценариев требуется отдельная проверка каждой функции и её авторизации. Публичные webhooks YooKassa/Telegram должны оставаться на защищённых Next.js API routes, а не на Edge Functions.
- Production ещё не запущен на локальном Windows ПК; требуется создать новый PG17 volume, выполнить первый запуск, проверить health всех сервисов и подтвердить внешний HTTPS-доступ.
- Не выполнены реальные транзакции YooKassa, реальные OAuth-входы Yandex/VK, SMTP-доставка и Web Push на пользовательских устройствах: для них нужны production credentials и проверка callback/доменов.
- В Edge Runtime остаются намеренно fail-closed 501 stubs для шести legacy функций (`abandoned-cart`, `bonus-expiry`, `daily-digest`, `send-email`, `send-push`, `tasting-reminder`). Текущие n8n retention workflows используют Next.js API routes; необходимо не вызывать эти legacy endpoints до реализации или удаления маршрутов из gateway.
- Не проведены нагрузочные, отказоустойчивые и восстановительные испытания.
- Не проверена полная совместимость всех внутренних клиентов Conditera с новым runtime и его секретами.

До закрытия этих пунктов overlay и deploy script — проверенная production-конфигурация, но сайт ещё не развёрнут в production. Запуск выполняется через `bash scripts/deploy-single-container.sh --config`, затем `--up` на локальном Windows ПК в WSL2/Docker Desktop. Скрипт не удаляет volumes и не запускает legacy DB/Supabase стеки.
