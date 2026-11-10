# STAGING_DEPLOYMENT_RUNBOOK — поэтапный план развёртывания staging (Z-v21)

**Статус: ПЛАН.** Каждый шаг, помеченный 🔒, требует отдельного разрешения владельца. До разрешения — не выполнять.

## Предусловия

- [ ] Владелец выдал разрешение на публикацию локальной истории (push) и на staging-развёртывание (см. OWNER_ACTIONS_REQUIRED.md A-1, A-2).
- [ ] Staging-хост существует, SSH-доступ у того, кто деплоит (или раннер GitHub с `STAGING_HOST`/`STAGING_SSH_KEY`).
- [ ] Env-файл staging заполнен по STAGING_ENVIRONMENT.md §2 (без production-значений).

## Этап 0 — публикация кода 🔒

1. `git push origin main` (225+ коммитов локальной истории; fast-forward, без force).
2. Дождаться CI (`ci.yml`) на GitHub: lint → typecheck → test → build → docker-build → security → migrations-pg18 → deps-audit. **Не продолжать при красном CI.**
   - Примечание: полный `next build` и docker-образы в песочнице не могли быть проверены (OOM) — CI здесь первый фактический прогон build-гейта.

## Этап 1 — подготовка staging-инфраструктуры 🔒

1. Создать БД staging (PostgreSQL 16/18). Не использовать production-инстанс.
2. Заполнить env (STAGING_ENVIRONMENT.md §2). Проверить отсутствие production-значений.
3. Caddy: хост + `X-Robots-Tag: noindex, nofollow`.

## Этап 2 — миграции (только staging-БД) 🔒

Вариант A (Docker): ledger-migrator применит `supabase/migrations/0001..0079` при старте compose.
Вариант B (ручной): `psql $STAGING_DATABASE_URL -v ON_ERROR_STOP=1 -f` по порядку (или `scripts/db/setup.mjs` с `DATABASE_URL=staging`).

Проверки после миграций:
- `SELECT count(*) FROM schema_migrations` = 79;
- повторный прогон мигратора — «0 newly applied» (идемпотентность);
- `GET /api/health/ready` → 200.

## Этап 3 — деплой приложения 🔒

Вариант A (compose на VPS): `docker compose up -d` (образы собраны CI с тегом SHA).
Вариант B (bare-metal): `bun install --frozen-lockfile && bun run build && bun run start` под процесс-менеджером.

Проверки:
- health/live/ready 200;
- версия/SHA в `/api/health` соответствуют опубликованному коммиту;
- логи: нет секретов, нет stack-trace наружу.

## Этап 4 — smoke tests

Выполнить чек-лист STAGING_SMOKE_TESTS.md, зафиксировать evidence (дата/время/аккаунт-роль/результат).

## Этап 5 — интеграции (по наличию credentials)

- n8n: `docker compose up -d n8n`, импорт `n8n-workflows/*.json`, заполнение `N8N_WEBHOOK_SECRET`; сверить приёмку событий (N8N_ACCEPTANCE.md §5).
- Telegram: `POST /api/telegram/setup-webhook` с CRON_SECRET; тестовая команда `/start` боту.
- YooKassa sandbox: PAYMENT_ACCEPTANCE.md §5.
- Yandex OAuth: регистрация redirect `<staging>/api/auth/oauth/yandex/callback`; живой логин.

## Этап 6 — откат (если что-то пошло не так)

1. Приложение: предыдущий SHA-образ (`docker compose` указывает на предыдущий тег) — данные не затрагиваются.
2. Миграции: откат НЕ автоматический (ledger forward-only). Если новый релиз требует отката — восстановить staging-БД из backup в disposable и поднять предыдущий SHA (см. ROLLBACK_AND_RECOVERY.md).
3. Webhooks: переключить URL кабинетов (YooKassa/Telegram) обратно, если менялись.

## Критерии успеха

- CI на GitHub зелёный на опубликованном SHA;
- health/ready 200 на staging;
- все smoke-tests PASS;
- в логах отсутствуют критические ошибки за первые 30 минут;
- staging изолирован (проверка: orders/users staging ≠ production).
