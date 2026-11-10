# ROLLBACK_RUNBOOK — откат релиза (DEPLOY-01 §9)

**DEPLOY-01 EXTENDED (§9) · Дата: 2026-11-10**
Исходники: `.github/workflows/deploy.yml`, `.github/workflows/staging-deploy.yml`, `supabase/init-scripts/01-apply-migrations.sh`, `docs/operations/{BACKUP_RECOVERY,INCIDENT_MANAGEMENT}.md`.

Ключевой принцип §9: **Git-revert ≠ восстановление системы.** Приложение и база данных откатываются по разным правилам; смешивать их нельзя.

---

## 0. Пока инцидент не закрыт — фиксировать

Любой откат выполняется под зарегистрированным инцидентом (INCIDENT_MANAGEMENT.md §4.2): создать/переоткрыть инцидент (P0 по умолчанию при затрагивании payments/database), связать `fix_commit`/note с SHA отката. Во время диагностики корреляция запросов — по `x-request-id` (ERROR_TRACKING.md §3.6), события — по fingerprint в `app_error_events`; версия сборки видна в `/api/health.version` (=GIT_SHA) и в `app_incidents.last_version`.

## 0.1 Быстрый выбор действия (симптом → первое движение)

| Симптом | Первое движение |
|---|---|
| 5xx-всплеск сразу после релиза (http5xx в метриках, новые P0/P1 с `last_version` = новый SHA) | Откат приложения (§2) — миграции трогать не нужно, если релиз был expand-only |
| Порча данных (неверные суммы/остатки), схема в порядке | Остановить запись (§5 BACKUP_RECOVERY) → restore из бэкапа (§4) |
| Релиз сломал запуск (health 503 после rollout) | deploy.yml уже упал на healthcheck → откат по §2; причину разбирать по `app_error_events` |
| Ошибка на этапе миграций в deploy | Релиз не завершён (fail-fast); web на старом образе — разбирать миграцию, не «докатывать» |
| Неизвестно, что сломалось | Зафиксировать инцидент (§0), собрать события по fingerprint/x-request-id, затем §0.1 |

## 1. Что откатывается, а что — нет

| Объект | Откат | Механика |
|---|---|---|
| Web-образ | ✅ да, вручную | предыдущий `sha-`-тег в ghcr — deploy.yml **не выполняет `docker image prune`**, история образов сохраняется намеренно |
| Chat-server / simplex-bridge | ✅ да, вручную | те же sha-теги: `conditera-chat:<sha>`, `conditera-simplex-bridge:<sha>` |
| Схема БД (миграции) | ❌ **нет авто-downgrade** | ledger forward-only: `01-apply-migrations.sh` применяет только неотмеченные в `schema_migrations` файлы; механизма понижения в пайплайне нет |
| Данные БД | ⚠️ только restore из бэкапа | BACKUP_RECOVERY.md §5 (одноразовая восстановленная БД + переключение) |

## 2. Откат приложения (шаги на VPS `/opt/conditera`)

1. Определить текущий тег: `/api/health` → `version` (= `GIT_SHA` образа), либо `docker image ls <repo>`, либо журнал запусков «Deploy to Production» (в каждом — `sha_tag`).
2. Выбрать предыдущий известный хороший SHA (`sha-<7>` последнего успешного релиза).
3. Откатить web **без** пересоздания зависимостей:
   ```bash
   WEB_IMAGE=ghcr.io/<repo>:sha-<prev7> WEB_TAG=sha-<prev7> \
     docker compose up -d --no-deps web
   ```
4. Healthcheck: `curl -sf http://localhost:3000/api/health` содержит `"status":"ok"` (тот же контракт, что в deploy.yml; при необходимости retry 10×10s).
5. Публичная проверка: `https://<домен>/api/health` → 200; smoke главной/каталога.
6. Если откатывается и чат/bridge: `docker compose up -d --no-deps chat-server` (аналогично для `simplex-bridge`) с предыдущим тегом.
7. Зафиксировать в инциденте: статус FIXED→VERIFIED после проверки, note с SHA отката и причиной.

