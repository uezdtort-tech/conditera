# Разворачивание: Docker + локально

## Проблема

При запуске части сервисов в Docker и части локально (Next.js) возникают
несколько типичных проблем:

### 1. .env.local пропадает после распаковки архива

**Причина:** Архив не всегда содержит .env.local (он в .gitignore).

**Решение:** Всегда создавать .env.local после распаковки:

```bat
cd C:\www\Uezdny
copy .env .env.local
:: Отредактировать .env.local — см. ниже
```

### 2. DATABASE_URL = file: protocol (PGlite/SQLite)

**Причина:** Файл `.env` содержит `DATABASE_URL=file:...` — это PGlite/SQLite
протокол. Если используется Docker PostgreSQL, Next.js пытается подключиться
к файлу вместо PostgreSQL.

**Решение:** В `.env.local` раскомментировать PostgreSQL URL:

```bash
# Для Docker dev (docker-compose.dev.yml):
DATABASE_URL=postgresql://uyezdny:uyezdny_dev_pass@localhost:5433/uyezdny_konditer_dev?schema=public

# Для Supabase local (docker-compose.supabase.yml):
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.UDfRkk0IVjJWLn1JT6o4vl9Aw1k2jEr3M7tDwP4mPhA
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.UDfRkk0IVjJWLn1JT6o4vl9Aw1k2jEr3M7tDwP4mPhA
```

### 3. Supabase URL не настроен

**Причина:** `NEXT_PUBLIC_SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` не заданы.
Admin клиент падает в stub-режим (http://localhost:8000 с фейковым ключом).

**Решение:** Добавить в `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.UDfRkk0IVjJWLn1JT6o4vl9Aw1k2jEr3M7tDwP4mPhA
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.UDfRkk0IVjJWLn1JT6o4vl9Aw1k2jEr3M7tDwP4mPhA
```

### 4. Docker контейнеры используют разные порты

**dev (docker-compose.dev.yml):**
- PostgreSQL: **5433** (внешний) → 5432 (контейнер)
- Redis: **6380** → 6379
- Meilisearch: **7700**
- Mailpit: **8025** (UI), **1025** (SMTP)
- n8n: **5678**

**Supabase (docker-compose.supabase.yml):**
- Kong API: **8000**
- PostgreSQL: **5432** (не проброшен наружу, доступ через Kong)
- Studio: **8100** (изменён, чтобы не конфликтовать с Next.js на 3000)

**production (docker-compose.yml):**
- Next.js: **3000**
- Caddy: **80, 443**
- PostgreSQL: 5432 (внутри сети, не проброшен)
- Chat: 3030 (внутри сети)

### 5. Next.js не видит Docker-сервисы

**Причина:** Next.js запускается локально (npm run dev:local) и обращается
к localhost:PORT. Docker-контейнеры пробрасывают порты на localhost.

**Решение:** Убедиться что .env.local содержит правильные порты:

```bash
# Docker dev (PostgreSQL на порту 5433):
DATABASE_URL=postgresql://uyezdny:uyezdny_dev_pass@localhost:5433/uyezdny_konditer_dev?schema=public
REDIS_URL=redis://localhost:6380
MEILI_URL=http://localhost:7700

# Docker Supabase (API на порту 8000):
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
```

### 6. Docker-контейнер не видит хост (Ollama/n8n)

**Причина:** Контейнеры в Docker не имеют доступа к localhost хоста.

**Решение:** Использовать `host.docker.internal`:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
environment:
  - OLLAMA_HOST=http://host.docker.internal:11434
  - APP_URL=http://host.docker.internal:3000
```

## Рекомендуемый workflow для C:\www\Uezdny

### Вариант 1: Только локально (без Docker) — самый простой

```bat
:: 1. Создать .env.local (из .env или вручную)
:: 2. Инициализировать PGlite БД
npx tsx scripts\init-db-local.ts --pglite

:: 3. Запустить Next.js
npm run dev:local
```

### Вариант 2: Docker для сервисов + Next.js локально

```bat
:: 1. Запустить Docker сервисы
docker-compose -f docker-compose.dev.yml up -d

:: 2. Раскомментировать в .env.local:
::    DATABASE_URL=postgresql://uyezdny:uyezdny_dev_pass@localhost:5433/uyezdny_konditer_dev?schema=public
::    REDIS_URL=redis://localhost:6380
::    MEILI_URL=http://localhost:7700

:: 3. Инициализировать PostgreSQL БД
docker exec -i uyezdny-db-dev psql -U uyezdny -d uyezdny_konditer_dev -f /migrations/0001_init.sql
:: (или запустить init-db.sh)

:: 4. Запустить Next.js локально
npm run dev:local
```

### Вариант 3: Полный Supabase в Docker

```bat
:: 1. Запустить Supabase
docker-compose -f docker-compose.supabase.yml up -d

:: 2. Добавить в .env.local:
::    NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
::    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
::    SUPABASE_SERVICE_ROLE_KEY=eyJ...

:: 3. Запустить Next.js локально
npm run dev:local
```

### Вариант 4: Полный production в Docker

```bat
:: 1. Создать .env.production с реальными секретами
:: 2. Запустить
docker-compose up -d
:: Все сервисы в Docker, включая Next.js
```

## Чек-лист перед запуском

- [ ] .env.local существует и содержит DATABASE_URL (или пустой для PGlite)
- [ ] .env не содержит `file:` protocol (использовать postgresql://)
- [ ] Docker-контейнеры запущены (если используются)
- [ ] Порты не конфликтуют (5433 для dev, 5432 для supabase, 3000 для Next.js)
- [ ] host.docker.internal настроен (для Docker → хост коммуникации)
