# RELEASE-03 — FINAL HARDENING, OWNER DECISIONS & RELEASE GATE

**Дата:** 2026-11-09 · **Ветка:** main · **Базовый HEAD до работ:** eb4fd1a · **Финальный HEAD:** 00f0c9c
**Статус: READY FOR OWNER REVIEW** (технические гейты пройдены; остаются решения владельца и внешние настройки — разделы H, K)

---

## A. Фактическая Git-точка

- Ветка `main`, HEAD `00f0c9c`; рабочее дерево: чистое, КРОМЕ 4 защищённых upload-файлов (worktree-deletion, index=HEAD — см. K-6).
- Относительно origin/main: behind 0 / ahead 206. Публикации НЕ было: push/merge/PR/deploy не выполнялись (по запрету).
- **Инцидент отката среды (критически важный):** в начале RELEASE-03 среда пережила полный сброс (uptime reset, восстановлен более старый снапшот). Все 8 коммитов RELEASE-02 (d43d029, b88714b, 93c42c8, 6390a98, ad1b8ea, 0b0009f, bbed571, 80e5c43; HEAD bbed571) были верифицированы метаданными ДО отката (полные списки файлов, empty UUID-коммит 80e5c43, скан секретов — чисто) и ПОСЛЕ отката утрачены безвозвратно (`git cat-file` → not valid objects; reflog начинается с eb4fd1a; fsck не содержит этих объектов). Происхождение — платформенный сброс среды, не git-операция. RELEASE-02 ре-применён в рамках RELEASE-03 (раздел B).
- Сопутствующие потери: worktree /home/z/gate20 (ветка release-candidate/gate-20 СОХРАНИЛАСЬ), evidence-файлы RELEASE-02 (prodpath-0075 JSON, r02-*.png, r02-prod-build log), scripts/verify/prodpath-0075-verify.mjs — всё восстановлено/заменено эквивалентами (0722dad), кроме скриншотов (не воспроизводятся, не критичны).
- Drift #18: 4 защищённых upload-файла удалены в worktree после отката (index=HEAD, blob'ы целы в истории). По явному запрету НЕ восстанавливались. Метаданные: 4 blob'а cb23e5dd/06b49c3c/f6c52a42/ec9f8efc, флаги `H` (skip-worktree снят ещё при drift-репаре #16), pre-commit guard (core.hooksPath=scripts/hooks → scripts/protected-paths.sh hook-guard) активен и отрабатывал на каждом коммите этой сессии.
- Скан секретов eb4fd1a..HEAD: 0 совпадений по маскам (yookassa_secret/sk_live/PRIVATE KEY/password=/api_key=).

## B. Исправленные технические дефекты

