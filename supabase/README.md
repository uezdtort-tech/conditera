# Self-hosted Supabase Conditera — PostgreSQL 17

## Канонический запуск

Conditera использует единый Supabase Runtime на PostgreSQL 17.12. PostgreSQL, GoTrue Auth, PostgREST, Realtime, Storage, Imgproxy, Postgres Meta, Kong и Edge Runtime запускаются в одном runtime-контейнере. Next.js подключается к той же базе через отдельную роль `conditera_app`.

Базы пустые — перенос данных из PG15/PG18 не выполняется. На чистом PG17 применяются системные и прикладные миграции. Demo seed разрешён только для локального тестирования и CI.

Подготовьте:
- `.env.production`;
- `.env.supabase-runtime` на основе `.env.supabase-runtime.example`.

Запуск из корня репозитория:

```bash
node scripts/compose-single-runtime.mjs config
node scripts/compose-single-runtime.mjs up -d --build
node scripts/compose-single-runtime.mjs ps
```

Логи:

```bash
node scripts/compose-single-runtime.mjs logs --tail 200 supabase-runtime
node scripts/compose-single-runtime.mjs logs --tail 200 web
```

Остановка без удаления volumes:

```bash
node scripts/compose-single-runtime.mjs stop
```

## Компоненты

| Компонент | Назначение |
|---|---|
| PostgreSQL 17.12 | Единый кластер и системные/прикладные схемы |
| GoTrue | Регистрация, вход, OAuth, refresh sessions |
| PostgREST | REST API и RLS |
| Realtime | WebSocket и postgres_changes |
| Storage | Buckets и объектное хранилище |
| Imgproxy | Обработка изображений |
| Kong | Единый API gateway |
| Postgres Meta | Метаданные схем |
| Edge Runtime | Запуск Edge Functions |

## Проверки

Runtime smoke CI проверяет Auth signup, REST/OpenAPI, Realtime health, Storage upload/download и системные схемы. PG17 business CI проверяет прикладные миграции, RLS, регистрацию, заказы, оплату, склад, чаты, медиа и Playwright.

Production запуск требует настоящих секретов, домена, TLS, OAuth/YooKassa credentials и настроенных каналов уведомлений. Тестовые ключи и placeholders в production запрещены.
