# DEV-16: mailu.env / mail-профиль — контракт и preflight-поведение

HEAD before: 142956e. TZ v4.0 §9 (P1). Sandbox: docker engine отсутствует (см. docker-gate-2,
cap_sys_admin absent) → проверка СТАТИЧЕСКАЯ (разбор docker-compose.yml), runtime `docker compose
config` — NOT RUN (gate владельца Docker-хоста).

## 1. Статический разбор compose

- Сервис `mailu` (docker-compose.yml:501-538): `profiles: ["mail", "full"]` (строка 507),
  `env_file: mailu.env` (строка 508). Это ЕДИНСТВЕННЫЙ потребитель mailu.env в стеке
  (остальные env_file — `.env.production`: migrator:27, web:57, chat-service:313, simplex-bridge:460).
- Поведение БЕЗ mailu.env:
  - Дефолт-профиль (`docker compose up -d` / `--profile default`): сервис mailu ИСКЛЮЧЕН
    (profiles [mail, full]) → его env_file НЕ резолвится → дефолтный подъём стека от файла
    НЕ ЗАВИСИТ и не падает. Подтверждено статически: profiles — механизм исключения сервиса
    из дефолтного набора; env_file解析ается только для выбранных к запуску сервисов.
  - `docker compose --profile mail up -d` (или `--profile full`) БЕЗ файла: HARD FAIL на
    этапе разрешения конфигурации, ДО старта контейнеров — compose завершается ошибкой вида
    `env file /path/mailu.env not found: stat ...: no such file or directory`. Не silent.
- Сервисные overrides: compose задаёт `environment: DOMAIN/HOSTNAMES/POSTMASTER/TZ` (строки 509-512)
  — они старше значений из env_file.

## 2. Ожидаемые ключи mailu.env — ТОЛЬКО ИМЕНА (значения — из secret-store владельца; шаблон: mailu.env.template)

Обязательные для старта Mailu:
- `SECRET_KEY` — 64 hex (openssl rand -hex 32); value from owner's secret store
- `DOMAIN`, `HOSTNAMES`, `POSTMASTER` — value from owner's secret store / DNS-плана
- `SUBNET` — внутренняя подсеть Mailu, value from owner's network plan
- `TLS_FLAVOR`, `CERTS_PATH` — TLS-стратегия владельца (letsencrypt / cert file и т.п.)

Опциональные (шаблон даёт дефолты):
`RELAYNETS`, `RELAYHOST`, `DISABLE_ANTIVIRUS`, `DISABLE_SPAM_FILTER`, `WEBMAIL`,
`WEBROOT_REDIRECT`, `ADMIN`, `WEB_ADMIN`, `MESSAGE_SIZE_LIMIT`, `AUTH_RATELIMIT`,
`DB_FLAVOR` (sqlite/…), `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PW`, `DB_NAME`,
`SESSION_TIMEOUT`, `LOG_LEVEL`.

НИКАКИХ реальных/похожих-на-реальные значений в этом документе и в шаблоне нет.

## 3. Preflight hook (добавлен)

`scripts/env-check.sh`: опциональный 2-й аргумент — профиль (`bash scripts/env-check.sh production mail`).
Только при profile ∈ {mail, full}: проверка наличия mailu.env + формат SECRET_KEY (имя файла и
класс значения; значения не печатаются). Advisory (warning), НЕ hard fail — итоговый exit
код определяется прежними required-проверками. Без 2-го аргумента поведение скрипта не изменилось.

Проверено в песочнице (bash -n OK; три состояния mailu.env):
- файл отсутствует → 2 advisory-warnings (упадёт profile-mail up; дефолт не затронут; шаблон указан)
- пустой файл → advisory «SECRET_KEY отсутствует или не 64-hex»
- валидный 64-hex → `✓ mailu.env найден` без warnings
Ограничение: при ОТСУТСТВУЮЩЕМ .env.production скрипт завершается раньше (прежнее поведение
exit 1 на строке «Файл не найден») — mail-блок не достигается; на деплой-хосте .env.production
есть (это prerequisite стека), для чистого mail-профиля без основного env — это осознанная граница.

## 4. Гигиена секретов

`mailu.env` НЕ был покрыт `.gitignore` (правило `.env*` матчит только имена, начинающиеся с `.env`).
Добавлено `/mailu.env` в .gitignore → реальный файл владельца не закоммитится случайно.
Шаблон `mailu.env.template` остаётся трекаемым (значения — только CHANGE_ME-плейсхолдеры).

## 5. Изменённые файлы

- `scripts/env-check.sh:9,29-32,208-221` — usage, PROFILE-аргумент, advisory-блок MAIL PROFILE
- `.gitignore:37-39` — `/mailu.env`
- этот evidence-файл