| # | Commit | Проблема | Первопричина | Файлы | Тест |
|---|---|---|---|---|---|
| 1 | 85394d8 | OAuth-перехват аккаунта: вход по совпадению email в парольный аккаунт со сбросом пароля; state не timing-safe/не одноразовый; VK initiation вёл на legacy oauth.vk.com → JSON-заглушку | Отсутствие анти-мержа; сравнение `===`; VK-код без fail-closed | src/app/api/auth/oauth/[provider]/route.ts, .../callback/route.ts, src/lib/secure-compare.ts | tsc=0; ESLint=0; ручная верификация всех 5 исходов callback (consumeStateCookie на всех путях) |
| 2 | 43d8149 | PATCH/POST складских API писали quantity напрямую (мимо журнала) | Whitelist без ограничения колонки | src/lib/inventory.ts (+setQuantityViaMovement), api/inventory/items/route.ts, api/supplier/products/route.ts | vitest inventory-quantity-via-movement: 5/5 |
| 3 | 191b1f2 | Обход модерации: marketplace POST ставил status:'published' из тела клиента; PATCH оффера и purchase не проверяли статус корня; модератор мог самоодобрить; reject без CAS/аудита | Клиентский is_published доверялся; проверок не было | api/recipes/marketplace/route.ts, [id]/route.ts, [id]/purchase/route.ts, api/moderator/action/route.ts, миграция 0076 | vitest moderation-bypass: 4/4 |
| 4 | 02e70fb | Webhook в production без кредов шлюза принимал события без re-fetch (fail-open); legacy metadata-фолбэк в prod; мёртвый код | Доверие NODE_ENV-веткам без prod-guard | api/payment/webhook/route.ts | vitest webhook: 23/23 |
| 5 | eda05e9 | **Новые находки RELEASE-03 (уровень БД):** (a) прямой UPDATE/INSERT/DELETE inventory_items через PostgREST владельцем — остаток менялся МИМО журнала (GRANT 0010:567-577 + RLS `inventory_own FOR ALL` без WITH CHECK, 0010:480); (b) самовыддача entitlement: GRANT INSERT/UPDATE recipe_purchases (0025:15) + политика buyer_insert — платный контент бесплатно; (c) прямые записи recipes/recipe_marketplace — обход модерации на уровне БД; (d) EXECUTE PUBLIC: add/deduct_bonus_balance (самоначисление бонусов), revenue_today/month, sum_succeeded_payments (утечка выручки), auto_assign_confectioner (манипуляция чужими заказами), apply_inventory_movement_atomic | Дефолтные EXECUTE→PUBLIC; избыточные GRANT 0010/0025; отсутствие CHECK quantity>=0 | supabase/migrations/0077_release_security_closures.sql | prodpath: has_table_privilege/has_function_privilege матрица + прямые пробы SET ROLE authenticated → 42501 permission denied |
| 6 | 0722dad, 00f0c9c | Утраченные при откате харнесс/пропозал/worklog | Откат среды | scripts/verify/prodpath-release03-verify.mjs, docs/product/SECURITY_RECIPE_01_PROPOSAL.md, worklog.md | prodpath-прогон (см. J) |

Всего в RELEASE-03: 7 коммитов (85394d8 → 00f0c9c), полный список — `git log --oneline eb4fd1a..HEAD`.

## C. Склад — матрица write-path

Проверены ВСЕ пути изменения quantity (API, Server Actions (0 в проекте), Supabase-клиенты, RPC, PostgREST, GRANT/RLS, триггеры, фоновые задачи, импорты, seed/scripts, n8n, Prisma, cleanup).

| Write-path | Может изменить остаток | Проверяет владельца | Записывает движение | Защищён от повторов | Результат после 0077 |
|---|---|---|---|---|---|
| POST /api/inventory/items (insert qty=0 + IN-движение) | да (только через RPC 0048) | да (owner_id=user.id) | да | частично (создание не идемпотентно) | OK |
| PATCH /api/inventory/items (метаданные) | НЕТ (quantity исключён из whitelist) | да | n/a | n/a | OK |
| PATCH /api/inventory/items quantity → setQuantityViaMovement | да (ADJUST/OUT через RPC) | да | да | нет (одиночные движения без ключа) | OK (риск M задокументирован) |
| DELETE /api/inventory/items | нет (soft-delete) | да | n/a | n/a | OK |
| POST /api/inventory/movements | да (RPC) | да | да | НЕТ (ретрай = 2-е движение) | OK, риск M |
| POST /api/inventory/write-off order-путь | да (N×RPC) | да | да | реестр 0049 при order_id | OK, риск M (не единая транзакция) |
| POST /api/inventory/write-off batch-путь | да (RPC 0071, одна транзакция) | да (двойная: route+SQL) | да | ДА (UNIQUE batch_id/idempotency_key + replay) | OK |
| POST/PATCH /api/supplier/products | да (только через RPC) | да | да | нет | OK |
| DELETE /api/supplier/products | hard-delete позиции + КАСКАДНОЕ УНИЧТОЖЕНИЕ журнала (0046:19) | да | — | — | РИСК M-H: предлагается soft-delete (решение владельца, не менялось) |
| **Прямой PostgREST PATCH/INSERT/DELETE inventory_items** | БЫЛО: ДА, мимо журнала | RLS только owner | НЕТ | НЕТ | **ЗАКРЫТО 0077: I/U/D отозваны; проба → 42501** |
| RPC apply_inventory_movement_atomic напрямую | БЫЛО: доступен PUBLIC (спасал только INVOKER+RLS) | в SQL нет (service_role by design) | (да) | нет | **ЗАКРЫТО 0077: EXECUTE только service_role** |
| RPC apply_inventory_write_off_batch | нет | да | да | да | закрыт ранее (0071) |
| Legacy stock_movements (запись) | нет (на остаток не влияет) | свои | фальсификация журнала | нет | **ЗАКРЫТО 0077: I/U/D отозваны** |
| cleanup.ts / seed / n8n / Prisma | ops-внутренние/dev | n/a | n/a | n/a | вне пользовательского периметра |

