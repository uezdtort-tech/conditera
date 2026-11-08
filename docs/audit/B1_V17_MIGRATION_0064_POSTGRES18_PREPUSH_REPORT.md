# B1 / Z-v17 — исправление миграции 0064, чистая PostgreSQL 18, полный pre-push gate

**Дата:** 2026-11-08
**Репозиторий:** github.com/uezdtort-tech/conditera (локальная рабочая копия `/home/z/my-project`)
**Статус:** `B1 FIXED — PRE-PUSH GATE WITH LIMITATIONS` (см. раздел J)
**Публикация:** запрещена владельцем, не выполнена (см. раздел K)

---

## A. Исходное состояние

| Параметр | Значение |
|---|---|
| Ветка | `main` |
| HEAD на старте работ | `831ee40220b82988a1a907becc3b98bab8f9daeb` |
| origin/main | `8a31081f40a752f9cef785f67616af6659bcf7e1` (remote доступен, только чтение) |
| ahead / behind | 188 / 0 (merge-base = origin/main → чистый fast-forward) |
| git status | чистый (единственное изменение в ходе работ — сама миграция 0064) |
| stash | пуст |
| core.hooksPath | `scripts/hooks` (не изменялся; pre-commit = guard защищённых путей) |

Защищённые upload-файлы (по сравнению с предыдущим аудитом — **изменилось**):

| Файл | Состояние на старте | Git-флаг |
|---|---|---|
| `src/app/api/upload/route.ts` | **на диске**, совпадает с HEAD | `H` (обычный) |
| `src/app/api/upload/route.test.ts` | **на диске**, совпадает с HEAD | `H` |
| `src/app/api/services/upload/route.ts` | **на диске**, совпадает с HEAD | `H` |
| `src/app/api/services/upload/route.test.ts` | **на диске**, совпадает с HEAD | `H` |

Файлы были восстановлены между сессиями (в предыдущем аудите они отсутствовали на диске, что давало 4 падения `redline-paths.test.ts` — в этом прогоне Vitest все 1421 тест проходят, drift-guard включительно). skip-worktree / assume-unchanged не установлены.

Новые коммиты после Z-v17 (`3733db4`): `fe8beb0` (пустой чекпоинт) и `831ee40` (добавлен `docs/product/RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md`, 514 строк — посторонних изменений не содержит). Посторонних незакоммиченных изменений в рабочем дереве нет.

История: коммит Z-v17 `3733db4` присутствует в HEAD-линии; merge `54ff3a5` (parents `26947c5` × `8a31081`) в истории, локальная история не опубликована.

---

## B. Первопричина

**Точный SQL-statement** (миграция `supabase/migrations/0064_supplier_procurement.sql`, statement 9/42):

```sql
CREATE POLICY "supplier_reviews_select_parties" ON public.supplier_profile_reviews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "supplier_profiles" sp
      WHERE sp.id = supplier_profile_reviews.profile_id
        AND (sp."userId" = auth.uid()          -- ← text = uuid → 42883
          OR EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.user_id = auth.uid()
                       AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active = true))
    )
  );
```

Ошибка: `operator does not exist: text = uuid (42883)`. Вся миграция (транзакция файла) откатывалась → схема V17 не создавалась.

**Фактические типы колонок** (проверено по миграциям и по реальной PostgreSQL 18.4):

| Объект | Колонка | Фактический SQL-тип | Источник | Назначение |
|---|---|---|---|---|
| supplier_profiles | id | TEXT | 0017:442 | PK профиля |
| supplier_profiles | **userId** | **TEXT** | 0017:443 | владелец профиля |
| supplier_profile_reviews | profile_id | TEXT (FK→supplier_profiles.id) | 0064:69 | ссылка на профиль |
| supplier_profile_reviews | actor_id | UUID (FK→auth.users) | 0064:74 | автор действия |
| user_roles | user_id | UUID (FK→auth.users) | 0001:119 | роли |
| supplier_products | id / supplier_id | UUID / UUID (FK→auth.users) | 0019:421–422 | товар поставщика |
| supplier_product_movements | supplier_id | UUID (FK→auth.users) | 0064:150 | поставщик движения |
| purchase_orders | buyer_id / supplier_id | UUID (FK→auth.users) | 0064:193–194 | стороны закупки |

