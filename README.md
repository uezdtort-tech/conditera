# Уездный кондитер / Conditera — локальный запуск БЕЗ Docker

## Быстрый старт (Windows / macOS / Linux)

```text
1. Установите Node.js 20+            → https://nodejs.org
2. Установите PostgreSQL              → https://www.postgresql.org/download/windows/
   (или пропустите — встроенный dev-PostgreSQL поставится через npm, см. шаг 5)
3. Создайте базу:  CREATE DATABASE conditera;
4. Скопируйте .env.example → .env.local и укажите DATABASE_URL
5. npm install
6. npm run db:setup        → миграции + сиды + демо-юзеры + ключи (.env.local)
   Своя PostgreSQL недоступна?  npm run db:start  — встроенный PostgreSQL на :54329
7. npm run dev             → http://localhost:3000
8. Опционально: npx n8n (порт 5678) — автоматизации; приложение работает и без него
```

Демо-аккаунты (создаёт db:setup, пароль у всех `Demo123!`):
customer@demo.ru · confectioner@demo.ru · admin@demo.ru · support@demo.ru · decor@demo.ru · animator@demo.ru

## Архитектура локального рантайма

```text
Windows ── PostgreSQL (локально) ── Next.js (npm run dev, :3000) ── браузер
                                       │
                                       ├── /api/**        — REST API приложения
                                       ├── /rest/v1/**    — PostgREST-шим (supabase-js → SQL)
                                       ├── /storage/v1/** — файловое хранилище (upload/storage)
                                       └── /api/health    — {app, database, n8n, environment}
n8n (localhost:5678) ← webhook-события (fail-safe, необязателен)
```

- **Docker не требуется.** Прежние docker-compose файлы оставлены как legacy deployment-тулинг.
- Данные БД встроенного PostgreSQL лежат в `.pgdata/` (команды: `npm run db:start|stop|status`).
- Секреты не хранятся в Git: `.env*` игнорируется, `.env.example` — шаблон.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер Next.js на :3000 |
| `npm run db:setup` | проверить PG → миграции → сиды → демо-юзеры → ключи |
| `npm run db:start / db:stop / db:status` | встроенный PostgreSQL (без Docker) |
| `npm run db:seed` | повторно применить сиды и демо-юзеров |
| `npm run lint / typecheck / test` | качество кода |

---

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
- **Database:** PostgreSQL 15+ (локально или embedded через `npm run db:start` — без Docker). Доступ через `supabase-js` поверх PostgREST-шима (`/rest/v1` обслуживает сам Next.js)
- **Migrations:** SQL-файлы `supabase/migrations/0001..0047`, применяются командой `npm run db:setup`
- **Realtime:** Socket.IO (chat, typing, online, order-tracking) — `mini-services/chat-server`
- **Payments:** YooKassa (mock/real, идемпотентность, IP whitelist, эскроу через cron)
- **Auth:** JWT (jose) + bcrypt + 2FA TOTP + OAuth (Telegram/Google/Yandex/VK)
- **Security:** anti-fraud rate-limiting, CSRF, CSP, security headers
- **Geolocation:** 180+ городов РФ + DaData + Яндекс.Геокодер (fallback-цепочка)
- **PWA:** manifest, service worker, push-уведомления (VAPID)
- **Mobile:** Expo React Native (`mobile-app/`)
- **SimpleX Chat:** гибридная модель (Socket.IO + E2E для премиум-тарифов) — `mini-services/simplex-bridge`

## Быстрый старт

Актуальная инструкция — в начале этого файла (секция «Быстрый старт (Windows / macOS / Linux)»).
Коротко:

```bash
npm install
npm run db:setup    # миграции + сиды + демо-аккаунты + .env.local (PostgreSQL без Docker)
npm run dev         # http://localhost:3000
```

> Примечание: `npm run dev` запускает настоящий dev-сервер (`next dev`).
> Production-сборка — отдельная команда `npm run build && npm run start`.

### Production (Docker, legacy deployment-тулинг)

Самохостинг Supabase/Docker-файлы сохранены как legacy deployment-вариант и
локальному запуску не требуются:

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

> ⚠️ **Никогда не запускайте `npm run db:seed` / `db:setup` в production** —
> сиды создают демонстрационные аккаунты с публично известными паролями (`Demo123!`).

## Структура проекта

```
├── supabase/                  # миграции (0001..0047), compat-сиды, seed-данные витрины
├── src/
│   ├── app/
│   │   ├── api/               # ~68 групп роутов: auth, orders, payment, chat,
│   │   │                      #   cron (18 задач), simplex, admin, ai, ...
│   │   ├── rest/v1/           # PostgREST-шим (supabase-js → SQL) — локальный рантайм
│   │   ├── storage/v1/        # файловое хранилище — локальный рантайм
│   │   └── ...                # страницы маркетплейса
│   ├── components/
│   │   ├── dashboard/         # дашборд кондитера
│   │   ├── marketplace/       # карточки, фильтры, карты
│   │   └── ui/                # shadcn/ui
│   └── lib/
│       ├── supabase/          # admin.ts, browser.ts, auth.ts — доступ к БД (v2.0)
│       ├── auth.ts            # JWT + bcrypt + 2FA temp token
│       ├── totp.ts            # RFC 6233 (нативный crypto)
│       ├── yookassa.ts        # платежи + эскроу
│       ├── anti-fraud.ts      # rate limiting (SHA-256 IP)
│       ├── csrf.ts            # double-submit cookie
│       └── geocoder.ts        # 180+ городов + DaData + Yandex
├── mini-services/
│   ├── chat-server/           # Socket.IO (порт 3030)
│   ├── n8n-receiver/          # приёмник webhook-событий (:5678, dev-эмуляция n8n)
│   └── simplex-bridge/        # SimpleX bot-мост
├── n8n-workflows/             # 25 workflow JSON + 26-conditera-event-bus (9/9 событий)
├── mobile-app/                # Expo React Native
├── scripts/                   # db/setup.mjs (db:setup), db/runtime.mjs (embedded PG), db-push.mjs (legacy deploy-контракт)
├── docs/                      # AUTH, DATABASE, ROLE_MATRIX, API_AUTH_MATRIX...
├── docker-compose*.yml        # LEGACY deployment-тулинг (локальному запуску не нужен)
└── Caddyfile                  # reverse-proxy (legacy deploy)
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

Локальный рантайм без Docker проверен end-to-end: `npm install && npm run db:setup && npm run dev`,
регистрация/вход/выход, каталог + карточка товара (deep link), конструктор, корзина →
заказ → оплата (webhook, идемпотентность, эскроу, бонусы), возврат (идемпотентность),
чат покупатель↔кондитер + поддержка (персистентность, unread, идемпотентность),
склад кондитера (движения, списание, inventory.low), декор/услуги из БД,
n8n event bus (9/9 событий) + health-check `{app, database, n8n}`.

Известные ограничения перед публичным production-релизом:
- E2E-сьют (Playwright) не расширен под новый локальный стек; критичные пути проверены вручную/HTTP-пробами
- Локализация: только русский язык
- Dual-lockfile: `bun.lock` + `package-lock.json` (см. issues)

## Лицензирование

- **Код маркетплейса:** Proprietary (закрытый)
- **SimpleX Chat (используется как есть):** AGPLv3 — не затрагивает backend маркетплейса
- **Next.js, React и прочие MIT/Apache-библиотеки:** их собственные лицензии
