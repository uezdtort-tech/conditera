# DOCKER GATE — статический ревью (HEAD da11451) + доказательство недоступности движка

**Дата:** 2026-10-15 · **HEAD:** `da11451022655469061e817edb5ac23f09e32349` (main, дерево чистое)
**Статус:** этот документ — статический ревью + протокол недоступности. Он НЕ заменяет
`docker compose config` и реальные `docker build` (мандат PROMPT §4 п.1: «не имитируй сборку»).

## 1. Протокол недоступности Docker (BLOCKED, не PASS)

| Проверка | Результат |
|---|---|
| `command -v docker` | exit 1 — отсутствует |
| `docker --version` / `docker compose version` / `docker info` | невыполнимы (нет CLI) |
| Альтернативы: podman, nerdctl, buildah, kaniko, containerd, dockerd | все отсутствуют |
| `/var/run/docker.sock` | не существует |
| `sudo` | недоступен (uid=1001(z), пароль не настроен) |
| `apt-get` | есть, но установка требует root |
| **Возможность запуска dockerd даже при наличии бинарника** | **нет**: `cap_sys_admin` НЕ входит в bounding set (`capsh --print`, /proc/self/status) — mount/namespace операции dockerd невозможны на уровне ядра (KATA_CONTAINER=true, изолированный контейнер) |
| unprivileged userns (`unshare --user --map-root-user`) | доступен — но это не даёт движок: podman/buildah требуют системной установки (root), статических бинарников нет |
| `DOCKER_HOST` | не задан; только переменные песочницы (KATA_CONTAINER, FC_CONTAINER_ID) |

**Минимальное действие для снятия блокировки:** запустить владельцу в среде с Docker Engine
и доступом к public.ecr.aws / registry-1.docker.io / ghcr.io / github.com:

```bash
docker compose config
SHA="$(git rev-parse --short HEAD)"
docker build -f Dockerfile -t "conditera:${SHA}" .
docker build -f Dockerfile.chat -t "conditera-chat:${SHA}" .
docker build -f Dockerfile.simplex-bridge -t "conditera-simplex-bridge:${SHA}" .
```

Примечание: `${POSTGRES_PASSWORD:?}`-стиль интерполяции требует .env.production (или экспорта
обязательных переменных — список в §4) даже для `docker compose config`.

## 2. Ревью Dockerfile (все COPY-источники проверены на HEAD)

### Dockerfile (web) — 4 стадии deps→builder→migrator→runner
- Базовые образы: `public.ecr.aws/docker/library/node:20-alpine`, `postgres:16-alpine` (политика зеркал fa9c9b8 против Docker Hub 429 — соблюдена).
- `bun install --frozen-lockfile` с копированием `bun.lock` ДО установки — детерминированное дерево.
- COPY-источники НА МЕСТЕ: package.json, bun.lock, .npmrc, supabase/migrations/, seed.sql, seed_cms_crm.sql, seed_fillings.sql, supabase/init-scripts/01-apply-migrations.sh.
- `output: "standalone"` подтверждён в next.config.ts:9 → COPY .next/standalone валиден.
- runner: USER nextjs (uid 1001) ✓, dumb-init ✓, HEALTHCHECK /api/health ✓, PORT 3000/HOSTNAME 0.0.0.0 ✓, upload/ и backups/ chown ✓.

### Dockerfile.chat
- COPY-источники НА МЕСТЕ: mini-services/chat-server/{package.json, bun.lock (4730 B), index.ts (45951 B)}.
- `bun install --production --frozen-lockfile` после lockfile ✓. USER chat ✓, dumb-init ✓, HEALTHCHECK /health:3030 ✓.

### Dockerfile.simplex-bridge
- COPY-источники НА МЕСТЕ: mini-services/simplex-bridge/{package.json, bun.lock (6645 B), index.ts (12942 B)}.
- BUILD-TIME сетевая зависимость: wget simplex-chat CLI v6.2.0 с github.com/releases + ELF-проверка — сборка требует egress на github.com.
- ⚠ Контейнер работает как root (USER не задан) — задокументировано как рекомендация (без Docker-fix тест невозможен).
- CMD: dumb-init + sh -c (simplex-chat CLI фоном → bun index.ts), HEALTHCHECK :5226/health ✓.

