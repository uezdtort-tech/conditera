# DEV-14 — simplex-bridge non-root: реализация (Release Gate v4.1, Этап 3, Task ID: C-2)

- HEAD на момент реализации: `1a19c29` (2026-10-15), ветка `main`
- Исполнитель: агент C-2. Docker в песочнице **BLOCKED** — рантайм-верификация
  T1–T6 остаётся за Docker-гейтом владельца (см. §5, §6); CI соберёт образ
  после publish (`.github/workflows/ci.yml`, job `docker-build`, шаг
  «Build simplex-bridge image», ci.yml:167–175 — шаг существовал до этого
  изменения и не менялся).

## 0. Замечание по имени файла оценки

Задание ссылается на `simplex-bridge-nonroot-assessment-82ae685.md`. Файл в
репозитории называется `simplex-bridge-nonroot-assessment-001c4ff.md` — это
**тот же документ**: конвенция именования evidence — суффикс = short-HEAD на
момент написания (оценка писалась при HEAD `001c4ff`), а `82ae685` — коммит,
которым она была создана. Проверено: `git log -- docs/evidence/release-gate/
simplex-bridge-nonroot-assessment-001c4ff.md` → единственный коммит `82ae685`
«docs(security): simplex-bridge non-root assessment — owner risk decision
required (DEV-14)».

## 1. Ре-верификация оценки v4.0 против текущего состояния

`git diff 82ae685..HEAD -- Dockerfile.simplex-bridge docker-compose.yml
Dockerfile Dockerfile.chat` → **пусто** (0 строк) — все четыре файла не менялись
с момента оценки; дрейфа нет, факты оценки воспроизведены по текущим файлам:

| Факт из оценки v4.0 | Проверка на HEAD `1a19c29` | Источник (текущие строки) |
|---|---|---|
| Bridge работал под **root** (нет USER) | До изменения: `USER` отсутствовал во всём файле | Dockerfile.simplex-bridge (весь файл до правки) |
| FROM node:20-alpine (по умолчанию root) | `FROM public.ecr.aws/docker/library/node:20-alpine` | Dockerfile.simplex-bridge:19 |
| Процессы: simplex-chat CLI + bun bridge | CMD без изменений | Dockerfile.simplex-bridge:61–62 |
| Порты 5225 (CLI WS) / 5226 (bridge HTTP), оба >1024 | ENV/EXPOSE без изменений | Dockerfile.simplex-bridge:51–54 |
| Публикации портов наружу нет | `ports:` у сервиса отсутствует | docker-compose.yml:453–489 |
| Записи на рантайме: /app/simplex.db (+wal/shm), $HOME/.simplex | CMD создаёт базу при старте; кэш bun — только при install | Dockerfile.simplex-bridge:62; index.ts не пишет в ФС |
| Volumes у сервиса НЕТ | секция `volumes:` отсутствует (docker-compose.dev.yml не при чём) | docker-compose.yml:453–489 |
| Healthcheck wget localhost:5226/health (Dockerfile + compose) | без изменений | Dockerfile.simplex-bridge:57–58; docker-compose.yml:473–478 |
| Entrypoint-скриптов нет; dumb-init работает под non-root | dumb-init из apk, без chown/su-логики | Dockerfile.simplex-bridge:26,61 |
| bun install только на сборке | `RUN bun install --frozen-lockfile` до USER | Dockerfile.simplex-bridge:37 |
| Конвенции соседей: web `USER nextjs`, chat `USER chat` | без изменений | Dockerfile:110; Dockerfile.chat:35–37 |
| compose: profiles [simplex,full], env_file .env.production, depends_on smp-server+web healthy | без изменений | docker-compose.yml:459–472 |

Дополнительно (не в оценке, для полноты): у сервиса **нет** `user:`,
`cap_add`, `privileged` (compose не форсирует root — управляет USER из
Dockerfile); `env_file: .env.production` не содержит ключей `USER=`/`HOME=`
(в шаблоне `.env.production.example` их нет — grep, §4).

