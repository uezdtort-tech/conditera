# CI_ACCEPTANCE — приёмка CI/CD (Z-v21)

**Дата:** 2026-11-10 · **HEAD на момент аудита:** `1505c0b` (+ коммиты Z-v21)

## 1. Инвентарь workflows (фактически проверено парсингом YAML)

| Файл | Триггеры | Фильтры веток | Секреты |
|---|---|---|---|
| `ci.yml` | push, pull_request | `[main, develop]` | не требует (автономен) |
| `deploy.yml` | **только workflow_dispatch** (авто-деплой на push отключён намеренно) | — | GITHUB_TOKEN, SSH_*, REGISTRY_TOKEN, POSTGRES_PASSWORD, TELEGRAM_*, Supabase публичные |
| `e2e.yml` | schedule (03:00 UTC nightly), push/PR по paths, dispatch | `[main, develop]` | TELEGRAM_* (только notify) |
| `maintenance.yml` | schedule (04:00 UTC), dispatch | — | MAINTENANCE_*, STAGING_* |
| `staging-deploy.yml` | workflow_run (после успешного CI на main), dispatch | `[main]` | STAGING_HOST/SSH_KEY/APP_URL |

Проверка структуры: `permissions: contents: read` на верхнем уровне ci.yml; job-уровневые permissions только в deploy.yml (`packages: write` для ghcr). Опасных прав (`id-token` в свободном доступе, write-all) нет. `continue-on-error` — ровно 1 (coverage-шаг, как задокументировано в шапке).

### Важное методологическое замечание (инструментальный артефакт сессии)

Первичный осмотр через `cat`/`sed`/`rg` показал «порчу» branch-фильтров (`ain, develop]`). **Проверка байтов через `od` и YAML-парс показала: файлы на диске корректны** (`[main, develop]`). Искажение — артефакт выходного канала сессии (вырезание литерала `[m`). Вывод: все branch-фильтры валидны; впредь любой вывод с квадратными скобками проверять guard-методом (замена `[` → маркер) или `od`.

## 2. Локальные эквиваленты CI (фактически выполнены в этой сессии)

| CI-джоб | Локальный эквивалент | Результат |
|---|---|---|
| lint-typecheck | `bun run typecheck` → `tsc --noEmit`; `bun run lint` → eslint | **PASS / PASS** |
| test | `bunx vitest run --no-file-parallelism` | **PASS: 109 файлов / 1571 теста** (после восстановления защищённых файлов штатным pre-commit guard; см. §4) |
| build | `next build` (turbopack и webpack) | **НЕ ВЫПОЛНИМ в песочнице**: kernel OOM-killer убивает `next-build` при ~2 GB RSS (cgroup-лимит контейнера ~3.9 GB; подтверждено `dmesg`). Требуется CI-раннер (7 GB) |
| migrations-pg18 | `bun run db:setup` на чистом embedded PG 18.4 + повторный прогон | **PASS** (79 миграций, идемпотентно, 248 таблиц) |
| evidence-hygiene | `node scripts/scan-evidence.mjs` + `scan-evidence-rules-verify` + `production-env-template` + `route-error-coverage` | **PASS** (0 реальных секретов; контракт env-шаблона OK; route coverage 47/47 + 1 задокументированно отсутствующий) |
| docker-build | — | НЕ выполним (нет Docker Engine в песочнице) |
| deps-audit | — | не запускался локально (osv-scanner требует сеть/бинарь) |

## 3. Что требует GitHub

- Фактический запуск workflows (ни один из 5 не запускался на GitHub с последними локальными коммитами — 225+ коммитов не опубликованы). **Заявлять «CI зелёный» нельзя до фактического запуска после push.**
- docker-build (3 образа + secret-gate) и полный `next build` — только на раннерах GitHub.
- Настройка secrets для e2e.yml/maintenance.yml/staging-deploy.yml — опционально (без них джобы деградируют честно).

## 4. Инцидент Z-v21: drift защищённых файлов и автосрабатывание guard

В начале сессии 4 защищённых upload-файла отсутствовали на диске (recurring drift-класс #8–#17). Из-за этого redline-тест падал (4 failed), а полный набор был 1552 теста. При коммите Z-v21 (`git add -A` застейджил удаления) **pre-commit guard `protected-paths.sh hook-guard` автоматически восстановил блобы в index и рабочее дерево** — коммит ушёл без удалений. Итог: файлы на диске, suite 1571/1571 PASS. Ручного восстановления не выполнялось (запрещено §0.2) — сработал штатный механизм репозитория.

Рекомендация: запускать `bash scripts/protected-paths.sh skip-on` в начале сессии (через ensure-dev.sh) — чтобы UUID-snapshotter не индексировал удаления (первопричина класса инцидентов).

## 5. Вывод

- Статическая конфигурация CI: **валидна** (YAML, триггеры, права, автономность от секретов).
- Локальные эквиваленты: **PASS** (кроме build/docker — ограничения среды, не кода).
- Фактический CI на GitHub: **NOT RUN** (нужен push по разрешению владельца).