## 3. Ревью docker-compose.yml (12 сервисов, pyyaml-парс OK)

- Сервисы: migrator, web, db, pgbouncer, meilisearch, redis, chat-service, n8n, caddy, smp-server*, simplex-bridge*, mailu* (* = profiles simplex/mail/full — опциональны).
- Все три build-блока: context `.` + правильные Dockerfile (web target: runner, migrator target: migrator). CI (ci.yml:142–171) собирает ровно эти 3 образа, tags по github.sha, push:false, cache gha — соответствие полное.
- depends_on-условия: web→migrator (service_completed_successfully), pgbouncer/redis/meilisearch (service_healthy); chat→redis; caddy→web+chat; migrator→db. Все ссылки разрешаются в существующие сервисы.
- Внутренние адреса согласованы: db:5432, pgbouncer:5432, redis:6379, meilisearch:7700, web:3000 (NEXT_API_URL=http://web:3000), ws://localhost:5225, healthchecks на localhost.
- Секреты: только ИМЕНА ключей в environment; значения через `${VAR:?required}` fail-fast или env_file .env.production; `.dockerignore` исключает `.env*` (кроме .env.example) — утечки в build context нет.
- Ресурсные лимиты у всех сервисов; logging json-file rotate; volume postgres_data_v18 (защита от PG16→18 конфликта); сеть conditera-net bridge.
- db НЕ публикует порт (expose only); наружу: 80/443 (caddy), 3000 (web), 6432 (pgbouncer админ), 7700 (meili studio — помечено «закрыть firewall»), 5223 (smp), 25/465/587/993/8081 (mailu, профиль mail).

## 4. Находки для handoff (не блокируют сборку образов; требует решения/действий владельца)

1. **`MEILISearch_URL` (compose:67) не читается кодом.** Код (src/lib/meilisearch.ts:33) читает `MEILI_HOST || MEILI_URL || localhost:7700` → в Docker-стеке поиск упал бы на localhost. Уже задокументировано ранее (worklog:8192/8200) как drift с рекомендацией «убрать MEILI_* вовсе»; варианты (переименовать в MEILI_URL vs удалить сервис) — решение владельца. На image builds НЕ влияет (env compose — runtime).
2. **mailu.env отсутствует** при `env_file: mailu.env` у профильного сервиса mailu (profiles: mail/full). В дефолтном профиле сервис не активен; перед `--profile mail`/`full` нужно создать mailu.env (и учесть mailu/certs bind — создастся docker'ом при запуске).
3. **Обязательные интерполяционные переменные** (fail-fast `:?`): POSTGRES_PASSWORD, MEILI_MASTER_KEY, JWT_SECRET, CRON_SECRET, N8N_ADMIN_PASSWORD, SIMPLEX_BRIDGE_API_KEY. Полный список секретов — шаблон `.env.production.example` (в репо).
4. **CI не передаёт `build-args: GIT_SHA=${{ github.sha }}`** → APP_VERSION=unknown в CI-образах (Dockerfile имеет ARG-дефолт). Косметика: /api/health не покажет SHA.
5. `pgbouncer/pgbouncer:latest` — непиннутый тег с Docker Hub (остальные сторонние пиннуты: meilisearch v1.12, n8n 1.95.0, smp-server v7.0.1; mailu 3.3 из ghcr).
6. Мелочь: migrator-стадия использует psql 16 (postgres:16-alpine) против db postgres:18-alpine — совместимо (клиент старее сервера), но версионное расхождение стоит синхронизировать при случае.

## 5. Восстановление защищённых маршрутов (до ревью)

Оба upload-маршрута были удалены в рабочем дереве (некоммичено, поверх чистого da11451 — дрифт среды,
аналог DRIFT #5 из runtime-gate-3). Восстановлены точечно: `git restore -- src/app/api/upload/route.ts
src/app/api/services/upload/route.ts`. Доказательство удаления ДО восстановления: `pre-restore-deletion-diff.txt`
(рядом, 162 строки). Дерево чистое, оба файла = HEAD-версии.