## 2. Изменение (before/after)

Единственный изменённый файл — `Dockerfile.simplex-bridge`. Содержательная
часть — ровно 3 строки из оценки v4.0 (§3 diff-скетч), плюс комментарии в
конвенции changelog-заголовка файла (v2/v3 → v4). Порты, CMD/entrypoint
(dumb-init), healthcheck, поведение bridge — **не менялись**; compose-правок
**нет** (оценка: «compose-изменения НЕ требуются»).

```diff
--- a/Dockerfile.simplex-bridge
+++ b/Dockerfile.simplex-bridge
@@ -12,6 +12,10 @@
 
 # v3 (registry-hardening): oven/bun публичных зеркал не имеет, а Docker Hub ловит
 # 429 в GH Actions — берём node из public.ecr.aws и ставим bun CLI из npm (musl).
+# v4 (non-root, DEV-14): рантайм (simplex-chat CLI + bun bridge) работает как
+# пользователь node — конвенция web (USER nextjs) и chat-server (USER chat).
+# Оценка и чек-лист владельца T1–T6:
+#   docs/evidence/release-gate/simplex-bridge-nonroot-assessment-001c4ff.md
 FROM public.ecr.aws/docker/library/node:20-alpine
 
 WORKDIR /app
@@ -35,6 +39,14 @@ RUN bun install --frozen-lockfile
 # Код bridge
 COPY mini-services/simplex-bridge/index.ts ./
 
+# Non-root (DEV-14): все сборочные шаги выше — под root; перед сменой
+# пользователя отдаём /app (включая /app/simplex.db, создаваемую CLI при
+# старте) пользователю node (uid 1000 из базового образа, HOME=/home/node).
+# Порты 5225/5226 > 1024 и healthcheck-wget привилегий не требуют.
+RUN chown -R node:node /app
+USER node
+ENV HOME=/home/node
+
 # Конфигурация SimpleX CLI (профиль, опции)
 ENV SIMPLEX_CLI_PORT=5225
 ENV BRIDGE_PORT=5226
```

Зеркалирование конвенций: как в `Dockerfile.chat` — `chown -R` на /app,
затем `USER` (chat: `addgroup/adduser` + `chown -R chat:chat /app` +
`USER chat`, Dockerfile.chat:35–37); как в `Dockerfile` — финальный
непривилегированный пользователь (`USER nextjs`, Dockerfile:110). Отличие:
пользователь `node` уже существует в базовом образе node:20-alpine (uid 1000,
HOME=/home/node) — `adduser` не нужен; `ENV HOME=/home/node` задаётся явно
(по оценке v4.0 §3), чтобы `simplex-chat` гарантированно писал состояние в
`/home/node/.simplex`, а не в `/`.

## 3. Статические проверки (выполнены в песочнице, без docker)

### 3.1 Порядок директив Dockerfile (FROM → root-шаги → chown → USER → ENV/…)

```
$ rg -n "^(FROM|WORKDIR|RUN|COPY|ENV|USER|EXPOSE|HEALTHCHECK|CMD|ARG)" Dockerfile.simplex-bridge
19:FROM public.ecr.aws/docker/library/node:20-alpine
21:WORKDIR /app
26:RUN apk add --no-cache dumb-init wget ca-certificates file && \
35:COPY mini-services/simplex-bridge/package.json ./
36:COPY mini-services/simplex-bridge/bun.lock* ./
37:RUN bun install --frozen-lockfile
40:COPY mini-services/simplex-bridge/index.ts ./
46:RUN chown -R node:node /app
47:USER node
48:ENV HOME=/home/node
51:ENV SIMPLEX_CLI_PORT=5225
52:ENV BRIDGE_PORT=5226
54:EXPOSE 5226
57:HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
61:CMD ["dumb-init", "sh", "-c", \
```

