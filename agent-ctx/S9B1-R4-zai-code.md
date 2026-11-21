# ОТЧЁТ S9B1-R4 — zai-code (Деплой-конвейер: Docker/bun, CI, релиз)

Task ID: S9B1-R4 (redo после data loss). Агент: zai-code. Дата: 2026-11-21.
База: conditera-v2 @ af46b2f (S8B2 complete; dev :3100 healthy).
Ветка v2: main. Код: f0d948e. Docs: 8b81381. Спец-файл
docs/rebuild/prompts/S9B1-deploy.md на диске отсутствует (потерян вместе с
данными) — исполнение по полной спеке из задачи.

## 1. Файлы (все в conditera-v2, коммит f0d948e)

- `Dockerfile` — multi-stage bun: deps (bun install --frozen-lockfile) →
  builder (bunx prisma generate; bunx next build БЕЗ runtime-секретов) →
  runtime (oven/bun:1, non-root uid/gid 10001, COPY .next node_modules
  prisma public package.json + next.config.ts + entrypoint + verify-ledger,
  HEALTHCHECK curl /api/health, ENTRYPOINT docker-entrypoint.sh);
  порт 3000; curl ставится apt'ом только под HEALTHCHECK.
- `Dockerfile.chat` — образ транспорта чатов S6B1 (свой bun.lock,
  Prisma-клиент из корневой схемы приёмом dev-раскладки, non-root 10001,
  HEALTHCHECK GET /health, :3030 — только внутренняя сеть).
- `.dockerignore` — .env*, **/node_modules, .next, backups, .zscripts,
  .storage-data, .outbox, .pgdata, .git, .github, tests, логи, бандлы.
- `scripts/docker-entrypoint.sh` (+x, set -euo pipefail) — prisma migrate
  deploy → verify-ledger → exec next start -H 0.0.0.0 -p 3000.
- `docker-compose.prod.yml` — db (postgres:16-alpine, том pgdata,
  pg_isready healthcheck, внутренняя сеть), app (build ., env_file
  .env.prod, DATABASE_URL собирается compose'ом из POSTGRES_* на db:5432,
  CHAT_INTERNAL_ORIGIN=http://chat:3030, depends_on db healthy, порты
  127.0.0.1:3000:3000 — loopback), chat (Dockerfile.chat, внутренний),
  n8n (внутренний :5678; BASE_URL/CRON_SECRET/RECEIVER_URL/
  N8N_ENCRYPTION_KEY — все с гварами :?), caddy:2 (80/443, Caddyfile.prod
  ro-монтаж, тома data/config). Гварды ${VAR:?} на обязательных ключах;
  секреты ТОЛЬКО в .env.prod на хосте (gitignored); запуск — с явным
  `--env-file .env.prod`.
- `Caddyfile.prod` — плейсхолдер conditera.ru с авто-HTTPS; клиентские
  IP-заголовки перезаписываются реальным соединением (header_up
  X-Forwarded-For / X-Real-IP — доверенная грань, подделка rate-limit
  невозможна); активный health-check апстрима /api/health (200);
  /socket.io* → chat:3030; блок http://:80 — стенд до переключения DNS.
- `.github/workflows/ci.yml` — PR→main, push main, теги v*: bun setup
  (кеш по bun.lock) → install --frozen-lockfile → prisma migrate deploy
  на чистый postgres:16-alpine-сервис → tsc → lint → vitest → grep-гейт
  deploy-пути (подстрока системного CLI узловых пакетов отсутствует) →
  next build → docker build smoke (app + chat) → GHCR publish ТОЛЬКО на
  v*-тегах (ghcr.io/<owner>/<repo>:<tag>+latest, lowercase). Таймауты
  (timeout-minutes) на каждом длительном шаге; concurrency cancel-in-progress.
- `scripts/release.sh` (+x, set -euo pipefail) — см. §2.
- `docs/DEPLOY_RUNBOOK.md` — prose-only (0 env-литералов), см. §3.
- `next.config.ts` — минимальный твиик: turbopack.root условный
  (existsSync пути песочницы → репо, иначе cwd) — guard recreate-1
  сохранён, docker-сборка не ломается.