### 2.1 Где найти предыдущий тег

| Источник | Команда/место |
|---|---|
| Локальный демон Docker на VPS | `docker image ls ghcr.io/<repo> --format '{{.Tag}} {{.CreatedAt}}'` |
| Журнал релизов | GitHub Actions → «Deploy to Production» — в каждом запуске output `sha_tag` |
| ghcr.io | Packages → `<repo>` → versions (теги `sha-*` и `migrator-sha-*`) |
| Реестр инцидентов | `app_incidents.fix_commit`/note прошлых откатов, `last_version` инцидентов |

## 3. База данных: почему нет авто-downgrade (§9)

- Ledger-мигратор **не откатывает** миграции — повторный прогон на том же SHA всегда no-op (это проверяет CI-гвард `migrations-pg18`), а «отмена» файла миграции не удаляет применённые объекты и записи `schema_migrations`.
- **Expand-contract стратегия** — единственная безопасная дисциплина изменений схемы:
  1. **Expand**: миграция только добавляет (новые таблицы/nullable-колонки/индексы; backfill отдельным шагом) и совместима со **старым** кодом — откат приложения на предыдущий SHA после такой миграции безопасен.
  2. **Contract** (удаление/переименование/ужесточение NOT NULL) — отдельный, **последующий** релиз, только когда предыдущая версия кода уже не используется (иначе откат кода ломается о схему).
- Правило для разработчика: любой PR, меняющий схему, либо expand-only, либо явно указывает в описании парный contract-шаг и окно совместимости.
- Поэтому **Git revert миграции запрещён** как способ «отката БД»: он не возвращает ни схему, ни данные.
- Перед откатом приложения после недавнего релиза с миграциями — проверить характер последних применённых миграций (список `schema_migrations` против git-истории): если среди них был contract-шаг, откат кода на более старый SHA может быть несовместим со схемой — тогда путь только через §4.

```bash
# пример проверки: какие миграции применены последними (на VPS)
docker exec -it <db-контейнер> psql -U postgres -d conditera \
  -c "SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;"
# и их содержимое в git: git log --oneline -- supabase/migrations/ | head
```

## 4. Восстановление данных = restore из бэкапа

Если повреждаются сами данные (не схема) — единственный путь: восстановление из проверенного бэкапа по BACKUP_RECOVERY.md §5 (восстановление в новую БД, трёхсторонняя сверка счётчиков, переключение `DATABASE_URL`, smoke). Учтите окно потери (RPO, D-EXT-5) и обязательную регистрацию действий в инциденте. Если откат потребовался из-за порчи данных миграцией — сначала §2 (предыдущий код), затем §4 (данные из бэкапа); схему вручную «не понижать» без expand-contract-анализа.

## 5. Откат на staging

Тот же механизм, что §2, на `/opt/conditera-staging` (staging-deploy.yml):
```bash
WEB_IMAGE=ghcr.io/<repo>:sha-<prev7> docker compose up -d --no-deps web
curl -sf http://127.0.0.1:3000/api/health | grep '"status":"ok"'
```
Staging-БД при необходимости пересоздаётся из `backup-staging.sh`; ledger forward-only действует так же.

## 6. Чек-лист после отката

- [ ] `/api/health` показывает версию откатившегося SHA.
- [ ] Новый поток ошибок в `app_error_events` не растёт (админ-метрики: события 1ч/24ч, http5xx — MONITORING.md §2).
- [ ] Инцидент переведён FIXED → VERIFIED → CLOSED; `fix_commit`/note содержат SHA отката.
- [ ] Причина сбоя задокументирована; для миграционных релизов — отражён expand/contract-анализ.
- [ ] Повторный релиз — только после исправления и полного зелёного CI (CI_CD.md).
