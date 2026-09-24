# Миграция БД: SQLite → PostgreSQL

Дата: 2026-07-13
Проект: Уездный кондитер

## Что изменилось

### 1. Schema (`prisma/schema.prisma`)

- **provider** изменён с `sqlite` на `postgres`.
- **previewFeatures = ["driverAdapters"]** — поддержка PGlite адаптера.
- Все поля, хранившие JSON как строку (`String` + `JSON.stringify`), теперь используют нативные типы PostgreSQL:
  - Объекты → `Json` (внутри используется JSONB, поддерживает индексацию GIN)
  - Массивы строк → `String[]`
  - Массивы объектов → `Json` (потому что Prisma не поддерживает `Json[]` напрямую)
- Добавлены **enum'ы** для всех строковых полей с фиксированным набором значений:
  - `UserRole` (CUSTOMER, CONFECTIONER, ADMIN, SUPER_ADMIN, COURIER, SUPPLIER, VENUE_OWNER, ANIMATOR_AGENCY, RECREATION_CENTER, KIDS_CLUB)
  - `LoyaltyLevel` (BRONZE, SILVER, GOLD, PLATINUM)
  - `AccountType` (individual, legal)
  - `TrustLevel` (NEW, VERIFIED, MASTER, EXPERT)
  - `Tariff` (START, BASIC, PREMIUM, BUSINESS)
  - `TaxMode` (NPD, USN, OSNO, PSN, SELF_EMPLOYED)
  - `OrderStatus` (10 значений)
  - `PaymentStatus` (5 значений)
  - `PaymentMethod` (7 значений)
- Добавлены **индексы** на часто фильтруемые поля (city, status, confectionerId, category, isPopular, isNew, isHit и др.)
- `GiftCertificate.toEmail` foreign key заменён на `toUserId String?` (более корректная связь через PK, а не email).

### 2. Database client (`src/lib/db.ts`)

Двойной режим работы:

| Среда | Поведение |
|-------|-----------|
| **PRODUCTION** (`NODE_ENV=production`) | Прямое подключение к PostgreSQL через `DATABASE_URL`. PGlite не используется. |
| **DEVELOPMENT** (default) | Сначала пробует реальный PostgreSQL (через `pg` драйвер, 3-сек таймаут). Если недоступен — fallback на **PGlite** (WASM PostgreSQL, встроенный в процесс). |

**Преимущества PGlite:**
- Не требует установки PostgreSQL на машине разработчика
- Не требует Docker
- Реальный PostgreSQL (скомпилирован в WASM) — те же SQL, те же типы, та же семантика
- Файлы БД хранятся локально в `db/pglite-dev/`
- Объём: ~3.7 МБ

### 3. Скрипт миграций (`scripts/migrate-pglite.ts`)

Поскольку Prisma CLI не умеет работать напрямую с PGlite (его engine подключается через TCP), скрипт:

1. Генерирует SQL из schema через `prisma migrate diff --from-empty --to-schema-datamodel ...`
2. Применяет SQL к PGlite напрямую, оператор за оператором
3. Записывает применённые миграции в таблицу `_prisma_migrations` (как это делает Prisma)

SQL миграция сохранена в `prisma/migrations/0000_init.sql` (708 строк).

### 4. API routes

Удалены все вызовы `JSON.parse()` и `JSON.stringify()` для полей, которые теперь используют нативные типы Prisma. Затронутые файлы:

- `src/app/api/confectioners/route.ts`
- `src/app/api/products/route.ts`
- `src/app/api/promotions/route.ts`
- `src/app/api/orders/route.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/refresh/route.ts`
- `src/app/api/payment/create/route.ts`

Prisma теперь возвращает JSON-поля как разобранные объекты, а массивы — как `String[]`, поэтому ручной парсинг больше не нужен.

### 5. Seed (`prisma/seed.ts`)

Обновлён: значения передаются напрямую (массивы и объекты), без `JSON.stringify()`. Enum'ы передаются как строки (валидируются Prisma).

## Как пользоваться

### Локальная разработка (PGlite)

```bash
# 1. Применить схему к PGlite (создаст таблицы в db/pglite-dev/)
bun run db:migrate:pglite

# 2. Заполнить БД начальными данными
bun run db:seed

# 3. Запустить dev-сервер
bun run dev
```

Сбросить локальную БД:
```bash
bun run db:reset:pglite   # удаляет db/pglite-dev/ и применяет миграцию заново
```

### Production (реальный PostgreSQL)

`docker-compose.yml` уже настроен:

```yaml
db:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: uyezdny
    POSTGRES_PASSWORD: uyezdny_pass
    POSTGRES_DB: uyezdny_konditer
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

```bash
# 1. Поднять инфраструктуру
docker-compose up -d db redis

# 2. Применить миграции (Prisma CLI подключается напрямую)
DATABASE_URL=postgresql://uyezdny:uyezdny_pass@localhost:5432/uyezdny_konditer?schema=public \
  bunx prisma migrate deploy

# 3. Заполнить БД
DATABASE_URL=postgresql://uyezdny:uyezdny_pass@localhost:5432/uyezdny_konditer?schema=public \
  bun run db:seed

# 4. Запустить приложение
docker-compose up -d web
```

### Перегенерация SQL-миграции

После изменения `schema.prisma`:

```bash
# 1. Сгенерировать новый SQL
bun run db:migration:gen

# 2. Применить к PGlite
bun run db:reset:pglite

# 3. Перегенерировать клиент
bun run db:generate
```

## Преимущества миграции

1. **Типобезопасность**: enum'ы и нативные типы проверяются на уровне БД.
2. **Производительность**: GIN-индексы на JSONB, массивы как нативный тип (без парсинга на лету).
3. **Сложные запросы**: `tags: { has: 'ягоды' }`, `roles: { has: 'ADMIN' }`, JSONB-операторы `@>`, `?`, `#>>`.
4. **Совместимость с прод-стеком**: docker-compose уже использует PostgreSQL 16, теперь dev-БД имеет ту же схему и типы.
5. **Меньше кода**: не нужно `JSON.parse`/`JSON.stringify` в каждом API route.
6. **Лёгкий onboarding**: новый разработчик клонирует репо, запускает `db:migrate:pglite && db:seed` — и работает, без установки PostgreSQL или Docker.

## Smoke test

```bash
bun run scripts/smoke-test-db.ts
```

Проверяет:
- Подключение к БД
- Чтение пользователя с `roles` (UserRole[]) и `loyaltyLevel` (enum)
- Чтение кондитера с `location` (Json), `specialization` (String[]), `ecoBadges` (String[])
- Чтение товара с `images`, `tags`, `fillings` (Json)
- Фильтр по массиву: `product.findMany({ tags: { has: 'ягоды' } })`
- Фильтр по enum: `user.findMany({ loyaltyLevel: 'GOLD' })`
- Create + read round-trip: продукт с native типами создаётся, читается, удаляется