- `prisma/migrations/20261121190000_baseline_recreate3/migration.sql` —
  консолидированный baseline (52 таблицы); прежние 4 миграции удалены
  (см. §5 отклонения).

## 2. Релиз одной командой (release.sh)

- `./scripts/release.sh --dry-run` — префлайт (.env.prod + 10 обязательных
  ключей) и полный план, НОЛЬ мутаций.
- `./scripts/release.sh --deploy` — префлайт → require_docker →
  ОБЯЗАТЕЛЬНЫЙ pg_dump → backups/db-YYYYMMDD-HHMMSS.sql (первым шагом;
  дамп < 1 КБ = отмена; fail-closed exit 1 — «деплой без бэкапа
  невозможен») → compose pull (нефатально) / build → up -d → health-loop
  curl до 60 с → smoke: /api/health, /, /catalog, /login — все обязаны
  200 → запись .zscripts/last-release.txt (prev_image/git_sha/backup) →
  сводка. Любой отказ до/после up — exit 1 с подсказкой отката.
- `./scripts/release.sh --rollback` — печатает предыдущий образ и дампы
  + пошаговые инструкции восстановления (сам ничего не разрушает).
- Секретные значения нигде не печатаются (только имена ключей).

## 3. Runbook / чек-лист владельца (docs/DEPLOY_RUNBOOK.md)

- Первый деплой пошагово: предусловия → код на хост (clone/бандл) →
  .env.prod по парity-чек-листу → стенд (`--dry-run` → `--deploy`) →
  E2E золотые пути S3–S7 (маркет/каталог/отзывы; корзина→checkout→
  оплата→эскроу/выплаты; вендор/админ; чаты/поддержка; AI — fallback
  допустим) → переключение conditera.ru ТОЛЬКО по поручению владельца
  (DNS A conditera.ru → 185.218.111.176; ACME-сертификаты Caddy получает
  автоматически; после переключения обновить публичные URL и повторить
  deploy — новый обязательный дамп).
- Rollback — §3 runbook (release.sh --rollback + ручные шаги).
- Миграция auth.users/Storage старого Supabase (Admin API, бакеты,
  RLS из docs/supabase-rls-storage.sql) — ОТДЕЛЬНОЕ поручение владельца.
- Парity-чек-лист env-ключей — полный из .env.local.example,
  сгруппированный (имена; обязательные для стека помечены); внешние
  сервисы по порядку: YooKassa тест-контур first (боевой контур —
  PAYMENT_MODE/PAYMENTS_MODE по решению владельца), Метрика (боевой
  домен, ключ в SAFE_FETCH_ALLOWLIST), Telegram, Supabase (URL/anon/
  service-role/JWT), 7 бакетов (avatars, portfolios, products, recipes,
  documents, chat-attachments, cms), CRON_SECRET, INBOUND_SECRET,
  SAFE_FETCH_ALLOWLIST (prod fail-closed), N8N_ENCRYPTION_KEY, DNS.

## 4. Sandbox substitutions (docker CLI отсутствует — честно)

- `command -v docker` пусто (CLI и compose-plugin в песочнице нет) →
  `docker compose config` невыполним. Подстановка: структурная
  YAML-валидация compose (5 сервисов, тома, гварды :?, loopback-порты,
  depends_on healthy) python3+yaml — PASS; Caddyfile — структурно;
  полный docker-прогон остаётся за CI (docker build smoke) и машиной
  владельца — задокументировано в runbook §8.
- Prod-сборка (замена docker builder-стадии): keeper остановлен
  stop-handle, dev :3100 убит, `.next` удалён → `env -u DATABASE_URL
  bunx next build` → **exit 0**, полная таблица маршрутов (статика ○ /
  динамика ƒ), Proxy/Middleware собран. Dev перезапущен чисто (rm -rf
  .next, detached, health ok), n8n-receiver перезапущен (keeper снова
  активен), stop-handle убран. → builder-стадия Dockerfile и CI-шаг
  «Production build» считаются проверенными на этой же кодовой базе.
