# MONITORING — мониторинг и ежедневное обслуживание (DEPLOY-01 §5/§12)

**DEPLOY-01 EXTENDED (§5/§12) · Дата: 2026-11-10**
Исходники: `src/app/api/health/{route,live/route,ready/route}.ts`, `src/lib/diagnostics/metrics.ts`, `src/app/api/admin/diagnostics/metrics/route.ts`, `src/app/api/cron/diagnostics-cleanup/route.ts`, `scripts/ops/daily-report.mjs`, `.github/workflows/maintenance.yml`.

---

## 1. Три health-эндпоинта — разделение ответственности

| Эндпоинт | Роль | Ответ | Что раскрывает |
|---|---|---|---|
| `GET /api/health/live` | **Liveness** (§5): «процесс жив» — внешние мониторы (UptimeRobot/Cloudflare Tunnel/Caddy health_uri) и liveness-пробы оркестратора | 200 `{"status":"alive"}`, `Cache-Control: no-store` | **ничего** — ни зависимостей, ни конфигурации, ни внутренних адресов |
| `GET /api/health/ready` | **Readiness** (§5): «готов принимать трафик» — БД жива (`SELECT 1` через пул, guard 3s) | 200 `{"status":"ready","database":"ok"}` / 503 `{"status":"not-ready","database":"unavailable"}` | только факт доступности БД; секреты/SQL/stack/имена env-переменных не раскрываются |
| `GET /api/health` (расширенный) | Совместимость с существующими контрактами: Docker HEALTHCHECK, healthcheck deploy.yml/staging (grep `"status":"ok"`), Caddy | 200 (`status: ok`/`degraded`) или 503 при недоступной БД | app/database/n8n, reachability GoTrue (`GET {SUPABASE_URL}/auth/v1/health`, таймаут 3s: reachable/unreachable/not-configured; production-деградация при configured+unreachable — регистрация fail-closed), `version` (=GIT_SHA), uptime, features, dependencies[] |

**Компромисс публичности (честно):** расширенный `/api/health` публичен по историческим контрактам и раскрывает состав фич/версию/статусы зависимостей — поэтому для наружных мониторов добавлены минимальные `/live` и `/ready`, не раскрывающие внутренностей; сам `/api/health` оставлен без изменений ради Docker/deploy/Caddy-контрактов и покрыт тестами (U-15, health-тесты). Перевод внешних мониторов на `/live` — рекомендация; смена контрактов `/api/health` — отдельное решение владельца.

Примеры:
```bash
curl -s https://<домен>/api/health/live   # {"status":"alive"}
curl -s https://<домен>/api/health/ready  # {"status":"ready","database":"ok"} | 503 not-ready
curl -s https://<домен>/api/health        # {status, database, n8n, auth, version, uptime, …}
```

## 2. Админ-метрики: `GET /api/admin/diagnostics/metrics` (§5)

Доступ: `getUserFromRequest` + `requireAnyRole(["ADMIN","SUPER_ADMIN"])` → 401/403; публично недоступно (`/api/health` внутренности не раскрывает). `Cache-Control: no-store`. Сбор — `collectMetricsSnapshot()`:

- **process**: pid, uptimeSec, RSS/heapUsed/heapTotal/external/arrayBuffers, load1/5/15;
- **system**: platform, totalMemBytes/freeMemBytes, cpuCount;
- **disk**: `fs.statfsSync(cwd)` → total/free bytes; в рантаймах без statfs — честные `null`;
- **eventStore** (`getStoreStats`): queueLength, circuitOpen, consecutiveFailures, totalDropped;
- **events**: агрегат `app_error_events` за 1ч/24ч — total, critical, error, warning, http5xx; fail-open (недоступная БД → нулевое окно, процессные метрики остаются честными);
- **incidents**: сводка `getIncidentSummary()` (byStatus, byPriority, openTotal, last24h);
- **limitations** (в самом ответе): `requestRate: "not collected — …"`, `latencyPercentiles: "not collected — p95 requires per-request timing (APM); see docs/operations/MONITORING.md"`.

**Честные ограничения (двойная фиксация: код `limitations` + этот документ):** полный RPS и p95-латентность **не собираются** — это не APM; события фиксируют только ошибки. Если метрики нагрузки/задержек нужны бизнесу — OWNER_DECISIONS.md **D-EXT-6** (Sentry/Grafana/самохостед APM — бюджет и SaaS-решение владельца). При сбое сбора эндпоинт возвращает 503 `{error, partial:true}` (fail-open, админка не ломается).