**Почему возник `text = uuid`:** `auth.uid()` (compat-шим `supabase/compat/0000_supabase_compat.sql:80-94`; в облачном Supabase — одноимённая функция) возвращает `uuid`. Строка 0064:89 сравнивала его с TEXT-колонкой без приведения. Это единственное место во всём файле с таким несоответствием — остальные 41 statement проверены построчно: все UUID-сравнения (`ur.user_id`, `supplier_id`, `buyer_id`) — `uuid = uuid`.

**Почему это отклонение, а не модель:** историческая модель проекта — camelCase **TEXT**-идентификаторы пользователей (`"userId" TEXT` у всех profile-таблиц 0017; приложение пишет туда строковую форму JWT `sub`, см. `src/lib/auth.ts:313`). Канонический паттерн сравнения — `auth.uid()::text`: миграции 0014:68 (`partner_id`), 0022, 0023, 0026:169–182 (`"userId"`), 0027:115+. UUID-колонки с FK на `auth.users` (новая модель V17: purchase_orders и др.) сравниваются напрямую — обе модели сосуществуют сознательно.

**Выбранный способ исправления:** `sp."userId" = auth.uid()::text`.
- соответствует каноническому паттерну проекта (5 прецедентов);
- uuid→text — детерминированный безопасный каст (каноническая нижняя hex-форма), не может дать ошибку данных;
- не меняет схему/типы/данные и совместим с API и TypeScript-типами (string);
- меняет только предикат доступа: множество разрешённых субъектов не расширяется (владелец профиля + ADMIN/SUPER_ADMIN — как и было задумано).

Отвергнутые альтернативы: смена типа `supplier_profiles."userId"` на UUID — ломает историческую схему 0017, данные и API; механическая замена всех `auth.uid()` — не нужна (остальные сравнения корректны); `USING (true)` — ослабление RLS, запрещено.

---

## C. Исправление

**Изменённые файлы:** ровно один —

`supabase/migrations/0064_supplier_procurement.sql`

```diff
 ALTER TABLE public.supplier_profile_reviews ENABLE ROW LEVEL SECURITY;
 DROP POLICY IF EXISTS "supplier_reviews_select_parties" ON public.supplier_profile_reviews;
+-- supplier_profiles."userId" — TEXT (историческая модель идентификаторов 0017,
+-- как у всех profile-таблиц), поэтому сравниваем с auth.uid()::text —
+-- канонический паттерн проекта (0014/0022/0023/0026/0027).
+-- auth.users-UUID-колонки (actor_id, supplier_id, buyer_id) сравниваются напрямую.
 CREATE POLICY "supplier_reviews_select_parties" ON public.supplier_profile_reviews
   FOR SELECT USING (
     EXISTS (
       SELECT 1 FROM "supplier_profiles" sp
       WHERE sp.id = supplier_profile_reviews.profile_id
-        AND (sp."userId" = auth.uid()
+        AND (sp."userId" = auth.uid()::text
```

**Обоснование:** устранение первопричины в самой миграции (не в тесте), сохранение семантики доступа (владелец профиля либо активный ADMIN/SUPER_ADMIN), совместимость с обеими моделями идентификаторов.

**Влияние на RLS и API:** политика осталась FOR SELECT, мутации по-прежнему deny-by-default для authenticated (нет INSERT/UPDATE/DELETE политик и GRANT — только service_role). V17 API работают через service_role (BYPASSRLS) — на них исправление не влияет; политика защищает прямой клиентский путь (PostgREST), если он будет открыт.

---

## D. Миграционный тест (чистая PostgreSQL 18)

**Окружение:** полностью изолированный кластер PostgreSQL 18.4.0 (бинарники `@embedded-postgres/linux-x64`, data dir `/tmp/b1audit-pgdata`, порт 54330 — рабочий инстанс на 54329 не затрагивался). Тестовая база `conditera_b1test`. `SELECT version()` → `PostgreSQL 18.4 on x86_64-pc-linux-gnu, compiled by gcc …`. Схема до миграций: **0 таблиц в public** (чистая база подтверждена).

