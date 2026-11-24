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
# v2 (e2e-fix): bun + bun.lock вместо npm. Прежний `npm install --no-package-lock`
# игнорировал bun.lock и разрешал зависимости по диапазонам — недетерминированное
# дерево (частая причина падений docker-build в CI). `bun install --frozen-lockfile`
# воспроизводит ровно то дерево, на котором проходят lint/test/build в CI.
# v3 (registry-hardening): базовые образы берём из public.ecr.aws (анонимные pull,
# без rate-limit 429 Docker Hub, на который ловил CI). oven/bun публичных зеркал не
# имеет — bun-CLI ставится из npm registry поверх node (musl-бинарь @oven/…-musl).
# merge с origin/main (Dependabot PR #10/#11): node 20 → 26, зеркало ECR сохранено.
FROM public.ecr.aws/docker/library/node:26-alpine AS deps
WORKDIR /app

RUN npm install -g bun@1 && bun --version

COPY package.json bun.lock ./
COPY .npmrc* ./

# Все зависимости (нужны dev для build); native-пакеты из trustedDependencies
# получают postinstall (embedded-postgres и т.п. билду не мешают)
RUN bun install --frozen-lockfile

# --- Этап 2: Build ---
FROM public.ecr.aws/docker/library/node:26-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public variables are embedded into the Next.js browser bundle.
# Production builds must receive real values from .env.production via Compose build args.
ARG GIT_SHA=unknown
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG CI=false
ENV APP_VERSION=${GIT_SHA}
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV CI=${CI}

# Собираем Next.js со standalone-выходом (см. next.config.ts: output: "standalone")
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Этап 3: Migrator (одноразовый init-контейнер) ---
# Запускается перед web, применяет SQL миграции через psql и завершается.
# Использует postgres:18-alpine чтобы был psql клиент (merge с origin/main,
# Dependabot PR #4: 16 → 18; зеркало ECR сохранено).
FROM public.ecr.aws/docker/library/postgres:18-alpine AS migrator
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
FROM public.ecr.aws/docker/library/node:26-alpine AS runner
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
    apk add --no-cache dumb-init openssl wget postgresql-client && \
    PG_DUMP_MAJOR="$(pg_dump --version | awk '{print $NF}' | cut -d. -f1)" && \
    PSQL_MAJOR="$(psql --version | awk '{print $NF}' | cut -d. -f1)" && \
    test "$PG_DUMP_MAJOR" -ge 18 && \
    test "$PSQL_MAJOR" -ge 18

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
RUN mkdir -p /app/upload /app/backups && chown -R nextjs:nodejs /app/upload /app/backups

USER nextjs

EXPOSE 3000

# Healthcheck: проверяем что Next.js отвечает на /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health > /dev/null 2>&1 || exit 1

# Запускаем standalone Next.js сервер (миграции применяет отдельный migrator-контейнер)
CMD ["dumb-init", "node", "server.js"]
