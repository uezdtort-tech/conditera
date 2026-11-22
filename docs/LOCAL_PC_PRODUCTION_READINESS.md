# Подготовка Conditera к production на локальном ПК

Статус документа: release gate. CI подтвердил полный E2E-набор на PostgreSQL 17 и запуск единого Supabase runtime; production на локальном Windows ПК ещё не развёрнут и не принят.

## Зафиксированная целевая среда

- Production-хост — локальный ПК владельца под Windows.
- Все компоненты запускаются в Docker Desktop (Linux containers / WSL2).
- Внешний трафик принимается через reverse proxy с HTTPS; наружу не публикуются PostgreSQL, Docker API, Redis, внутренние Supabase API и панели администрирования.
- Для всей рабочей системы используется один PostgreSQL-кластер и одна каноническая рабочая база.
- По требованию владельца весь обязательный Supabase runtime должен работать внутри ОДНОГО Docker-контейнера. Отдельные Supabase Auth/REST/Realtime/Storage/Kong контейнеры не считаются выполнением этого требования.
- Внутренние прикладные сервисы могут оставаться отдельными контейнерами, но используют единый Compose-проект, согласованную сеть и DNS-имена сервисов. Нельзя закреплять динамические IP контейнеров в конфигурации.
- Данные, Storage и резервные копии не должны зависеть от жизненного цикла контейнера; volumes не удаляются при обновлении приложения.

## Фактические блокеры, обнаруженные в репозитории

1. Целевая БД — PostgreSQL 17.12. `docker-compose.yml` и мигратор выровнены на PostgreSQL 17; в production overlay эти legacy app-db сервисы отключены.
2. `docker-compose.supabase.yml` содержит прежний многоконтейнерный Supabase на PG15, но все его сервисы, включая Studio, отключены профилем `legacy-supabase` при использовании целевого overlay.
3. Единый Supabase runtime собран из закреплённых версий PostgreSQL 17, GoTrue, PostgREST, Realtime, Storage, Postgres Meta, Imgproxy, Kong и Edge Runtime в одном контейнере. Его Compose overlay подключает Next.js к той же базе через роль `conditera_app`.
4. GitHub Actions подтвердил PostgreSQL 17 migration Compose validation, Supabase runtime smoke, 980 unit/integration tests, 196 P0.5 checks, 26 payment checks, 37 operational checks, 63 media/moderation checks и 156 Playwright Chromium tests. Это CI-проверка, не локальный production deployment.
5. `scripts/deploy.sh` остаётся намеренно заблокированным. Добавлен отдельный `scripts/deploy-single-container.sh`: он проверяет реальные env, итоговую Compose-конфигурацию и запрещает публикацию web/Meilisearch портов; не удаляет контейнеры или volumes.
6. `.github/workflows/deploy.yml` ориентирован на удалённый VPS через SSH и каталог `/opt/conditera`; не запускать его для production Conditera.
7. Фактическое состояние Docker Desktop, DNS, маршрутизатора/NAT, Windows Firewall, volumes и секретов на локальном ПК можно подтвердить только проверкой на самой машине владельца.
8. Владелец подтвердил, что обе прежние БД пустые и пользовательских данных нет. Перенос/слияние данных не требуется: целевая PG17 должна инициализироваться с нуля в отдельном volume; production seeds должны оставаться выключенными (`SEED_MODE=none`).

## Что необходимо реализовать и проверить

### A. Единый Supabase runtime

- Единый образ Supabase all-in-one уже реализован в `Dockerfile.supabase-runtime-poc` с supervisor; в production overlay используется один контейнер `supabase-runtime`.
- Внутри него запускаются PostgreSQL 17.12, GoTrue, PostgREST, Realtime, Storage, Postgres Meta, Imgproxy, Kong и Edge Runtime; версии закреплены.
- Readiness/health checks и корректное завершение процессов проверены в CI runtime POC. Полный бизнес E2E на PG17 подтверждён отдельно.
- На локальном Windows ПК ещё требуется проверить падение/перезапуск каждого процесса, восстановление клиентов, нагрузку, backup/restore и восстановление после перезагрузки ПК.
- Не использовать плавающие теги образов и не запускать старый multi-container Supabase профиль.

### B. Единая база PostgreSQL 17 с нуля

