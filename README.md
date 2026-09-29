# Уездный кондитер (Conditera)

> Маркетплейс кондитерских изделий от частных кондитеров России.
> Next.js 16 (App Router) + React 19 + TypeScript + **Supabase** (PostgreSQL) + Zustand.

[![License](https://img.shields.io/badge/license-Proprietary-blue)](#)
[![Node](https://img.shields.io/badge/node-20.x-green)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](#)

> **Важно (v2.0):** Prisma полностью удалена из проекта (использование запрещено ТЗ).
> Вся работа с БД — через `supabase-js` (`src/lib/supabase/admin.ts`, `browser.ts`).
> Файл `src/lib/db.ts` остаётся compatibility-shim: реэкспортирует `supabaseAdmin` как `db`
> для старых импортов. Каталог `prisma/` — legacy, из него используется только `seed.ts`.

## Возможности

### Для покупателей
- Каталог тортов и десертов с фильтрами (город, рейтинг, самовывоз)
- Конструктор тортов (форма, размер, начинка, покрытие, декор)
- Эскроу-платежи через YooKassa (деньги кондитеру после подтверждения получения)
- Групповые заказы и оплата по долям (split-платежи)
- Программа лояльности: баллы за покупки, 4 уровня (Бронза → Платина)
- AR-просмотр тортов (`@google/model-viewer`)
- Чат с кондитером (Socket.IO) + приватный E2E-канал SimpleX
- Push-уведомления, PWA
- AI-инструменты: умный поиск десертов, ИИ-сравнение, «Помочь выбрать»

### Для кондитеров
- Дашборд: заказы, каталог, финансы, налоги (НПД/УСН/ОСНО), акции, рецепты
- CRM-клиенты, маркетинг, склад и инвентарь
- Канал (микро-блог), дегустации, отзывы, команда
- Конструктор цен, оптовые цены
- 2FA (TOTP RFC 6233) при логине и выплатах
- Авто-верификация через DaData (ИНН организаций)

### Для операторов
- Авточат: FAQ-бот, эскалация на оператора, canned responses
- Дашборд оператора с очередью чатов
- Модерация отзывов, баннеров, страниц CMS

## Архитектура

- **Backend:** Next.js 16 (App Router), ~68 групп API-роутов, 18 cron-задач (`src/app/api/cron/`)
- **Database:** self-hosted Supabase — PostgreSQL 15 + Kong + GoTrue + Storage + Studio (`docker-compose.supabase.yml`)
- **Migrations:** SQL-файлы `supabase/migrations/0001..0038`, применяются скриптами `scripts/ops-apply-*.ts`
- **Realtime:** Socket.IO (chat, typing, online, order-tracking) — `mini-services/chat-server`
- **Payments:** YooKassa (mock/real, идемпотентность, IP whitelist, эскроу через cron)
- **Auth:** JWT (jose) + bcrypt + 2FA TOTP + OAuth (Telegram/Google/Yandex/VK)
- **Security:** anti-fraud rate-limiting, CSRF, CSP, security headers
- **Geolocation:** 180+ городов РФ + DaData + Яндекс.Геокодер (fallback-цепочка)
- **PWA:** manifest, service worker, push-уведомления (VAPID)
- **Mobile:** Expo React Native (`mobile-app/`)
- **SimpleX Chat:** гибридная модель (Socket.IO + E2E для премиум-тарифов) — `mini-services/simplex-bridge`

## Быстрый старт

### Требования
- Node.js 20+ / Bun 1.x
- Docker 24+ (для self-hosted Supabase)

### Установка

```bash
git clone https://github.com/uezdtort-tech/conditera.git
cd conditera
bun install

# Настроить окружение (интерактивный мастер)
bash scripts/setup-env.sh dev
# ИЛИ вручную:
#   cp .env.local.example .env.local
#   задать DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
#   SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET и т.д.

# Проверить готовность окружения
bash scripts/env-check.sh

# Запустить Supabase (PostgreSQL + Kong + GoTrue + Storage + Studio)
docker-compose -f docker-compose.supabase.yml up -d

# Применить миграции (SQL: supabase/migrations/0001..0038)
# — через ops-скрипты последовательности или psql, см. docs/DATABASE.md

# Заполнить тестовые данные (ТОЛЬКО для dev-окружения!)
bun run db:seed

# Запуск dev-сервера
bun run dev:local
# → http://localhost:3000
```

> ⚠️ `bun run dev` в этом репозитории — production-режим (`next build && next start`).
> Для разработки используйте `bun run dev:local`.

### Production (Docker)

```bash
cp .env.production.example .env.production
# Сгенерировать секреты:
openssl rand -base64 48  # JWT_SECRET
openssl rand -hex 32    # TFA_ENCRYPTION_KEY
openssl rand -hex 32    # SIMPLEX_BRIDGE_API_KEY

docker-compose up -d
docker-compose ps
docker-compose logs -f web
```

> ⚠️ **Никогда не запускайте `db:seed` в production** — seed создаёт
> демонстрационные аккаунты с публично известными паролями (см. `prisma/seed.ts`).

## Структура проекта

```
├── supabase/                  # Самохостинг Supabase: миграции (0001..0038), config, seed
├── prisma/                    # LEGACY (Prisma удалена): используется только seed.ts
├── src/
│   ├── app/
│   │   ├── api/               # ~68 групп роутов: auth, orders, payment, chat,
│   │   │                      #   cron (18 задач), simplex, admin, ai, ...
│   │   └── ...                # страницы маркетплейса
│   ├── components/
│   │   ├── dashboard/         # дашборд кондитера
│   │   ├── marketplace/       # карточки, фильтры, карты
│   │   └── ui/                # shadcn/ui
│   └── lib/
│       ├── supabase/          # admin.ts, browser.ts — доступ к БД (v2.0)
│       ├── auth.ts            # JWT + 2FA temp token
│       ├── totp.ts            # RFC 6233 (нативный crypto)
│       ├── yookassa.ts        # платежи + эскроу
│       ├── anti-fraud.ts      # rate limiting (SHA-256 IP)
│       ├── csrf.ts            # double-submit cookie
│       └── geocoder.ts        # 180+ городов + DaData + Yandex
├── mini-services/
│   ├── chat-server/           # Socket.IO (порт 3030)
│   └── simplex-bridge/        # SimpleX bot-мост (порт 5226)
├── mobile-app/                # Expo React Native
├── scripts/                   # ops-apply-*.ts, db-push.mjs, setup-env.sh, env-check.sh
├── docs/                      # AUTH, DATABASE, DOCKER_DEPLOY, ROLE_MATRIX, DNS_SETUP...
├── docker-compose.supabase.yml  # Supabase-стек (Postgres, Kong, GoTrue, Storage, Studio)
├── docker-compose.yml         # production: web, db, redis, chat, n8n, caddy, ...
├── Dockerfile                 # multi-stage, standalone, healthcheck
└── Caddyfile                  # reverse-proxy + auto-HTTPS + security headers
```

## Безопасность

- **2FA при логине:** `/api/auth/login` возвращает `tfaRequired` + `tfaTempToken`; `/api/auth/2fa/login-verify` проверяет TOTP или backup-код
- **Socket.IO JWT auth:** проверка access-token из `handshake.auth.token` (jose)
- **Критичные секреты без fallback:** JWT_SECRET, TFA_ENCRYPTION_KEY, CRON_SECRET — приложение падает в production, если не заданы
- **CSRF:** double-submit cookie pattern (`src/lib/csrf.ts`)
- **CSP + security headers:** middleware.ts + next.config.ts + Caddyfile
- **Anti-fraud:** rate limiting по IP (SHA-256 хэш с солью, 152-ФЗ)
- **YooKassa IP whitelist:** проверка только в production
- **Эскроу через cron** (не setTimeout): переживает рестарты
- **Демо-аккаунты** создаёт только seed — не запускать в production (см. выше)

## Тестирование

```bash
bun run test          # Vitest
bun run test:e2e      # Playwright
bun run typecheck     # tsc --noEmit
bun run lint          # ESLint
```

## Документация

- [docs/AUTH.md](docs/AUTH.md) — аутентификация и роли
- [docs/DATABASE.md](docs/DATABASE.md) — схема БД и миграции
- [docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md) — деплой через Docker
- [docs/ROLE_MATRIX.md](docs/ROLE_MATRIX.md) — матрица ролей и доступа
- [docs/API_AUTH_MATRIX.md](docs/API_AUTH_MATRIX.md) — защита API-эндпоинтов

## Статус (v2.0, предрелиз)

Проверено и работает: production-сборка (`next build`), typecheck, lint, e2e
золотой путь (главная → каталог → карточка → корзина), деплой-пайплайн платформы.

Известные ограничения перед публичным production-релизом:
- CI-workflows (`.github/workflows/`) требуют чистки: сломанные `branches`, упоминания удалённого Prisma
- Покрытие автотестами минимальное; критичные пути проверены вручную
- Локализация: только русский язык
- Dual-lockfile: `bun.lock` + `package-lock.json` (см. issues)

## Лицензирование

- **Код маркетплейса:** Proprietary (закрытый)
- **SimpleX Chat (используется как есть):** AGPLv3 — не затрагивает backend маркетплейса
- **Next.js, React и прочие MIT/Apache-библиотеки:** их собственные лицензии
