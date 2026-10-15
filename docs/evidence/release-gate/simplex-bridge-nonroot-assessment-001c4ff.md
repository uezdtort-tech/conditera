# DEV-14 — simplex-bridge: оценка перехода на non-root (P1)

- HEAD на момент оценки: `001c4ff` (2026-10-15)
- Вердикт: **требуется решение/риск-акцепт владельца** — реализация НЕ выполнялась
  в этой сессии (рантайм-проверка в песочнице невозможна: docker BLOCKED, см.
  `docker-engine-check-001c4ff.txt`); ниже — точный план изменения и обязательные
  рантайм-тесты. Полу-реализация («изменили Dockerfile без проверки») запрещена
  дисциплиной гейтов репозитория.
- Область: `Dockerfile.simplex-bridge` (весь) + сервис `simplex-bridge`
  (docker-compose.yml:453–489). Соседний `smp-server` (готовый образ
  `simplexchat/smp-server:v7.0.1`, compose:422–450) — вне этого Dockerfile,
  отмечен отдельно.

## 1. Текущее состояние (факты с file:line)

| Вопрос | Факт | Источник |
|---|---|---|
| От кого работает | **root** — в Dockerfile.simplex-bridge нет `USER`, базовый образ `node:20-alpine` по умолчанию root | Dockerfile.simplex-bridge:15 (FROM), отсутствие USER во всём файле |
| Процессы под root | (а) `simplex-chat` CLI (`-p 5225 --database /app/simplex.db`); (б) `bun index.ts` (bridge) | Dockerfile.simplex-bridge:49–50 (CMD) |
| Порты | CLI WS **5225**, bridge HTTP **5226** — оба >1024 → привилегированный bind НЕ нужен | Dockerfile.simplex-bridge:39–42; mini-services/simplex-bridge/index.ts:31,82; compose:463 |
| Публикация портов наружу | Нет `ports:` у сервиса — слушает только внутри сети `conditera-net` | compose:453–489 |
| Запись в ФС на рантайме | (а) `/app/simplex.db` (+ `-wal`/`-shm`) — база CLI, создаётся при старте; (б) состояние CLI в `$HOME/.simplex` (у root = `/root/.simplex`: prefs, ключи/файлы); (в) transpile/install-кэш bun — только при установке, не в рантайме | Dockerfile.simplex-bridge:50; index.ts не пишет в ФС вообще (только HTTP/WS, index.ts:23–84,335–351) |
| Volumes у сервиса | **НЕТ** — база/состояние живут в контейнерном слое (теряются при recreate; отдельное наблюдение по durability, вне DEV-14) | compose:453–489 (секции volumes отсутствуют) |
| Healthcheck | `wget -qO- http://localhost:5226/health` — Dockerfile и compose; работает от того же пользователя, что и процесс; привилегий не требует | Dockerfile.simplex-bridge:45–46; compose:473–478; endpoint — index.ts:45–58 |
| Entrypoint-скрипты, chown/su на старте | Отсутствуют; `dumb-init` — только форвардинг сигналов, от non-root работает | Dockerfile.simplex-bridge:22,49–50 |
| `bun install` в рантайме | НЕТ — зависимости ставятся в слое сборки (`bun install --frozen-lockfile`) | Dockerfile.simplex-bridge:31–33 |
| Практика соседних образов | web: `USER nextjs` (Dockerfile:110); chat-server: `adduser`+`chown -R`+`USER chat` (Dockerfile.chat:34–37) — non-root здесь уже конвенция | Dockerfile:110, Dockerfile.chat:34–37 |

## 2. Анализ: что сломается при добавлении USER non-root

1. **Сборочные шаги** (`apk add`, `npm install -g bun`, wget CLI в `/usr/local/bin`,
   `bun install`) требуют root — остаются ДО директивы `USER`; не ломаются.
2. **`/app/simplex.db`**: `/app` принадлежит root; под non-root CLI не сможет
   создать базу → громкое падение при старте. Лечится `chown -R` (см. §3).
3. **`$HOME/.simplex`**: у user `node` из базового образа HOME=/home/node
   (существует, принадлежит node) — CLI создаст каталог сам; верифицировать
   рантайм-тестом (§4, T3), т.к. точная поверхность записи стороннего бинарника
   (prefs, keystore, каталог файлов входящих вложений) статически не
   гарантируется.
4. **Порты 5225/5226** (>1024) — привилегий не требуют; healthcheck-wget — тоже.
5. **`depends_on: smp-server/web healthy`** (compose:468–472) — сетевые
   зависимости, от пользователя не зависят.
