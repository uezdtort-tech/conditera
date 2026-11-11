# Z-v27 — STAGING READINESS AUDIT

Дата: 2026-11-11 · HEAD `664e1e5` · Это АУДИТ ГОТОВНОСТИ, staging НЕ развёртывался и НЕ деплоился.

---

## 1. Чек-лист (25 пунктов задания §12)

| # | Пункт | Статус | Доказательство / Примечание |
|---|---|---|---|
| 1 | Staging-конфигурация существует | PARTIAL | `.github/workflows/staging-deploy.yml` (байт-верифицирован Z-v26-F3, `branches: [main]` корректен), `docs/release/STAGING_ENVIRONMENT.md`, `STAGING_DEPLOYMENT_RUNBOOK.md` |
| 2 | Staging ≠ production | PASS | отдельные env-шаблоны (`.env.production.example`, staging-раздел в runbook); staging-джоб защищён `environment: staging` |
| 3 | Переменные окружения | PARTIAL | шаблоны есть; реальные staging-значения может задать только владелец (секреты не в репо) |
| 4 | Секреты не в репозитории | PASS | в git только `*.example`; secrets-scan Z-v25 чист (дерево+300 коммитов); новые файлы Z-v27 секретов не содержат |
| 5 | Migration runner | PASS | `setup.mjs`: advisory lock (F4), дубликат-гейт ДО SQL (exit 1), fail-fast, честный леджер; legacy `apply-migrations.ts` честный exit 1 (F2) |
| 6 | Повторный запуск миграций | PASS | идемпотентность: леджер `schema_migrations` (79 файлов, 0 дубликатов); повтор `setup.mjs` на существующей БД — штатная ветка |
| 7 | Конкурентный запуск миграций | PASS | advisory lock верифицирован Z-v26 (оба exit 0); тест конкурентного запуска в логах Z-v26 |
| 8 | Backup | PASS | `bun run ops:backup` exit 0 (Z-v27 прогон) |
| 9 | Restore | PASS | `bun run ops:restore-verify` → PASSED (Z-v27 прогон) |
| 10 | Health checks | PASS | `/api/health` → `{app:ok, database:ok, n8n:ok, status:ok}`; chat `/health` ok |
| 11 | Логи | PARTIAL | структурные логи в коде (route-error-coverage 47/48); централизованной сборки нет (вне scope локальной среды) |
| 12 | Мониторинг ошибок | PARTIAL | `app_error_events`/`app_incidents` + diagnostics 16/16; внешний Sentry/Apm не подключён (решение владельца) |
| 13 | Rate limits | PASS | checkout 5/min per IP подтверждён живым 429 (Z-v26); анти-брутфорс 2FA (Z-v20) |
| 14 | CORS | PASS | единая регистрация ошибок/заголовков; проб Z-v25 нарушений нет |
| 15 | CSRF | PASS | `/api/csrf-token` + cookie-пара; HTTP-сценарии Z-v27 используют корректный флоу |
| 16 | Cookie security | PASS | httpOnly/secure-флаги в auth-контракте (Z-v25 аудит) |
| 17 | RLS | PASS | 159 таблиц с RLS, 371 политика; spot-check изоляции Z-v21/Z-v25 |
| 18 | Серверная авторизация | PASS | ownership-пробы Z-v25 чисты; role-gates Z-v21 |
| 19 | OAuth callback configuration | BLOCKED_CREDENTIALS | код готов (501 fail-closed без ключей); нужен `YANDEX_CLIENT_ID/SECRET` и callback-URL владельца |
| 20 | Платёжный webhook | PARTIAL | код: подпись/IP-allowlist/idempotent; sandbox-прогон невозможен без ключей |
| 21 | Storage permissions | PASS (local) | 4 защищённых upload-файла + MIME-sniff fail-closed; для облака — ключи владельца |
| 22 | Chat-server JWT compatibility | PASS | chat и Next используют общий `JWT_SECRET` (F6 закрыт Z-v25); strict no-default |
| 23 | n8n webhook security | PASS (receiver) | webhook-receiver с секретом (BOT_SECRET/CRON_SECRET-контур); workflow-engine отсутствует — не блокер витрины |
| 24 | Rollback strategy | PASS | `docs/release/ROLLBACK_RUNBOOK.md`, `ROLLBACK_AND_RECOVERY.md` |
| 25 | Миграции на чистой PG 18.4 | PASS | Z-v27: `conditera_zv27_gate` создана штатным `setup.mjs`, 79 миграций + сиды, exit 0 |

## 2. Ключевые условия, которые может выполнить ТОЛЬКО владелец

1. Внешний PostgreSQL для staging (или решение продолжать на embedded в контейнере).
2. Секреты окружения staging (`JWT_SECRET`, `CHAT`-секрет, `CRON/BOT` секреты, домен, OAuth callback).
3. Yandex ID приложение (client id/secret + callback).
4. YooKassa sandbox-пара (`YOOKASSA_SHOP_ID`/`SECRET`).
5. SMTP и/или Telegram-токен (опционально для staging).

## 3. Вердикт по staging-подготовке

`READY FOR CONTROLLED STAGING PREPARATION` — по технической части (миграции, runner, бэкапы,
здоровье, RLS, security-пробы) блокеров НЕТ. Внешние интеграции — после credentials владельца.
Сам staging deploy остаётся ЗАПРЕЩЁН до отдельного решения владельца.
