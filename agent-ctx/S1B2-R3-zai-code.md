# S1B2-R3 — zai-code — единая схема данных CONDITERA v2 (recreate-3)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Третье пересоздание блока S1B2 в цепочке recreate-3 перед целевым блоком S2B1
(после инцидента D13 №5). Поверх каркаса S1B1-R3 (коммит 1040b86) — только чтение,
его процессы не тронуты (dev :3000, PG :54329). Ground truth — отчёт
S1B2-R-zai-code-recreate2.md (46m/36e, состав моделей, seed counts, уроки 1–6):
его решения воспроизведены. Бандл recreate-2 (e5ab8ba) на диске отсутствует —
текст прежней schema.prisma восстановить было нельзя, схема воссоздана по
составу/решениям отчётов (см. Уроки №7). Старый проект — только чтение
(prisma/schema.prisma v1.0, supabase/migrations 0002/0011/0019/0034/0036/
0037/0038/0041/0063 — денежный контур, scripts/db/runtime.mjs).

## Артефакты
- Коммит: **23b0c98** (23b0c98a6628948c6ed9c75351a0c97dce47c47b)
  `[S1B2] database: unified prisma schema 46m/36e, embedded PG :54330, seed, db client (recreate-3)`,
  ветка main, поверх 1040b86, дерево чистое (git status — 0 записей).
- Bundle: /home/z/my-project/backups/conditera-v2-S1B2-23b0c98.bundle
  (**154 513 bytes**), `git bundle verify`: ref refs/heads/main = 23b0c98,
  complete history — OK.
- worklog.md в корне v2 — полная запись S1B2 (что сделано 9 пунктов,
  отклонения 4, гейты, артефакты).
- prisma/schema.prisma — 1713 строк (после prisma format);
  prisma/migrations/20261119221321_init (46 CREATE TABLE) — коммитится.

## Состав схемы (46 моделей / 36 enum'ов)
- Профили: Profile (+ConfectionerProfile, FranchiseeProfile) — userId @unique
  БЕЗ FK на auth.users (GoTrue — внешняя система), роль/2FA-группа tfa*
  (backupCodes, requiredFor String[] @default([])), telegramChatId (№5),
  bonusPolicyOverride Json (№9).
- Каталог: Category (admin-managed №12) → Product (ingredients/allergens
  String[], categoryId — закрытие D11); Review (ReviewStatus lowercase,
  модерация D11).
- Деньги: BalanceLedger (SD-8: kind topup|payment|bonus|refund|payout|hold|
  release, знаковые копейки, balanceAfter, refType/refId), Payout
  (ledgerId NOT NULL, PayoutStatus pending|approved|completed|rejected,
  completedTfaAt), PayoutRequest (PayoutRequestStatus pending|approved|
  rejected|paid), Escrow (escrow_accounts, сплиты 0011), Refund
  (idempotencyKey 0041), FinancialLedgerEntry (0063: рубли Decimal 14,2,
  append-only, idempotencyKey @unique, FinancialEntryType 8 значений),
  BonusTransaction.
- Торговля: Order (paymentMode PaymentMode STUB|YOOKASSA default STUB №1,
  promoCodeId @unique БЕЗ FK), OrderItem, Payment (yookassaId @unique).
- Коммуникации: SupportTicket/TicketMessage, ChatRoom (orderId @unique —
  0058)/ChatMessage, Notification (+NotificationPreferences 1:1).
- Прочее: Recipe, Venue, Service, DecorProduct, CartItem, Promotion,
  PromoCode (DiscountType percent|fixed), CommissionRate (kind @unique —
  №10), InventoryItem/StockMovement, Lead (LeadSource/Status/Stage),
  AuditLog, CmsPage, Banner, WishlistItem, GiftCertificate, LoyaltyTransaction,
  Badge/UserBadge, Challenge/UserChallenge, SiteSetting (bonusPolicy Json —
  №9), CronRun, Certification.