Итог: все пользовательские изменения остатка — ТОЛЬКО через атомарный RPC с журналом; прямой обход закрыт на уровне БД (доказано 42501); CHECK quantity>=0 добавлен (defense-in-depth, без триггера). Задокументированные остаточные риски (НЕ менялись — требуют решения владельца): идемпотентность одиночных движений; order-write-off не в одной транзакции; supplier hard-delete стирает журнал каскадом.

## D. Рецепты — фактическая модель

- **Покупка:** POST purchase создаёт заказ type='recipe' (metadata: recipe_offer_id, recipe_id=КОРЕНЬ) + payment; entitlement выдаёт ТОЛЬКО webhook payment.succeeded (CAS-победитель), grantEntitlement upsert по UNIQUE(recipe_id,buyer_id), фиксирует recipe_version_id = последняя версия на момент оплаты.
- **Фактическая модель доступа — recipe-level entitlement:** Access Resolver даёт level='full' на КОРЕНЬ; живая карточка GET /api/recipes/[id] отдаёт ТЕКУЩИЙ контент → покупатель автоматически получает будущие версии; зафиксированная купленная версия доступна снапшотом через GET /api/recipes/[id]/versions. Это противоречит ранее обсуждавшейся модели «доступ к купленной версии» → вынесено в решение Q-3.2 (раздел H), НЕ менялось.
- **Версии:** иммутабельные снапшоты recipe_versions (UNIQUE(recipe_id,version_no), RLS без мутационных политик, API update/delete версий не существует); публикация новой версии НЕ трогает production-карты/партии/себестоимость (карты зафиксированы на своей recipe_version_id через RESTRICT).
- **Автор может изменить купленное:** рабочий корень правится свободно (новая версия при publish); купленный снапшот неизменен; DELETE купленной версии кодом недостижим, но FK recipe_version_id → ON DELETE SET NULL молча переключил бы покупателя на «последнюю» (риск задокументирован, рекомендация RESTRICT — в Q-3.2).
- **Возвраты:** заявка покупателя (requested, без денег) → админ: reserve_refund (атомарный RPC, лимит) → провайдер (Idempotence-Key = refund:{refundId}) → webhook refund.succeeded (re-fetch GET /refunds/{id}; RPC 0039 дедуп по refund_id PK; refund_amount копится атомарно) → при fully_refunded: orders='refunded' + revokeEntitlement (is_active=false, Resolver → REVOKED_REFUND). Частичный возврат доступ СОХРАНЯЕТ (Q-3.1-дефолт). Повторный webhook с тем же refund_id — no-op (3 слоя дедупа); разные частичные возвраты корректно суммируются. Финансовая история: soft-only, ledger append-only, hard delete отсутствует.
- **Задокументированные гэпы (не менялись):** сбой grantEntitlement после CAS не ретраится автоматикой (CRITICAL-лог + ручной scripts/reconcile-payments.ts — автоматического reconciliation нет); recipe_acceptances — дрейф схемы SQL/Prisma/API (fallback на mock — вне рецептурно-платёжного ядра).

## E. OAuth