### Как читать метрики (ориентиры, не конфигурация)

| Сигнал | Что означает |
|---|---|
| `eventStore.circuitOpen = true` | 5 подряд неудач записи событий — события временно только в консоли; проверить БД |
| `eventStore.totalDropped` растёт | лавина ошибок (drop-oldest при очереди 500) — искать fingerprint с большим occurrence_count |
| `events.last1h.http5xx` всплеск + новые P0/P1 | регрессия недавнего релиза — версия в `last_version`, свёртка по fingerprint |
| `disk.freeBytes` → мало / `null` | null — statfs недоступен (честно), мало — очистка/расширение диска |
| `incidents.last24h` vs `openTotal` | темп появления против скорости закрытия реестра |

Пороговые значения алертов этим контуром не конфигурируются — уведомления привязаны к P0/P1-инцидентам (INCIDENT_MANAGEMENT.md §4.4).

## 3. Ретеншн диагностических событий (§5/§12)

`GET /api/cron/diagnostics-cleanup` (X-Cron-Secret, как `/api/cron/backup`):
- удаляет raw-события `app_error_events` старше `DIAGNOSTICS_RETENTION_DAYS` (**по умолчанию 90**, максимум 3650; env принимается при `Number.isFinite && > 0`);
- **инциденты и история НЕ удаляются** — это реестр, владелец закрывает их через админ-панель (§4);
- факт операции — в `maintenance_logs` (`DIAGNOSTICS_CLEANUP`, `deletedEvents`, `retentionDays`; сбой записи лога не ломает очистку); ответ 200 `{ok:true, deletedEvents, retentionDays}`.

Триггер — шаг 2 `maintenance.yml` (ежедневно 04:00 UTC после бэкапа) — **READY FOR OWNER APPROVAL** (D-EXT-3). Тюнинг периода/ретеншна — D-EXT-8.

## 4. Ежедневный отчёт (`scripts/ops/daily-report.mjs`, §12)

Собирает **фактические** данные: (1) доступность `/live`, `/ready`, `/health`; (2–3) инциденты и ошибки по severities из БД; (4) последние cron-прогоны (`site_settings.cron_runs`); (5) состояние бэкапов — последняя запись `maintenance_logs` + файлы `./backups`; (6) результат последней restore-проверки или честное «не выполнялась»; (7) локальный git HEAD — внешние статусы CI честно помечаются «недоступно» без имитации; (8) ссылка на требуемые решения владельца.

Запуск — **на хосте приложения по crontab** (скрипт читает локальные `./backups` и git — из GitHub Actions эта часть не работает; там только HTTP-шаги maintenance.yml):

```
# пример crontab на хосте (после настройки окружения; время — решение владельца, D-EXT-5):
0 6 * * * cd /opt/conditera && node scripts/ops/daily-report.mjs --notify >> /var/log/conditera-daily-report.log 2>&1
```

`--notify`: при настроенных `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHANNEL_ID` — отправка в Telegram (обрезка до 3800 симв.); без них — честное «уведомление НЕ отправлено» и exit code 1.

## 5. Каналы уведомлений — текущее состояние

- Единственный канал — **Telegram** (`notifyChannel`, src/lib/telegram-bot.ts): P0/P1-инциденты (30-мин дедуп, at-least-once), уведомление deploy.yml о релизе, daily-report `--notify`.
- Если `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHANNEL_ID` не настроены в целевой среде — P0/P1-уведомления **честно не отправляются**: `console.warn` с троттлингом 60с (INCIDENT_MANAGEMENT.md §4.4) — READY FOR OWNER APPROVAL, см. D-EXT-4.
- Резервных каналов (email/SMS) **нет** — отказ Telegram виден только по логам; введение второго канала — решение владельца (D-EXT-4).

## 6. Расписание обслуживания (сводка)

| Время (UTC) | Что | Где | Статус |
|---|---|---|---|
| 03:00 | Playwright E2E (chromium-only) | e2e.yml | активен |
| 04:00 | backup + diagnostics-cleanup (HTTP) | maintenance.yml | READY FOR OWNER APPROVAL (D-EXT-3) |
| 04:00+ | restore-verify на staging host | maintenance.yml | READY FOR OWNER APPROVAL (D-EXT-1) |
| 06:00 (пример) | daily-report + `--notify` | crontab хоста | конфигурирует владелец |