- `RUN chown` (строка 46) **строго до** `USER node` (строка 47): `chown_line=46
  user_line=47` → `ORDER_OK`.
- `USER` ровно один (`rg -c "^USER "` → 1); все привилегированные шаги (apk,
  npm -g, wget CLI, bun install) — до него. Аргументов `ARG` нет (не требуются).
- Линии-продолжения `\` в RUN/HEALTHCHECK/CMD не затронуты (правка — точечные
  вставки между существующими директивами).

### 3.2 Совместимость с docker-compose.yml (YAML-парс + assertions, python3+pyyaml)

```
PASS compose parses as valid YAML -- services=12
PASS service present -- docker-compose.yml:simplex-bridge
PASS no user: override (stays root-free per Dockerfile USER) -- user=<absent>
PASS no volumes (no root-owned host mounts to chown) -- volumes=<absent>
PASS profiles unchanged [simplex, full] -- ['simplex', 'full']
PASS build dockerfile unchanged -- {'context': '.', 'dockerfile': 'Dockerfile.simplex-bridge'}
PASS healthcheck CMD wget localhost:5226/health unchanged -- ['CMD','wget','-qO-','http://localhost:5226/health']
PASS no privileged/cap_add -- cap_add=<absent> privileged=<absent>
PASS depends_on unchanged (network-only deps) -- ['smp-server', 'web']
PASS env vars unchanged (no USER/HOME injection from compose) -- [SIMPLEX_CLI_WS=…, BACKEND_WEBHOOK=…, BACKEND_API_KEY=…, SIMPLEX_PROFILE_NAME=…, NODE_ENV=production]
```
(exit 0; compose не переопределяет пользователя в root, томов у сервиса нет —
chown внутри образа покрывает всю запись: /app + $HOME)

### 3.3 Отсутствие переопределений пользователя где-либо

```
$ rg -n "^\s*user:" docker-compose.yml            → 0 совпадений (exit 1)
$ rg -n "^(USER|HOME)=" .env.production.example   → 0 совпадений (exit 1)
```

### 3.4 wget для non-root (healthcheck) — статический анализ пути бинарника

- Бинарник ставится явным `apk add --no-cache … wget …` (Dockerfile.simplex-bridge:26)
  → `/usr/bin/wget`, root:root 0755 — исполняем любым пользователем; PATH
  пользователя `node` в node:20-alpine стандартно включает `/usr/bin`
  (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`).
- Healthcheck в compose — exec-форма `["CMD", "wget", …]` → поиск по PATH от
  имени процесса (после USER — это node). В Dockerfile — shell-форма `CMD wget
  …` → `/bin/sh -c` от того же пользователя; привилегий localhost-HTTP не требует.
  Выполнение healthcheck от non-root идентично процессу — это уже доказанная в
  репо конвенция: `Dockerfile.chat` = `USER chat` (37) + тот же wget-healthcheck
  (42–43), и `Dockerfile` = `USER nextjs` (110) + wget `/api/health` (115–116).
- Удалённый бинарник `/usr/local/bin/simplex-chat` — root:root, `chmod +x`
  (0755) — исполняем пользователем node; запись он делает только в
  `/app/simplex.db*` (покрыто chown) и `$HOME/.simplex` (=/home/node, владелец
  node в базовом образе). Рантайм-подтверждение — T3/T6 владельца.

## 4. Честный объём верификации (БЕЗ docker)

- **Сделано здесь (статика):** порядок/состав директив Dockerfile (§3.1),
  YAML-парс compose + 10 assertions совместимости (§3.2), отсутствие
  user:/HOME-переопределений (§3.3), анализ доступности wget/бинарников для
  non-root (§3.4), неизменность портов/CMD/healthcheck/поведения.
