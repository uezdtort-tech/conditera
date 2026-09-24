# База данных «Уездный кондитер» — разворачивание и управление

## Обзор

Проект использует **PostgreSQL 18** через **Supabase** как основную БД. Локально
можно разворачивать тремя способами в зависимости от окружения:

| Способ | Docker | Время запуска | Особенности |
|--------|--------|---------------|-------------|
| **Docker dev** | ✓ | ~30 сек | PostgreSQL 18 + Redis + Meilisearch + Mailpit + n8n |
| **Docker Supabase** | ✓ | ~60 сек | Полный Supabase stack (Auth, Storage, Realtime, Edge Functions) |
| **PGlite (без Docker)** | ✗ | ~5 сек | WASM PostgreSQL в Node.js — для CI, тестов, preview |

- **197 таблиц** в схеме `public` (после применения всех миграций)
- **20 SQL миграций** (0001–0019 + 0016b) общим объёмом ~7 000 строк
- **27 SQL RPC функций** для атомарных операций (counters, balance, escrow)
- **80+ RLS policies** для row-level security
- **3 seed файла**: 28 категорий, 45 начинок, 7 CMS-страниц, 13 пунктов меню

---

## Быстрый старт

### Вариант 1: Docker dev (рекомендуется для разработки)

```bash
# 1. Запуск PostgreSQL 18 + Redis + Meilisearch + Mailpit + n8n
./scripts/init-db.sh

# 2. Проверка
docker-compose -f docker-compose.dev.yml ps

# 3. Запуск Next.js
npm run dev:local
# → http://localhost:3000
```

Параметры подключения:
- **Host:** `localhost`
- **Port:** `5433`
- **User:** `uyezdny`
- **Password:** `uyezdny_dev_pass`
- **DB:** `uyezdny_konditer_dev`
- **DATABASE_URL:** `postgresql://uyezdny:uyezdny_dev_pass@localhost:5433/uyezdny_konditer_dev?schema=public`

Дополнительно запускаются:
- **Redis:** `localhost:6380` (для сессий, rate-limiting)
- **Meilisearch:** `http://localhost:7700` (полнотекстовый поиск, ключ `dev_meili_key_32_chars_min_aaaaaa`)
- **Mailpit:** `http://localhost:8025` (веб-интерфейс для перехвата email)
- **n8n:** `http://localhost:5678` (admin/admin — автоматизация)

### Вариант 2: Docker Supabase (полный stack)

```bash
# 1. Запуск полного Supabase
./scripts/init-db.sh supabase

# 2. Проверка
docker-compose -f docker-compose.supabase.yml ps

# 3. Запуск Next.js
npm run dev:local
```

Параметры подключения:
- **Host:** `localhost`
- **Port:** `5432`
- **User:** `supabase`
- **DB:** `supabase`
- **Supabase Studio:** `http://localhost:3000` (после запуска `npm run dev:local`)
- **Supabase API:** `http://localhost:8000`

### Вариант 3: PGlite (без Docker)

```bash
# Установка PGlite (один раз)
npm install @electric-sql/pglite

# Инициализация локальной БД
./scripts/init-db.sh pglite
# или
npx tsx scripts/init-db-local.ts --pglite

# Сброс и повторная инициализация
./scripts/init-db.sh pglite-reset
```

PGlite-БД создаётся в `/home/z/my-project/db/pglite-dev/`. Это файлы, которые
можно удалить в любой момент — повторная инициализация пересоздаст их.

**Ограничения PGlite-режима:**
- ✗ `CREATE EXTENSION` пропускается (используется `gen_random_uuid()` вместо `uuid_generate_v4()`)
- ✗ `auth.users` FK заменяются на комментарий (нет auth schema)
- ✗ `auth.uid()` в RLS-политиках заменяется на `NULL::uuid` (RLS фактически отключён)
- ✗ `pg_cron`, `pgsodium`, `pgjwt` — недоступны
- ✓ Все таблицы, индексы, CHECK-констрейнты, COMMENT — работают
- ✓ Все INSERT/UPDATE/DELETE — работают
- ✓ JSONB, массивы, enum'ы — работают

---

## Структура миграций

