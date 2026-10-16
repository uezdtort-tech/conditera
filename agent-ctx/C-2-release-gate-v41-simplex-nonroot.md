# C-2 — Release Gate v4.1 (Этап 3): simplex-bridge non-root + config re-verification

Agent: Z.ai Code (C-2) · Base: main @ `1a19c29` · Commits: `7bcf817` (Part 1), `50214d6` (Part 2) · Push: НЕ выполнялся
Предыдущие записи: см. `agent-ctx/6-a-production-config.md` (DEV-12/13/15/16 — контракты v4.0), `B-1-release-gate-checkout-idempotency.md`.

## Part 1 — DEV-14: simplex-bridge non-root (коммит `7bcf817`)

- Оценка v4.0 (`simplex-bridge-nonroot-assessment-001c4ff.md`; в задании упомянута как «-82ae685» — это коммит её создания, файл назван по HEAD написания) ре-верифицирована: `git diff 82ae685..HEAD` по 4 docker-файлам → пусто, дрейфа нет; факты совпадают построчно.
- Реализация — ровно 3 строки из оценки §3 в `Dockerfile.simplex-bridge` (после COPY index.ts, все root-шаги сборки выше):
  ```dockerfile
  RUN chown -R node:node /app
  USER node
  ENV HOME=/home/node
  ```
  + changelog-комментарий v4. Конвенции: web `USER nextjs` (Dockerfile:110), chat `adduser+chown+USER chat` (Dockerfile.chat:35–37); `node` (uid 1000, HOME=/home/node) уже в базовом node:20-alpine. Порты 5225/5226, CMD, healthcheck, compose, index.ts — БЕЗ изменений (compose-правок 0: у сервиса нет user:/volumes/cap_add).
- Статические проверки (docker BLOCKED): порядок директив (USER×1, chown:46 < USER:47), YAML-парс compose + 10 assertions → 10/10 PASS exit 0, grep user:/HOME-переопределений → 0, wget-путь /usr/bin/wget 0755 в PATH node (конвенция доказана Dockerfile.chat — USER chat + идентичный wget-healthcheck).
- Рантайм T1–T6 = Docker-гейт владельца (чек-лист с точными командами — в evidence); CI собирает образ после publish (ci.yml:167–175, шаг существовал).
- Evidence: `docs/evidence/release-gate/simplex-bridge-nonroot-impl-1a19c29.md` (NEW) + append-only аппендикс в v4.0-оценку. 3 файла, +232.

## Part 2 — re-verification контрактов v4.0 (коммит `50214d6`, 1 файл, правок кода НЕТ)

| Контракт | Вердикт | Доказательство |
|---|---|---|
| MEILI_URL на web (DEV-13) | PRESENT | compose:69 `- MEILI_URL=http://meilisearch:7700` (in-network); присваиваний MEILISearch_URL = 0 (остаток: compose:68 — комментарий самого фикса, worklog/agent-ctx — журналы) |
| GIT_SHA→APP_VERSION (DEV-15) | PRESENT | ci.yml:153 `GIT_SHA=${{ github.sha }}` на web-образе; Dockerfile:43-44/72-73 ARG+ENV |
| mailu.env (DEV-16) | PRESENT | compose:507-508 profiles [mail,full] + env_file; .gitignore:39; env-check.sh:208-221 advisory |
| .env.production.example (DEV-12) | PRESENT | verifier exit 0 (6 required: POSTGRES_PASSWORD, MEILI_MASTER_KEY, JWT_SECRET, CRON_SECRET, N8N_ADMIN_PASSWORD, SIMPLEX_BRIDGE_API_KEY); 14/14 непустых секретов = CHANGE_ME* |

Evidence: `docs/evidence/release-gate/config-reverify-v41-7bcf817.md`.

## Notes для следующих агентов

- НИЧЕГО не делать с `Dockerfile.simplex-bridge`/compose до прогонов T1–T6 владельцем; откат при сбое — удалить 3 строки.
- Не «чинить» MEILISearch_URL-упоминания в compose:68/worklog — это намеренные исторические/контрактные комментарии.
- worklog.md и agent-ctx/C-2-*.md оставлены НЕ закоммиченными (скоуп задания — ровно 2 коммита).
