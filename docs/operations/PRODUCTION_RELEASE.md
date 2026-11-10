# PRODUCTION_RELEASE — релиз в production (DEPLOY-01 §8)

**DEPLOY-01 EXTENDED (§8) · Дата: 2026-11-10**
Исходник: `.github/workflows/deploy.yml`; откат — `docs/operations/ROLLBACK_RUNBOOK.md`; решения владельца — `docs/operations/OWNER_DECISIONS.md` (D-EXT-2, D-EXT-7).

## 1. Принципы релиза

- **Только ручной `workflow_dispatch`** (параметр `version` — метка для заметок, например `v2.0.0`; образ всегда тегируется SHA). Авто-деплой на push в main **отключён намеренно**: production-деплой — осознанное действие.
- Схема безопасности: **1 коммит → 1 образ с immutable SHA-тегом → миграции ledger-мигратором из ТОГО ЖЕ SHA → controlled rollout → healthcheck → откат на предыдущий SHA**.
- `.env.production` на сервере создаётся **вручную один раз**; workflow НЕ генерирует env-файлы и НЕ печатает секреты в логи (секреты передаются в SSH-скрипт через `envs:` action'а).
- `docker image prune` после релиза **не выполняется** — предыдущие `sha-`теги остаются в ghcr для отката.
- Теги web-образа: `sha-$(git rev-parse --short=7 $GITHUB_SHA)` + `latest`; migrator-образ — `migrator-<sha-<7>>`.

## 2. Approval gate — READY FOR OWNER APPROVAL

Job `deploy` объявлен с `environment: production`. Сам workflow **не может** принудительно запросить одобрение — барьер настраивается на стороне репозитория:

> GitHub → Settings → Environments → `production` → **Required reviewers** → добавить владельца.

После этого запуск «Deploy to Production» ожидает явного одобрения владельца перед выполнением job'а deploy. **До настройки Required reviewers единственный барьер — сама ручность запуска** (OWNER_DECISIONS.md D-EXT-2). Рекомендуется также перенести production-секреты внутрь environment `production` (environment-scoped secrets).

## 3. Требуемые секреты (настраиваются владельцем один раз)

| Секрет | Назначение |
|---|---|
| `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY` | доступ к собственному VPS (`/opt/conditera`); порт — по умолчанию 22 (`secrets.SSH_PORT \|\| 22`) |
| `REGISTRY_TOKEN` | PAT с `read:packages` для `docker login ghcr.io` на сервере (password-stdin) |
| `POSTGRES_PASSWORD` | передаётся в SSH-скрипт для контейнера мигратора (PGPASSWORD) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` | build-args web-образа (GIT_SHA добавляется автоматически) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | пост-деплой уведомление (`if: always()`) |

База может быть пустой (ledger применит 0001..NNNN) или существующей — тогда `schema_migrations` заполняется по процедуре DEPLOYMENT.md («База-лайн»).

## 4. Процесс релиза (по шагам workflow)

1. **`build-and-push`** (permissions: `packages: write`):
   - `sha_tag = sha-$(git rev-parse --short=7 $GITHUB_SHA)`;
   - web-образ: `ghcr.io/<repo>:sha-<7>` + `:latest`, build-args `GIT_SHA` + публичные Supabase-переменные (target `runner`); кэш `type=gha`;
   - migrator-образ: `ghcr.io/<repo>:migrator-sha-<7>` (target `migrator`).
2. **`deploy`** (needs build-and-push, `environment: production`) — SSH на VPS (`script_stop: true`, любая ошибка = провал шага):
   - `docker login ghcr.io` (REGISTRY_TOKEN);
   - `docker pull` web + migrator с точным `sha_tag`;
   - **миграции**: `docker run --rm --network conditera-net -e PGHOST/PGDATABASE/PGUSER/PGPASSWORD … migrator-sha-<7>` — ledger `01-apply-migrations.sh` применяет только файлы, не отмеченные в `schema_migrations`, fail-fast (`ON_ERROR_STOP=1`);
   - **rollout**: `WEB_IMAGE=…:sha_tag WEB_TAG=$SHA_TAG docker compose up -d --no-deps web` (git pull НЕ используется);
   - **healthcheck**: retry 10×10s — `curl http://localhost:3000/api/health` должен содержать `"status":"ok"`; иначе `HEALTHCHECK FAILED` и exit 1 (в логе — подсказка найти предыдущий sha-тег через `docker image ls`/registry для ручного отката).
3. **`Post-deploy public health check`**: через 10s `curl $NEXT_PUBLIC_APP_URL/api/health` (fallback `https://conditera.space-z.ai`) — не-200 → job красный.
4. **`Notify Telegram`** (`if: always()`): «🚀 Deploy <STATUS>: <ref> @ <sha_tag>»; сбой отправки не влияет на итог (`|| true`).

### Что релиз НЕ делает (важно знать)

| Не делает | Следствие |
|---|---|
| Не откатывает БД автоматически | healthcheck fail → только приложение остаётся на предыдущем SHA вручную; миграции forward-only (ROLLBACK_RUNBOOK.md §3) |
| Не генерирует `.env.production` | конфигурация сервера — зона владельца; workflow только подтягивает образы |
| Не чистит старые образы | реестр растёт, но откат всегда возможен |
| Не ждёт approval сам по себе | см. §2 — настройка Required reviewers обязательна |

## 5. Особенность: платформа space-z (D-EXT-7)

Фактический production-хостинг проекта — платформа **space-z**, которая деплоит собственным пайплайном `.zscripts/`. Настоящий workflow описывает путь для **собственного VPS** и служит референс-механикой (sha-теги, ledger-мигратор, healthcheck). Граница ответственности за production-публикацию (GitHub Actions vs платформенный pipeline) — решение владельца (OWNER_DECISIONS.md D-EXT-7); механика отката при этом общая (ROLLBACK_RUNBOOK.md).

## 6. Чек-лист перед запуском релиза

- [ ] CI (9 job'ов) зелёный на целевом SHA (CI_CD.md §1).
- [ ] Staging-прогон этого SHA выполнен (если staging настроен, D-EXT-1).
- [ ] GitHub Environment `production` с Required reviewers настроен (D-EXT-2).
- [ ] Свежий бэкап БД существует и проверен restore-verify (BACKUP_RECOVERY.md §3–4).
- [ ] `TELEGRAM_*` настроены — уведомление о релизе придёт в канал (D-EXT-4).
- [ ] Открыт реестр инцидентов — после релиза следить за новыми P0/P1 (INCIDENT_MANAGEMENT.md).

## 7. Критерии успешного релиза

| Критерий | Как проверить |
|---|---|
| Образ собран и запушен | job `build-and-push` success; `sha_tag` в output |
| Миграции применены | шаг миграций без ошибки (fail-fast), `schema_migrations` пополнился |
| Локальный health | `curl localhost:3000/api/health` → `"status":"ok"` (10×10s) |
| Публичный health | `https://<домен>/api/health` → 200 |
| Уведомление | Telegram-сообщение «Deploy success @ sha-…» |

## 8. После релиза

- Сверить `/api/health` → `version` = ожидаемому SHA (`GIT_SHA` → APP_VERSION).
- Проверить `app_incidents` (админ-таб «Инциденты»): новые NEW/REOPENED после релиза — сигнал регрессии; `first_version`/`last_version` помогают локализовать версию.
- При проблемах — откат по ROLLBACK_RUNBOOK.md (приложение — предыдущий sha-тег; БД — forward-only, восстановление данных только из бэкапа).