```
supabase/migrations/
├── 0001_init.sql                       # Базовые таблицы: profiles, user_roles, addresses
├── 0002_marketplace.sql                # Marketplace: products, orders, payments, deliveries
├── 0003_search_function.sql            # RPC search_products
├── 0004_cake_builder_chat.sql          # Конструктор тортов + чат
├── 0005_crm_cms.sql                    # CRM + CMS (pages, nav, banners)
├── 0006_products_extended.sql          # Расширения каталога
├── 0007_tenders.sql                    # Тендеры и отклики
├── 0008_geo.sql                        # Гео: города, регионы, координаты
├── 0009_cms_payments_extended.sql      # Платежи + CMS расширения
├── 0010_extended_catalog.sql           # Лояльность, рецепты, AI-ассистент
├── 0011_rbac_franchise_escrow.sql      # RBAC + франшиза + эскроу
├── 0012_new_roles_recipes_loyalty_ai.sql # Новые роли, recipe_marketplace, AI
├── 0013_atomic_counter_helpers.sql     # 27 SQL RPC для атомарных операций
├── 0014_builder_config.sql             # CRUD для конструктора (типы, начинки, покрытия)
├── 0015_uploads_registry.sql           # Реестр загруженных файлов
├── 0016_channel_moderation.sql         # Модерация канала + авто-пост в Telegram
├── 0016b_prisma_enums.sql              # 19 CamelCase enum типов для 0017
├── 0017_sync_missing_tables.sql        # 88 Prisma-style таблиц (CamelCase колонки)
├── 0018_audit_log_table.sql            # audit_log (snake_case, для API кода)
└── 0019_missing_runtime_tables.sql     # 9 таблиц, используемых кодом, но отсутствовавших
```

### Порядок применения

Миграции применяются в алфавитном порядке. Порядок `0016` → `0016b` → `0017` →
`0018` → `0019` обеспечивает:
1. `0016b_prisma_enums.sql` создаёт CamelCase enum'ы ДО того, как `0017` их использует
2. `0017_sync_missing_tables.sql` создаёт Prisma-style таблицы
3. `0018_audit_log_table.sql` добавляет snake_case таблицу `audit_log`
4. `0019_missing_runtime_tables.sql` добавляет остальные snake_case таблицы

---

## Seed данные

```
supabase/
├── seed.sql              # 28 категорий + 4 permissions + 4 CMS-страницы
├── seed_cms_crm.sql      # CMS pages + nav menu + scheduled jobs
└── seed_fillings.sql     # 45 начинок с группами вкуса (berry/chocolate/caramel/...)
```

После инициализации:
- **28 категорий товаров** (20 кондитерских + 8 сопутствующих)
- **45 начинок** с описаниями, цветовыми кодами, сезонностью
- **7 CMS-страниц** (about, faq, contacts, terms, privacy, cookies, consent)
- **13 пунктов меню** (header + footer)

---

## Управление БД

### Применить миграции повторно (Docker)

```bash
# Применить все миграции заново
for f in supabase/migrations/*.sql; do
  docker exec -i uyezdny-db-dev psql -U uyezdny -d uyezdny_konditer_dev < "$f"
done
```

### Сброс БД (Docker)

```bash
# Остановить и удалить контейнеры + данные
docker-compose -f docker-compose.dev.yml down -v

# Запустить заново с чистой БД
./scripts/init-db.sh
```

### Создание дампа

```bash
# Полный дамп схемы
docker exec uyezdny-db-dev pg_dump -U uyezdny -d uyezdny_konditer_dev --schema=public > backups/schema.sql

# Дамп данных конкретной таблицы
docker exec uyezdny-db-dev pg_dump -U uyezdny -d uyezdny_konditer_dev --table=public.profiles --data-only > backups/profiles.sql
```

### Восстановление из дампа

```bash
docker exec -i uyezdny-db-dev psql -U uyezdny -d uyezdny_konditer_dev < backups/schema.sql
```

---

## Структура таблиц по группам

### Аутентификация и пользователи (5 таблиц)
- `profiles` — публичные профили пользователей
- `user_roles` — множественные роли (CUSTOMER, CONFECTIONER, ADMIN, ...)
- `notification_preferences` — настройки уведомлений
- `addresses` — адреса доставки
- `user_holidays` — дни рождения и праздники

### Marketplace (10 таблиц)
- `products` — товары
- `product_categories` — 28 категорий
- `product_images`, `product_attributes`, `product_variants`
- `product_reviews`, `product_favorites`
- `cart_items` — корзина
- `orders`, `order_items` — заказы

### Платежи и финансы (8 таблиц)
- `payments` — платежи YooKassa
- `escrow_accounts` — эскроу-счета
- `payouts` — выплаты кондитерам
- `loyalty_transactions` — транзакции лояльности
- `refunds` — возвраты
- `royalty_payments` — роялти авторам рецептов
- `business_expenses` — расходы бизнеса
- `tax_reports` — налоговая отчётность

