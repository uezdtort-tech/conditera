# ARCHITECTURE — операционная архитектура «Уездный кондитер» (Conditera)

**DEPLOY-01 EXTENDED (§1 — архитектурный обзор) · Дата: 2026-11-10**
**Состояние:** HEAD `ea7379f` (DEPLOY-01 EXTENDED закоммичен); Z-v19-фиксы поверх — см. git status · v2.0 Supabase + bun + Next.js 16 App Router
**Верификация:** `bun run test` → 107 файлов / 1547 тестов PASSED · typecheck 0 ошибок · lint 0 ошибок.

---

## 1. Состав набора операционной документации

| Документ | Раздел DEPLOY-01 | Тема |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | §1 | Этот документ — обзор и проектные решения |
| [ERROR_TRACKING.md](ERROR_TRACKING.md) | §3 | Единая регистрация ошибок, маскирование, correlation-id |
| [INCIDENT_MANAGEMENT.md](INCIDENT_MANAGEMENT.md) | §4 | Реестр инцидентов: статусы, приоритеты, уведомления |
| [MONITORING.md](MONITORING.md) | §5/§12 | Health-пробы, метрики, ретеншн, ежедневный отчёт |
| [CI_CD.md](CI_CD.md) | §6 | 9 job'ов CI, E2E, staging/deploy/maintenance workflows |
| [STAGING_DEPLOYMENT.md](STAGING_DEPLOYMENT.md) | §7 | Staging: изоляция, pipeline, настройка владельцем |
| [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md) | §8 | Production: ручной релиз, approval gate |
| [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md) | §9 | Откат приложения; БД — forward-only, expand-contract |
| [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) | §10 | Бэкап, restore-verify (доказательство = восстановление) |
| [OWNER_DECISIONS.md](OWNER_DECISIONS.md) | §18 G | 8 решений, ожидающих владельца (D-EXT-1…D-EXT-8) |

## 2. Компонентная схема операционного контура

```
 ┌────────────────────────── ПРИЛОЖЕНИЕ (single backend, Next.js nodejs-runtime) ──────────────────────┐
 │                                                                                                     │
 │  API-роуты / cron / чат-хуки              Клиент (браузер)                                          │
 │   ├─ handleRouteError (src/lib/http-helpers.ts)        error.tsx / global-error.tsx                 │
 │   ├─ captureServerError / captureDependencyError       reportClientError (src/lib/diagnostics/      │
 │   └─ uncaughtException / unhandledRejection             client-report.ts)                           │
 │        (src/lib/diagnostics/global-handlers.ts              │                                       │
 │          ← регистрируются в src/instrumentation.ts)         ▼                                       │
 │              │                                     POST /api/diagnostics/client-errors              │
 │              ▼                                        (202; маскирование ×2; rate-limit)           │
 │  masking.ts (scrub / maskString / maskStackTrace) ← ЕДИНАЯ точка фильтрации PII/секретов            │
 │              │                                                                                      │
 │              ▼                                                                                      │
 │  event-store.ts: очередь (500, drop-oldest) → flush 300ms → app_error_events                        │
 │        │          circuit-breaker 5→30s · per-fingerprint 20/мин · рекурсия-гвард                   │
 │        └─ upsertIncident (каждое событие) → app_incidents (агрегация по fingerprint)                │
 │                 │                            рецидив CLOSED/VERIFIED → REOPENED                     │
 │                 └─ P0/P1 → Telegram (notified_at-дедуп 30 мин; at-least-once)                       │
 │                                                                                                     │
 │  proxy.ts: x-request-id (correlation) ──► заголовки запроса и ответа ──► все события                │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
        │ админ-API (ADMIN/SUPER_ADMIN + RLS 0079)                     │ cron (X-Cron-Secret)
        ▼                                                              ▼
  /api/admin/diagnostics/{incidents,events,metrics}          /api/cron/backup
  UI: админ-таб «Инциденты» (admin-incidents-tab.tsx)        /api/cron/diagnostics-cleanup
                                                                       │
  GitHub Actions ◄── ci.yml (9 jobs) / e2e.yml / staging-deploy.yml / deploy.yml / maintenance.yml
        │ (гварды: route-error-coverage, RLS/write-path, osv-audit, red-line, secret-gate)
        ▼
  PostgreSQL 18 (единственное хранилище; embedded PG 54329 в локальной среде)
```

## 3. Ключевые проектные решения