**Yandex ID (main):** реальный флоу реализован и захарденен (85394d8): authorize oauth.yandex.ru (scope login:email login:info), state 32 байта randomBytes, httpOnly-cookie path=/api/auth/oauth maxAge 600, timing-safe сверка, одноразовое гашение на всех исходах, серверный token-exchange (15s timeout), профиль login.yandex.ru/info, синтетический email ЗАПРЕЩЁН (fail-closed), анти-мерж fail-closed (парольный аккаунт не входит по email; вход только для OAuth-аккаунтов того же провайдера), первый вход → profiles+CUSTOMER, cancel/error → /oauth/finish. **НЕ проверен реальным провайдером — внешний блокер (K-2).**
**VK ID:** на main — ЧЕСТНАЯ заглушка 501 (configured:false независимо от VK_CLIENT_ID; мёртвый legacy oauth.vk.com удалён). Полная реализация существует в ветке release-candidate/gate-20 (a7e169a…9ca33d7, 83 коммита: id.vk.ru OAuth 2.1 + PKCE S256, service_token, 2FA-паритет, rate limits, safeNextPath, 5 тест-файлов) — НЕ слита в main (по запрету). Интеграция требует: переноса 0067_profiles_oauth_subject, lib/oauth/providers.ts+state.ts, переписывания callback на app-JWT-сессии, 2FA-гейта, rate-limit пресетов, env-документации, тестов; в самой VK-реализации нет привязки/отвязки аккаунта и live-прогона с реальным VK. **OAuth не объявляется production-ready.**

## F. Модерация — доказательство невозможности обхода

| Путь draft→published | Статус | Доказательство |
|---|---|---|
| POST /api/recipes/[id]/publish при RECIPE_MODERATION_REQUIRED=false | контролируемый by design | publish/route.ts: флаг читается сервером; при true → pending_review (без версии), публикация только moderator approve |
| POST /api/recipes/[id]/publish при true | требует модератора | draft→pending_review; approve → publish-core |
| POST /api/recipes/marketplace {is_published:true} | **ЗАКРЫТО** | корень всегда draft, оффер is_published:false (191b1f2) |
| PATCH /api/recipes/marketplace/[id] {is_published:true} | **ЗАКРЫТО** | 409 если корень не published |
| purchase при draft-корне | **ЗАКРЫТО** | 409 по статусу корня |
| **Прямой PostgREST PATCH recipes {status:'published'}** (обход всего) | **ЗАКРЫТО 0077** | UPDATE/INSERT/DELETE recipes отозваны у authenticated/anon; прямая проба → 42501 |
| Прямой INSERT recipes {status:'published'} | **ЗАКРЫТО 0077** | INSERT отозван |
| Модератор одобряет свой рецепт | **ЗАКРЫТО** | 403 author_id===user.id (approve и reject) |
| Конкурентные approve/reject | **ЗАКРЫТО (CAS)** | reject: .eq(status,pending_review); 0 строк → 409 |
| Аудит решений | **ВВЕДЕНО** | audit_log (recipe_approve/reject, actor, metadata.reason) + персистентность moderated_by/at/reason (миграция 0076) |

Проверено: Server Actions в проекте отсутствуют (grep "use server" = 0); админ-роли самоназначить нельзя (register whitelist 403 на ADMIN/MODERATOR; user_roles INSERT-политика 0074 требует is_platform_admin; 0077 лишних RPC-дверей нет). RECIPE_MODERATION_REQUIRED по умолчанию false — **для production владелец должен установить true** (K-4); при false прямая авторская публикация через POST publish — легитимное поведение (документировано в коде), при true — обязательная модерация. Кнопка «На модерацию» не считается доказательством — защита серверная.

## G. RLS — реестр опасных политик