**Полный прогон** (`0001 → … → 0063 → 0064`, семантика штатного runner'а `scripts/db/setup.mjs`: compat-слой → ledger `public.schema_migrations` → файл в отдельной транзакции, fatal + rollback при ошибке):

```
✔ compat: 27 applied
✔ 0001_init.sql … ✔ 0063_financial_ledger.sql  (все успешно)
✔ 0064_supplier_procurement.sql: 42 stmts, 0 idempotent-skip
Последняя успешно применённая миграция: 0064_supplier_procurement.sql
Ledger: 64 файлов
```

Полный лог: `/home/z/b1-audit/migrate-full.log` (артефакт аудита, вне репозитория).

**Проверка итоговой схемы — 29/29 структурных проверок:** 5 таблиц V17, enum `purchase_order_status`, sequence, 6 политик, FK `supplier_movements_order_fk`, 4 CHECK-ограничения остатков, 3 индекса (включая partial `idx_supplier_products_public_catalog` и unique `uq_purchase_orders_idempotency`), RLS enabled на всех 5 таблицах, новые колонки `supplier_profiles`/`supplier_products`/`purchase_orders`. Фактическое определение политики в PG подтверждает `sp."userId" = (auth.uid())::text`.

Backfill: `approved_profiles=0, published_products=0` (корректно — на чистой БД нет активных записей).

Ledger: все префиксы 0001–0064 присутствуют; **0056 отсутствует как файл в репозитории** (нумерация прыгает 0055→0057; это не пропуск миграции, а отсутствие файла — зафиксировано как observation).

**Повторная применимость:**
- runner пропускает файлы из ledger; повторное выполнение тела 0064 поверх применённой схемы: **42/42 statements OK, 0 warns** (файл построен на `IF NOT EXISTS` / `DROP POLICY IF EXISTS` / guarded `DO $$`; UPDATE-бэкфиллы семантически идемпотентны);
- **частичная схема (симуляция):** при гипотетическом существовании старой `purchase_orders` из 5 колонок прогон 0064 падает на `CREATE INDEX … (status)` (42703) — `CREATE TABLE IF NOT EXISTS` не доливает колонки. **Оценка реализуемости:** через собственный runner проекта (файл в транзакции) частичное состояние недостижимо — ошибка откатывает файл целиком (доказано прогоном); через deploy-мигратор (psql без транзакции файла, см. H) частичная схема возможна, но 0064 сама не может её породить: таблица создаётся одним statement со всеми колонками, падение после её создания оставляет колонку `status` на месте, и повторный прогон завершается успешно. Опасное состояние «purchase_orders без status» 0064 не создаёт ни при каком месте падения. **Решение: не исправлять** (соответствует критерию «исправляй только необходимое для B1»), рекомендация — в разделе I.

**Рабочая dev-БД** (`postgresql://postgres@127.0.0.1:54329/conditera`, только локальный dev, не production): до работ ledger 63 файла, таблиц V17 не было (следствие B1). Исправленная 0064 применена штатным путём проекта — `node scripts/db/setup.mjs` → `✔ 0064_supplier_procurement.sql: 42 stmts`, ledger 64, fixups/demo users/seeds без ошибок.

---

## E. RLS — фактическая проверка

Субъекты (тестовая БД, реальные роли PostgreSQL через `SET ROLE authenticated` + JWT через `set_config('request.jwt.claims', '{"sub":…}', true)`; `auth.uid()` — compat-шим): владелец профиля (SUPPLIER), ADMIN, SUPER_ADMIN, SUPPORT, посторонний CUSTOMER, чужой SUPPLIER, покупатель-кондитер, anon (без GRANT), authenticated без claims, service_role.

Механика GRANT: в локальном рантайме compat выдаёт привилегии только service_role. Для провоцирования политик (а не упирания в отсутствие привилегии) тестовой БД выдан SELECT только на проверяемые таблицы — **тестовая среда, не проект**. Отсутствие GRANT для authenticated в проекте задокументировано как осознанная модель («мутации и чтение — серверные API»).

**Результаты: 30/30 passed** (`/home/z/b1-audit/b1-audit-rls.mjs`).

| Сценарий | Ожидание | Факт |
|---|---|---|
| Владелец профиля читает отзыв своего профиля | разрешено | ✓ 1 строка |
| ADMIN / SUPER_ADMIN читают отзыв | разрешено | ✓ |
| Посторонний CUSTOMER / чужой SUPPLIER / чужой покупатель | запрещено | ✓ 0 строк (в т.ч. кросс-фильтр всей таблицы) |
| authenticated без claims (пустой GUC) | запрещено, без ошибки | ✓ 0 строк, нет 42883 |
| anon | запрещено | ✓ permission denied (нет GRANT) |
| INSERT/UPDATE/DELETE от authenticated | запрещено | ✓ 42501 (и без GRANT, и с тестовым GRANT — RLS violation, нет INSERT-политики) |
| purchase_orders: buyer/supplier/admin/support видят; посторонний нет | по правилам | ✓ |
| purchase_order_items / status_history (вложенные EXISTS) | по правилам | ✓ |
| supplier_product_movements: свой — да, чужой — нет, admin — да | по правилам | ✓ |
| user_roles: свои роли видны, чужие нет | по правилам | ✓ |
| service_role (BYPASSRLS) | полный доступ (серверные API) | ✓ |

**Найдена и задокументирована отдельная проблема (не B1):** `user_roles_select_admin` из 0001 ссылается на собственную таблицу → `42P17 infinite recursion detected in policy for relation "user_roles"` при любом доступе authenticated к user_roles/зависимым политикам. Проект уже содержит штатный фикс — `supabase/compat/0001_local_fixups.sql` (SECURITY DEFINER `app_is_admin()`), применяемый setup.mjs после миграций (в CI-path он есть, в deploy-миграторе — нет; в облачном Supabase проявлялось бы только на прямом клиентском пути). После применения fixups рекурсия устранена, все 30 тестов зелёные. Рекомендация: перевести политики 0064 на `app_is_admin()` в будущей миграции (не в рамках B1).

---

## F. API и бизнес-процессы (V17)

Проверено поверх схемы, созданной исправленной 0064, на рабочей dev-БД через штатные скрипты проекта.

**SQL-интеграция** (`bun scripts/verify-supplier-procurement-v17.ts`): **41/41 passed** —
1. Happy path SUBMITTED→CONFIRMED→PROCESSING→READY_FOR_SHIPMENT→SHIPPED→DELIVERED: списание `quantity 10→6`, резерв 0, движения RESERVE=4/OUT=4, история 6 переходов; повторный confirm → 409
2. Недостаток остатка → 409, резерв не изменён
3. MOQ/кратность → 409
4. Гонка за последний остаток (2 параллельных): ровно один победитель, резерв ровно 2, **отрицательного остатка нет**
5. Идемпотентность создания: повтор → `existing:true`, тот же номер, в БД 1 заказ
6. Confirm с корректировкой количеств: излишек резерва освобождён
7. Buyer cancel после confirm → резерв освобождён
8. Изоляция: чужой buyer/supplier → 403; поставщик не может заказать у себя → 409
9. Неопубликованный товар → 409
10. Cleanup выполнен

**HTTP-сквозная** (`node scripts/verify-supplier-api-v17.mjs` через работающий dev-сервер :3000): **39/39 passed** —
- [A] регистрация/онбординг: профиль upsert (создание/изменение владельцем), submit → submitted, повторный submit → 409, RBAC 403
- [B] модерация: очередь, start_review, approve, reject с короткой причиной → 400, уведомление поставщику
- [C] каталог: draft/published, publish, видимость draft-товара
- [D] закупка: создание 201, сумма 34000 коп., повтор → existing, draft-товар → 409, MOQ → 409
- [E] обработка: полный статусный каскад, чужой confirm → 403, история, списание при доставке
- [F] отказ+изоляция: чужой заказ 404/403, reject с причиной, резерв освобождён
- cleanup выполнен

**Раздельный учёт остатков** подтверждён: списывается только `supplier_products.quantity` поставщика (модель V17 с собственным журналом `supplier_product_movements`); `inventory_items`/`inventory_movements` кондитера не затрагиваются; резервирование→списание не дублируются; повторный запрос не создаёт вторую операцию (идемпотентный ключ); гонка не даёт отрицательный остаток; заказ не считается доставленным из-за подтверждения (списание только на DELIVERED).

Все 15 обязательных сценариев задания покрыты (профиль, модерация, каталог, публикация, доступность/остаток, заказ, подтверждение, статусы, история, уведомления, чужой доступ, негативный RBAC).

---

## G. Полный набор тестов

| Проверка | Команда | Результат | Примечание |
|---|---|---|---|
| Миграции (чистая PG 18) | аудит-скрипт (семантика setup.mjs) | exit 0, 64/64 файлов | раздел D |
| Миграции (deploy-путь) | psql-семантика, autocommit | exit 0, 42/42 stmts | раздел H |
| Идемпотентность 0064 | повторный прогон тела | 42/42 OK | раздел D |
| RLS | `node /home/z/b1-audit/b1-audit-rls.mjs` | **30/30 passed** | раздел E |
| SQL-интеграция supplier/procurement | `bun scripts/verify-supplier-procurement-v17.ts` | **41/41 passed** | раздел F |
| HTTP/API V17 | `node scripts/verify-supplier-api-v17.mjs` | **39/39 passed** | раздел F |
| TypeScript | `bun run typecheck` | **exit 0** | |
| ESLint | `bun run lint` | **exit 0** | |
| Vitest (полный) | `bun run test` | **1421/1421 passed (92 файла)** | в т.ч. 4 redline-paths drift-guard (файлы восстановлены) |
| Playwright smoke | `npx playwright test tests/e2e/smoke.spec.ts` | **22/22** | |
| Playwright smoke+api-v2+auth-flow (2 воркера) | | **124/124** | первые 6 транзиентных падений при 3 параллельных спеках — не воспроизведены (22/22 и 124/124 в повторах) |
| Playwright onboarding+regional-pricing | workers=1 | **28 passed, 2 skipped** | skip — условные внутри спеков |
| Playwright payment-webhook-idempotency | workers=1 | **24/24** | |
| Playwright recipe-purchase-flow | workers=1 | **14/14** | |
| Playwright integration-auth-flow | workers=1 | **34/34** | |
| Playwright full-flow (тяжёлый) | workers=1 | **41/41** | в предыдущей сессии падал по OOM; сейчас прошёл |
| Evidence hygiene | `node scripts/scan-evidence.mjs` | exit 0; real=0, synthetic=481 | |
| Production build | — | **НЕ ВЫПОЛНЕН** | см. раздел I |

Пропусков по причине недоступности инструментов нет: все команды, выполненные в среде, дали фактические результаты.

---

## H. CI/deploy migration path

**CI (`.github/workflows/e2e.yml`):** job Playwright → `node scripts/db/runtime.mjs start` + `bun run db:setup` с `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/conditera` → embedded PostgreSQL **18.4** + полный setup-путь (compat → миграции → fixups → демо-юзеры → сиды). Мой чистый прогон воспроизводит ровно этот путь (compat+миграции+fixups на чистой PG 18.4) — исправленная 0064 проходит. `ci.yml` использует `DATABASE_URL=file:./db/ci-test.db` только в build-шаге (миграции там не выполняются, маскирования нет).

**Deploy (`.github/workflows/deploy.yml`):** одноразовый migrator-образ (`Dockerfile` stage `migrator` = `postgres:18-alpine` + `supabase/migrations` + seeds + `supabase/init-scripts/01-apply-migrations.sh`) → psql **ledger + `ON_ERROR_STOP=1`, каждый statement в autocommit (файл НЕ в транзакции)** → только файлы вне ledger → healthcheck `/api/health` с rollback. Версия PG — **18-alpine** (соответствует требованию 18; поднята Dependabot-мерджем 54ff3a5).

**Симуляция deploy-пути** (`/home/z/b1-audit/b1-audit-deploy-sim.mjs`, БД `conditera_deploy_sim`): compat (эмуляция существующей auth-схемы production) → база-лайн 0001–0063 → ledger без 0064 → прогон **только 0064 в autocommit** → **все 42 statements OK**, объекты и политика на месте, `auth.uid()::text` в определении. На production `auth.uid()` — реальная функция Supabase с тем же возвращаемым типом uuid → исправление переносимо без изменений.

**Ответы на контрольные вопросы:**
1. PG в тестовом окружении = 18.4 (embedded), deploy = postgres:18-alpine — требованию 18 соответствует.
2. CI использует правильный runner (`db:setup` — тот же, что в локальной разработке).
3. 0064 не пропускается: e2e.yml применяет всё через ledger; deploy применяет pending по ledger.
4. Маскирования ошибки нет: падение миграции роняет job (fatal в setup.mjs; `exit 1` + `script_stop` в deploy).
5. Зависимость от существующей схемы: 0064 опирается только на 0017/0019/0001 — присутствуют в базе-лайн; на чистой БД порядок соблюдён (доказано полным прогоном).
6. Последующие миграции: 0064 — последняя; порядок не нарушен.

**Отдельные наблюдения (вне B1, не менялись):**
- deploy-мигратор не выполняет compat/fixups: production-БД должна уже иметь `auth`-схему (архитектурное допущение проекта; латентная рекурсия `user_roles_select_admin` на клиентском authenticated-пути в этом пути не фиксится — см. E);
- мигратор без транзакции файла → при падении возможна частичная схема; для 0064 все реалистичные точки падения повторно применимы (раздел D);
- evidence-hygiene job остаётся на Node 20, `Dockerfile.chat` на Node 20 (не тронуты Dependabot; не регрессия).

---

## I. Pre-push gate

| Проверка | Результат | Доказательство | Ограничения |
|---|---|---|---|
| Ветка/HEAD | ✓ main @ фиксация исправления | git rev-parse | |
| Diff — только B1 | ✓ 1 файл миграции (+ отчёт и коммит — раздел C/этап 9) | git status/diff | |
| Секреты в diff | ✓ отсутствуют | grep по паттернам + scan-evidence real=0 | |
| 4 защищённых upload-файла | ✓ не изменены, флаги `H`, на диске | git diff HEAD по каждому | |
| Git hooks / flags | ✓ не изменены | core.hooksPath, ls-files -v | |
| Посторонние изменения | ✓ не затронуты (RECIPE-док и чекпоинты в истории не тронуты) | git status | |
| TypeScript | ✓ exit 0 | bun run typecheck | |
| ESLint | ✓ exit 0 | bun run lint | |
| Vitest полный | ✓ 1421/1421 | bun run test | |
| SQL/HTTP/RLS тесты V17 | ✓ 41/41, 39/39, 30/30 | разделы E–F | |
| Playwright (доступные) | ✓ ≈267 passed / 2 skipped | раздел G | |
| Чистая PostgreSQL 18 (полный прогон) | ✓ 0001–0064, ledger 64 | раздел D | |
| Deploy-путь (psql) | ✓ DEPLOY-SIM | раздел H | |
| Идемпотентность/повторный запуск | ✓ | раздел D | |
| История vs origin/main | ✓ ahead 188 / behind 0, merge-base = origin/main, merge 54ff3a5 в истории, fast-forward возможен | git rev-list / cat-file | |
| Production build | ⚠ **НЕ ВЫПОЛНЕН** | — | `next build` пишет в общий `.next` работающего dev-сервера (риск повреждения артефактов) + подтверждённые ограничения песочницы (4 GB RAM, зафиксированные OOM при сборке в предыдущей сессии). По условию задачи build пропущен и не засчитывается. |

**Рекомендации (вне рамок B1, не реализовались):**
1. Перевести политики, проверяющие админ-роль, на SECURITY DEFINER `app_is_admin()` (устраняет 42P17 на клиентском пути; fixups уже дают хелпер).
2. В 0064 можно (опционально, следующей миграцией) добавить `ADD COLUMN IF NOT EXISTS` для колонок `purchase_orders`, используемых последующими statements, если требуется устойчивость к произвольным частичным состояниям deploy-мигратора.
3. Обновить Node 20 → 26 в evidence-hygiene job и `Dockerfile.chat`.

---

## J. Итоговый статус

**`B1 FIXED — PRE-PUSH GATE WITH LIMITATIONS`**

Обоснование: B1 исправлен в первопричине; чистая PostgreSQL 18.4 полностью применяет 0001–0064 (ledger 64/64); RLS проверен фактически (30/30) под реальными ролями и JWT; V17 API и supplier/procurement проверены SQL-интеграцией (41/41) и HTTP (39/39); полный набор тестов прошёл (typecheck/lint/vitest/Playwright). Единственное ограничение — production build не выполнялся из-за окружения (общий `.next` с dev-сервером + OOM-лимиты песочницы); это честно отражено в таблице раздела I и не влияет на миграционные доказательства.

## K. Публикация

```text
PUSH: NOT EXECUTED
REMOTE BRANCH: NOT MODIFIED
DEPLOY: NOT EXECUTED
PUBLICATION: NOT AUTHORIZED
```

Локальный коммит исправления и отчёта создан (см. ниже), но **не отправлен**; origin/main не изменялся.

**Локальный коммит:** hash и родитель фиксируются в ответе задачи; файлы — `supabase/migrations/0064_supplier_procurement.sql` (исправление B1) и `docs/audit/B1_V17_MIGRATION_0064_POSTGRES18_PREPUSH_REPORT.md` (настоящий отчёт).
