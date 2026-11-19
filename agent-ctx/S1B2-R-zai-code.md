# S1B2-R — zai-code — единая схема данных CONDITERA v2 (recovery)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все 5 гейтов пройдены, коммит + bundle созданы.

## Контекст
Ре-исполнение блока S1B2 поверх каркаса S1B1-R (коммит f4038b6). Выходы S0B1/S0B2
(audit.md, spec-registry.md) утрачены вместе с прежним v2 — по заданию использован
резерв: артефакты старого проекта /home/z/my-project (prisma/schema.prisma v1.0,
supabase/migrations/*.sql — точные колонки денег, scripts/db/runtime.mjs).
Спек: docs/rebuild/prompts/S1B2-database.md; приоритет: docs/rebuild/DECISIONS.md.

## Что готово для следующих блоков
- prisma/schema.prisma: **46 моделей / 36 enum'ов** — единый источник истины (D1).
  База — старый schema.prisma + живые колонки денежного контура (0002/0009/0011/
  0019/0034/0036/0037/0038/0041/0063) — консолидация БЕЗ потери колонок.
- Embedded PostgreSQL :54330 работает, демон ПЕРЕЖИВАЕТ tool-call'ы (pg_ctl detach,
  проверено) — в отличие от nohup next dev. Данные: conditera-v2/.pgdata.
- Коммит: **7fcf60b** (`[S1B2] database: unified prisma schema, embedded PG :54330,
  seed, db client (recovery)`), ветка main, дерево чистое.
- Bundle: /home/z/my-project/backups/conditera-v2-S1B2-7fcf60b.bundle (147701 bytes,
  verify OK, полная история).
- scripts/db/: runtime.mjs (ВЕРБАТИМ из старого проекта, diff-чисто), setup.mjs
  (env → PG → migrate deploy → seed → auth-users-заметка «отложено», не падает),
  seed.ts (идемпотентный, PrismaClient-only).
- src/lib/db/client.ts — singleton PrismaClient (globalThis) + pingDatabase; db.ts —
  фасад-реэкспорт; queries/{users,products,orders,payments,ledger}.ts — fail-closed
  типизированные заглушки (NotImplemented).
- Health: database:"ok" → status:"ok" (200); когерентность сохранена
  (not-configured → 200 degraded; unavailable → 503).
- Временный GET /api/diag/seed-check — TODO-remove(S3B1) помечен В КОДЕ.

## Ключевые содержательные решения (для наследующих блоков)
1. **id = String @default(uuid()) везде** (TEXT со значением UUID): однотипность FK
   и userId из auth.users; @db.Uuid НЕ использован намеренно.
2. **profiles.userId @unique без FK** на auth.users (GoTrue владеет Auth); паролей и
   сессий в схеме НЕТ (sessions/refresh_tokens/accounts/password_hash удалены — D2).
3. **2FA одна группа**: tfaEnabled/tfaSecret/tfaConfirmedAt (+backupCodes,
   requiredFor); двухфакторных дублей two_factor_* НЕТ (SD-10/D9/D10).
4. **balance_ledger (SD-8)**: kind LedgerKind(topup|payment|bonus|refund|payout|
   hold|release), amount знаковый в копейках, balanceAfter, refType/refId;
   payouts.ledgerId NOT NULL — деньги на баланс только проводкой журнала.
   financial_ledger (0063) сохранён ОТДЕЛЬНО (платформенный append-only, рубли) —
   разные контуры аудита, не смешивать.
5. **payouts**: status PayoutStatus(pending|approved|completed|rejected) +
   completedTfaAt (закрытие легаси-роута complete, D9/SD-10); payout_requests —
   отдельная модель со своим PayoutRequestStatus(pending|approved|rejected|paid).
6. **Категории admin-managed** (решение №12): categories + products.categoryId FK
   (строковый products.category удалён); ingredients/allergens String[] (D11).
7. **Комиссии** (№10): commission_rates(kind @unique, rate, active, updatedAt), сид
   ORDER 10% / DELIVERY 5% / RECIPE 15%.
8. **Бонусная политика** (№9): site_settings.bonusPolicy (JSON-колонка) +
   profiles.bonusPolicyOverride (JSON nullable).
9. **PaymentMode(STUB|YOOKASSA)** default STUB на orders (№1); payments.method —
   PaymentMethod, yookassaId @unique.
10. promoCodeId в orders — String @unique БЕЗ FK: справочник промо — контур S4B1.
11. Из ~163 таблиц живой БД вошли 46 ключевых; нишевые (deliveries, tenders,
    recipe_* под-таблицы, ops_*, promo_*) — добавочными миграциями блоков-владельцев,
    НЕ «на всякий случай» (запрет спека).
12. Seed-идемпотентность: upsert по slug/email/key/kind; reviews/recipes —
    детерминированные id (rvw-demo-*/rcp-demo-*). Демо-профили isDemo=true,
    userId = randomUUID при создании; учётки Demo123! — S2B1 через GoTrue Admin API.

