# Conditera — запуск production на локальном Windows-компьютере

## Целевая среда

- Windows + Docker Desktop с Linux containers / WSL2.
- Один единый Supabase Runtime на PostgreSQL 17.12.
- Next.js, chat-service, n8n, Redis, Meilisearch и Caddy подключаются к одному Compose-проекту.
- PostgreSQL, Docker API, Redis, внутренние Supabase API и панели администрирования не публикуются напрямую в интернет.
- Внешний доступ — через Caddy с HTTPS.

## База данных

Целевая база — чистый PostgreSQL 17. Исходные базы пустые; переносить пользовательские данные не требуется. Runtime init scripts создают системные схемы Supabase и применяют прикладные миграции Conditera. Demo seed разрешён только в CI и локальном тестировании.

Штатный запуск не должен активировать отдельные PostgreSQL 15 или PostgreSQL 18. Проверка Compose должна показывать один активный кластер supabase-runtime.

## Подготовка

1. Установить Docker Desktop и включить WSL2 integration.
2. Скопировать .env.production.example в .env.production.
3. Скопировать .env.supabase-runtime.example в .env.supabase-runtime.
4. Сгенерировать уникальные секреты. Не оставлять CHANGE_ME, stub, ci-only и демонстрационные значения.
5. Указать внешние URL Conditera и корректные redirect URLs для OAuth.
6. Проверить конфигурацию:

   ~~~powershell
   node scripts/compose-single-runtime.mjs config
   ~~~

## Запуск

~~~powershell
./scripts/deploy.sh
node scripts/compose-single-runtime.mjs ps
node scripts/compose-single-runtime.mjs logs --tail 200 supabase-runtime
node scripts/compose-single-runtime.mjs logs --tail 200 web
~~~

Launcher фиксирует три Compose-файла, проверяет обязательные секреты и направляет Next.js и Supabase API в единый PostgreSQL 17. Он запрещает включение legacy PG15/PG18 профилей и удаление volumes.

## Проверки после запуска

- PostgreSQL 17.12 healthy;
- миграционный ledger содержит все актуальные миграции;
- Auth signup/login/refresh работают;
- PostgREST возвращает OpenAPI и проверяет RLS;
- Realtime принимает подключения;
- Storage создаёт bucket и выполняет upload/download;
- Next.js /api/health возвращает healthy;
- регистрация, заказ, оплата, чат, рецептуры, склад и медиа проходят сквозной smoke;
- Caddy выдаёт HTTPS для домена и корректно проксирует маршруты.

## Реальные интеграции

До полноценного публичного запуска должны быть внесены настоящие credentials:
- Yandex ID и VK ID OAuth;
- YooKassa;
- Telegram bot и канал;
- SMTP;
- внешние URL и redirect URLs.

CI использует тестовые ключи и mock payment/auth для бизнес-сценариев; runtime POC отдельно проверяет реальные внутренние Supabase Auth/Storage API. Эти тесты не заменяют проверку настоящих внешних провайдеров.

## Статус

Чистая PG17, прикладные миграции, основные бизнес-сценарии, production build, Playwright и единый Supabase runtime проверяются GitHub Actions. Сам локальный Windows-компьютер владельца из GitHub Actions недоступен, поэтому фактический запуск на нём и DNS/TLS не объявляются выполненными до получения результатов с этого компьютера.