Полный реестр: **28 политик USING(true)/WITH CHECK(true)** по всем миграциям (греп-подтверждение). Группы:
- **10 политик 0053/0054** (SEC-1, FOR SELECT TO authenticated): domain_events 0053:37, ops_tasks 0053:79, purchase_drafts 0053:118, purchase_draft_items 0053:125, recipe_ingredients 0053:152, confectioner_capacity 0054:53, capacity_reservations 0054:110, order_production 0054:149, order_production_checklist 0054:178, order_media 0054:216. ЛАТЕНТНЫ: GRANT authenticated на эти таблицы отсутствует (последний blanket 0011:314 — до создания таблиц), клиентских чтений нет (все через getPool/supabaseAdmin). Предложение — **docs/product/SECURITY_RECIPE_01_PROPOSAL.md** (миграция 0073, зарезервирована): сужение на «участники+админы» через is_platform_admin(); **НЕ применяется до Q-7**.
- **7 vs 10 — расхождение объяснено:** RECIPE-01A (Ф-10) насчитал 7 (purchase_drafts+items за одну, пропустив domain_events и ops_tasks); RECIPE-01B/RELEASE-02 (RB.3) — ровно 10; полный реестр по проекту — 28.
- **Активные низкорисковые (by design):** публичные каталоги (product_images/attributes/videos/variants, design_settings, holidays, capabilities, permissions, role_permissions), recipe_acceptances (M: anon читает все acceptance-отзывы — продуктовое решение), financial_ledger service_only (эталон).
- **Латентные (без GRANT):** uploads_read_all, builder_* ×3, fraud-таблицы (INSERT WITH CHECK(true), но GRANT только service_role).
- **Устранено в 0077 (не RLS, а GRANT):** самовыддача entitlement (recipe_purchases), прямые записи recipes/marketplace/inventory — см. B-5.
- **Обнаружено и НЕ исправлено (нужен владелец/отдельная задача):** service_bookings имеет GRANT I/U/D authenticated БЕЗ RLS вообще (0040:138) — активная дыра средней тяжести вне складского/рецептурного ядра; Prisma-legacy 0017-семейство (~80 таблиц без RLS, включая users с passwordHash/tfaSecret — защищены только отсутствием GRANT); избыточный GRANT INSERT ON user_roles (0001:295, политика 0074 делает его безопасным); recipe_purchases_buyer_insert политика остаётся в схеме (недостижима после REVOKE — глубокая чистка в 0073/Q-7).

Изоляционные проверки (уровень кода+схемы): чтение чужих данных перекрыто (RLS собственные-политики + 0077 REVOKE записи; payments/refunds — только участники заказа/админ; financial_ledger — service_role); покупатель без entitlement не читает платный контент (Resolver+gateRecipeContent на всех контентных роутах; /scale 403; /versions только своя фикс-версия); поставщик не получает production-данные кондитера (production-таблицы: owner-RLS, supplier-грантов нет); self-escalation роли закрыт (register whitelist + 0074 + 0077). Мультипользовательские live-RLS-тесты (два реальных JWT) в этой сессии не выполнялись — зафиксировано как остаточный пункт (схемно-кодовые доказательства выше; риск ограничен REVOKE-дисциплиной 0077).

## H. Шесть решений владельца (НЕ применялись)

