# CI_CD — цепочка проверок и деплой-контуры (DEPLOY-01 §6)

**DEPLOY-01 EXTENDED (§6) · Дата: 2026-11-10**
Исходники: `.github/workflows/{ci,e2e,staging-deploy,deploy,maintenance}.yml`, `scripts/verify/{route-error-coverage,osv-audit}.mjs`, `scripts/scan-evidence.mjs`.

Все шаги CI — строгие: **без `continue-on-error`**, кроме шага coverage (артефакт отчёта не ломает CI). Любая ошибка ломает CI.

## 0. Триггеры и параллельность

| Workflow | Триггеры | Concurrency |
|---|---|---|
| `ci.yml` (CI) | `push` + `pull_request` в `main`/`develop` | `ci-<ref>`, cancel-in-progress |
| `e2e.yml` | nightly `0 3 * * *`; push/PR по путям `src/app/api/**`, `src/components/**`, `src/lib/**`, `tests/e2e/**`, `playwright.config.ts`; dispatch c фильтром `grep` | — |
| `staging-deploy.yml` | `workflow_run` после **успешного** CI на push в `main`; dispatch (параметр `sha`) | `staging-<ref>`, без cancel |
| `deploy.yml` | **только** ручной `workflow_dispatch` | — |
| `maintenance.yml` | ежедневно `0 4 * * *` UTC; dispatch | `maintenance`, без cancel |

Permissions минимальны (`contents: read`; deploy.yml build job — `packages: write` для ghcr).

---

## 1. ci.yml — 9 job'ов