- release.sh proofs → `agent-ctx/s9b1-dryrun.txt`:
  --dry-run полный план exit 0; FAIL-CLOSED доказательства: --deploy
  БЕЗ .env.prod → exit 1; --deploy с .env.prod (временный файл с
  фиктивными значениями, удалён) БЕЗ docker CLI → exit 1 ДО мутаций;
  --rollback exit 0; неверный режим → exit 2. Примечание: первый прогон
  proofs был прерван таймаутом раннера агента (гигиена set -e внешнего
  скрипта) — артефакт пересобран пошагово, дубликат секции удалён; сам
  release.sh отработал корректно во всех режимах.
- npm-гейт: `grep -rni` по всем 7 deploy-файлам — совпадений нет
  (подстрока отсутствует в Dockerfile, Dockerfile.chat, entrypoint,
  compose, Caddyfile.prod, release.sh, .dockerignore); тот же гейт
  зашит в CI.

## 5. Отклонения (осознанные)

1. **Консолидация миграций в baseline.** Форензика: 4 прежних миграции
   покрывали 48 таблиц, схема — 52 (db push-дрейф: addresses,
   ai_conversations, inbound_emails, order_events + колонки S2–S8) —
   prod-путь «migrate deploy» на чистой БД создал бы НЕПОЛНУЮ схему.
   Baseline сгенерирован prisma migrate diff (from-empty → schema), его
   применение на свежую scratch-БД проверено (deploy чисто, diff vs
   schema пуст). Боевой БД не существует — первый деплой впереди,
   история консолидирована ДО него. Dev-БД :54330: записи
   _prisma_migrations консолидированы (wipe + migrate resolve --applied),
   ДАННЫЕ не тронуты; db:setup повторно — идемпотентно (сид/учётки на
   месте). Побочно зафиксировано fail-closed-поведение deploy на
   битой записи (рефьюс, транзакция откатилась, данные целы).
2. n8n-образ в compose — `latest` с явной инструкцией зафиксировать
   конкретный тег перед боем (верифицировать реальный тег в песочнице
   без docker нельзя; выдумывать несуществующий тег — фальсификация).
3. CSP strict/nonce — отдельное решение (комментарий S2B3 в headers.ts);
   в runbook — рекомендация strict для prod (unsafe-eval не нужен вне
   dev), nonce в спеке блока не значится.
4. Chat — отдельный лёгкий образ (не переиспользует app-node_modules):
   свой bun.lock + минимальный Prisma-клиент.
5. Времянный .env.prod для proofs содержал только фиктивные значения,
   после прогонов удалён; в артефакте значений нет (скрипт их не печатает).

## 6. Гейты (фактические)

- lint: 0 (exit 0); tsc: 0 (exit 0); vitest: 203/203 (11 файлов).
- Prod-build: exit 0 (env -u DATABASE_URL bunx next build, после rm -rf .next).
- release.sh: dry-run exit 0; fail-closed 2×exit 1; rollback exit 0; usage exit 2.
- npm-absence grep: чисто (0 совпадений по 7 файлам).
- Compose YAML: структурная валидация PASS.
- Renders (после рестарта dev и после docs-коммита): / → 200,
  /catalog → 200, /api/health → ok (status ok, database ok, auth ok,
  storage local, n8n ok). chat :3030 и приёмник :5678 живы.

## 7. Артефакты и пины

- v2 коммиты: f0d948e (код), 8b81381 (docs worklog, sha/bundle pinned).
- Бандл (создан СРАЗУ после docs-коммита):
  `/home/z/my-project/backups/conditera-v2-S9B1-f0d948e.bundle` —
  **1 619 662 bytes**; `git bundle verify`: complete history,
  main = 8b81381 (docs на базе f0d948e); HEAD-ссылка включена (git clone бандла восстанавливает main по умолчанию — clone-тест PASS). Трекинг корня: коммит backup (пересоздан с HEAD; add -f)
  (только файл бандла, add -f).
- Корневое bookkeeping: a3a7c7a — слиты «висящие» артефакты S8B2 сессии
  корня (root worklog + отчёт/матрица/скрины) — защита от потери данных.
- Артефакты: agent-ctx/s9b1-dryrun.txt (proofs release.sh + compose-проверка);
  настоящий отчёт agent-ctx/S9B1-R4-zai-code.md.
- Бандл-цепочка: S8B2 af46b2f → S9B1 f0d948e/8b81381. Следующий блок:
  **S9B2 — FINAL** (health-матрица, recover.sh, бэкап-задача реестра,
  финальная сводка владельцу).
