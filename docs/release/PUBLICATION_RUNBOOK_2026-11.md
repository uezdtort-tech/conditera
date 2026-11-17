# Publication Runbook — ноябрь 2026 (дельта 306 коммитов)

Статус: READY FOR OWNER PUSH (локальные гейты зелёные; финальный build-гейт — CI)
Автор: Super Z, 2026-11-18. Коммит-якорь: f1ace2a (HEAD локального main)

## 1. Что публикуем (дельта origin/main..HEAD = 306 коммитов)

| Категория | Кол-во | Ключевое |
|---|---|---|
| fix | 82 | P0 auth root-cause (b061552: fail-closed blocked-check, XSS-санитизация писем, timing-safe cron-secret, fallback 409), hydration, pgrst pool, video-feed, a11y |
| feat | 23 | дизайн-2025 (c6b38fd + 2d3ac60 + f1ace2a: унификация 7 витрин), AI-сценарии (умный поиск, сравнение, «Помочь выбрать»), Ollama-провайдер LLM, цена-история (PR-1..7) |
| docs | 56 | инженерная синхронизация A–G, release-гейты, риски, роадмап |
| ops/test/chore/ci/perf | 46 | инфраструктура, тесты, CI-гейты |

Новые миграции: **0081–0086** (26 файлов, ~5128 строк SQL): атомарное списание/рецепты, CMS-версии+аудит, история цен продукта, price_version в заказах, срок офферов, фиксы price history. Применяются деплой-пайплайном автоматически (ledger `01-apply-migrations.sh`, fail-fast, только неотмеченные в `schema_migrations`).

## 2. Локальные гейты (выполнены, доказательства)

- **tsc**: 0 ошибок (2026-11-18, HEAD f1ace2a)
- **vitest**: полный прогон 1922/1922 PASS (последний зафиксированный полный прогон; изменённые страницы повторно 13/13)
- **eslint**: 0/0 (после фикса игнора mobile-app — см. §6.1; ранее 3 ошибки в архивной зоне)
- **agent-browser E2E**: регистрация 201/автовход 200 (прошлые сессии); дизайн-7 витрин verified (светлая/тёмная/375px/1440px, скриншоты agent-ctx)
- **production build локально**: НЕВОЗМОЖЕН — документированное ограничение платформы (KNOWN_LIMITATIONS §1.1: cgroup ~3.9GB, OOM-killer при ~2GB RSS, turbopack и webpack). Попытка 2026-11-18 подтвердила (build-prod-20261118.log, «Killed»). Build-гейт выполняет GitHub Actions job `build` (7GB runners) — это норма процесса, не блокер.

## 3. Путь публикации (владелец)

1. **Восстановить прод-инфраструктуру** (СЕГОДНЯШНИЙ ИНЦИДЕНТ, до push):
   - Факт 21:02Z: Caddy отдаёт **502 на все маршруты** (www+apex), backend Next не отвечает; TLS переключён на self-signed **Caddy Local Authority** (internal, срок до 2026-11-18 08:25 GMT) вместо публичного LE (вчера: до 2027-02-12). Записей в production-watch.log: 2026-11-17T21:02Z FAIL.
   - Действия на прод-сервере: поднять контейнер Next (docker compose ps / logs next), проверить pgbouncer/БД; вернуть публичный TLS: в Caddyfile tls-блок должен вести ACME (LE) — проверить email/дНС-доступность, НЕ `tls internal`; после восстановления — smoke `curl https://conditera.ru/api/health`.
2. **Push**: `git push origin main` (306 коммитов; push выполняет владелец — агентам запрещён).
3. **CI-гейт**: пайплайн `ci.yml` (строгий): lint → typecheck → test → build (7GB, первый фактический production build) → docker-build (3 образа + compose validation + secret-gate по слоям) → security + evidence-hygiene. Красный CI = деплой не происходит, разбирать лог job'а.
4. **Деплой**: `deploy.yml` — автоматом на зелёный push в main (или workflow_dispatch вручную). Внутри: миграции (ledger, fail-fast) → rollout образов (SHA-тег) → healthcheck.
5. **Post-deploy smoke** (read-only, ~3 мин):
   - `/api/health` → status=ok, database=ok (auth может быть unreachable/unconfigured до env — см. §4)
   - Каталог: /api/products, /api/decor/products, /api/services, /api/builder/decor-shops, /api/recipes/marketplace → все 2xx
   - TLS: `openssl s_client -connect conditera.ru:443 -servername conditera.ru` → issuer публичный (LE/ZeroSSL), NOT публичный «Caddy Local Authority»
   - Регистрация нового тестового пользователя (прод-аккаунт-фикстура) → 201 + автовход 200
   - Дизайн: главная в браузере → mesh/антиква/градиент CTA (или по скриншотам agent-ctx/design-verify-*)
6. **Rollback** (если пост-деплой красный): docs/RELEASE-ROLLBACK-CHECKLIST.md (образы SHA-тегированы, миграции ledger — откат кода без откатa БД; новые миграции не деструктивны: добавляют таблицы/колонки).

## 4. Env-контракт прода (проверить до/после деплоя)

- Шаблон: `.env.production.example`; secret-gate CI проверит слои образов.
- **Новое с дельты**: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` (не обязательны: fail-safe → z-ai-web-dev-sdk → rule-based fallback; без Ollama AI-блоки работают через провайдер-цепочку).
- Не менять: существующие Production-секреты (JWT_SECRET ротировался отдельно — работа 2026-11, задокументирована); Supabase URL/keys; CRON_SECRET.
- `auth_gotrue`: на проде вчера был reachable/200 — после передеплоя регистрация должна работать без «auth fail-closed 500» (фикс b061552 + GoTrue жив).

## 5. Риски публикации (из ENGINEERING_RISKS.md + свежие)

- R13: upload-файлы лежат на эфемерном диске web-контейнера — при rollout образа пользовательские загрузки теряются; до деплоя: бэкап upload-томов на проде (если есть контент).
- Миграции 0081–0086: идемпотентный ledger, fail-fast; на живой БД с данными — применяются только добавления (проверено дизайном миграций), но перед деплоем — pg_dump снапшот (шаг из BACKUP_RECOVERY_READINESS).
- Двойной auth-механизм: после деплоя проверить связку app-JWT ↔ GoTrue на проде (health auth=ok + тестовая регистрация). Глубокая консолидация — задача Z (архитектура выбрана, отчёт AUTH_ROOT_CAUSE_REPORT.md).
- Сегодняшний 502-инцидент: если backend не поднимется и после рестарта — разбирать вне рамок этого runbook (логи контейнера Next на проде).

## 6. Что уже сделано в этой подготовке (коммиты в дельте)

1. `eslint.config.mjs`: `mobile-app/**` добавлен в игноры — консистентно с архивацией 74c12f0 (NOT MAINTAINED, ZV31-015 CLOSED); устранило 3 lint-ошибки, которые ломали строгий CI lint job (блокер публикации). Код dead-zone не правился.
2. Дизайн-унификация f1ace2a (7 витрин) — входит в дельту.
3. Верификации см. §2.

Пункты владельцу (не блокеры push, но до/сразу после деплоя): бэкап upload-томов; pg_dump перед миграциями; восстановление публичного TLS на Caddy (§3.1); заполнить регресс-чеклист после деплоя.