- Не проектировать перенос или слияние данных: владелец подтвердил, что обе прежние БД пустые и пользовательских данных нет.
- На локальном ПК создать новый volume `supabase_runtime_pg17_data`; не подключать к нему PGDATA от PostgreSQL 15 или 18.
- CI на чистом PG17.12 уже применяет системные и прикладные миграции, сверяет ledger с точным списком файлов и повторно выполняет `bun run db:setup` без изменения ledger.
- CI проверяет роль `conditera_app`, grants, RLS, Auth/Storage/Realtime схемы; полный набор бизнес-сценариев выполняется на PG17.
- На локальном ПК первый старт должен использовать `SEED_MODE=none`, новый volume и подтвердить тот же migration ledger без demo seeds.
- Настроить регулярные резервные копии новой PG17 и Storage с проверенным восстановлением. Это защита уже созданных production-данных, а не перенос старых БД.
- Старые тестовые volumes не использовать как источник истины; не удалять их в рамках deploy-скрипта.

### C. Docker Desktop и сеть на локальном ПК

- Один Compose project и сеть `conditera-net`; web и Meilisearch не публикуют host ports, PostgreSQL/Redis/Supabase остаются внутренними.
- Публичный вход — Caddy на 80/443; n8n UI привязан только к `127.0.0.1:5678` и не проксируется наружу.
- DNS-имена сервисов Compose используются вместо статических IP; Next.js подключается к `supabase-runtime`, внутренние Edge вызовы — через alias `supabase-kong`.
- Добавлены `scripts/prepare-production-env.sh` для генерации локальных секретов/JWT и `scripts/deploy-single-container.sh` для проверки/запуска без удаления volumes.
- CI проверяет итоговый Compose config, отсутствие активных legacy DB/Supabase сервисов, локальный n8n bind, приватные web/search порты и Caddy routing.
- На локальном ПК всё ещё нужно подтвердить отсутствие конфликтов портов и корректность Windows/WSL2 networking.
- Проверить запуск после перезагрузки Windows, рестарт Docker Desktop, рестарт каждого контейнера, временную потерю интернета и восстановление.
- Проверить автозапуск, Windows Firewall, публичный DNS, маршрутизатор/NAT, доступность только необходимых портов и TLS.
- Внешние резервные копии должны храниться отдельно от рабочего диска локального ПК.

### D. Приложение и релиз

- Сохранить существующую концепцию Conditera, интерфейс, навигацию и согласованные пользовательские сценарии. Не переносить интерфейс Qwen и не менять продуктовую модель без отдельного согласования.
- Проверить регистрацию, вход, выход, обновление сессии, восстановление доступа и реальные OAuth-потоки Яндекс, VK ID и Google.
- Проверить роли и изоляцию данных на сервере, RLS и доступ к Storage.
- Проверить полный жизненный цикл заказа, согласование ТЗ, чаты, производство, склад, платежи, отмены и возвраты.
- Выполнить typecheck, lint, unit/integration tests, production build и полный Playwright E2E на целевом локальном runtime.
- Проверить health/readiness каждого процесса, резервное копирование и восстановление.
- Проверить юридические тексты, согласия, версии документов и применимые требования законодательства РФ; юридические формулировки должны быть подтверждены ответственным специалистом.

## Запреты до прохождения release gate

- Не запускать старый удалённый VPS workflow для production.
- Не запускать старый `scripts/deploy.sh` и не использовать удалённый VPS workflow.
- Не запускать production deploy до заполнения и проверки реальных секретов, включения платёжного провайдера и OAuth, а также прохождения локального release gate.
- Не выполнять `docker compose down -v`, `docker volume rm`, `db reset`, очистку Storage или удаление PGDATA.
- Не менять major-версию PostgreSQL поверх существующего volume; целевой PG17 использует новый volume, инициализированный с нуля.
- Не объединять PR и не выполнять production deploy из CI; production запуск выполняется только на целевом ПК через проверенный `scripts/deploy-single-container.sh` после заполнения реальных секретов.
- Не объявлять готовность по CI, одному health endpoint или успешному запуску только web-контейнера.

## Критерий готовности

Релиз считается подготовленным только после документированного успешного прогона на локальном Windows ПК: чистый запуск → Auth/OAuth → заказ → запись в единую БД → REST/RLS → Realtime → Storage → платежные и складские сценарии → backup → restore → перезагрузка ПК → повторная проверка. До этого момента статус — NOT READY.