| # | Job | Содержание |
|---|---|---|
| 1 | `lint-typecheck` | `bun run typecheck` + `bun run lint` (bun, `--frozen-lockfile`) — любая TS/ESLint-ошибка ломает CI |
| 2 | `test` | `bun run test` (Vitest; env-заглушки JWT_SECRET/TFA_ENCRYPTION_KEY) + `test:coverage` (continue-on-error, артефакт `coverage/`, 7 дней) |
| 3 | `build` | `bun run build` с test-env ( Supabase-заглушки `http://127.0.0.1:54321`); артефакт `.next/`, 3 дня |
| 4 | `docker-build` | `CANDIDATE_SHA = PR head sha (или github.sha на push)`; чекаут **точного** SHA + проверка `git rev-parse HEAD == tag SHA` («тег одного SHA, собран другой исходник» — исключено; в лог фиксируются оба SHA); `docker compose config -q` с dummy-переменными; сборка **3 образов** `conditera / conditera-chat / conditera-simplex-bridge` тегом `CANDIDATE_SHA`, build-arg `GIT_SHA` (→ APP_VERSION в /api/health); **secret-gate**: `docker image inspect` (существование до скана) + `docker history --no-trunc | grep` + контент-скан экспортированной ФС (`docker create` + `docker export | grep -aEi`) на `sk_live_/AKIA…/ghp_…/glpat-…/PRIVATE KEY/ci_test_*` |
| 5 | `security-checks` | grep секретов в `src/ scripts/ mini-services/`; ревизия `.env*`-файлов; **red-line drift guard** — 4 обязательных upload-пути существуют на диске И отслеживаются git: `src/app/api/upload/route.ts` (+`route.test.ts`), `src/app/api/services/upload/route.ts` (+`route.test.ts`) — против повторения 4 исторических drift-инцидентов (#8/#10/#11/#12); второй слой — unit-регрессия `src/lib/redline-paths.test.ts` |
| 6 | `validate-caddyfile` | `caddy validate --adapter caddyfile` в `public.ecr.aws/docker/library/caddy:2.8-alpine` (зеркало без rate-limit Docker Hub) |
| 7 | `evidence-hygiene` | `scripts/scan-evidence.mjs` (real-секрет/PII в tracked evidence → exit 1; значения не печатаются) + adversarial-регрессия правил `scan-evidence-rules-verify.mjs` + контракт `.env.production.example` (`production-env-template.mjs`) + **route-error-coverage** (`46/47`) |
| 8 | `migrations-pg18` | сервис `postgres:18-alpine`; реальный ledger-мигратор прод-пайплайна `supabase/init-scripts/01-apply-migrations.sh`: применяются все миграции (fail-fast) + `applied == total` по `schema_migrations`; **идемпотентность** — повторный прогон обязан быть no-op (grep "Applying" = FAIL); **RLS sanity** — `rowsecurity = true` для `app_error_events, app_incidents, app_incident_history, ops_tasks, orders, payments, recipe_purchases, inventory_items`; **write-path closures (0077)** — нет INSERT/UPDATE/DELETE-грантов `anon/authenticated` на `inventory_items, stock_movements, recipe_purchases, recipes, recipe_marketplace, financial_ledger` |
| 9 | `deps-audit` | `scripts/verify/osv-audit.mjs`: osv-scanner по `bun.lock` (скачивается latest с GitHub releases); diff с baseline `scripts/security/osv-baseline.json` — **новые** advisory → exit 1; baseline-элементы → WARN (remediation backlog); `--update-baseline` — только осознанным коммитом владельца |

Все три скрипта job'а 7 — только node builtins (установка зависимостей не нужна).

## 2. e2e.yml — Playwright E2E

- Jobs: `setup` (bun install, build, кэш `.next` по SHA) → `test` (матрица).
- Матрица **chromium-only** (решение владельца variant B, 2026-10-15): firefox/webkit не активированы в `playwright.config.ts` и поэтому не предлагаются в dispatch (TODO возвращения — в шапке workflow).
- Данные: embedded PostgreSQL `postgresql://postgres@127.0.0.1:54329/conditera` — источник для шима `/rest/v1` (ранний `file:./db`-вариант давал 53+ ошибок CI). HTML-отчёт — артефакт.

## 3. staging-deploy.yml — «Staging Deployment»

Статус: **READY FOR OWNER APPROVAL** — никогда не выполнялся (секреты не настроены; STAGING_DEPLOYMENT.md).

- `gate` (CI conclusion == success) → `predeploy` (`bash -n scripts/env-check.sh`; требование «staging-БД обновляется только ledger-мигратором того же SHA») → `deploy` (`environment: staging`; job-level env-гейт `STAGING_HOST_SET`; **секретов нет → честный FAILED**) → `postdeploy` (smoke `/api/health/live` = alive, `/api/health` = ok, `/` и `/api/products` = 200; итог в run summary) → `finalize` (FAILED при любом не-success).
- Caveat: в dispatch-режиме гейт CI не проверяется автоматически — ответственность за пройденный CI на выбранном SHA на запускающем (зафиксировано в логе).
- Хост-скрипт: `cd /opt/conditera-staging` → `./scripts/ops/backup-staging.sh` → `pull migrator web` → `run --rm migrator` → `WEB_IMAGE=ghcr.io/<repo>:sha-<7> up -d --no-deps web` → health retry 10×10s.

## 4. deploy.yml — «Deploy to Production»

Ручной dispatch (параметр `version` — метка; образ тегируется SHA `sha-<7>`, плюс `latest` и `migrator-<sha>`). Авто-деплой на push отключён намеренно; `environment: production` — approval gate настраивается владельцем (PRODUCTION_RELEASE.md §2). Детали — PRODUCTION_RELEASE.md; откат — ROLLBACK_RUNBOOK.md.

## 5. maintenance.yml — «Maintenance»

Статус: **READY FOR OWNER APPROVAL** — при отсутствующих секретах job пишет `SKIPPED (not an error)` в run summary, без имитации успеха.

- `http-maintenance`: `MAINTENANCE_APP_URL` + `MAINTENANCE_CRON_SECRET` → `GET /api/cron/backup` и `GET /api/cron/diagnostics-cleanup` с `X-Cron-Secret`; не-200 → job красный.
- `restore-verify`: `STAGING_HOST` → SSH `node scripts/ops/backup-verify-restore.mjs` (§10: доказательство = успешное восстановление); иначе честный SKIPPED (D-EXT-1).
- `daily-report` из Actions НЕ запускается — скрипт читает локальные `./backups` и git (MONITORING.md §4).

## 6. Локальный прогон гвардов (равноценная проверка без push)

```bash
node scripts/verify/route-error-coverage.mjs   # 46/47, exit 0 (измерено 2026-11-10)
node scripts/scan-evidence.mjs                 # docs/evidence/ — real-находки → exit 1
node scripts/verify/production-env-template.mjs
```

## 7. Связь с релизными гейтами

- Job `evidence-hygiene` спроектирован как обязательный PR-гейт: подключается владельцем к **required checks** для PR (комментарий v4.5 в ci.yml).
- Требование перед production-релизом: зелёный CI на целевом SHA (PRODUCTION_RELEASE.md §6) и, при настроенном staging, — успешный staging-прогон того же SHA.

## 8. Бизнес-регрессия (§6 п.14)

1. **Unit/интеграционные** — Vitest: 107 файлов / 1547 тестов PASSED (прогон 2026-11-10); typecheck 0 ошибок, lint 0 ошибок.
2. **Единая регистрация ошибок** — CI-гвард `route-error-coverage.mjs`: 46/47 core-маршрутов (exit 0, измерено 2026-11-10); новый непокрытый маршрут ломает CI.
3. **E2E Playwright** — smoke/full-flow/auth/payment-webhook-idempotency/recipe-purchase контракты (nightly + по изменению API-путей).
4. **Инфраструктурная регрессия** — `migrations-pg18` (RLS + write-path на чистой PG18), `docker-build` (secret-gate), red-line drift guard.