- enum UserRole — 27 значений (26 базовых + RECIPE_DEVELOPER №8).
  Статусы lowercase где предусмотрено (ReviewStatus, PaymentStatus,
  PayoutStatus, PayoutRequestStatus, VerificationStatus, EscrowStatus,
  RefundStatus, LedgerKind). Индексы: все FK, email, status+createdAt
  для списков.
- Нишевые таблицы v1 (~117 шт) НЕ включены — добавочными миграциями
  блоков-владельцев.

## scripts + seed
- scripts/db/runtime.mjs — ВЕРБАТИМ из старого проекта (diff-чисто;
  eslint ignore точечный, не по scripts/**).
- scripts/db/setup.mjs — идемпотентный: ГАРД ПОРТА 54330 ДО динамического
  импорта runtime.mjs → PG start/ensureDatabase → migrate deploy →
  generate → seed → auth-users: seedAuthUsers создаёт Demo123! через GoTrue
  Admin API при настроенном env, иначе «auth-users: отложено» (не падает;
  S2B1 продолжит). DATABASE_URL потомкам: env(:54330-гвард) → .env.local →
  embedded default; отравленный внешний URL не пробрасывается, значения
  не печатаются.
- scripts/db/seed.ts — идемпотентный upsert, сам читает .env.local/.env:
  counts: profiles=7 (2 confectioner), confectionerProfiles=2,
  categories=8, products=20 (состав/аллергены D11), reviews=10
  (status approved — lowercase, урок recreate-1 №1), recipes=3,
  siteSettings=3 (bonusPolicy Json №9), commissionRates=3 (ORDER 10 /
  DELIVERY 5 / RECIPE 15 — №10), orders=1 (ORD-DEMO-0001, paymentMode STUB
  №1), orderItems=1, payments=1, escrowAccounts=1, balanceLedger=3
  (topup/payment/release SD-8). Демо-учётки Demo123! НЕ созданы (нет GoTrue
  env) — создаст S2B1 через Admin API.

## Что готово для следующих блоков
- **S1B3** (дизайн-система): не зависит от БД — каркас/гейты не менялись.
- **S2B1** (auth): queries/users.ts — fail-closed контракт (createProfile/
  getProfileByUserId/updateProfile/setProfileRole/setProfileBlocked);
  setup.mjs seedAuthUsers умеет создавать 7 демо-учёток Demo123! через
  GoTrue Admin API при SUPABASE_URL+SUPABASE_SERVICE_ROLE_KEY; Profile.userId
  @unique ждёт привязку auth.users; в src/lib/db.ts — prisma singleton
  (getPrisma/prisma) + pingDatabase.
- **S3B2** (витрина/поиск): queries/products.ts (listProducts/getProductBySlug/
  listCategories/createProduct); Category admin-managed, продукты с
  ingredients/allergens.
- **S4B1** (заказы): queries/orders.ts (createOrder/transitionOrderStatus/
  listOrdersFor); Order.promoCodeId — String @unique без FK (справочник
  промо — этот блок); commissionRateSnapshot — снапшот commission_rates.
- **S4B2** (платежи): queries/payments.ts (createPayment/confirmPayment —
  STUB №1, getEscrowByOrderId/releaseEscrow, createRefund — Idempotency-Key
  0041); FinancialLedgerEntry — append-only после факта.
- **S4B3** (баланс/выплаты/бонусы): queries/ledger.ts (postLedgerEntry —
  единственный легальный способ движения денег SD-8; requestPayout —
  ledgerId NOT NULL + completedTfaAt SD-10; applyBonusPolicy — №9);
  CommissionRate — №10.
- **S3B1**: удалить /api/diag/seed-check — TODO-remove(S3B1) помечен В КОДЕ.
- Health-контракт сохранён: top-level решает ТОЛЬКО БД; version →
  0.1.0-s1b2.

## Гейты (все пройдены 2026-11-19)
1. `env -u DATABASE_URL DATABASE_URL=<dummy> bunx prisma validate` →
   "The schema at prisma/schema.prisma is valid" (P1012 без env — не ошибка
   схемы). PASS.
2. runtime.mjs start → RUNNING (pid 3907) :54330, база conditera;
   `bunx prisma migrate dev --name init` → 20261119221321_init;
   `prisma migrate status` → "Database schema is up to date!";
   `env -u DATABASE_URL bun run db:setup` — конвейер целиком идемпотентен
   (auth-users: отложено — как задумано). PASS.
3. seed ×2 — counts стабильны: profiles=7, confectionerProfiles=2,
   categories=8, products=20, reviews=10, recipes=3, siteSettings=3,
   commissionRates=3 (+orders=1, orderItems=1, payments=1, escrowAccounts=1,
   balanceLedger=3). PASS.
4. lint 0 ошибок/0 предупреждений; tsc --noEmit 0 (прогнано и после коммита).
   PASS.
5. Boot одним батчем :3100 (env -u DATABASE_URL, Next читает .env.local):
   /api/health → 200 {"status":"ok","database":"ok","auth":"ok"(shim),
   "storage":"local","n8n":"ok","version":"0.1.0-s1b2"};
   /api/diag/seed-check → 200 {"ok":true, counts все >0}; / → 200
   (38723 B). dev.log — только собственные строки (Ready in 337ms;
   Environments: .env.local). PASS.
6. БД :54330 НЕ оставлена запущенной (sandbox всё равно убивает процессы);
   .pgdata осталась на диске, подъём одной командой:
   `cd /home/z/my-project/conditera-v2 && env -u DATABASE_URL bun run db:setup`.
   PASS (по заданию).

## Критические уроки (наследованные 1–6 recreate-2 — сработали; НОВЫЕ)
1–6 (применены как профилактика): гард порта 54330 до импорта runtime;
files-override после общего rules; argsIgnorePattern "^_"; чужой stdout в
чужом dev.log не диагносцировать; seed сам читает .env; migrate dev +
shadow-DB на trust-auth PG.
НОВЫЕ:
7. **Бандл recreate-2 не сохранился в backups** (на диске только
   S1B1-1040b86) — точный текст schema.prisma восстановить невозможно;
   воссоздание по отчёту потребовало проектных решений для
   недокументированных enum'ов (FranchiseeStatus, StockMovementType,
   GiftCertificateStatus, PayoutMethod, ChatRoomType, CronRunStatus,
   DiscountType, BonusTransactionKind — консолидация строковых литералов
   v1). Урок для ВСЕХ блоков: bundle после КАЖДОГО коммита копировать и
   ПРОВЕРЯТЬ наличие в backups; отчёт блока должен перечислять ВСЕ enum'ы
   ПОЛНЫМ списком значений (состав 46m перечислен, а 36e — только
   документированные).
8. Экспорт-из одной строки (`export { pingPrisma } from "./db/client"`) НЕ
   создаёт локальную привязку — вызов pingPrisma в том же файле дал
   TS2304. Правильный паттерн фасада: отдельный `import` + `export-from`.
9. `bun add -d @embedded-postgres/linux-x64` блокирует postinstall —
   обязательный `bun pm trust` (иначе native/bin пуст; повторение урока
   recreate-1 №3 — актуально и в recreate-3).
10. prisma CLI читает ТОЛЬКО .env (не .env.local): для ручных migrate/dev
    команд DATABASE_URL передавать явно через env; в .env.local его держит
    setup.mjs/seed.ts-контур и dev-сервер Next.js.

## Дальше по карте
- S1B3 «Дизайн-система 2025» (параллельно возможен) — зависимость S1B1.
- **S2B1 «Supabase Auth/GoTrue»** — целевой блок recreate-3: Demo123! через
  Admin API (setup.mjs seedAuthUsers готов), привязка auth.users →
  profiles.userId, supabase-клиенты src/lib/supabase/*, refresh-сессия в
  proxy.ts, DEV_AUTH_SHIM=1 уже в .env.local.
- S3B1 — удалить /api/diag/seed-check (TODO в коде).
- Перед каждым блоком: DECISIONS.md + worklog.md корня v2 + отчеты
  agent-ctx.
