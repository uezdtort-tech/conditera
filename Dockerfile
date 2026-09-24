# ====================================================================
# Dockerfile для «Уездного кондитера» — multi-stage production build
# ====================================================================
# Этапы:
#   1. deps     — установка ВСЕХ зависимостей (для build)
#   2. builder  — next build → standalone output
#   3. migrator — отдельный образ для прогона SQL миграций (одноразовый)
#   4. runner   — production-образ (только standalone + prod-deps)
#
# ВАЖНО: Начиная с v2.0 проект использует Supabase (а не Prisma).
# Миграции — это SQL файлы в supabase/migrations/*.sql
# Применяются через psql, а не через prisma migrate.
# ====================================================================

# --- Этап 1: Dependencies (all, including dev) ---
FROM node:20-alpine AS deps
WORKDIR /app

# Копируем package файлы
COPY package.json bun.lock* package-lock.json* ./
COPY .npmrc* ./

# Устанавливаем ВСЕ зависимости (нужны dev для build)
RUN if [ -f package-lock.json ]; then \
      npm ci --legacy-peer-deps; \
    elif [ -f bun.lock ]; then \
      npm install --legacy-peer-deps --no-package-lock; \
    else \
      npm install --legacy-peer-deps; \
    fi

# --- Этап 2: Build ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Собираем Next.js со standalone-выходом (см. next.config.ts: output: "standalone")
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Этап 3: Migrator (одноразовый init-контейнер) ---
# Запускается перед web, применяет SQL миграции через psql и завершается.
# Использует postgres:16-alpine чтобы был psql клиент.
FROM postgres:18-alpine AS migrator
WORKDIR /migrations

# Копируем все SQL миграции
COPY supabase/migrations /migrations
COPY supabase/seed.sql /seeds/01-seed.sql
COPY supabase/seed_cms_crm.sql /seeds/02-seed_cms_crm.sql
COPY supabase/seed_fillings.sql /seeds/03-seed_fillings.sql
COPY supabase/init-scripts/01-apply-migrations.sh /docker-entrypoint-initdb.d/01-apply-migrations.sh
RUN chmod +x /docker-entrypoint-initdb.d/01-apply-migrations.sh

# Migrator не запускается как демон — он запускает apply-migrations.sh и завершается
ENTRYPOINT ["sh", "/docker-entrypoint-initdb.d/01-apply-migrations.sh"]

# --- Этап 4: Production runner ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Создаём непривилегированного пользователя
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache dumb-init openssl wget

# Standalone-сборка Next.js содержит только нужные node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Supabase JS клиент (для runtime запросов к БД)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@supabase ./node_modules/@supabase
# pg — нужен для /api routes, использующих pg Client напрямую
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg ./node_modules/pg
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/xdg-basedir ./node_modules/xdg-basedir
# jose — для JWT
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jose ./node_modules/jose
# sharp — для оптимизации изображений
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp

# Создаём директорию для upload/backup
RUN mkdir -p /app/upload /app/backups && chown -R nextjs:nodejs /app/upload /app/backups

USER nextjs

EXPOSE 3000

# Healthcheck: проверяем что Next.js отвечает на /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health > /dev/null 2>&1 || exit 1

# Запускаем standalone Next.js сервер (миграции применяет отдельный migrator-контейнер)
CMD ["dumb-init", "node", "server.js"]
