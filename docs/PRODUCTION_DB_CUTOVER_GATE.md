# Conditera — готовность единого PostgreSQL 17

## Актуальное решение

Целевая база Conditera — чистый PostgreSQL 17 внутри единого Supabase Runtime. Исходные базы пустые; пользовательские данные, которые требовалось бы переносить или объединять, отсутствуют. Сложный перенос PG15/PG18, логический dump/restore, CDC и сверка записей не нужны.

Документ с прежним gate для объединения двух непустых баз устарел и заменён этим порядком чистой инициализации.

## Подтверждено CI

На чистом Supabase PostgreSQL 17.12:
- применяются все прикладные миграции;
- проверяются обязательные таблицы, расширения, роли и RLS;
- выполняются конкурентные операции;
- проходит регистрация, полный жизненный цикл заказа, оплата, checkout, идемпотентность, отзывы и чат;
- проходят рецептуры, складские остатки, списание ингредиентов, медиа и модерация;
- проходят production build и Playwright Chromium.

Отдельный runtime smoke проверяет единый контейнер Supabase Runtime: PostgreSQL 17.12, Auth signup, REST/OpenAPI, Realtime health, Storage bucket create/upload/download.

## Канонический запуск

Нужны настоящие секреты в .env.production и .env.supabase-runtime. Запускать только через launcher:

~~~bash
node scripts/compose-single-runtime.mjs config
node scripts/compose-single-runtime.mjs up -d --build
node scripts/compose-single-runtime.mjs ps
~~~

Legacy PG15/PG18 сервисы не входят в активный Compose-граф и не используются целевой системой. Не подключать их data directories к PG17.

## Оставшиеся действия на целевом Windows-компьютере

1. Создать env-файлы с уникальными production-секретами.
2. Запустить единый runtime через Docker Desktop/WSL2.
3. Проверить health всех сервисов, миграционный ledger, Auth, REST, Realtime и Storage.
4. Проверить Caddy, DNS и HTTPS домена.
5. Подключить реальные Yandex/VK OAuth, YooKassa и Telegram credentials.
6. Провести контрольный заказ в production с реальными интеграциями и проверить логи/уведомления.

CI подтверждает программную готовность чистой PG17 и тестовых сценариев. Он не является доказательством, что локальный компьютер владельца уже запущен или домен обслуживается новым runtime.
