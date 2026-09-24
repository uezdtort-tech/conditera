# Установка проекта на Windows (C:\www\Uezdny)

## 1. Копирование проекта

Скопируйте проект в `C:\www\Uezdny`:
```bat
cd C:\www
:: Копируйте проект сюда любым способом (git clone, copy-paste, etc.)
cd Uezdny
```

## 2. Установка зависимостей

```bat
npm install --legacy-peer-deps
```

## 3. Локальная БД (PGlite, без Docker)

```bat
npx tsx scripts\init-db-local.ts --pglite
```

Или через скрипт (если установлен Git Bash / WSL):
```bat
bash scripts/init-db.sh pglite
```

БД создаётся в `C:\www\Uezdny\db\pglite-dev\` — 197 таблиц, 28 категорий, 45 начинок.

## 4. Dev-сервер

```bat
npm run dev:local
```

→ http://localhost:3000

## 5. Production build

```bat
npm run build
npm run start
```

## 6. Docker (опционально)

Если установлен Docker Desktop для Windows:

```bat
docker-compose -f docker-compose.dev.yml up -d
```

Это запустит:
- PostgreSQL 18 на порту 5433
- Redis на порту 6380
- Meilisearch на порту 7700
- Mailpit на порту 8025 (SMTP 1025)
- n8n на порту 5678

## 7. Проверка

```bat
npx tsc --noEmit        :: Typecheck (0 errors)
npx eslint .            :: Lint (0 errors)
npm run test            :: 731 unit-тестов
npm run build           :: Production build
```

## Важно для Windows

- Все пути в скриптах теперь **относительные** (используют `process.cwd()`)
- Shell-скрипты (`.sh`) требуют Git Bash или WSL
- TypeScript-скрипты (`.ts`) работают через `npx tsx` без bash
- Docker Desktop должен быть запущен перед `docker-compose`
- Если порт 3000 занят: `npx next dev -p 3001`

## .env.local

Файл `.env.local` уже настроен для локальной разработки:
- `DATABASE_URL` — PostgreSQL из docker-compose.dev.yml (порт 5433)
- `PGLITE_DB_PATH=./db/pglite-dev` — относительный путь
- `REDIS_URL=redis://localhost:6380`
- `MEILI_URL=http://localhost:7700`
- `SMTP_HOST=localhost` (Mailpit)