| Решение | Рассмотренная альтернатива | Обоснование (факты) |
|---|---|---|
| **Собственная диагностика** (8 модулей `src/lib/diagnostics/` + 7 тест-файлов + 3 таблицы 0079) | Sentry и SaaS-аналоги | Контур уже production-grade: 1547 unit-тестов, 0 typecheck/lint ошибок, E2E-регрессия. Sentry = внешняя SaaS-зависимость (доступность, бюджет, передача PII наружу) без выигрыша для одиночного backend. Своя система полностью под контролем маскирования (PII не покидает БД) и покрыта тестами. Возврат к SaaS — решение владельца (OWNER_DECISIONS D-EXT-6). |
| **In-process метрики** (`collectMetricsSnapshot`) | Prometheus + Grafana + node_exporter | Нет требования тяжёлой инфраструктуры: один backend + PostgreSQL. Процессные/системные метрики читаются админ-API; честные limitations зашиты в ответ (RPS/p95 не собираются). Prometheus оправдан только при росте числа инстансов — решение D-EXT-6. |
| **Единый backend + PostgreSQL** | Микросервисы, отдельный log-store (ELK/Loki) | Весь операционный стейт (события, инциденты, история, maintenance_logs) живёт в public-схеме той же БД; RLS-политики 0079 дают admin-only доступ; ретеншн — обычным SQL DELETE по cron. |
| **Интеграция, а не дублирование** | Собственная auth/нотификации/логи | Диагностика НЕ копирует существующие системы: аутентификация — `getUserFromRequest`/`requireAnyRole` (src/lib/auth, src/lib/role-guards); роли/RLS — `user_roles`; уведомления — существующий `notifyChannel` (src/lib/telegram-bot.ts); журнал операций — существующий `maintenance_logs`; клиентские ошибки — существующий admin dashboard. |
| **Fail-open диагностики** | Диагностика как критический путь | Ни одна точка врезки не бросает и не блокирует ответ (§3.3): capture fire-and-forget, очередь drop-oldest, circuit-breaker, рекурсия-гвард. Сбой мониторинга никогда не роняет бизнес-код. |
| **Honest status** (§19) | Имитация успеха | Все workflows/скрипты при отсутствии owner-конфигурации честно возвращают FAILED/SKIPPED (staging-deploy, maintenance, daily-report `--notify`) — «нет прогонки = нет успеха». |

## 4. Поток «ошибка → закрытый инцидент»

1. **Перехват** — `handleRouteError` / `captureServerError` / клиентский ingest / global-handlers (см. [ERROR_TRACKING.md](ERROR_TRACKING.md) §3.4–3.5).
2. **Маскирование** — `masking.scrub()` до записи; стек только серверный (см. ERROR_TRACKING.md §3.2).
3. **Хранение** — `storeErrorEvent()` → очередь → `app_error_events`; параллельно `upsertIncident()` → `app_incidents` (occurrence_count, REOPENED при рецидиве).
4. **Приоритизация** — `classifyPriority()`: critical×(payments/database/infrastructure)→P0; error×(payments/auth/orders)→P1 и т.д. (см. [INCIDENT_MANAGEMENT.md](INCIDENT_MANAGEMENT.md) §4.3).
5. **Уведомление** — P0/P1 через Telegram c 30-минутным дедупом `notified_at` (at-least-once).
6. **Разбор** — админ-UI «Инциденты»: статусы NEW→…→CLOSED, история переходов (`app_incident_history`), сырые события по fingerprint.
7. **Закрытие** — FIXED→VERIFIED→CLOSED с фиксацией `fix_commit`/`resolved_version`; рецидив автоматически переводит инцидент в REOPENED.

## 5. Границы операционного контура (что НЕ входит)

- Распределённая трассировка и сбор RPS/p95 — не реализованы (честные `limitations` в метриках; D-EXT-6).
- Автоматический downgrade БД — отсутствует по дизайну (§9, forward-only ledger-миграции; см. [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md)).
- Авто-масштабирование и многорегиональность — вне скоупа (single VPS/платформа space-z; D-EXT-7).
- Resilient-каналы уведомлений (email/SMS) — только Telegram, деградация честная (D-EXT-4).

## 6. Точки интеграции с существующей системой (без дублирования)

| Интеграция | Используемый механизм | Где в коде |
|---|---|---|
| Аутентификация админ-API | `getUserFromRequest` + `requireAnyRole(["ADMIN","SUPER_ADMIN"])` | src/lib/auth.ts, src/lib/role-guards.ts |
| Авторизация на уровне БД | RLS-политики миграции 0079 (admin-only SELECT/UPDATE) | supabase/migrations/0079_diagnostics_incidents.sql |
| Уведомления | `notifyChannel({type:"error",…})` существующего Telegram-бота | src/lib/telegram-bot.ts |
| Журнал обслуживания | таблица `maintenance_logs` (BACKUP_FULL, DIAGNOSTICS_CLEANUP) | src/app/api/cron/* |
| Cron-аутентификация | `verifyCronSecret` (заголовок X-Cron-Secret) | src/lib/cron-auth.ts |
| UI админки | таб «Инциденты» + метрики-панель в dashboard | src/components/dashboard/admin-incidents-tab.tsx |
| Версия сборки | `GIT_SHA` → `APP_VERSION` → `/api/health.version` и `app_incidents.last_version` | Dockerfile, deploy.yml |