**Q-3.1 — частичный возврат.** Текущее поведение: частичный — доступ сохраняет, полный (fully_refunded) — revoke. Совпадает с рекомендуемым. Последствия проверены: YooKassa (двухэтапный refund, дедуп по refund_id), ledger (refund_confirmed атомарно), webhook (RPC 0039), entitlement (is_active=false только при fully_refunded), повторы (3 слоя дедупа), история (soft-only). Вариант B «частичный тоже revoke» — строже, но меняет контракт без необходимости. Рекомендация: оставить как есть. Если оставить текущее: рисков нет.
**Q-3.2 — новые версии.** Факт: покупатель получает БУДУЩИЕ версии автоматически (живая карточка), купленный снапшот — в /versions.
| Вариант | Покупатель | Автор | Продажи | Сложность | Риски |
|---|---|---|---|---|---|
| A (факт): entitlement на корне | авто-доступ к обновлениям | может улучшать рецепт без отзыва прав | стимул улучшать; фиксация «что куплено» ослаблена | 0 (уже работает) | автор может ухудшить контент после продаж; «версия» только справочная |
| B: доступ к купленной версии | контент фиксируется на момент покупки | обязан публиковать новую версию как новый продукт | возможна допродажа обновлений | высокий: Resolver/purchase/versions/карточка + миграция entitlement-модели | двойной прайсинг, миграция существующих покупок, недовольство покупателей |
Рекомендация: A (фактическая) + гарантии: recipe_version_id FK → ON DELETE RESTRICT (сейчас SET NULL), запрет деградации содержимого вне новой версии — отдельная задача. Если оставить текущее: работает; риск «ухудшение после покупки» остаётся продуктовым.
**Q-4 — права поставщика.** Факт: поставщик не может создать рецепт/оффер (SUPPLIER исключён из POST /api/recipes:141-152; marketplace требует RECIPE_DEVELOPER); может покупать как покупатель (покупка не даёт прав продавать чужое; production-данные кондитера поставщику недоступны). Совпадает с рекомендуемым. Изменений не требуется.
**Q-6 — права кондитера.** Факт: кондитер может продавать СВОИ рецепты только в роли RECIPE_DEVELOPER (роль назначается администратором, self-регистрация 400/403), публикация — через publish-core (+ модерация при RECIPE_MODERATION_REQUIRED=true), покупка чужого — как покупатель, производственное использование — через production-контур своего склада. Разделение покупка/создание/публикация/продажа/чужие рецепты/производство — реализовано на ролях и RLS. Рекомендация: оставить; при включении модерации — verificar authors' rights_confirmed (RA.13) уже гейтит publish.
**Q-7 — RLS.** Факт: 10 политик USING(true) 0053/0054 не тронуты (латентны); предложение готово (SECURITY_RECIPE_01_PROPOSAL, миграция 0073). Рекомендация: утвердить сужение «участники+админы» — риска регрессий нет (клиентских чтений нет, все серверные пути BYPASSRLS). Если не утверждать: латентная поверхность остаётся; при будущих blanket-GRANT раскроется.
**Q-10 — защита quantity на уровне БД.** Факт (после 0077): прямой UPDATE невозможен (REVOKE, проба 42501), единственный путь — атомарный RPC с журналом (EXECUTE только service_role), CHECK quantity>=0 добавлен. Рекомендуемая политика («не допускать прямого изменения без атомарной операции») — **уже выполнена минимальными средствами, БЕЗ триггера**. Дальнейшее (триггер-страж) не требуется; опционально — NOT NULL на quantity.

## I. Тесты

