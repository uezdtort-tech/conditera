// prisma.config.ts (в корне проекта)
// ====================================================================
// Конфигурация Prisma v7 — datasource теперь здесь, а не в schema.prisma.
//
// Документация: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/no-data-source
//
// Файл загружается Prisma CLI (generate, migrate, db push) и runtime
// (@prisma/client) автоматически. Поддерживает:
//   - process.env.DATABASE_URL — стандартная переменная окружения
//   - явная загрузка .env через dotenv (Prisma v7 не грузит .env сам)
// ====================================================================

import { defineConfig } from 'prisma/config'
import path from 'node:path'

// Prisma v7 не загружает .env автоматически — делаем это сами.
// Загружаем .env.local > .env.development > .env, с override=true,
// чтобы всегда брать значение из файла (а не из случайного shell env).
// В production (docker-compose) DATABASE_URL задаётся через environment block,
// и .env файла нет — dotenv просто не найдёт его и оставит process.env как есть.
try {
  const dotenv = require('dotenv')
  const candidates = ['.env.local', '.env.development', '.env']
  for (const file of candidates) {
    const result = dotenv.config({ path: file, override: true })
    if (!result.error && process.env.DATABASE_URL) {
      break
    }
  }
} catch {
  // dotenv не установлен (маловероятно, но безопасно) — продолжаем с тем что есть в process.env
}

// Если DATABASE_URL до сих пор не задан — кидаем понятную ошибку,
// а не падаем с загадочным P1013 о `file:` протоколе.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    `[prisma.config.ts] DATABASE_URL is not set. ` +
      `Create a .env file in the project root with:\n` +
      `  DATABASE_URL=postgresql://conditera:conditera_dev_pass@localhost:5433/conditera_dev?schema=public\n` +
      `(for production use your real Postgres connection string)`
  )
}

// Защита от случайного использования file: URL (PGlite/SQLite) —
// schema.prisma объявлен как provider=postgresql, и Prisma CLI всё равно упадёт с P1013.
// Лучше дать понятное сообщение раньше.
if (databaseUrl.startsWith('file:')) {
  throw new Error(
    `[prisma.config.ts] DATABASE_URL="${databaseUrl}" uses file: protocol, ` +
      `but schema.prisma declares provider=postgresql. ` +
      `Set DATABASE_URL to a real PostgreSQL connection string, e.g.:\n` +
      `  DATABASE_URL=postgresql://conditera:conditera_dev_pass@localhost:5433/conditera_dev?schema=public`
  )
}

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),

  // Реальный PostgreSQL — для production и для dev (через docker-compose.dev.yml)
  // В dev runtime (src/lib/db.ts) есть fallback на PGlite если БД недоступна.
  datasource: {
    url: databaseUrl,
  },

  migrations: {
    path: path.join(__dirname, 'prisma/migrations'),
  },
})