### Доставка (4 таблицы)
- `deliveries` — доставки
- `delivery_tracking` — отслеживание
- `delivery_zones` — зоны доставки
- `addresses` — адреса (используется и для доставки)

### Кондитеры (5 таблиц)
- `confectioners` — профили кондитеров
- `confectioner_geo` — гео-данные
- `confectioner_ateliers` — ателье (филиалы)
- `confectioner_lessons` — уроки от мастеров
- `confectioner_transactions` — транзакции кондитеров

### Конструктор тортов (5 таблиц)
- `cake_builder_drafts` — черновики
- `cake_builder_options` — опции
- `fillings` — 45 начинок
- `coatings` — покрытия
- `decor_items` — декор

### Контент и CMS (8 таблиц)
- `cms_pages`, `cms_page_history` — страницы с версионированием
- `cms_blocks`, `cms_section_blocks`, `cms_sections` — блоки контента
- `cms_banners`, `cms_media` — баннеры и медиа
- `cms_nav_menu` — навигация
- `cms_site_settings`, `site_settings` — настройки сайта

### Тендеры и B2B (5 таблиц)
- `tenders` — тендеры
- `tender_offers` — отклики
- `tender_reviews` — отзывы
- `tender_invitations` — приглашения
- `venues` — площадки для мероприятий

### Чат и поддержка (8 таблиц)
- `chat_rooms`, `chat_messages` — комнаты и сообщения
- `chat_message_reactions`, `chat_message_reads` — реакции и прочтения
- `chat_typing` — индикатор печатания
- `chat_escalations` — эскалации в поддержку
- `support_tickets`, `ticket_messages` — тикеты
- `canned_responses` — шаблонные ответы

### AI и автоматизация (5 таблиц)
- `ai_assistant_conversations`, `ai_assistant_logs` — AI-консультант
- `ai_learning_profiles`, `ai_learning_logs` — ML-профили
- `conversation_memories`, `relationship_contexts` — диалоговый движок

### Безопасность и модерация (6 таблиц)
- `audit_log` — аудит действий (snake_case)
- `audit_logs` — аудит (CamelCase, для Prisma)
- `fraud_alerts` — антифрод-алерты
- `fraud_log` — лог антифрод-проверок
- `moderation_reports` — жалобы
- `moderation_queue`, `moderation_rules` — очередь модерации

### Email и уведомления (5 таблиц)
- `email_messages` — лог email-сообщений
- `notifications` — in-app уведомления
- `push_subscriptions` — push-подписки
- `holiday_reminders` — напоминания о праздниках
- `operator_escalations` — эскалации операторам

---

## SQL RPC функции (27 штук, миграция 0013)

Атомарные операции, защищающие от race conditions:

### Counters (атомарные инкременты/декременты)
- `increment_followers(p_confectioner_id)` — подписчики
- `decrement_followers(p_confectioner_id)`
- `increment_likes(p_post_id)` — лайки
- `decrement_likes(p_post_id)`
- `increment_views(p_post_id)` — просмотры
- `toggle_follow_channel(p_confectioner_id, p_user_id)` — переключатель подписки

### Balance operations (с SELECT FOR UPDATE)
- `deduct_bonus_balance(p_user_id, p_amount)` — списание бонусов
- `deduct_confectioner_balance(p_confectioner_id, p_amount)` — выплаты
- `add_bonus_balance(p_user_id, p_amount, p_reason)` — начисление

### Revenue aggregation
- `revenue_today(p_confectioner_id)` — выручка за сегодня
- `revenue_month(p_confectioner_id, p_month, p_year)` — за месяц
- `revenue_year(p_confectioner_id, p_year)` — за год
- `orders_count_today(p_confectioner_id)`

### Escrow operations
- `release_escrow(p_order_id)` — релиз эскроу после доставки
- `refund_escrow(p_order_id, p_reason)` — возврат при споре
- `split_escrow(p_order_id, p_confectioner_share, p_platform_share)` — разделение

---

## RLS (Row Level Security)

Большинство таблиц имеют RLS-политики, обеспечивающие:
- **SELECT:** пользователь видит только свои записи или публичные
- **INSERT:** только аутентифицированные, с проверкой ownership
- **UPDATE:** только владелец или админ
- **DELETE:** только владелец или суперапдмин

Пример типичной политики:
```sql
CREATE POLICY "orders_select_own_or_admin" ON public.orders
  FOR SELECT USING (
    customer_id = auth.uid()
    OR confectioner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );
```

