# ПРОМПТ S1B2 — Единая схема данных (Prisma, консолидация 86 миграций)

Этап 1 «Фундамент» | Блок 2. Зависимости: S1B1 (каркас), S0B2 (реестр).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — архитектор данных. Ты консолидируешь 86 разросшихся SQL-миграций старого
проекта в ОДНУ чистую Prisma-схему — единственный источник истины v2.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (dev :3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui (New York, Lucide); без indigo/blue.
- Данные: Prisma — единственный контур записи app-данных; supabase-js —
  ТОЛЬКО Auth/Storage (S2B1/S2B4), в контур записи app-данных не входит
  (закрыть D1). auth.users — управляется Supabase Auth: Prisma-модели
  НЕ объявляют FK на него, хранится userId UUID. Права — requireRole-
  гварды (S2B2) + RLS на бакетах Storage (S2B4). Миграции:
  `prisma migrate` (каталог prisma/migrations).
- Backend: только Route Handlers; server actions запрещены.
- Процесс: один блок = один коммит `[S1B2] ...`; верификация tsc→vitest→
  браузер; worklog.md; тесты не писать.
- Запреты: не трогать прод/секреты; не печатать .env*; старый проект —
  только чтение.

## 3. ЦЕЛЬ БЛОКА
prisma/schema.prisma v2, покрывающая все таблицы из реестра audit.md;
скрипты локальной БД (runtime/seed); генерация типов; проверка целостности.

## 4. ШАГИ
1. Прочитать audit.md (раздел «Таблицы БД») и spec-registry.md (SD-1,
   SD-8, SD-9, SD-10). Прочитать ключевые старые миграции для точных
   колонок: profiles, products, orders, order_items, payments, bonuses,
   escrow, payouts, reviews, tickets, chats/chat_messages, notifications,
   site_settings, cron_runs, certifications, recipes, venues, services,
   decor_products, franchise, gamification, b2b.
2. Спроектировать схему v2 с исправлениями дефектов:
   - ОДНА группа колонок 2FA в profiles: tfaEnabled, tfaSecret, tfaConfirmedAt
     (без дублей two_factor_* — SD-10);
   - products: добавить ingredients (text[]), allergens (text[]),
     categoryId (FK categories) — закрыть D11; category отдельной таблицей;
   - reviews: полный список с текстом и статусом модерации (D11);
   - НОВАЯ balance_ledger: id, userId, amount, kind
     (topup|payment|bonus|refund|payout|hold|release), refType, refId,
     balanceAfter, createdAt — все движения денег только через неё (SD-8);
   - payouts: связь с balance_ledger обязательна, поле status enum
     (pending|approved|completed|rejected), дваFA-подтверждение — колонка
     completedTfaAt (SD-10, закрыть легаси-роут D9);
   - СЕССИЙ-таблицы НЕТ: refresh-токены и сессии ведёт Supabase Auth
     (GoTrue, S2B1) — дублирующая таблица sessions ЗАПРЕЩЕНА (уроки
     D1/D2); profiles.userId — UUID из auth.users, уникальный, роль
     (enum UserRole) — истина в profiles;
   - enums вместо строковых литералов: UserRole (26 значений — взять из
     старого prisma/schema.prisma: CUSTOMER, CONFECTIONER, ADMIN,
     SUPER_ADMIN, COURIER, SUPPLIER, ANIMATOR_AGENCY, SUPPORT, FRANCHISEE,
     STUDIO, WHOLESALER, VENUE_OWNER, RECREATION_CENTER, KIDS_CLUB,
     FOOD_SERVICE, EVENT_ORGANIZER, PICKUP_POINT, BLOGGER, TASTER,
     NUTRITIONIST, COPYWRITER, CORPORATE_CLIENT, MODERATOR,
     QUALITY_INSPECTOR, CERTIFICATION_AGENT, GUEST), OrderStatus,
     PaymentStatus, LedgerKind и т.д.;
   - индексы: все FK, email (unique, lowercase-храним), status+createdAt
     для выборок списков;
   - РЕШЕНИЯ ВЛАДЕЛЬЦА (DECISIONS.md):UserRole пополняется значением
     RECIPE_DEVELOPER (псевдороль, решение №8 — admin-assigned);
     категории — admin-managed (№12): таблица categories + в админ-кабинете
     CRUD (S5B3), исполнители только выбирают; №10 — таблица
     commission_rates (id, kind, rate, active, updatedAt) — стандартные
     тарифы комиссии, редактируемые админом; №9 — бонусная политика:
     глобальные параметры в site_settings (JSON bonusPolicy) + поле
     bonusPolicyOverride (JSON, nullable) в profiles для точечного
     override конкретного исполнителя; №1 — orders.paymentMode
     (enum PaymentMode: STUB|YOOKASSA, default STUB).
3. Скрипты БД в scripts/db/ (перенести и упростить из старого проекта):
   - runtime.mjs — initdb/start/status/stop embedded PostgreSQL :54329
     (скопировать рабочий скрипт старого проекта scripts/db/runtime.mjs);
   - setup.mjs — запуск PG → prisma migrate deploy → seed (упрощённая
     версия). Демо-пользователи создаются через Supabase Admin API
     (service-role) при доступном Auth; если недоступен и шим выключен —
     seed app-таблиц продолжается с пометкой «auth-users: отложено»
     (не падать);
   - seed.ts — демо-данные: категории, 6 демо-пользователей по ролям
     (customer/confectioner/admin/support/decor/animator, пароль
     Demo123! — создание через Supabase Admin API, GoTrue хэширует
     сам; bcrypt вручную НЕ использовать), 20 товаров с составом/
     аллергенами/категориями, 10 отзывов, 3 рецепта, настройки
     site_settings.
4. Прогнать: `node scripts/db/runtime.mjs start` → `bunx prisma migrate dev
   --name init` → `bunx prisma db seed` (или tsx scripts/db/seed.ts —
   как настроено). Убедиться, что повторный setup идемпотентен.
5. Сгенерировать типы: `bunx prisma generate`; создать
   src/lib/db/client.ts (singleton PrismaClient) и
   src/lib/db/queries/ (заглушки-модули по доменам: users, products,
   orders, payments, ledger — пустые функции с типами).
6. Health-эндпоинт (S1B1) доработать: database=ok при живом SELECT 1
   через PrismaClient.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- scripts/db/runtime.mjs — целиком (работает);
- enum UserRole и модели из старого prisma/schema.prisma — как база
  (поля переименовывать только для SD-10);
- seed-подход старого setup.mjs (демо-юзеры Demo123!);
- из миграций: точные составы таблиц orders/payments/escrow/bonuses
  (это денежный контур — консолидация без потери колонок).

## 6. ЗАПРЕТЫ
- НЕ смешивать supabase-js и Prisma в один контур записи app-данных
  (auth.users — только через Admin API; app-таблицы — только Prisma).
- Не создавать дублирующие/легаси-колонки «на всякий случай».
- Не выполнять SQL руками в обход migrate.
- Не трогать старый проект (только чтение).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] prisma/schema.prisma валидна: `bunx prisma validate` — ok;
- [ ] `bunx prisma migrate dev` применяет init-миграцию без ошибок;
- [ ] seed идемпотентен (повторный запуск не дублирует данные);
- [ ] balance_ledger, profiles (userId UUID), categories,
      ingredients/allergens в схеме;
- [ ] 2FA-колонки едины (нет two_factor_*);
- [ ] GET /api/health → database:"ok";
- [ ] tsc 0, lint 0; коммит [S1B2]; worklog дополнен.

## 8. ВЕРИФИКАЦИЯ (agent-browser + CLI)
- GET /api/health → {"database":"ok"};
- Быстрая проверка данных: временный route `GET /api/diag/seed-check`
  (в dev, помеченный TODO-удалением в S3B1) возвращает counts таблиц —
  числа > 0 после seed.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S1B2] (schema + migrations + scripts/db + seed + db/client).
- Отчёт владельцу: число моделей/enum'ов, отличия от старой схемы
  (список исправлений D9/D10/D11), как поднять БД локально.