| Проверка | Команда | Exit | Результат |
|---|---|---|---|
| TypeScript | bunx tsc --noEmit | 0 | 0 ошибок |
| ESLint | bunx eslint . | 0 | 0 ошибок, 0 warnings |
| Vitest (полный) | bunx vitest run | 1 | 1414/1418 passed; 4 failed — ТОЛЬКО redline-paths.test.ts (существование 4 защищённых upload-файлов на диске; средовое: worktree-deletion drift #18; продуктовых падений 0) |
| E2E payment-webhook-idempotency | bunx playwright test ... (chromium+mobile) | 0 | **24/24 passed с первой попытки — OOM НЕ воспроизвёлся** (блокер RELEASE-02 §4 закрыт) |
| E2E recipe-purchase-flow | bunx playwright test ... --workers=1 | 0 | 6 passed, 8 skipped (by-design guard'ы seed-фильтров), 0 failed |
| Production build (изолированно /home/z/r03-build) | bun run build, NODE_OPTIONS=2400 | 0 | BUILD_ID ZyEfIONys5CfyzpJZSBOo, 355 роутов (32 static + 323 dynamic), ~97с; dev-среда не разрушена |
| Production migration path | node scripts/verify/prodpath-release03-verify.mjs | 0 | см. J |
| Скриншот-верификация UI | — | — | не выполнялась в RELEASE-03 (утраченные r02-скриншоты не воспроизводятся; не является гейтом RELEASE-03) |

OOM-протокол: потребление памяти не фиксировалось (OOM не возник); нестабильность не потребовала изоляции; тесты не пропускались и не ослаблялись.

## J. Миграции

- Харнесс: scripts/verify/prodpath-release03-verify.mjs (восстановлен, взамен утраченного prodpath-0075-verify.mjs): чистый embedded **PostgreSQL 18** (порт 54351, отдельная data-директория, :54329 не тронут), bootstrap Supabase-compat, STRICT psql-эквивалент: каждый statement отдельным autocommit.
- Применение: **76 файлов, 2310 statements, 0 ошибок**; ledger public.schema_migrations = 76 == диску, set-equality, линейка 0001..0077 (0056 не существует исторически; 0073 зарезервирована за Q-7).
- STRICT rerun: 0075, 0076, 0077 — по 0 ошибок (idempotent).
- Частичный отказ: первые 2 statement 0076/0077 отдельно → затем файл целиком → 0 ошибок (восстановление после краша на середине файла).
- GRANT-assertions: 10 table-проверок + 3 function-проверки pass; прямые пробы под SET ROLE authenticated: UPDATE inventory_items → 42501, INSERT recipe_purchases → 42501.
- 0076-колонки: moderated_by/moderated_at/moderation_reason — 3/3.
- Evidence: docs/evidence/release-gate/r03-prodpath-20261109-204353.json (полный per-file лог).
- **На production НЕ применялись** (запрет). Для публикации: боевой путь = тот же autocommit; ручной контроль при применении 0077 не требуется (REVOKE/GRANT идемпотентны); rollback для 0077 — возврат прежних GRANT (перечислены в шапке миграции); для 0076 — DROP COLUMN трёх добавленных.

## K. Внешние блокеры и действия владельца

1. **YooKassa:** получить shopId/secret (live), настроить webhook URL https://<domain>/api/payment/webhook; реальный провайдер НЕ проверен (код-верификация: IP-allowlist+re-fetch+идемпотентность — см. D/B-4). Проверить актуальность IP-диапазонов YooKassa на момент публикации.
2. **Yandex ID:** создать OAuth-приложение, YANDEX_CLIENT_ID/SECRET, YANDEX_OAUTH_REDIRECT; прогнать живой флоу.
3. **VK ID:** решение о переносе из release-candidate/gate-20 (список шагов — E) и live-проверка; до тех пор VK — честная заглушка.
4. **RECIPE_MODERATION_REQUIRED=true** в production-env (иначе авторы публикуются без модерации — by design при false). Также: NEXT_PUBLIC_APP_URL (не localhost), TRUSTED_PROXY_HOPS по реальной прокси-цепочке.
5. **Git публикация:** ротация PAT (старый скомпрометирован исторически), затем push 215+ локальных коммитов, внешние CI-проверки. Push выполняет владелец.
6. **4 защищённых upload-файла удалены в worktree** (drift #18, index=HEAD, blob'ы целы): владелец решает восстановление (git restore путей) или возврат skip-worktree; до этого /api/upload* роуты в билде отсутствуют (сборка проходит, 355 роутов).
7. **Инцидент отката среды** (раздел A): потеряны локальные коммиты RELEASE-02 (восстановлены ре-применением); рекомендация владельцу — ускорить push/backup, пока среда нестабильна.
8. Документированные остаточные риски (отдельные задачи, не гейт): идемпотентность одиночных складских движений; supplier hard-delete (каскад журнала); service_bookings без RLS; Prisma-legacy таблицы без RLS; автоматический reconciliation платежей; recipe_acceptances schema-drift; доступ к search_products у клиентов.

## L. Итоговый статус

**READY FOR OWNER REVIEW.**

Обоснование: все технические проверки, выполнимые в среде, пройдены (I, J); обнаруженные обходы безопасности закрыты и покрыты регрессионными тестами (B, C, F, G); entitlement/возвраты работают по задокументированной модели (D); миграции проверены на чистой PG18 с rerun/partial-failure (J); рабочая история подтверждена с учётом инцидента отката (A).

Статус READY FOR PUBLICATION НЕ присваивается, поскольку: VK ID — заглушка на main; YooKassa/Yandex не проверены реальными провайдерами; шесть решений владельца (H) не утверждены; RECIPE_MODERATION_REQUIRED не задан; 4 защищённых файла отсутствуют в worktree (K-6); публикация (push) — за владельцем.

После действий владельца (K-1…K-6) и утверждения H — рекомендуется финальный короткий re-gate (tsc/vitest/E2E/build + боевые провайдеры) до READY FOR PUBLICATION.