6. **`process.exit(1)` при отсутствии BACKEND_API_KEY в prod** (index.ts:33–36) —
   поведение не меняется.

Блокирующих технических препятствий НЕТ; изменение мало и статически
просматривается. Однако: сторонний бинарник simplex-chat (скачиваемый с GitHub
releases, Dockerfile.simplex-bridge:24–28) — его полный список путей записи не
документирован и в песочнице без docker НЕ проверяем; ошибка в одном пути даёт
либо падение контейнера, либо тихую потерю персистности.

## 3. Предлагаемое изменение (diff-скетч, НЕ применён)

```dockerfile
# Dockerfile.simplex-bridge — вставить МЕЖДУ строкой 36 (COPY index.ts) и ENV
# (строки 39–40) — сборочные шаги выше остаются под root:

# Non-root: конвенция web (USER nextjs) и chat-server (USER chat)
RUN chown -R node:node /app
USER node
ENV HOME=/home/node
```

-compose-изменения НЕ требуются (портов/томов/healthcheck-пользователя менять
не нужно). `USER node` вместо `adduser` — базовый образ node:20-alpine уже
содержит пользователя `node` (uid 1000) с домашним каталогом.

### Обязательные рантайм-тесты (на машине владельца, с docker)

- T1 `docker compose --profile simplex build simplex-bridge` — образ собирается.
- T2 `docker compose --profile simplex up -d smp-server web simplex-bridge` —
  оба контейнера healthy после start_period 30s (healthcheck зелёный).
- T3 `docker exec conditera-simplex-bridge sh -c 'id && ls -la /app /home/node/.simplex'`
  — uid=1000(node); `/app/simplex.db*` и `/home/node/.simplex` принадлежат node.
- T4 Функциональный раунд-трип: `POST /api/create-profile` c валидным
  `X-Bridge-Api-Key` → 200, профиль создан; `POST /send` → сообщение уходит;
  входящее сообщение доходит до backend-webhook.
- T5 Персистность в контейнере: `docker restart conditera-simplex-bridge` →
  профиль/контакты сохранились (база перечиталась non-root-процессом).
- T6 `docker inspect --format '{{.State.Health.Status}}' conditera-simplex-bridge`
  → healthy; логи без EACCES/EPERM.

### Рекомендуемое продолжение (отдельное решение владельца)

- Named volume для базы CLI (сейчас данные гибнут при recreate контейнера —
  compose:453–489 без volumes). Требует переноса пути БД и миграции владельца
  тома — отдельно от DEV-14, не смешивать.
- `smp-server` (готовый образ) — проверить его дефолтного пользователя отдельно,
  если владельцу нужен полный non-root периметр SimpleX-профиля.

## 4. Почему «риск-акцепт владельца», а не немедленная реализация

1. Невозможно исполнить T1–T6 в песочнице (docker BLOCKED) — а непроверенный
   образ опционального сервиса нельзя коммитить как «готовое» изменение.
2. Единственная содержательная неизвестность — поверхность записи стороннего
   CLI-бинарника (§2.3); её закрывает только T3/T4 на реальном рантайме.
3. Сервис за профилем `simplex|full` (compose:459) — изоляция дефекта хорошая
   (ядро маркетплейса не затронуто), риск репутационный, не продуктовый.
4. Сам diff — 3 строки; владелец может применить его и прогнать T1–T6 за
   минуты; откат — удаление 3 строк и rebuild.

---

## Обновление (v4.1, Этап 3, Task ID: C-2) — указатель на реализацию

- Предложенный в §3 diff-скетч **применён** к `Dockerfile.simplex-bridge`
  (3 строки: `RUN chown -R node:node /app` → `USER node` → `ENV HOME=/home/node`,
  плюс changelog-комментарий v4 в заголовке файла); порты/CMD/healthcheck/compose
  не менялись.
- Ре-верификация оценки против HEAD на момент реализации, статические проверки
  и чек-лист владельца T1–T6 (точные команды): см.
  `docs/evidence/release-gate/simplex-bridge-nonroot-impl-1a19c29.md` (append-only
  продолжение этого документа; файл оценки назван по HEAD написания `001c4ff`,
  коммит создания — `82ae685`).
- Рантайм-верификация T1–T6 по-прежнему за Docker-гейтом владельца
  (docker в песочнице BLOCKED); CI соберёт образ после publish.