- **НЕ сделано (BLOCKED):** сборка образа и рантайм T1–T6 — docker в песочнице
  недоступен (см. `docker-engine-check-671f82a.txt`, задача явно помечает Docker
  как BLOCKED; установку не предпринимать). Образ будет собран CI после publish
  (ci.yml `docker-build`, шаг `Build simplex-bridge image` уже существует) и
  рантайм-проверен владельцем по чек-листу §5. Это соответствует оценке v4.0:
  «рантайм-проверка в песочнице невозможна: docker BLOCKED».

## 5. Чек-лист владельца T1–T6 (маппинг тестов оценки v4.0 на точные команды)

Машина владельца, репо на этом коммите, `.env.production` заполнен
(`SIMPLEX_BRIDGE_API_KEY` задан). Контейнер: `conditera-simplex-bridge`.

| # | Тест (оценка v4.0 §3) | Команда владельца | Ожидаемый результат |
|---|---|---|---|
| T1 | Образ собирается | `docker compose --profile simplex build simplex-bridge` | Сборка доходит до `RUN chown -R node:node /app` → `USER node`; финальный образ без ошибки. Сбой на chown/USER = регресс этой правки |
| T2 | Контейнеры healthy | `docker compose --profile simplex up -d smp-server web simplex-bridge && docker compose --profile simplex ps` | `conditera-simplex-bridge` → healthy (start_period 30s); `conditera-smp`, `web` → healthy (зависимости `service_healthy` прошли — иначе up не поднимет bridge) |
| T3 | uid/владение ФС | `docker exec conditera-simplex-bridge sh -c 'id; echo HOME=$HOME; ls -la /app; ls -la /home/node/.simplex 2>/dev/null'` | `uid=1000(node) gid=1000(node)`; `HOME=/home/node`; `/app`, `/app/simplex.db*` (появились после старта) — владелец `node node`; `/home/node/.simplex` существует и принадлежит node (поверхность записи стороннего CLI — главный неизвестный оценки v4.0 §2.3, закрывается здесь) |
| T4 | Функциональный round-trip (изнутри сети compose; порт 5226 не публикуется наружу) | `docker exec conditera-simplex-bridge sh -c 'wget -qO- --header="X-Bridge-Api-Key: $BACKEND_API_KEY" --header="Content-Type: application/json" --post-data="{}" http://localhost:5226/api/create-profile'` затем `POST /send` с `{"contactName":"…","text":"…"}` | `POST /api/create-profile` → 200 (профиль создан CLI-процессом под node, база в /app/simplex.db доступна на запись); `POST /send` → сообщение уходит; входящее доходит до `${NEXT_PUBLIC_APP_URL}/api/simplex/incoming` (webhook backend) |
| T5 | Персистность при рестарте | `docker restart conditera-simplex-bridge && sleep 35 && docker exec conditera-simplex-bridge wget -qO- http://localhost:5226/health` + повтор запроса профиля/отправки | После рестарта health 200, профиль/контакты сохранились — non-root-процесс перечитал `/app/simplex.db*` (права не сломались) |
| T6 | Health + логи без EACCES/EPERM | `docker inspect --format '{{.State.Health.Status}}' conditera-simplex-bridge && docker logs conditera-simplex-bridge 2>&1 | grep -Eic 'EACCES|EPERM|permission denied'` | `healthy`; grep → 0 |

Откат при любом сбое T1–T6: удалить 3 строки (`RUN chown…`, `USER node`,
`ENV HOME=…`) и блок changelog-комментария v4 → rebuild (оценка v4.0 §4.4).

## 6. Что НЕ менялось (границы правки)

- `docker-compose.yml` — 0 правок (сервис, порты, healthcheck, env, profiles).
- `mini-services/simplex-bridge/index.ts` — 0 правок (поведение bridge то же).
- Порты 5225/5226, CMD (dumb-init + simplex-chat + bun), healthcheck — без
  изменений.
- `smp-server` (готовый образ `simplexchat/smp-server:v7.0.1`) — вне скоупа,
  как в оценке v4.0 (рекомендация про named volume для базы CLI — отдельное
  решение владельца, не смешивать).
