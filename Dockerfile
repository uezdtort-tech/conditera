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
FROM oven/bun:1.4.5-alpine AS deps
WORKDIR /app

# Копируем package файлы
COPY package.json bun.lock ./.npmrc ./

# Устанавливаем ВСЕ зависимости (нужны dev для build)
RUN bun install --frozen-lockfile

# --- Этап 2: Build ---
FROM oven/bun:1.4.5-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# pay4: идентификация версии образа (передаётся из CI как GIT_SHA=${{ github.sha }})
ARG GIT_SHA=unknown
ENV APP_VERSION=${GIT_SHA}

# Next.js встраивает NEXT_PUBLIC_* значения в клиентские чанки ВО ВРЕМЯ build.
# Runtime env_file не может исправить уже собранный JS, поэтому все публичные
# production-параметры передаются отдельными build args через Compose.
# Здесь нет серверных секретов: anon key является публичным RLS-ключом.
ARG NEXT_PUBLIC_APP_URL=https://conditera.ru
ARG NEXT_PUBLIC_SUPABASE_URL=https://conditera.ru/api
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG NEXT_PUBLIC_YANDEX_METRIKA_ID=111432662
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_DESCRIPTION
ARG NEXT_PUBLIC_SUPPORT_EMAIL=support@conditera.ru
ARG NEXT_PUBLIC_INFO_EMAIL=info@conditera.ru
ARG NEXT_PUBLIC_PRIVACY_EMAIL=privacy@conditera.ru
ARG NEXT_PUBLIC_SUPPORT_PHONE
ARG NEXT_PUBLIC_SUPPORT_PHONE_HREF=+78000000000
ARG NEXT_PUBLIC_COMPANY_ADDRESS=
ARG NEXT_PUBLIC_COMPANY_INN=
ARG NEXT_PUBLIC_COMPANY_OGRN=
ARG NEXT_PUBLIC_TELEGRAM_CHANNEL=@conditera
ARG NEXT_PUBLIC_TELEGRAM_URL=https://t.me/conditera
ARG NEXT_PUBLIC_VK_URL=
ARG NEXT_PUBLIC_INSTAGRAM_URL=
ARG NEXT_PUBLIC_LEGAL_NAME=
ARG NEXT_PUBLIC_LEGAL_ADDRESS=
ARG NEXT_PUBLIC_FOUNDED_YEAR=2024
ARG NEXT_PUBLIC_CHAT_URL="/?XTransformPort=3030"
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG SUPABASE_STORAGE_HOSTNAME=
ARG SUPABASE_STORAGE_PROTOCOL=https

ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_YANDEX_METRIKA_ID=${NEXT_PUBLIC_YANDEX_METRIKA_ID} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
    NEXT_PUBLIC_APP_DESCRIPTION=${NEXT_PUBLIC_APP_DESCRIPTION} \
    NEXT_PUBLIC_SUPPORT_EMAIL=${NEXT_PUBLIC_SUPPORT_EMAIL} \
    NEXT_PUBLIC_INFO_EMAIL=${NEXT_PUBLIC_INFO_EMAIL} \
    NEXT_PUBLIC_PRIVACY_EMAIL=${NEXT_PUBLIC_PRIVACY_EMAIL} \
    NEXT_PUBLIC_SUPPORT_PHONE=${NEXT_PUBLIC_SUPPORT_PHONE} \
    NEXT_PUBLIC_SUPPORT_PHONE_HREF=${NEXT_PUBLIC_SUPPORT_PHONE_HREF} \
    NEXT_PUBLIC_COMPANY_ADDRESS=${NEXT_PUBLIC_COMPANY_ADDRESS} \
    NEXT_PUBLIC_COMPANY_INN=${NEXT_PUBLIC_COMPANY_INN} \
    NEXT_PUBLIC_COMPANY_OGRN=${NEXT_PUBLIC_COMPANY_OGRN} \
    NEXT_PUBLIC_TELEGRAM_CHANNEL=${NEXT_PUBLIC_TELEGRAM_CHANNEL} \
    NEXT_PUBLIC_TELEGRAM_URL=${NEXT_PUBLIC_TELEGRAM_URL} \
    NEXT_PUBLIC_VK_URL=${NEXT_PUBLIC_VK_URL} \
    NEXT_PUBLIC_INSTAGRAM_URL=${NEXT_PUBLIC_INSTAGRAM_URL} \
    NEXT_PUBLIC_LEGAL_NAME=${NEXT_PUBLIC_LEGAL_NAME} \
    NEXT_PUBLIC_LEGAL_ADDRESS=${NEXT_PUBLIC_LEGAL_ADDRESS} \
    NEXT_PUBLIC_FOUNDED_YEAR=${NEXT_PUBLIC_FOUNDED_YEAR} \
    NEXT_PUBLIC_CHAT_URL=${NEXT_PUBLIC_CHAT_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    SUPABASE_STORAGE_HOSTNAME=${SUPABASE_STORAGE_HOSTNAME} \
    SUPABASE_STORAGE_PROTOCOL=${SUPABASE_STORAGE_PROTOCOL}

# Собираем Next.js со standalone-выходом (см. next.config.ts: output: "standalone")
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# --- Этап 3: Migrator (одноразовый init-контейнер) ---
# Запускается перед web, применяет SQL миграции через psql и завершается.
# Использует postgres:17-alpine чтобы версия клиентских утилит совпадала с целевой БД PG17.
FROM postgres:17-alpine AS migrator
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
FROM node:26-alpine AS runner
WORKDIR /app

# Версия образа (commit SHA) — видна в /api/health
ARG GIT_SHA=unknown
ENV APP_VERSION=${GIT_SHA}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Создаём непривилегированного пользователя
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache dumb-init openssl wget postgresql17-client tar gzip

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
# jose — для JWT
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jose ./node_modules/jose
# sharp — для оптимизации изображений
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp

# Создаём директорию для upload/backup
RUN mkdir -p /app/upload /app/backups /app/storage /app/supabase-storage && chown -R nextjs:nodejs /app/upload /app/backups /app/storage

USER nextjs

EXPOSE 3000

# Healthcheck: проверяем что Next.js отвечает на /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health > /dev/null 2>&1 || exit 1

# Запускаем standalone Next.js сервер (миграции применяет отдельный migrator-контейнер)
CMD ["dumb-init", "node", "server.js"]
