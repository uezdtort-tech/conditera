# OWNER_DECISIONS — решения, ожидающие владельца (DEPLOY-01 §18 G)

**DEPLOY-01 EXTENDED (§18 G) · Дата: 2026-11-10**
Статус всего списка: **READY FOR OWNER APPROVAL** — ни один пункт не считается выполненным, пока владелец не подтвердит действие и (где применимо) не внесёт конфигурацию. Ни один workflow/скрипт не имитирует выполнение этих пунктов (§19: нет прогонки = нет успеха).

---

## Сводная таблица

| ID | Тема | Состояние (факт) | Действие владельца | Влияние |
|---|---|---|---|---|
| D-EXT-1 | Staging-инфраструктура | `STAGING_HOST`/`STAGING_SSH_KEY`/`STAGING_APP_URL` не настроены → staging-deploy.yml и restore-verify в maintenance.yml **никогда не выполнялись** (честный FAILED/SKIPPED) | Подготовить staging-хост и secrets по шагам STAGING_DEPLOYMENT.md §5 | Без staging релизы идут в production без промежуточной среды; restore-verify бэкапов не автоматизирован |
| D-EXT-2 | Production approval gate | `deploy.yml` — job с `environment: production`, но **Required reviewers в GitHub Environments не настроены** (workflow сам принудить не может) | GitHub → Settings → Environments → `production` → Required reviewers → владелец | Единственный барьер перед публикацией — ручной запуск dispatch; reviewers дают явное второе подтверждение |
| D-EXT-3 | Maintenance-секреты | `MAINTENANCE_APP_URL`/`MAINTENANCE_CRON_SECRET` не настроены → maintenance.yml честно SKIPPED, ежедневный backup/cleanup по cron **не выполняются** | Настроить оба секрета (URL целевой среды + значение её `CRON_SECRET`) | Автоматический ежедневный бэкап и ретеншн событий заработают только после этого |
| D-EXT-4 | Telegram-канал уведомлений | `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHANNEL_ID` не настроены в целевой среде → P0/P1-инциденты **честно не отправляются** (console.warn, троттлинг 60с); дедуп `notified_at` при этом работает; единственный канал — Telegram, резервных нет | Создать бота/канал, настроить переменные в целевой среде (и секреты в environment `production` для deploy.yml) | Без канала владелец узнаёт о P0/P1 только из админ-панели/логов; второй канал (email/SMS) — опциональное расширение этого решения |
| D-EXT-5 | Цели RPO/RTO | **Не определены** — AI их не устанавливает (фиксация фактов в BACKUP_RECOVERY.md §6: частота — ежедневный cron после D-EXT-3, ретеншн файлов 30 дней, restore-verify ежедневно после D-EXT-1) | Совместно с бизнесом определить допустимую потерю данных (RPO) и время восстановления (RTO); при необходимости увеличить частоту бэкапа | До решения окно потери данных не формализовано; также решается расписание restore-verify/daily-report (в комментариях кода упоминалось как «D-7») |
| D-EXT-6 | APM / метрики нагрузки | RPS и p95-латентность **не собираются** (честные `limitations` в `/api/admin/diagnostics/metrics` и MONITORING.md §2); собираются: процесс/система/диск/очередь диагностики/события 1ч-24ч/инциденты | Решить, нужны ли APM-метрики; при да — выбрать (Sentry/Grafana/самохостед) и утвердить бюджет + SaaS-зависимость | Текущий контур достаточен для одиночного backend; без решения p95/RPS остаются не измеряемыми (осознанное ограничение, зафиксированное в коде) |
| D-EXT-7 | Production-путь space-z | `deploy.yml` — схема для **собственного VPS** (SSH + docker compose + ghcr); фактический production-хостинг платформы space-z публикуется собственным пайплайном `.zscripts/` | Подтвердить границу ответственности: кто и как выполняет production-публикацию (GitHub Actions VPS-схема vs платформенный pipeline) и кто держит процедуру отката | Без решения два потенциальных пути публикации могут разойтись версиями; sha-теги/health-контракт общие, механика отката едина (ROLLBACK_RUNBOOK.md) |
| D-EXT-8 | Ретеншн диагностики и бэкапов | `DIAGNOSTICS_RETENTION_DAYS` — по умолчанию **90 дней** (макс 3650; cron `/api/cron/diagnostics-cleanup`); ретеншн файлов бэкапов — **30 дней** (`BACKUP_RETENTION_DAYS` в src/lib/backup.ts) | Согласовать значения с D-EXT-5 (RPO) и объёмом БД; переопределить env при необходимости | По умолчанию события ошибок живут 90 дней, инциденты/история — бессрочно (реестр не чистится); бэкап-файлы — 30 дней |

---

## Детализация (① состояние ② действие ③ влияние)