В PGlite-режиме `auth.uid()` заменяется на `NULL::uuid`, поэтому RLS фактически
отключён — это нормально для локальной разработки.

---

## Диагностика проблем

### "PG_VERSION mismatch"

Старый volume содержит данные от предыдущей версии PostgreSQL:
```bash
docker-compose -f docker-compose.dev.yml down -v
docker volume rm uyezdny_uyezdny-db-dev-data-v18
./scripts/init-db.sh
```

### "extension uuid-ossp is not available" (PGlite)

Это нормально — PGlite не поддерживает `CREATE EXTENSION`. Скрипт
`init-db-local.ts` автоматически пропускает эти операторы и заменяет
`uuid_generate_v4()` на `gen_random_uuid()` (pgcrypto bundled).

### "current transaction is aborted, commands ignored"

Это происходит в PostgreSQL, когда statement внутри транзакции падает.
Скрипт `init-db-local.ts` оборачивает каждое statement в `BEGIN`/`COMMIT` и
делает `ROLLBACK` при ошибке — остальные statements продолжают выполняться.

### "auth.uid() function not found" (PGlite)

PGlite не имеет `auth` schema. Скрипт `init-db-local.ts` заменяет `auth.uid()`
на `NULL::uuid`. RLS-политики становятся noop (всегда TRUE для SELECT/INSERT),
что нормально для локальной разработки.

### "invalid input value for enum user_role: 'XYZ'"

В enum `user_role` 25 значений (см. миграцию 0001). Если в коде используется
роль, которой нет в enum — нужно либо добавить её в 0001, либо переименовать
в коде. Текущие роли: CUSTOMER, CONFECTIONER, ADMIN, SUPER_ADMIN, COURIER,
SUPPLIER, VENUE_OWNER, ANIMATOR_AGENCY, RECREATION_CENTER, KIDS_CLUB, GUEST,
MODERATOR, SUPPORT, STUDIO, BLOGGER, TASTER, FRANCHISEE, NUTRITIONIST,
CORPORATE_CLIENT, QUALITY_INSPECTOR, CERTIFICATION_AGENT, COPYWRITER,
FOOD_SERVICE, EVENT_ORGANIZER, PICKUP_POINT, WHOLESALER.

---

## Скрипты для управления

| Скрипт | Назначение |
|--------|-----------|
| `./scripts/init-db.sh` | Запуск Docker dev + миграции + seed |
| `./scripts/init-db.sh supabase` | Запуск Docker Supabase stack |
| `./scripts/init-db.sh pglite` | Локальная PGlite (без Docker) |
| `./scripts/init-db.sh pglite-reset` | Сброс + инициализация PGlite |
| `npx tsx scripts/init-db-local.ts --pglite` | Прямой вызов PGlite-скрипта |
| `npx tsx scripts/init-db-local.ts --pg` | Прямой вызов PostgreSQL-скрипта |
| `npx tsx scripts/check-tables.ts` | Проверка таблиц в PGlite |
| `npx tsx scripts/apply-migrations.ts` | Применение миграций к существующей БД |
| `npx tsx scripts/smoke-test-db.ts` | Smoke-тест: чтение/запись/типы |

---

## Production deployment

### Docker (рекомендуется)

```bash
# Сборка образа
docker build -t uyezdny-konditer .

# Запуск с подключением к production PostgreSQL
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@db-host:5432/uyezdny \
  -e NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  -e JWT_SECRET=your-secret-64-chars-minimum \
  uyezdny-konditer
```

### Миграция production БД

```bash
# 1. Backup текущей БД
docker exec prod-db pg_dump -U user -d uyezdny > backups/pre-migration.sql

# 2. Применение миграций по порядку
for f in supabase/migrations/*.sql; do
  echo "Applying $f..."
  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME \
    -v ON_ERROR_STOP=0 -f "$f"
done

# 3. Проверка
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
# Должно быть 197+
```

### Откат миграции

Большинство миграций используют `CREATE TABLE IF NOT EXISTS` — идемпотентны.
Для отката конкретной таблицы:

```sql
DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.venues CASCADE;
-- и т.д.
```

---

## Контакты

- **Документация по миграциям:** `supabase/migrations/README.md` (в каждом файле)
- **Скрипты:** `scripts/init-db.sh`, `scripts/init-db-local.ts`
- **Docker конфиги:** `docker-compose.dev.yml`, `docker-compose.supabase.yml`
- **Проблемы:** создавайте issue в GitHub с логом ошибки и шагами воспроизведения
