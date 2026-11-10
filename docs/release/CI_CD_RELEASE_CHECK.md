# CI/CD RELEASE CHECK — Z-v20

## Workflows (`.github/workflows/`)

| Файл | Назначение | Триггеры | Ключевые защиты |
|---|---|---|---|
| `ci.yml` | typecheck/lint/unit/security-сканы на PR и push | push/PR | permissions ограничены, concurrency cancel-in-progress |
| `e2e.yml` | Playwright E2E + уведомления в Telegram | push/PR/schedule | отдельный job, secrets Telegram опциональны |
| `staging-deploy.yml` | Deploy в staging | ручной/ветка | `environment: staging`, цепочка gate → predeploy → deploy → postdeploy, проверки secrets до старта (STAGING_HOST_SET и т.п.) |
| `deploy.yml` | Production | ручной/тег | `environment: production` (GitHub Environment protection — approval настраивается владельцем), registry auth через GITHUB_TOKEN |
| `maintenance.yml` | Ежедневный backup/cleanup/report по cron | schedule | честная деградация: если `MAINTENANCE_APP_URL`/`MAINTENANCE_CRON_SECRET` не заданы — job помечает SKIPPED (не имитирует успех) |

- YAML-валидность: **все 5 файлов парсятся** (js-yaml, Z-v20).
- Production НЕ деплоится автоматически после staging (нет workflow_run-связки) —
  отдельный ручной запуск `deploy.yml`.
- Секреты в репозитории не хранятся; в workflows только `secrets.*`-ссылки.

## Честные ограничения

1. **GitHub Actions ни разу не запускались** — push в origin запрещён без отдельного
   разрешения владельца. Локальная YAML-валидация и локальные аналоги проверок
   (typecheck/lint/unit/E2E/build) пройдены, но это НЕ доказывает успешный run в Actions.
2. Production approval: владелец должен настроить GitHub Environment `production`
   (required reviewers) — см. OWNER_ACTIONS_REQUIRED.md.
3. Staging secrets (STAGING_HOST/STAGING_SSH_KEY/STAGING_APP_URL) не настроены —
   staging-deploy.yml честно остановится на gate.

## Как запустить staging после разрешения владельца

1. Настроить Environment `staging` и secrets (см. PRODUCTION_ENVIRONMENT_REQUIREMENTS.md).
2. Запустить workflow `staging-deploy.yml` вручную (workflow_dispatch).
3. Проверить job `gate` (все secrets на месте) → predeploy (backup/migrations dry-run) →
   deploy → postdeploy (health-check, smoke).
4. Верификация: `GET $STAGING_APP_URL/api/health` → `"status":"ok"`;
   `GET /robots.txt` → `Disallow: /dashboard`; логин тестового пользователя.
