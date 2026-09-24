# 🔧 PgBouncer + Meilisearch — интеграция

> Руководство по connection pooling (PgBouncer) и полнотекстовому поиску (Meilisearch).

---

## 📋 Содержание
1. [PgBouncer — connection pooling](#1-pgbouncer)
2. [Meilisearch — full-text search](#2-meilisearch)
3. [API endpoints](#3-api-endpoints)
4. [Запуск и проверка](#4-запуск-и-проверка)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. PgBouncer

### Что это
PgBouncer — lightweight connection pooler для PostgreSQL. Мультиплексирует клиентские соединения: 200 одновременных клиентов → 20 реальных соединений к БД.

### Зачем нужно
**Без PgBouncer:** Prisma открывает новое TCP-соединение на каждый запрос. При 100+ одновременных пользователях PostgreSQL упирается в `max_connections` (по умолчанию 100) и отказывает.

**С PgBouncer:** Клиенты подключаются к PgBouncer (порт 6432), который держит пул из 20 постоянных соединений к PostgreSQL. Запросы переиспользуют эти соединения.

### Конфигурация в docker-compose.yml

```yaml
pgbouncer:
  image: edoburu/pgbouncer:1.23.1
  environment:
    DB_HOST: db                    # реальная БД
    DB_USER: uyezdny
    DB_PASSWORD: ${POSTGRES_PASSWORD}
    DB_NAME: uyezdny_konditer
    POOL_MODE: transaction          # режим мультиплексирования
    MAX_CLIENT_CONN: 200            # максимум клиентских соединений
    DEFAULT_POOL_SIZE: 20           # реальных соединений к БД
    MIN_POOL_SIZE: 5                # минимум (держим открытыми)
    RESERVE_POOL_SIZE: 5            # reserve для пиков
    SERVER_IDLE_TIMEOUT: 240        # закрывать простаивающие (сек)
    QUERY_TIMEOUT: 60               # убивать долгие запросы (сек)
    AUTH_TYPE: scram-sha-256        # совместимо с PostgreSQL 16
  ports:
    - "6432:5432"                   # для внешних подключений (pgAdmin)
```

### Режим `transaction` (важно!)

PgBouncer работает в режиме `transaction` — это означает:
- ✅ Каждая транзакция может использовать разные real-соединения
- ✅ Prisma `$transaction()` работает корректно
- ❌ Session-level features НЕ работают:
  - `TEMP TABLE` (временные таблицы)
  - `SET` без транзакции
  - `LISTEN/NOTIFY`
  - `WITH HOLD CURSOR`

Для Prisma этого достаточно — все запросы в явных транзакциях.

### Подключение приложения

В `docker-compose.yml` сервис `web` использует:
```yaml
environment:
  # Через PgBouncer (для application queries)
  - DATABASE_URL=postgresql://uyezdny:...@pgbouncer:5432/uyezdny_konditer?schema=public&pgbouncer=true
  # Прямое подключение (для миграций — PgBouncer не поддерживает DDL)
  - DIRECT_DATABASE_URL=postgresql://uyezdny:...@db:5432/uyezdny_konditer?schema=public
```

Параметр `pgbouncer=true` в URL сообщает драйверу `pg` использовать совместимый режим.

### Мигратор — НАПРЯМУЮ к PostgreSQL

Сервис `migrator` подключается **напрямую** к `db:5432`, НЕ через PgBouncer:
```yaml
migrator:
  environment:
    - DATABASE_URL=postgresql://uyezdny:...@db:5432/uyezdny_konditer?schema=public
```
**Почему:** PgBouncer в `transaction` mode не поддерживает DDL операции (`CREATE TABLE`, `ALTER INDEX`). Миграции Prisma — это DDL.

### Мониторинг

```bash
# Подключиться к admin-консоли PgBouncer
docker exec -it uyezdny-pgbouncer psql -h localhost -p 5432 -u uyezdny pgbouncer

# В admin-консоли:
SHOW POOLS;       # статус пулов по базам
SHOW CLIENTS;     # активные клиенты
SHOW SERVERS;     # real-соединения к БД
SHOW STATS;       # статистика запросов
SHOW CONFIG;      # текущая конфигурация
```

### Когда менять настройки

| Симптом | Решение |
|---------|---------|
| `too many connections` в логах web | Увеличить `MAX_CLIENT_CONN` (200 → 500) |
| Медленные запросы под нагрузкой | Увеличить `DEFAULT_POOL_SIZE` (20 → 40) |
| PostgreSQL warning `max_connections` | Уменьшить `DEFAULT_POOL_SIZE` или увеличить `max_connections` в PostgreSQL |
| Долгие запросы таймаутятся | Увеличить `QUERY_TIMEOUT` (60 → 120 сек) |

---

## 2. Meilisearch

### Что это
Meilisearch — open-source поисковый движок с typo-tolerance, фильтрами, фасетами. Заменяет медленный `ILIKE '%...%'` в PostgreSQL.

### Возможности
- ⚡ **Мгновенный поиск** — ответ < 50ms даже на 100k документов
- 🔤 **Typo tolerance** — находит «шоколад» даже при опечатке «шакалад»
- 🎯 **Фильтры** — по категории, цене, кондитеру, городу
- 📊 **Фасеты** — для sidebar-фильтров (сколько товаров в каждой категории)
- ↕️ **Сортировка** — по цене, рейтингу, новизне
- 🌟 **Подсветка** — `<mark>торт</mark>` в результатах

### Конфигурация в docker-compose.yml

```yaml
meilisearch:
  image: getmeili/meilisearch:v1.12
  environment:
    MEILI_ENV: production
    MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}   # openssl rand -hex 32
    MEILI_DB_PATH: /meili_data
    MEILI_HTTP_ADDR: 0.0.0.0:7700
    MEILI_MAX_INDEXING_MEMORY: 512MB
    MEILI_MAX_INDEXING_THREADS: 2
    MEILI_SCHEDULE_SNAPSHOT: "true"          # авто-snapshot каждые 24ч
    MEILI_SNAPSHOT_DIR: /meili_data/snapshots
  ports:
    - "7700:7700"                            # Studio (admin UI)
  volumes:
    - meili_data:/meili_data
```

### Структура индекса `products`

```typescript
interface ProductSearchDocument {
  id: string
  title: string              // searchable
  description: string        // searchable
  category: string           // filterable, facet
  price: number              // filterable, sortable
  oldPrice?: number
  images: string[]
  confectionerId: string     // filterable
  confectionerName: string   // searchable
  city: string               // filterable, facet
  rating: number             // filterable, sortable
  reviewsCount: number       // sortable
  isPopular: boolean         // filterable
  isNew: boolean             // filterable
  isHit: boolean             // filterable
  tags: string[]             // searchable
  weight?: string
  servings?: number
  createdAt: string          // sortable (ISO date)
}
```

### Клиент `src/lib/meilisearch.ts`

Основные функции:
- `searchProducts(query, options)` — поиск с фильтрами
- `indexProduct(product)` — добавить/обновить один товар
- `indexProducts(products[])` — массовая индексация
- `deleteProductFromIndex(id)` — удалить товар
- `reindexAllProducts()` — полная переиндексация из БД
- `isMeilisearchHealthy()` — health check

### Конфигурация индекса

При инициализации (`initMeilisearchIndexes()`) настраивается:
- **Searchable attributes:** title, description, confectionerName, tags
- **Filterable attributes:** category, confectionerId, city, isPopular, isNew, isHit, price, rating
- **Sortable attributes:** price, rating, reviewsCount, createdAt
- **Typo tolerance:** 1 typo от 4 символов, 2 typos от 8 символов
- **Ranking rules:** words → typo → proximity → attribute → sort → exactness

---

## 3. API endpoints

### `GET /api/search`

Полнотекстовый поиск с фильтрами.

```bash
# Простой поиск
curl 'https://conditera.ru/api/search?q=торт'

# С фильтрами
curl 'https://conditera.ru/api/search?q=шоколад&category=cakes&maxPrice=3000&sort=price:asc'

# Пагинация
curl 'https://conditera.ru/api/search?q=торт&limit=24&offset=48'
```

**Параметры:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `q` | string | Поисковый запрос (пустая строка = показать все) |
| `category` | string | Фильтр по категории (cakes, cupcakes, ...) |
| `confectionerId` | string | Фильтр по кондитеру |
| `city` | string | Фильтр по городу |
| `minPrice` | number | Минимальная цена |
| `maxPrice` | number | Максимальная цена |
| `minRating` | number | Минимальный рейтинг (0-5) |
| `isPopular` | boolean | Только популярные |
| `isNew` | boolean | Только новинки |
| `isHit` | boolean | Только хиты |
| `sort` | enum | `price:asc`, `price:desc`, `rating:desc`, `createdAt:desc` |
| `limit` | number | Лимит (1-100, по умолчанию 24) |
| `offset` | number | Смещение для пагинации |

**Ответ:**
```json
{
  "query": "торт",
  "hits": [
    {
      "id": "p1",
      "title": "Торт «Праздничный»",
      "description": "...",
      "price": 1500,
      "images": ["https://..."],
      "confectionerName": "Сладкая уездная",
      "city": "Москва",
      "rating": 4.8,
      "reviewsCount": 124,
      "isPopular": true,
      ...
    }
  ],
  "totalHits": 156,
  "processingTimeMs": 12,
  "limit": 24,
  "offset": 0
}
```

### `POST /api/search/reindex`

Полная переиндексация товаров. Только для админов или через cron-secret.

```bash
# Ручной запуск (нужен JWT админа)
curl -X POST https://conditera.ru/api/search/reindex \
  -H "Authorization: Bearer <admin-jwt>"

# Через cron-secret (для n8n)
curl -X POST https://conditera.ru/api/search/reindex \
  -H "X-Cron-Secret: <CRON_SECRET>"
```

**Ответ:**
```json
{
  "success": true,
  "reindexed": 1247,
  "message": "Переиндексировано 1247 товаров"
}
```

### `GET /api/search/health`

Health check для мониторинга.

```bash
curl https://conditera.ru/api/search/health
# → {"status":"ok","service":"meilisearch","timestamp":"..."}
```

---

## 4. Запуск и проверка

### Первый запуск

```bash
# 1. Сгенерировать MEILI_MASTER_KEY (если ещё нет)
echo "MEILI_MASTER_KEY=$(openssl rand -hex 32)"

# 2. Добавить в .env.production:
# MEILI_MASTER_KEY=<сгенерированный ключ>
# MEILISearch_URL=http://meilisearch:7700

# 3. Запустить стек
docker compose up -d

# 4. Дождаться готовности всех сервисов
docker compose ps
# Все должны быть "healthy"

# 5. Проверить Meilisearch
curl http://localhost:7700/health
# → {"status":"available"}

# 6. Переиндексировать товары
curl -X POST http://localhost:3000/api/search/reindex \
  -H "X-Cron-Secret: $CRON_SECRET"
# → {"success":true,"reindexed":1247}

# 7. Проверить поиск
curl 'http://localhost:3000/api/search?q=торт&limit=5'
```

### Проверка PgBouncer

```bash
# 1. Проверить что web подключается через PgBouncer
docker compose logs web | grep "Connected to"
# → [db] Connected to PostgreSQL at DATABASE_URL

# 2. Проверить пул соединений
docker exec -it uyezdny-pgbouncer psql -h localhost -u uyezdny pgbouncer -c "SHOW POOLS;"
#  database         |   user    | cl_active | cl_waiting | cl_active_cancel_req | ...
#  uyezdny_konditer | uyezdny   |         5 |          0 |                    0 | ...

# 3. Проверить что миграции работают (через прямое подключение)
docker compose logs migrator
# → ✓ Migrations applied successfully
```

### Meilisearch Studio (admin UI)

Открыть в браузере: `http://localhost:7700`

- Ввести `MEILI_MASTER_KEY` для авторизации
- Видеть все индексы, документы, настройки
- Тестировать поиск в реальном времени
- Просматривать статистику (количество документов, размер индекса)

⚠️ **В production:** закрыть порт 7700 в firewall, оставить доступ только через VPN/SSH-туннель.

### Авто-reindex через cron

Добавить в crontab на сервере:
```bash
# Ежедневная переиндексация в 4:00 ночи
0 4 * * * curl -X POST http://localhost:3000/api/search/reindex \
  -H "X-Cron-Secret: $CRON_SECRET" > /var/log/meili-reindex.log 2>&1
```

Или через n8n workflow с триггером `cron` → HTTP request к `/api/search/reindex`.

---

## 5. Troubleshooting

### PgBouncer

#### `Cannot use query_timeout in transaction mode`
Это означает, что PgBouncer получил запрос с `statement_timeout` — не поддерживается в transaction mode.
**Решение:** Prisma не должен устанавливать `statement_timeout` через `SET`. Если используете — уберите.

#### `prepared statement "s1" already exists`
PgBouncer transaction mode не поддерживает prepared statements.
**Решение:** В `@prisma/adapter-pg` это уже отключено. Если используете raw `pg` — добавьте:
```typescript
const client = new Client({ connectionString, statement_timeout: 0 })
await client.query('DISCARD ALL')  // отключить prepared
```

#### `too many connections to PostgreSQL`
PgBouncer превысил `max_connections` PostgreSQL.
**Решение:**
```yaml
# Уменьшить DEFAULT_POOL_SIZE в pgbouncer
DEFAULT_POOL_SIZE: 10  # было 20

# ИЛИ увеличить max_connections в PostgreSQL
# Добавить в docker-compose.yml → db:
command: postgres -c max_connections=200
```

### Meilisearch

#### `Meilisearch is not available`
- Проверить что контейнер запущен: `docker compose ps meilisearch`
- Проверить `MEILI_MASTER_KEY` в `.env.production`
- Проверить логи: `docker compose logs meilisearch`

#### Поиск возвращает 0 результатов
- Проверить что индекс не пустой: `curl http://localhost:7700/indexes/products/stats -H "Authorization: Bearer $MEILI_MASTER_KEY"`
- Если пусто — запустить reindex: `POST /api/search/reindex`
- Проверить что в БД есть товары: `docker exec uyezdny-db psql -U uyezdny uyezdny_konditer -c "SELECT count(*) FROM Product;"`

#### Индексация зависла
- Проверить `MEILI_MAX_INDEXING_MEMORY` (512MB по умолчанию)
- Для больших каталогов (>10k товаров) увеличить:
  ```yaml
  MEILI_MAX_INDEXING_MEMORY: 2GB
  MEILI_MAX_INDEXING_THREADS: 4
  ```
- Проверить прогресс: `curl http://localhost:7700/indexes/products/stats`

#### Поиск не находит опечатки
- Проверить typo tolerance:
  ```bash
  curl http://localhost:7700/indexes/products/settings/typo-tolerance \
    -H "Authorization: Bearer $MEILI_MASTER_KEY"
  ```
- Минимум для 1 typo: 4 символа, для 2 typos: 8 символов

### Общие

#### После `docker compose down && up` поиск пустой
Meilisearch данные в volume `meili_data` — не теряются. Но если volume удалили:
```bash
# Переиндексировать
curl -X POST http://localhost:3000/api/search/reindex \
  -H "X-Cron-Secret: $CRON_SECRET"
```

#### High memory usage
PgBouncer (128M) + Meilisearch (1G) + остальные сервисы = ~3.5G
Если сервер с 4G RAM — может быть тесно. Уменьшить:
```yaml
meilisearch:
  deploy:
    resources:
      limits:
        memory: 512M  # было 1G
```

---

## 📊 Архитектура после интеграции

```
                    ┌─────────────┐
                    │   Caddy     │ ← HTTPS, порт 80/443
                    │  (proxy)    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐  ┌───▼────┐  ┌───▼──────┐
         │  web    │  │ chat   │  │   n8n    │
         │ Next.js │  │ Socket │  │ workflows│
         └────┬────┘  └───┬────┘  └────┬─────┘
              │           │            │
              │      ┌────▼────┐       │
              │      │ Redis   │       │
              │      │ cache   │       │
              │      └─────────┘       │
              │                        │
    ┌─────────┼──────────┐             │
    │         │          │             │
┌───▼────┐ ┌──▼─────┐ ┌──▼────────┐   │
│PgBouncer│ │Meili   │ │           │   │
│ (pool)  │ │search  │ │           │   │
│ :6432   │ │ :7700  │ │           │   │
└────┬────┘ └────────┘ └───────────┘   │
     │                                 │
┌────▼────┐                             │
│PostgreSQL│ ◄──────────────────────────┘
│  :5432  │   (n8n → webhook → web → БД)
└─────────┘
```

### Ресурсы (примерно)

| Сервис | CPU | RAM | Диск |
|--------|-----|-----|------|
| web | 2.0 | 1G | — |
| db (PostgreSQL) | 1.0 | 1G | 10G+ |
| **pgbouncer** | 0.3 | 128M | — |
| **meilisearch** | 1.0 | 1G | 1G+ |
| redis | 0.5 | 512M | — |
| caddy | 0.5 | 256M | — |
| chat-service | 0.5 | 512M | — |
| n8n | 1.0 | 1G | — |
| **Итого** | ~6.8 CPU | ~5.4G | ~11G |

Минимум: **8 CPU / 8 GB RAM / 20 GB disk**
