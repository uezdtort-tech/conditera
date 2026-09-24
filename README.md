# Уездный кондитер

> Маркетплейс кондитерских изделий от частных кондитеров России.
> Next.js 16 + React 19 + TypeScript + Prisma + PostgreSQL + Zustand.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![License](https://img.shields.io/badge/license-Proprietary-blue)](#)
[![Node](https://img.shields.io/badge/node-20.x-green)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](#)

## Возможности

### Для покупателей
- Каталог тортов и десертов с фильтрами (город, рейтинг, самовывоз, SimpleX)
- Конструктор тортов (форма, размер, начинка, покрытие, декор)
- Эскроу-платежи через YooKassa (деньги кондитеру через 24ч после получения)
- Групповые заказы и оплата по долям (split-платежи)
- Рассрочка (Сплит, Тинькофф, Сбер)
- Программа лояльности: 1 балл за 100₽, 4 уровня (Бронза → Платина)
- AR-просмотр тортов через камеру (3D-модели)
- Чат с кондитером (Socket.IO) + приватный E2E-канал SimpleX
- Push-уведомления, PWA, мобильное приложение (Expo)

### Для кондитеров
- Дашборд с 27 разделами: заказы, каталог, финансы, налоги (НПД/УСН/ОСНО), акции, рецепты
- Управление складом, инвентарём, производством (Gantt)
- CRM-клиенты, маркетинг, печать на пряниках
- Канал (микро-блог), дегустации, отзывы, команда
- Конструктор цен, оптовые цены, рекуррентные заказы
- Подтверждение готовности испечь по рецептам + статистика конверсии
- Приватный SimpleX-канал (для тарифов PREMIUM/BUSINESS)
- 2FA (TOTP RFC 6233) при логине и выплатах
- Авто-верификация через DaData (ИНН организаций)

### Для операторов
- Авточат: FAQ-бот (15 RU + 10 EN тем), ML matcher, sentiment analysis (v1 лексический + v2 embeddings)
- Эскалация на оператора, canned responses (20 шаблонов)
- Дашборд оператора с очередью чатов
- Модерация отзывов, баннеров, страниц CMS

### Архитектура
- **Backend:** Next.js 16 (app router), 133 API endpoints, 14 cron-задач
- **Database:** PostgreSQL 16 + Prisma 6 (95 моделей, 19 enum'ов, 26 ролей)
- **Realtime:** Socket.IO (chat, typing, online, order-tracking)
- **Automation:** n8n (21 workflow: abandoned cart, digest, bonus expiry)
- **Payments:** YooKassa (mock/real, идемпотентность, IP whitelist, эскроу)
- **Auth:** JWT (jose) + bcrypt + 2FA TOTP + OAuth (Telegram/Google/Yandex/VK)
- **Security:** Anti-fraud rate-limiting, CSRF, CSP, security headers, DaData verification
- **Geolocation:** 180+ городов РФ + DaData + Яндекс.Геокодер (fallback-цепочка)
- **PWA:** manifest, service worker, push-уведомления (VAPID)
- **Mobile:** Expo React Native (23 экрана)
- **SimpleX Chat:** гибридная модель (Socket.IO + E2E для премиум)

## Быстрый старт

### Требования
- Node.js 20+
- Docker 24+ (для `docker-compose.supabase.yml` — Postgres 15, Kong, GoTrue, Storage, Studio)
- Redis 7+ (опционально, для multi-instance Socket.IO)

### Установка

```bash
git clone <repo-url>
cd conditera-konditer
npm install

# Настроить окружение (интерактивный мастер, спрашивает Yandex Metrika ID, OAuth, и т.д.)
bash scripts/setup-env.sh dev
# ИЛИ вручную:
#   cp .env.local.example .env.local
#   отредактировать .env.local — задать DATABASE_URL, JWT_SECRET, YANDEX_METRIKA_ID и т.д.

# Проверить готовность
bash scripts/env-check.sh

# Запустить Supabase (PostgreSQL 15 + Kong + GoTrue + Storage + Studio на http://localhost:8100)
docker-compose -f docker-compose.supabase.yml up -d

# Применить схему БД — миграции в supabase/migrations/0001..0026
# (выполняется автоматически при первом `docker-compose up`, либо вручную:
#   for f in supabase/migrations/*.sql; do
#     docker exec -i conditera-supabase-db psql -U postgres -d postgres < "$f"
#   done)

# Заполнить тестовые данные
npm run db:seed

# Запуск dev-сервера
npm run dev
# → http://localhost:3000
```

### Docker (production)

```bash
# Заполнить .env.production
cp .env.production.example .env.production
# Сгенерировать секреты:
openssl rand -base64 48  # JWT_SECRET
openssl rand -hex 32    # TFA_ENCRYPTION_KEY
openssl rand -hex 32    # SIMPLEX_BRIDGE_API_KEY

# Запуск всех сервисов
docker-compose up -d

# Проверка статуса
docker-compose ps
docker-compose logs -f web
```

### Тестовые аккаунты (после `npm run db:seed`)

| Роль | Email | Пароль |
|---|---|---|
| Покупатель | customer@demo.ru | demo123 |
| Кондитер | confectioner@demo.ru | demo123 |
| Админ | admin@demo.ru | admin123 |

## Структура проекта

```
├── prisma/
│   ├── schema.prisma          # 95 моделей, 19 enum'ов
│   ├── migrations/            # SQL-миграции
│   └── seed.ts                # Тестовые данные
├── src/
│   ├── app/
│   │   ├── api/               # 133 API endpoints
│   │   │   ├── auth/          # login, register, 2FA, OAuth
│   │   │   ├── orders/        # заказы, отмена, трекинг
│   │   │   ├── payment/       # YooKassa create + webhook
│   │   │   ├── chat/          # Socket.IO, FAQ, sentiment
│   │   │   ├── simplex/       # E2E-чат (bridge webhook + management)
│   │   │   ├── cron/          # 14 cron-задач (эскроу, бонусы, etc.)
│   │   │   └── ...            # другие endpoints
│   │   └── ...                # страницы
│   ├── components/
│   │   ├── dashboard/         # 27 табов дашборда кондитера
│   │   ├── pages/             # страницы маркетплейса
│   │   ├── marketplace/       # карточки, фильтры, карты
│   │   ├── simplex/           # SimpleX-виджет
│   │   └── ui/                # shadcn/ui компоненты
│   └── lib/
│       ├── auth.ts            # JWT + 2FA temp token
│       ├── totp.ts            # RFC 6233 (нативный crypto)
│       ├── yookassa.ts        # платежи + эскроу
│       ├── anti-fraud.ts      # rate limiting (SHA-256 IP)
│       ├── geocoder.ts        # 180+ городов + DaData + Yandex
│       ├── notifications.ts   # email/SMS/push/in-app/telegram
│       ├── simplex-bridge     # (см. mini-services/)
│       └── ...
├── mini-services/
│   ├── chat-server/           # Socket.IO (Node.js, порт 3030)
│   └── simplex-bridge/        # SimpleX bot-мост (порт 5226)
├── mobile-app/                # Expo React Native (23 экрана)
├── scripts/                   # 30 скриптов (smoke, e2e, deploy)
├── docs/                      # SIMPLEX.md, MIGRATION_PG.md
├── docker-compose.yml         # 8 сервисов: web, db, redis, chat, n8n, caddy, smp, simplex-bridge
├── Dockerfile                 # multi-stage, standalone, dumb-init, healthcheck
├── Dockerfile.chat            # chat-server
├── Dockerfile.simplex-bridge  # simplex-bridge + simplex-chat CLI
└── Caddyfile                  # reverse-proxy + auto-HTTPS + security headers
```

## Безопасность

- **2FA при логине:** `/api/auth/login` возвращает `tfaRequired` + `tfaTempToken`; `/api/auth/2fa/login-verify` проверяет TOTP или backup-код
- **Socket.IO JWT auth:** проверка access-token из `handshake.auth.token` (jose)
- **Критичные секреты без fallback:** JWT_SECRET, TFA_ENCRYPTION_KEY, CRON_SECRET — приложение падает в production если не заданы
- **CSRF:** double-submit cookie pattern (утилита в `src/lib/csrf.ts`)
- **CSP + security headers:** middleware.ts + next.config.ts + Caddyfile
- **Anti-fraud:** rate limiting по IP (SHA-256 хэш с солью, 152-ФЗ)
- **YooKassa IP whitelist:** 8 диапазонов, проверка только в production
- **Эскроу через cron** (не setTimeout): переживает рестарты

## Лицензирование

- **Код маркетплейса:** Proprietary (закрытый)
- **SimpleX Chat (используется как есть):** AGPLv3 — не затрагивает backend маркетплейса
- **Prisma, Next.js, React:** MIT/Apache 2.0

## Документация

- [SimpleX Chat интеграция](docs/SIMPLEX.md) — архитектура, установка, troubleshooting
- [Миграция SQLite → PostgreSQL](download/MIGRATION_PG.md)
- [Аудит готовности](download/audit_report.pdf) — 10-страничный отчёт

## Статус готовности

| Категория | Готовность |
|---|---|
| Backend / API | 95% |
| Frontend (web) | 90% |
| Mobile (Expo) | 85% |
| Auth & Security | 90% |
| Payments (YooKassa) | 85% |
| Chat (Socket.IO) | 80% |
| SimpleX (E2E) | 85% |
| Локализация | 5% |
| Тестирование | 10% |
| CI/CD | 50% |
| Документация | 60% |
| **Средняя готовность** | **~80%** |

## Контакты

- **Поддержка:** через SimpleX Chat (QR-код в личном кабинете) или через чат в приложении
- **Документация:** см. раздел выше
- **Bug reports:** создайте issue в репозитории

---

**⚠️ Production deployment:** Перед развёртыванием обязательно прочитайте [audit_report.pdf](download/audit_report.pdf) и заполните `.env.production` реальными секретами.
#   c o n d i t e r a  
 