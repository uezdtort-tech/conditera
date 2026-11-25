# Единая база данных Conditera — PostgreSQL 17

## Решение

Целевая архитектура — один Supabase Runtime на PostgreSQL 17. В едином кластере находятся системные схемы Supabase и прикладные данные Conditera: Auth, профили, роли, каталог, предложения, заказы, платежи, склад, чаты, согласия и OAuth identity links.

**Исходные базы пустые. Перенос пользовательских данных, логический dump/restore, CDC и слияние записей не требуются.** PostgreSQL 17 поднимается как чистая база, после чего на неё применяются актуальные системные и прикладные миграции.

## Состав целевого runtime

- PostgreSQL 17 с необходимыми расширениями;
- GoTrue Auth;
- PostgREST;
- Realtime;
- Storage и Imgproxy;
- Postgres Meta;
- Kong API Gateway;
- Edge Runtime;
- Next.js подключён к тому же PostgreSQL 17 через отдельную роль `conditera_app`.

Supabase-компоненты работают в едином runtime-контейнере. Внешний Compose-overlay направляет приложение и API в один кластер. Отдельные PostgreSQL 15 и PostgreSQL 18 не являются частью штатного целевого стека.

## Инициализация чистой базы

1. Подготовить `.env.production` и `.env.supabase-runtime` на основе соответствующих example-файлов. Все секреты должны быть уникальными и непустыми.
2. Проверить итоговую конфигурацию:

   ```bash
   node scripts/compose-single-runtime.mjs config
   ```

3. Запустить единый стек:

   ```bash
   node scripts/compose-single-runtime.mjs up -d --build
   ```

4. Проверить состояние:

   ```bash
   node scripts/compose-single-runtime.mjs ps
   node scripts/compose-single-runtime.mjs logs --tail 200 supabase-runtime
   ```

5. Дождаться health-check PostgreSQL, Auth, REST, Realtime, Storage и Next.js.
6. Убедиться, что миграционный журнал содержит все актуальные системные и прикладные миграции, а обязательные таблицы, роли, триггеры, функции и RLS-политики созданы.

Runtime migration runner применяет миграции к пустой базе с `SEED_MODE=none`. Демонстрационные пользователи, товары и рецептуры создаются только в тестовом контуре. Production не получает demo seed.

## Переменные и секреты

- `.env.production` — публичные URL, ключи приложения, JWT и секреты сервисов;
- `.env.supabase-runtime` — отдельный пароль роли `conditera_app` и внутренние ключи Supabase Runtime;
- `.env.supabase-runtime.example` — список обязательных переменных и формат генерации.

Не использовать значения `ci-only`, `stub`, `CHANGE_ME` и другие placeholders в production. Не передавать пароль `conditera_app` контейнерам n8n, chat-service или публичным клиентам.

## Что проверено в CI

Отдельный runtime smoke проверяет запуск PostgreSQL 17.12, Auth signup, REST/OpenAPI, Realtime health, Storage bucket create/upload/download и системные схемы Supabase.

Отдельный PG17 business pipeline на чистом PostgreSQL 17.12 проверяет:
- применение прикладных миграций и RLS;
- расширения, роли, обязательные таблицы и миграционный ledger;
- конкурентные операции;
- регистрацию, refresh/replay защиту, полный цикл заказа;
- checkout, платежи, идемпотентность, отзывы и чаты;
- рецептуры, складские остатки и списание;
- медиа, модерацию, файловое хранилище;
- production build и Playwright Chromium.

Эти проверки доказывают чистую инициализацию и работу сценариев на PG17. Они не являются подтверждением фактического production deployment.

## Что остаётся для запуска на целевом компьютере

- создать два env-файла с настоящими секретами и внешними URL;
- выполнить запуск launcher на целевом Windows-компьютере с Docker Desktop;
- проверить DNS, HTTPS/Caddy и доступность домена;
- подключить реальные OAuth Yandex/VK и YooKassa credentials;
- настроить Telegram и реальные каналы уведомлений;
- выполнить smoke с реальными Auth/Storage/Realtime и проверить логи контейнеров.

## Правила эксплуатации

- Не подключать старые каталоги PG15/PG18 как PG17 data directory.
- Не использовать `docker compose down -v` и удаление именованных volumes для обычного обновления.
- Не запускать отдельные legacy Compose-файлы без PG17 overlay.
- Все изменения схемы оформлять миграциями в `supabase/migrations`.
- Перед релизом запускать PG17 business pipeline и runtime smoke; нельзя подменять их проверкой только `docker compose config`.