### D-EXT-1 — Staging-инфраструктура
① Workflow `staging-deploy.yml` готов (триггер после CI + dispatch), но при отсутствии `STAGING_HOST` job `deploy` возвращает честный FAILED («требуется решение владельца D-1»); restore-verify в maintenance.yml — честный SKIPPED.
② Пошаговая настройка — STAGING_DEPLOYMENT.md §5 (хост → DNS → `backup-staging.sh` → secrets → первый dispatch → приёмка).
③ Пока не сделано: перед каждым production-релизом нет промежуточной среды; единственное restore-доказательство — локальный прогон 2026-11-10 (BACKUP_RECOVERY.md §4).

### D-EXT-2 — Production approval gate
① `deploy.yml` ручной; job ссылается на `environment: production`, но GitHub Environments ещё не настроен владельцем.
② Settings → Environments → `production` → Required reviewers; рекомендуется перенести production-секреты в environment.
③ Без reviewers публикация зависит только от дисциплины запуска; после — двухступенчатое подтверждение (запуск + одобрение).

### D-EXT-3 — Maintenance-секреты
① Job `http-maintenance` проверяет `MAINTENANCE_APP_URL`/`MAINTENANCE_CRON_SECRET`; без них — `SKIPPED (not an error)` в run summary; значения secret-гейтов видны в summary (true/false, без самих значений).
② Настроить оба секрета; значение секрета = `CRON_SECRET` той среды, на которую указывает URL.
③ Включает ежедневные `/api/cron/backup` и `/api/cron/diagnostics-cleanup` с защитой не-200 → красный job.

### D-EXT-4 — Telegram-канал
① Код уведомлений готов и честен: без токена/канала — warn-лог раз в 60с, отправки нет, окно `notified_at` не съедает событие (at-least-once при настроенном канале).
② Создать бота и канал, внести `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHANNEL_ID` в целевую среду (см. docs/TELEGRAM_SETUP.md); решить, нужен ли второй канал.
③ Настраивает доставку P0/P1, релизных уведомлений и daily-report; без решения владелец мониторит админ-панель вручную.

### D-EXT-5 — RPO/RTO
① Значения не установлены никем; документация фиксирует только механизмы и частоты (BACKUP_RECOVERY.md §6).
② Владелец + бизнес определяют RPO/RTO; следствия: частота бэкапа (сейчас — ежедневный cron), расписание restore-verify и daily-report.
③ Влияет на требования к хосту (внешний офсайт-хранитель бэкапов не реализован) и на допустимость окна потери при restore.

### D-EXT-6 — APM
① In-process метрики — честный минимум; `limitations` возвращаются самим API (нет имитации).
② Решение о введении APM (Sentry/Grafana/самохостед) — бюджет, SaaS-зависимость, схема передачи данных; связано с решением «собственная диагностика vs Sentry» (ARCHITECTURE.md §3).
③ Без решения мониторинг остаётся ошибко-центричным (события/инциденты), без RPS/p95.

### D-EXT-7 — Production-путь space-z
① Существуют два контура публикации: `deploy.yml` (собственный VPS, референс-механика) и пайплайн платформы space-z (`.zscripts/`).
② Владелец фиксирует: какой контур является production-истиной, кто держит откаты и как сверяются версии.
③ Исключает расхождение версий между платформой и VPS-схемой; механика (sha-теги, ledger, healthcheck) общая.

### D-EXT-8 — Ретеншн
① Значения по умолчанию: события — 90 дней (макс 3650), бэкап-файлы — 30 дней; инциденты/история — бессрочно.
② Согласовать с RPO (D-EXT-5) и объёмом БД; переопределение — через env `DIAGNOSTICS_RETENTION_DAYS` (cron-эндпоинт читает при каждом запуске).
③ Недостаточный ретеншн = потеря forensic-контекста ошибок; избыточный = рост таблицы `app_error_events`.

---

## Соответствие ссылок в коде

| Ссылка в коде | Где | Пункт этого списка |
|---|---|---|
| «решение владельца D-1» | staging-deploy.yml (шапка, honest-FAILED), maintenance.yml (restore-verify) | D-EXT-1 |
| «D-7» (restore-verify cron) | scripts/ops/daily-report.mjs (секция 6) | D-EXT-5 (расписание проверки восстановления) |
| «D-8» (osv baseline backlog) | scripts/verify/osv-audit.mjs | backlog advisory зависимостей — ведётся в `scripts/security/osv-baseline.json`, отдельный от D-EXT-1…8 операционный пункт (CI_CD.md, job deps-audit) |

## Порядок разблокировки (рекомендуемая последовательность)

1. **D-EXT-2** (минуты, бесплатно) — включить approval gate для production.
2. **D-EXT-3 + D-EXT-4** — maintenance-секреты и Telegram: включит ежедневный бэкап/ретеншн и доставку P0/P1.
3. **D-EXT-5** — зафиксировать RPO/RTO (определяет частоту бэкапа и расписание отчётов).
4. **D-EXT-1** — staging-инфраструктура (STAGING_DEPLOYMENT.md §5), включит и ежедневный restore-verify.
5. **D-EXT-6 / D-EXT-7 / D-EXT-8** — по мере роста нагрузки/команды: APM, уточнение production-пути, тюнинг ретеншна.
