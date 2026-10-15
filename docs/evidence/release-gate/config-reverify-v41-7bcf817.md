# Config re-verification v4.1 (Release Gate v4.1, Этап 3, Task ID: C-2, Part 2)

- HEAD: `7bcf817` (2026-10-15), ветка `main`. Цель — подтвердить, что фиксы
  v4.0 (DEV-12/13/15/16) **присутствуют и не тронуты**; правок кода в этой
  части НЕТ (evidence-only).
- Замечание: проверочные команды прогнаны на HEAD `1a19c29` и повторены на
  `7bcf817` (коммит Part 1 `fix(docker): simplex-bridge …`); между ними
  конфиг-файлы не менялись — `git show --stat 7bcf817` содержит только
  `Dockerfile.simplex-bridge` + 2 evidence-документа.

## Сводная таблица

| # | Проверка | Вердикт | Доказательство (ключевая строка) |
|---|---|---|---|
| 1 | `MEILI_URL` на web-сервисе compose (in-network URL) | **PRESENT** | `docker-compose.yml:69 - MEILI_URL=http://meilisearch:7700` |
| 1b | `MEILISearch_URL` отсутствует как присваивание (config-поверхности) | **PRESENT** | `rg "MEILISearch_URL\s*=" --glob *.yml/*.env*/*.ts/*.mjs/*.sh` → 0 (exit 1) |
| 2 | CI: `build-args GIT_SHA=${{ github.sha }}` на web-образе; Dockerfile `ARG GIT_SHA`+`ENV APP_VERSION` | **PRESENT** | `ci.yml:153`; `Dockerfile:43-44, 72-73` |
| 3 | mailu: `env_file: mailu.env` за профилями [mail, full]; `.gitignore /mailu.env`; env-check advisory-preflight | **PRESENT** | `docker-compose.yml:507-508`; `.gitignore:39`; `env-check.sh:208-221` |
| 4 | `.env.production.example`: все 6 compose-required имён; verifier exit 0; все непустые секреты = CHANGE_ME | **PRESENT** | verifier: «6 required var(s) … OK»; `rg … \| grep -v CHANGE_ME` → 0 |

## 1. MEILI_URL (DEV-13)

Команда + вывод:

```
$ rg -n "MEILI_URL" docker-compose.yml
67:      # MEILI_URL — единый контракт с src/lib/meilisearch.ts:33 (раньше здесь был
68:      # MEILISearch_URL со сломанным регистром — код эту переменную не читал)
69:      - MEILI_URL=http://meilisearch:7700
```

- Присваивание на **web-сервисе** (блок services.web, docker-compose.yml:62–113),
  URL **in-network** (`http://meilisearch:7700` — имя сервиса meilisearch сети
  conditera-net), контракт с `src/lib/meilisearch.ts:33`
  (`MEILI_HOST || MEILI_URL || localhost:7700`). Вердикт: **PRESENT**.

### 1b. Grep MEILISearch_URL по репо (исключая docs/evidence)

```
$ rg -n "MEILISearch_URL" . --glob '!docs/evidence/**'
./docker-compose.yml:68:      # MEILISearch_URL со сломанным регистром — код эту переменную не читал)
./worklog.md:8192 / 8200 / 8492 / 8587   (исторический журнал работ)
./agent-ctx/6-a-production-config.md:15  (журнал агента, DEV-13)

$ rg -n "MEILISearch_URL\s*=" --glob '*.yml' --glob '*.yaml' --glob '*.env*' \
      --glob '*.ts' --glob '*.mjs' --glob '*.sh' .
→ 0 совпадений (exit 1)
```

- **Присваиваний (config-поверхности) — 0**: единственный остаточный текст в
  compose — строка 68, это **комментарий самого фикса v4.0** (добавлен
  намеренно фиксом DEV-13 как контекст контракта, см.
  `meili-env-unify-23b437f.md:57` «+ комментарий контракта»); совпадения в
  `worklog.md`/`agent-ctx/` — исторические журнальные записи, не конфиг.
- Формулировка задания «0 hits» выполняется для присваиваний; остаточные
  текстовые упоминания (1 комментарий + журналы) перечислены выше для честности.
- Вердикт: **PRESENT** (контракт MEILI_URL цел, сломанного ключа нет).

## 2. GIT_SHA → APP_VERSION (DEV-15)

```
$ sed -n '143,156p' .github/workflows/ci.yml        # шаг «Build web image»
      - name: Build web image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          …
          build-args: |
            GIT_SHA=${{ github.sha }}

$ rg -n -F 'GIT_SHA=${{ github.sha }}' .github/workflows/ci.yml
153:            GIT_SHA=${{ github.sha }}

$ rg -n "ARG GIT_SHA|ENV APP_VERSION" Dockerfile
43:ARG GIT_SHA=unknown
44:ENV APP_VERSION=${GIT_SHA}
72:ARG GIT_SHA=unknown
73:ENV APP_VERSION=${GIT_SHA}
```

- build-arg подаётся именно на web-образ (шаг `file: ./Dockerfile`, ci.yml:143–155);
  Dockerfile принимает его в builder (43–44) и runner (72–73) → версия видна в
  `/api/health`. Вердикт: **PRESENT**.

## 3. mailu.env контракт (DEV-16)

