# STAGING_DEPLOYMENT — staging-контур (DEPLOY-01 §7)

**DEPLOY-01 EXTENDED (§7) · Дата: 2026-11-10**
Исходники: `.github/workflows/staging-deploy.yml`; решения владельца: `docs/operations/OWNER_DECISIONS.md` (D-EXT-1; в комментарии workflow упоминается как «D-1»).

## Статус: READY FOR OWNER APPROVAL

Workflow существует и синтаксически валиден, но **никогда не выполнялся**: `STAGING_HOST`/`STAGING_SSH_KEY`/`STAGING_APP_URL` не настроены. При запуске job `deploy` честно завершает релиз со статусом **FAILED** («STAGING_HOST не настроен — staging-инфраструктуры нет») — имитация успеха исключена (§19). Пока владелец не выполнит §5 этого документа, автоматический деплой на staging не происходит.

---

## 1. Принципы изоляции от production (§7)

- **Отдельный** host / БД / credentials / OAuth callback / платёжный sandbox / storage.
- **Никаких** production-данных и реальных платежей на staging.
- Production-деплой (`deploy.yml`) остаётся ручным с approval gate (PRODUCTION_RELEASE.md §2).
- Staging-БД обновляется **только** ledger-мигратором из образа того же SHA (порядок «backup → миграции → rollout → health» жёсткий, `set -e`).

## 2. Версионность и артефакты

- Каждый образ привязан к коммиту: тег `sha-<7 символов>` (`WEB_IMAGE=ghcr.io/${{ github.repository }}:sha-${SHA:0:7}`).
- Образы публикуются в `ghcr.io/<repo>` (build-логика deploy.yml; при недоступности ghcr — сборка на месте, опция `STAGING_WEB_IMAGE_PREFIX (⚠ Z-v19: опция НЕ реализована в workflow — deploy-шаг жёстко использует ghcr.io/<repo>:sha-<7>; комментарий в шапке staging-deploy.yml — план, не код)`).
- Откат = повторный `up -d` с предыдущим `sha-`-тегом (ROLLBACK_RUNBOOK.md §5).
- `concurrency: staging-<ref>` без cancel-in-progress — параллельные релизы не перебивают друг друга посреди миграций.

## 3. Pipeline (`staging-deploy.yml`)

| Job | Что делает |
|---|---|
| `gate` | Допуск: `workflow_run` CI завершился `success` на push в main (в dispatch-режиме ответственность за пройденный CI на SHA — на запускающем, фиксируется в логе); определяет SHA (input или `github.sha`) |
| `predeploy` | `bash -n scripts/env-check.sh` (синтаксис/композиция обязательных env по example-контракту, без значений); фиксация требования «миграции — только из образа того же SHA» (полные миграции уже прогнаны job'ом `migrations-pg18` в CI на этом SHA) |
| `deploy` | `environment: staging`; гейт `STAGING_HOST_SET == 'true'` (job-level env — secrets недоступны в step-level if); SSH `deploy@STAGING_HOST` (`appleboy/ssh-action@v1.2.5`): **1)** `cd /opt/conditera-staging` → `./scripts/ops/backup-staging.sh` (бэкап staging-БД перед апдейтом) → **2)** `docker compose pull migrator web` + `docker compose run --rm migrator` (ledger, fail-fast) → **3)** `WEB_IMAGE=…:sha-<7> docker compose up -d --no-deps web` → **4)** health retry 10×10s: `curl http://127.0.0.1:3000/api/health` должен содержать `"status":"ok"`, иначе FAIL после 100s |
| `postdeploy` | Smoke против `STAGING_APP_URL`: `/api/health/live` → `"status":"alive"`; `/api/health` → `"status":"ok"`; `/` и `/api/products` → HTTP 200; результат релиза — в `$GITHUB_STEP_SUMMARY` (`SUCCESS` / `FAILED — не считать готовым`) |
| `finalize` | RELEASE STATUS: FAILED, если deploy или postdeploy не success |

Скрипт `scripts/ops/backup-staging.sh` — хост-скрипт staging-сервера, готовится владельцем вместе с compose-проектом (§5, шаг 3); не-0 exit = FAIL деплоя.

## 4. Что уже готово в репозитории

