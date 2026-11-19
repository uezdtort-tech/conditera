# S1B2-R — zai-code — единая схема данных CONDITERA v2 (recreate-2)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Второе пересоздание блока S1B2 поверх S1B1 recreate-2 (eb49d6f). Выходы S0B1/S0B2
(audit.md, spec-registry.md) утрачены с прежним v2 — использован резерв: старый
проект /home/z/my-project (prisma/schema.prisma v1.0, supabase/migrations —
денежный контур, scripts/db/runtime.mjs) + отчёт S1B2-R первого восстановления.
Спек: docs/rebuild/prompts/S1B2-database.md; приоритет: DECISIONS.md.

## Артефакты
- Коммит: e5ab8ba ([S1B2] database: unified prisma schema 46m/36e, embedded PG
  :54330, seed, db client (recreate-2)) + docs-коммит (worklog pin), main, дерево чистое.
- Bundle: /home/z/my-project/backups/conditera-v2-S1B2-e5ab8ba.bundle (138517 B, verify OK).
- Отчёт субагента схемы: prisma/schema.prisma 1728 строк — см. гейты.

## Что готово для следующих блоков
- **prisma/schema.prisma: 46 моделей / 36 enum'ов** — единый источник истины (D1).
  Профили: Profile(+ConfectionerProfile, FranchiseeProfile); каталог: Category
  (admin-managed №12) → Product (ingredients/allergens String[], D11); деньги:
  BalanceLedger (SD-8, kind 7 значений, знаковые копейки, balanceAfter),
  Payout (ledgerId NOT NULL, status pending|approved|completed|rejected,
  completedTfaAt), PayoutRequest (свой статус), Escrow, Refund (idempotency
  0041), FinancialLedgerEntry (0063, рубли, append-only), BonusTransaction;
  trade: Order (paymentMode STUB №1, promoCodeId @unique без FK), OrderItem,
  Payment; коммуникации: SupportTicket/TicketMessage, ChatRoom/ChatMessage,
  Notification(+Preferences); прочее: Recipe, Venue, Service, DecorProduct,
  CartItem, Promotion, PromoCode, CommissionRate (№10), InventoryItem,
  StockMovement, Lead, AuditLog, CmsPage, Banner, WishlistItem, GiftCertificate,
  LoyaltyTransaction, Badge/UserBadge, Challenge/UserChallenge, SiteSetting
  (bonusPolicy Json №9), CronRun, Certification.
- enum UserRole — 27 значений (вкл. RECIPE_DEVELOPER №8). Статусы lowercase
  где предусмотрено (ReviewStatus, PaymentStatus, PayoutStatus, VerificationStatus).
- **Embedded PostgreSQL :54330**, база conditera, данные conditera-v2/.pgdata
  (gitignored). Миграция 20261119203844_init в prisma/migrations (коммитится).
- **scripts/db/**: runtime.mjs (вербатим старого), setup.mjs (идемпотентный:
  PG → migrate deploy → generate → seed → auth-users при настроенном GoTrue,
  иначе «отложено»; ГАРД ПОРТА 54330 ДО импорта runtime), seed.ts (идемпотентный
  upsert; counts: profiles=7, confectionerProfiles=2, categories=8, products=20,
  reviews=10, recipes=3, siteSettings=3, commissionRates=3).
- **src/lib/db/**: client.ts (singleton globalThis + pingPrisma SELECT 1/3s),
  queries/{users,products,orders,payments,ledger}.ts — fail-closed заглушки
  с блоками-владельцами (S2B1/S3B2/S4B1/S4B2/S4B3). src/lib/db.ts — фасад.
- **health-контракт S1B2**: top-level status решает ТОЛЬКО БД:
  database ok → status:"ok" (200); not-configured → 200+degraded;
  unavailable → 503+degraded. auth/storage "unreachable" — подписанные
  dev-состояния, top-level не деградируют.
- Временный GET /api/diag/seed-check (counts; 404 в production) —
  TODO-remove(S3B1) помечен В КОДЕ.
- Демо-учётки Demo123! — НЕ созданы (нет Supabase env); S2B1 создаст через
  GoTrue Admin API (setup.mjs: seedAuthUsers уже умеет при env).

## Ключевые решения (наследование S1B2-R №1–12 сохранено)
id String uuid() везде; Profile.userId @unique БЕЗ FK (GoTrue); паролей/
сессий/Account/RefreshToken в схеме НЕТ; 2FA одна группа (backupCodes/
requiredFor @default([]) — Prisma 6 не умеет String[]?); balance_ledger vs
financial_ledger — РАЗНЫЕ контуры аудита (копейки vs рубли); категории
admin-managed; нишевые таблицы v1 (~117 шт: streams, simplex, team, ai-memory,
moderation-очереди...) НЕ включены — добавочными миграциями блоков-владельцев.

## Критические уроки (НОВЫЕ, к S1B1 №1–7)
1. **ГАРД ПОРТА v2=54330**: дефолт runtime.mjs 54329 совпадает с портом
   СТАРОГО проекта. Старый PG-демон умер между tool-call'ами → setup поднял
   свой кластер на :54329 молча. setup.mjs теперь ставит CONDITERA_PG_PORT
   ДО импорта runtime.mjs. Случайную пустую БД на :54329 — drop (проверять:
   только если БД создана нашим ensureDatabase и пуста).
2. flat-config ESLint: files-override ставится ПОСЛЕ общего блока rules.
3. no-unused-vars: argsIgnorePattern "^_" для fail-closed заглушек.
4. Строки [auth] JWT_SECRET/[supabase/admin] в dev.log v2 = чужой stdout
   старого проекта (подтверждение урока S1B1 №7).
5. seed.ts сам читает .env при отсутствии DATABASE_URL в окружении.
6. migrate dev создаёт shadow-DB — trust-auth embedded PG это позволяет.

## Гейты (все пройдены 2026-11-19)
1. prisma validate ok (с dummy DATABASE_URL; P1012 без env — не ошибка схемы).
2. migrate dev --name init ok → 20261119203844_init; migrate status: up to date.
3. seed ×2 идемпотентен (counts стабильны, см. выше).
4. lint 0 ошибок/0 warnings; tsc 0.
5. health 200 {"status":"ok","database":"ok",...}; diag {"ok":true,counts>0};
   home 200.

## Как поднять БД локально
```
cd /home/z/my-project/conditera-v2
env -u DATABASE_URL bun run db:setup          # всё разом, идемпотентно
# шагами: runtime.mjs start (CONDITERA_PG_PORT=54330!) → migrate deploy → seed
```

## Дальше
S1B3 (дизайн-система) — следующий блок Этапа 1; S2B1 (auth: Demo123! через
GoTrue Admin API); S3B1 — удалить /api/diag/seed-check (TODO в коде).