## Критические уроки (обязательны к учёту)
1. **enum-значения чувствительны к регистру**: ReviewStatus lowercase (pending) —
   сид/код должны использовать точные значения enum'а (ловилось на seed: APPROVED →
   approved).
2. **Каждое направление relation требует back-relation** (Order.confectioner ↔
   Confectioner.orders ловилось на validate).
3. **bun блокирует postinstall**: после `bun add -d @embedded-postgres/linux-x64`
   обязательно `bun pm trust @embedded-postgres/linux-x64` (иначе native/bin пуст —
   пакет кладёт симлинки, hydrate-symlinks.js). bun сам добавил trustedDependencies.
4. **runtime.mjs вербатимен** — в eslint.config.mjs добавлен ignore
   `scripts/db/runtime.mjs` (правила приложения не прогоняют чужой код; собственные
   setup.mjs/seed.ts линтятся штатно).
5. **tsx не грузит .env** — seed.ts читает .env сам (DATABASE_URL), значения не
   печатаются. prisma CLI .env читает сам; в setup.mjs DATABASE_URL удаляется из
   окружения потомков (отравленный внешний URL песочницы не доходит).
6. Все команды БД — `env -u DATABASE_URL ... CONDITERA_PG_PORT=54330 ...` (урок S1B1).
7. `prisma migrate dev --name init` создал prisma/migrations/20261119164956_init —
   каталог миграций коммитится; `prisma validate` ругается на package.json#prisma
   (deprecation warn к Prisma 7) — не блокирует, миграция на prisma.config.ts —
   решение отдельного блока при апгрейде.

## Гейты (все пройдены 2026-11-19)
1. PG start → RUNNING pid 3629 :54330, база conditera.
2. validate ok → migrate dev --name init ok → generate ok → seed ×2: counts
   стабильны (profiles=6, categories=8, products=20, reviews=10, recipes=3,
   site_settings=3, commission_rates=3).
3. lint 0, tsc 0.
4. health 200 {"status":"ok","database":"ok",...}; diag {"ok":true,"counts":{...все>0}};
   home 200.
5. commit 7fcf60b; bundle 147701 B verify OK.

## Как поднять БД локально
```
cd /home/z/my-project/conditera-v2
env -u DATABASE_URL CONDITERA_PG_PORT=54330 node scripts/db/runtime.mjs start
env -u DATABASE_URL bunx prisma migrate deploy
env -u DATABASE_URL bunx tsx scripts/db/seed.ts
# всё разом: env -u DATABASE_URL bun run db:setup
```

## Дальше
S1B3 (дизайн-система), S2B1 (GoTrue: Demo123! через Admin API — заменит
auth-users-заметку в setup.mjs), S3B1 — удалить /api/diag/seed-check (TODO в коде).