```
$ sed -n '503,508p' docker-compose.yml
  mailu:
    image: ghcr.io/mailu/mailu:3.3
    container_name: conditera-mailu
    <<: *default-restart
    profiles: ["mail", "full"]
    env_file: mailu.env

$ rg -n "^/mailu.env" .gitignore
39:/mailu.env

$ rg -n -i "mailu" scripts/env-check.sh
9:  #   bash scripts/env-check.sh production mail  # + advisory-проверка mailu.env (профиль mail/full)
30: # Проверка mailu.env выполняется ТОЛЬКО при явном запросе mail-профиля и только
211:  if [ -f "mailu.env" ]; then
212:    log "mailu.env найден (env_file сервиса mailu; значения не проверяются и не печатаются)"
213:    if ! grep -Eq '^SECRET_KEY=[0-9a-fA-F]{64}[[:space:]]*$' mailu.env; then
214:      warn "mailu.env: SECRET_KEY отсутствует или не 64-hex — сгенерируйте: openssl rand -hex 32 (advisory)"
217:    warn "mailu.env ОТСУТСТВУЕТ — 'docker compose --profile $PROFILE up -d' упадёт на env_file …"
218:    warn "Дефолтный профиль это НЕ ломает: сервис mailu под профилями [mail, full] (docker-compose.yml). Шаблон: mailu.env.template"
```

- `env_file: mailu.env` строго за профилями `["mail", "full"]` (507–508) —
  дефолтный профиль не требует файл; `.gitignore:39` блокирует коммит секретов;
  preflight в env-check — **advisory** (только `warn`, ошибок не добавляет,
  выполняется лишь при явном `mail`/`full` профиле). Шаблон имён —
  `mailu.env.template`. Вердикт: **PRESENT**.

## 4. .env.production.example (DEV-12)

```
$ node scripts/verify/production-env-template.mjs; echo "exit=$?"
[compose]  docker-compose.yml: 6 required var(s): CRON_SECRET, JWT_SECRET, MEILI_MASTER_KEY, N8N_ADMIN_PASSWORD, POSTGRES_PASSWORD, SIMPLEX_BRIDGE_API_KEY
[template] .env.production.example: 63 key(s)
OK: контракт выполнен — все required-переменные присутствуют в шаблоне
exit=0
```

Все 6 compose-required имён (`${NAME:?…}` fail-fast интерполяции) в шаблоне,
verifier **exit 0**:

| Required в compose | Шаблон (строка) | Значение-заполнитель |
|---|---|---|
| POSTGRES_PASSWORD | :16 | `CHANGE_ME_STRONG_PASSWORD` |
| MEILI_MASTER_KEY | :34 | `CHANGE_ME_STRONG_MEILI_KEY_32_CHARS` |
| JWT_SECRET | :60 | `CHANGE_ME_USE_openssl_rand_hex_32` |
| CRON_SECRET | :67 | `CHANGE_ME_24CHARS` |
| N8N_ADMIN_PASSWORD | :49 | `CHANGE_ME_STRONG_N8N_ADMIN_PASSWORD_24CHARS` |
| SIMPLEX_BRIDGE_API_KEY | :55 | `CHANGE_ME_STRONG_SIMPLEX_BRIDGE_API_KEY_32CHARS` |

Доказательство отсутствия реальных секретов:

```
$ rg -n "^[A-Z0-9_]*(KEY|SECRET|PASSWORD|TOKEN|SALT)[A-Z0-9_]*=.+" .env.production.example
16:POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD
20:NEXT_PUBLIC_SUPABASE_ANON_KEY=CHANGE_ME_REAL_ANON_KEY
21:SUPABASE_SERVICE_ROLE_KEY=CHANGE_ME_REAL_SERVICE_ROLE_KEY
34:MEILI_MASTER_KEY=CHANGE_ME_STRONG_MEILI_KEY_32_CHARS
46:N8N_API_KEY=CHANGE_ME_N8N_API_KEY_32_CHARS
49:N8N_ADMIN_PASSWORD=CHANGE_ME_STRONG_N8N_ADMIN_PASSWORD_24CHARS
55:SIMPLEX_BRIDGE_API_KEY=CHANGE_ME_STRONG_SIMPLEX_BRIDGE_API_KEY_32CHARS
60:JWT_SECRET=CHANGE_ME_USE_openssl_rand_hex_32
62:JWT_REFRESH_SECRET=CHANGE_ME_USE_openssl_rand_hex_32
65:TFA_ENCRYPTION_KEY=CHANGE_ME_USE_openssl_rand_hex_32
66:IP_HASH_SALT=CHANGE_ME_16CHARS
67:CRON_SECRET=CHANGE_ME_24CHARS
68:BOT_SECRET=CHANGE_ME_24CHARS
70:TELEGRAM_WEBHOOK_SECRET=CHANGE_ME_24CHARS

$ rg "…=.+" .env.production.example | rg -v "CHANGE_ME"   # непустые секреты НЕ от CHANGE_ME
→ 0 строк (exit 1)
```

- Все 14 **непустых** secret-класс значений начинаются с `CHANGE_ME`;
  `DATABASE_URL` (:15) содержит инлайн `…:CHANGE_ME_STRONG_PASSWORD@…`;
  7 secret-ключей намеренно пустые (user-must-fill: MAILGUN_SIGNING_KEY,
  SENDGRID_WEBHOOK_KEY, YANDEX_METRIKA_OAUTH_TOKEN, YANDEX_GEOCODER_API_KEY,
  TELEGRAM_BOT_TOKEN, YOOKASSA_SECRET_KEY, LLM_API_KEY). Реалистичных секретов
  нет (публичные конфиги — URL/имя приложения/публичный ID Метрики — секретами
  не являются). Вердикт: **PRESENT**.

## Итог

Все четыре контракта v4.0 (MEILI_URL — DEV-13; GIT_SHA/APP_VERSION — DEV-15;
mailu.env — DEV-16; production-env шаблон — DEV-12) **присутствуют на HEAD
`7bcf817` и не тронуты**. Изменений кода/конфигов в этой части не вносилось.