- Workflow `staging-deploy.yml` (триггер `workflow_run` после CI на main + dispatch).
- Health-эндпоинты: `/api/health/live`, `/api/health/ready`, `/api/health` (MONITORING.md §1).
- Ledger-мигратор в образе (`Dockerfile` target `migrator`) — тот же, что в production-пайплайне.
- Контракт обязательных env: `.env.production.example` + `scripts/verify/production-env-template.mjs` (проверяется в CI, job evidence-hygiene).
- Провал любой обязательной проверки постдеплоя помечает релиз FAILED в run summary (§7/§19).

## 5. Пошаговая настройка владельцем (READY FOR OWNER APPROVAL)

1. **Хост**: поднять отдельный VPS/хост для staging (не тот же, что production); установить Docker + compose; создать `/opt/conditera-staging` с `docker-compose.yml` (web + db + caddy по аналогии с production) и `.env` — отдельные `POSTGRES_PASSWORD`, `JWT_SECRET`, `CRON_SECRET`, отдельное OAuth-приложение с собственным callback, YooKassa **sandbox**-ключи.
2. **DNS**: выделить поддомен (например `staging.<домен>`) на staging-хост; TLS — Caddy по тому же принципу, что в production.
3. **Хост-скрипт бэкапа**: положить `/opt/conditera-staging/scripts/ops/backup-staging.sh` (pg_dump staging-БД в каталог с датой; исполняемый бит; workflow вызывает его до миграций).
4. **GitHub Secrets** (Settings → Secrets and variables → Actions):
   - `STAGING_HOST` — IP/hostname staging-сервера;
   - `STAGING_SSH_KEY` — приватный SSH-ключ пользователя `deploy` (публичный — на хосте);
   - `STAGING_APP_URL` — публичный URL staging (для smoke);
   - опционально `STAGING_WEB_IMAGE_PREFIX (⚠ Z-v19: опция НЕ реализована в workflow — deploy-шаг жёстко использует ghcr.io/<repo>:sha-<7>; комментарий в шапке staging-deploy.yml — план, не код)` — префикс реестра образов.
5. **Environment staging** (опционально): Settings → Environments → `staging` — workflow уже ссылается на `environment: staging`; можно добавить required reviewers как ручной барьер.
6. **Первый прогон**: Actions → «Staging Deployment» → Run workflow (dispatch) на SHA с зелёным CI → все 5 job'ов зелёные, в run summary `RELEASE STATUS: SUCCESS`.
7. **Приёмка**: ручные smoke-сценарии (регистрация, заказ, sandbox-оплата, чат) — только после этого staging считается готовым к использованию перед production-релизами.

## 6. Проверка после первого успешного деплоя

| Проверка | Ожидание |
|---|---|
| `/api/health/live` | 200 `{"status":"alive"}` |
| `/api/health` | 200 `"status":"ok"`, `version` = деплоившийся SHA |
| `/` и `/api/products` | HTTP 200 |
| `app_error_events` (админ-таб «Инциденты» → события) | нет всплеска новых событий после релиза |
| maintenance-логи | `BACKUP_FULL` от `backup-staging.sh` (если скрипт пишет в maintenance_logs хоста) |

## 7. Откат staging

```bash
cd /opt/conditera-staging
WEB_IMAGE=ghcr.io/<repo>:sha-<prev7> WEB_TAG=sha-<prev7> docker compose up -d --no-deps web
curl -sf http://127.0.0.1:3000/api/health | grep '"status":"ok"'
```
БД на staging при необходимости пересоздаётся из `backup-staging.sh`; ledger forward-only действует так же, как в production (ROLLBACK_RUNBOOK.md §3/§5).

## 8. Ограничения текущего состояния

- Restore-verify в maintenance.yml завязан на тот же `STAGING_HOST` (`/opt/conditera-staging`) — без D-EXT-1 ежедневная проверка восстановления бэкапов остаётся SKIPPED (BACKUP_RECOVERY.md §4).
- Отдельная staging-БД (`STAGING_DATABASE_URL`) — провизирует владелец; миграции выполняет `migrator` из образа SHA.
- Единственное зафиксированное restore-доказательство на 2026-11-10 — локальный прогон (BACKUP_RECOVERY.md §4), не staging.
