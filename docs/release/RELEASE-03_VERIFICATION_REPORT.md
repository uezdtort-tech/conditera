# RELEASE-03 VERIFICATION REPORT — независимая проверка фактического результата

**Дата:** 2026-11-09 (UTC) · **Верификатор:** независимый агент (Z-v18 / R03V), не участвовавший в RELEASE-03
**Репозиторий:** `github.com/uezdtort-tech/conditera` · **Рабочая директория:** `/home/z/my-project`
**Исходная точка проверки:** HEAD `e0304e4` (рабочее дерево чистое) · **Конечная точка:** HEAD `a858765` (5 новых коммитов, см. §18/§21)
**Финальный статус: `READY FOR OWNER REVIEW`** (обоснование — §22)

---

## 1. Executive summary

Проверены заявления RELEASE-03 FINAL HARDENING по коду, SQL, миграциям и реальным пробам на disposable PostgreSQL 18 — не по тексту отчёта.

**Подтверждено (ключевое):**
- Git-точка: заявленный `b19295b` существует и является содержательным HEAD; поверх него один пустой env-коммит `e0304e4` (UUID-сообщение, 0 файлов). Все 9 заявленных коммитов — линейная цепочка потомков `eb4fd1a`, ни один не пуст.
- Миграция 0077 реально закрывает прямые write-path на уровне GRANT — подтверждено 10 негативными пробами под `authenticated`/`anon` (все 42501) и 8 функциональными пробами RPC (insufficient/CHECK/forbidden_item/replay/конкурентность/согласованность журнала) — **18/18 PASS**.
- Модерация: клиентский `is_published` игнорируется, включение оффера гейтится статусом корня (fail-closed), покупка требует published и оффера, и корня; самоодобрение запрещено (403); CAS на reject/approve.
- Webhook: в production fail-closed по трём линиям (IP-allowlist, строгий матчинг по `yookassa_payment_id`, обязательная re-fetch сверка; отсутствие кредов → 500). E2E payment-webhook-idempotency **24/24 воспроизведены независимо**.
- Миграции: 76 файлов (0001..0077 без 0016-как-отдельного/0056/0073) применяются на чистой PG18 — независимо повторено дважды; rerun 0075–0077 и partial-failure восстановление — 0 ошибок. (Заявление «77 миграций» относится к счётчику задания; фактическая линейка — 76 файлов на момент RELEASE-03, объяснение зафиксировано в ledger-заметке харнесса.)
- Vitest 1433/1433 (выше заявленных 1414/1418: 4 «падения из-за защищённых upload-файлов» воспроизвести не удалось — файлы восстановлены окружением 21:04, см. §17).

**Найдено и исправлено (2 технических дефекта, без продуктовых решений):**
1. **4 route-файла с не-хендлерными экспортами** — Next.js 16 route-type проверка (генерируемая) даёт TS2344; production build по webpack-пайплайну падает на type check. Turbopack-путь предыдущего агента (EXIT 0) в текущей песочнице воспроизводимо падает по OOM до TS-фазы — перепроверить нечем; дефект доказан независимо (webpack build + `tsc` c build-типами). Исправлено: хелперы вынесены в lib (`a6d468d`).
2. **Мёртвая авторская ветка RLS-политики покупок** (латентен с 0075): `recipe_purchases_buyer_or_author_read` сверяла `recipe_id` с id офферов — автор не видит продажи своих рецептов через PostgREST; виджет роялти кабинета автора пуст вдвойне (сам фильтровал по id офферов). Исправлено миграцией 0078 + виджет (`db393a4`); изоляционные пробы 19/19.

**Не подтверждено / внешние блокеры:** реальный YooKassa (только контрактная верификация), реальный Yandex ID (нужно OAuth-приложение), VK ID на main — честная заглушка 501 (реализация в ветке `release-candidate/gate-20`, не слита; нумерация миграций ветки коллидирует с main).

---

## 2. Ground Truth Git

| Проверка | Результат |
|---|---|
| `pwd` / toplevel | `/home/z/my-project` |
| Ветка | `main` |
| HEAD при старте | `e0304e41ebfeff6df7644ae03edc474e4c782b69` |
| `git status --short` / porcelain=v2 | пусто (чистое дерево) |
| Всего коммитов | 399 |
| ahead / behind origin/main | **209 / 0** (без fetch; локальный origin/main = `8a31081`) |
| `core.hooksPath` | `scripts/hooks` |
| stash / worktree | stash пуст; worktree `/home/z/gate20` (gate-20) — **prunable** (каталог удалён), ветка `release-candidate/gate-20` жива (`9ca33d7`) |
| Защищённые upload-файлы | существуют на диске, флаги `H` (не skip-worktree), blob'ы в HEAD, статус чистый (см. §17) |

**Расхождение с отчётом:** b19295b «поправка — фактический ahead 206 в K-5»: измерено `206`@00f0c9c, `207`@cb88bbb, `208`@b19295b, `209`@e0304e4 — поправка отражала счётчик до собственного коммита; финальный ahead — 209. Существенно: **push не выполнялся**, origin/main не двигался.

## 3. Точная цепочка коммитов RELEASE-03

```
eb4fd1a (RELEASE-02-era evidence docs)
 → 85394d8 fix(oauth): анти-мерж fail-closed + timing-safe state + честный VK   [3 файла]
 → 43d8149 fix(inventory): quantity только через журнал движений               [4 файла]
 → 191b1f2 fix(recipe): закрытие обхода модерации + аудит + 0076               [6 файлов]
 → 02e70fb fix(pay): webhook fail-closed в production                          [2 файла]
 → eda05e9 fix(db): 0077 закрытие прямых write-path                            [1 файл]
 → 0722dad chore(release): prodpath харнесс + прогон на чистой PG18            [2 файла]
 → 00f0c9c docs(security): SECURITY-RECIPE-01 пропозал + worklog               [2 файла]
 → cb88bbb docs(release): RELEASE-03 final hardening report                    [4 файла]
 → b19295b docs(release): поправка ahead 206 в K-5                             [1 файл]
 → e0304e4 (пустой env-коммит, UUID-сообщение, diff = ∅)                        ← фактический HEAD на старте R03V
```

Каждый из 9 коммитов проверен: полный SHA, parent, author (`Z User`), дата (2026-11-09 20:02–21:04 UTC), message, список файлов (`git show --name-status`), не пуст, входит в текущую ветку, изменения присутствуют в HEAD. Последовательность линейна и подтверждена reflog (без reset/amend следов в диапазоне).

## 4. Сравнение «заявлено ↔ фактически» (RELEASE-03)

| Заявление | Факт | Вердикт |
|---|---|---|
| HEAD `b19295b` | верно; поверх пустой env-коммит | PASS (с примечанием) |
| 9 коммитов поверх `eb4fd1a` | ровно 9, линейно, непустые | PASS |
| `b19295b` включает `cb88bbb` | да (прямой parent) | PASS |
| Отчёт = коммит `cb88bbb`, точка `b19295b` | да; `b19295b` менял только строку K-5 отчёта (`git show b19295b --stat`) | PASS |
| 0077 закрывает прямой write-path | доказано пробами (§6) | PASS |
| Склад через журнал движений | доказано кодом + пробами (§6–7) | PASS |
| Модерация защищена серверно | доказано кодом + тестами (§10) | PASS |
| Webhook fail-closed | доказано кодом + HTTP-тестами + E2E (§13) | PASS |
| OAuth hardening | код соответствует; реальный провайдер не проверялся | NOT VERIFIED (внешний) |
| 76 миграций на PG18 | независимо воспроизведено 2× | PASS |
| TypeScript 0 / ESLint 0 | `tsc --noEmit` exit 0; `eslint .` exit 0 (повторено после фиксов) | PASS |
| Vitest 1414/1418, 4 падения upload | сейчас 1433/1433, 0 падений; 4 «падения» невоспроизводимы — файлы восстановлены 21:04 | PARTIAL (см. §16) |
| payment-webhook-idempotency 24/24 | независимо: 24/24 | PASS |
| build EXIT 0, 355 маршрутов | в текущей песочнице turbopack OOM до TS-фазы; webpack-пайплайн нашёл 4 route-type ошибки → **исправлено** → EXIT 0, 356 маршрутов | FAIL → FIXED |
| Отчёт в `docs/release/RELEASE-03_FINAL_HARDENING_REPORT.md` | существует, не менялся после b19295b | PASS |

## 5. Проверка миграции 0077 (файл: `supabase/migrations/0077_release_security_closures.sql`, commit `eda05e9`)

Затронутые объекты (все подтверждены в применённой БД):
- Таблицы: `inventory_items` (REVOKE I/U/D anon+authenticated, SELECT сохранён), `stock_movements` (аналогично), `recipe_purchases` (REVOKE I/U/D), `recipes` (полный REVOKE записи), `recipe_marketplace` (полный REVOKE записи).
- Функции (REVOKE ALL у PUBLIC/anon/authenticated + GRANT service_role под гвардом `pg_roles`): `apply_inventory_movement_atomic(uuid,text,numeric,uuid,text,uuid)`, `add_bonus_balance(text,integer)`, `deduct_balance(text,integer)`→`deduct_bonus_balance(text,integer)`, `revenue_today()`, `revenue_month()`, `sum_succeeded_payments(timestamptz,timestamptz)`, `auto_assign_confectioner(uuid,text)`.
- CHECK `inventory_items_quantity_nonnegative` (quantity IS NULL OR ≥ 0) с DO-гвардом и проверкой данных.
- Сознательно не тронуто: `search_products` (клиентский UI-поиск), политики USING(true) (Q-7), миграция 0073 (резерв).

Rerun/partial: подтверждены харнессом (34 statement, rerun 0 ошибок; head 2 statement отдельно → весь файл → успех).

## 6. Inventory write-path (полная инвентаризация)

Все пути изменения количества (grep по src/**, RPC-реестр, prisma, raw SQL):

| Write-path | Изменяет остаток | Проверка владельца | Запись движения | Защита от повторов | Результат |
|---|---|---|---|---|---|
| POST /api/inventory/movements → `applyInventoryMovement` → RPC 0048 | да (RPC) | `canManageInventoryItem` (owner/admin) | да, в RPC, атомарно | n/a (одиночное) | OK |
| POST /api/inventory/write-off → RPC 0071 | да (RPC) | в RPC (`forbidden_item`) + owner из БД | да, per-item | реестр (owner,order,signature)/batch/idem-key | OK |
| POST /api/inventory/items | INSERT quantity=0 + `setQuantityViaMovement` | да | ADJUST/OUT движение | n/a | OK |
| PATCH /api/inventory/items | whitelist БЕЗ quantity + `setQuantityViaMovement` | да | да | n/a | OK |
| POST /api/supplier/products | INSERT quantity=0 + `setQuantityViaMovement` | owner = поставщик | да | n/a | OK |
| PATCH /api/supplier/products | whitelist БЕЗ quantity + `setQuantityViaMovement` | да | да | n/a | OK |
| production/batches, production.ts, checkout, orders/accept | только чтение `inventory_items` (нормы/проверки) | — | — | — | OK (не пишут) |
| cleanup.ts, backup.ts | только count/read | — | — | — | OK |
| PostgREST прямой (anon/authenticated) | **запрещён GRANT (42501)** | RLS вторая линия | — | — | OK |
| Второй неучтённый путь | не найден (RPC-реестр полный: единственные складские RPC — 0048/0071; prisma-записей нет) | | | | OK |

Fail-closed: оба RPC при отсутствии (PGRST202) НЕ заменяются небезопасным read-check-write (inventory.ts:149-159; write-off/route.ts:597+).

## 7. Матрица привилегий (реальные пробы, disposable PG18)

Источник: `docs/evidence/release-gate/r03v-privilege-matrix-2026-11-09T22-09-43.json` (18/18 PASS). Роли: `anon`, `authenticated`, `service_role` (созданы compat-слоем; `service_role NOLOGIN NOINHERIT BYPASSRLS`). Владельцы всех складских/рецептных таблиц и обеих RPC — `postgres` (отдельной роли «owner» в БД нет; владение приложением реализовано колонками `owner_id`/`author_id`).

| Операция | anon | authenticated | service_role |
|---|---|---|---|
| SELECT inventory_items / movements / stock_movements / recipe_purchases / recipes / recipe_marketplace | GRANT (RLS фильтрует) | GRANT (RLS фильтрует) | GRANT+BYPASSRLS |
| UPDATE/DELETE любого из них; INSERT во все | **нет гранта → 42501** | **нет гранта → 42501** | да |
| EXECUTE apply_inventory_movement_atomic / apply_inventory_write_off_batch | 42501 | 42501 | GRANT |
| INSERT payments / fraud_log / fraud_alerts / abandoned_cart_logs / uploads / audit_log | 42501 | 42501 | да |

Функциональные пробы (от service_role, эмуляция сервера): insufficient-guard без изменения остатка; IN атомарен (остаток+движение); прямой отрицательный UPDATE → CHECK 23514; чужая позиция в batch-RPC → forbidden_item; повтор с тем же idempotency_key → replay (двойного списания нет); конкурентный двойной OUT(6)@8 → ровно 1 успех, итог 2; quantity == реплей журнала; OUT точного остатка → 0, OUT(0+1) → insufficient.

## 8. RPC и SECURITY DEFINER

- `apply_inventory_movement_atomic` (0048): SECURITY INVOKER, строки блокируются FOR UPDATE, OUT-guard, атомарность; вызывается только сервером (inventory.ts:129).
- `apply_inventory_write_off_batch` (0071): INVOKER + `SET search_path = public`; signature вычисляет СЕРВЕР (sha256 отсортированных item:qty), owner из БД, не из запроса; RAISE откатывает всё.
- Полный реестр **43 SECURITY DEFINER** функций — в `r03v-rls-registry-*.json` (с признаком наличия `SET search_path`). Группа без search_path (increment/decrement-счётчики, bonus-balance legacy, revenue_*) — унаследована из ранних миграций; потенциальный риск hijack-вставки минимален, т.к. владельцы = postgres и вызовы серверные; **рекомендация вне рамок дефектов** (не менялось).
- RPC-финансы (add/deduct_bonus_balance, revenue_*, sum_succeeded_payments, auto_assign_confectioner): EXECUTE только service_role (0077; подтверждено has_function_privilege).

## 9. Рецепты, версии, entitlement, возвраты

- Покупка (`purchase/route.ts`): серверная цена с оффера; root-status published обязателен (fail-closed при ошибке чтения корня — 409-логика; **примечание:** в GET marketplace/[id] при transient-ошибке чтения корня контент отдаётся без гейта — fail-open на исключительном пути, оценено LOW, не менялось т.к. FK RESTRICT делает «корень без оффера» невозможным, а ошибка чтения — временной); самопокупка 422; повтор при активном entitlement идемпотентен; dev-stub НЕ выдаёт entitlement.
- Entitlement: только webhook после CAS-победы; UNIQUE(recipe_id,buyer_id) (0072) — повторный webhook не создаёт дубль; реактивация при повторной покупке; payment_id FK (0072).
- Возвраты: RPC `apply_yookassa_refund` (0039) идемпотентен по provider refund id; re-fetch верификация refund (status/payment_id/сумма в копейках); entitlement отзывается ТОЛЬКО при `fully_refunded` (Q-3.1 default); история покупок сохраняется (is_active=false).
- Единицы денег: orders/payments.amount — **рубли** (канон 0034, целые); refund-провайдер — **копейки** (конверсия `wireAmountToKop`, сравнение в копейках в 0039); recipe_purchases.price_paid — NUMERIC(10,2) рубли. Неоднозначность документирована (0034/0039 шапки), молча не «чинилась».
- Клиент не может назначить payment_id/создать entitlement: purchase route игнорирует тело; INSERT в recipe_purchases без гранта (42501).
- Q-3.2 (версии): фактическая модель — «entitlement на корень» (см. RELEASE-03_OWNER_DECISIONS.md Q-3.2); колонка recipe_version_id информационная. Решение — за владельцем.

## 10. Модерация

- Полный lifecycle: draft → (MODERATION_REQUIRED=true: pending_review → moderator approve/reject) / (по умолчанию «Завис-2»: draft → published через publish-core). RECIPE_MODERATION_REQUIRED: отсутствует/`false` → прямая публикация; `true` → pending_review БЕЗ создания версии; версию создаёт approve.
- Обходные пути закрыты: marketplace POST игнорирует клиентский is_published (offer всегда false); PATCH оффера с is_published=true требует root.status='published' (409 иначе, fail-closed при ошибке чтения корня); покупка требует И оффер, И корень published; PATCH recipes/[id] не принимает status в whitelist (кроме archived→draft); DB: 0077 отнял клиентскую запись в recipes/recipe_marketplace (42501).
- Самоодобрение: author_id === moderator.id → 403 (approve и reject).
- CAS: reject — UPDATE …WHERE status='pending_review' (0 строк → 409); approve — через publish-core (идемпотентность по updated_at/version_no, 23505-ретраи). Повторный запрос на решённом рецепте → 409 «не в очереди».
- Аудит: audit_log (0018) + moderated_by/at/reason (0076).
- Регрессия: moderation-bypass.test.ts (4 контракта) — в составе 1433.

## 11. Полный RLS-реестр

Источник: `docs/evidence/release-gate/r03v-rls-registry-2026-11-09T21-31-53.json` — выгрузка pg_policies/pg_class/GRANT из чистой PG18 после всех миграций.
- 367 политик; 244 таблицы, RLS включён на 156; 43 SECURITY DEFINER.
- `USING(true)` — 25 (10 операционных 0053/0054 → Q-7/SECURITY-RECIPE-01; 15 публичных каталог-SELECT). `WITH CHECK(true)` — 4 (fraud_log, fraud_alerts, abandoned_cart_logs — INSERT-«системные» для public; financial_ledger — только service_role). Все 4 нейтрализованы GRANT-уровнем (проба: INSERT fraud_log под authenticated → 42501).
- Расхождение «7 vs 10»: точное число операционных политик USING(true) — **10** (5 в 0053 + 5 в 0054); «7» — устаревший подсчёт. Подтверждено и grep'ом миграций, и выгрузкой pg_policies.
- Изоляционные пробы (19/19, `r03v-rls-isolation-*.json`): A читает только свои покупки; B видит только покупки своих рецептов (после 0078); чужие UPDATE/INSERT — 42501; самоповышение user_roles — 42501; stranger C не видит заказы/платежи/покупки A; только published-рецепты; INSERT заказа с чужим user_id — 42501; payments/audit_log/fraud_log — 42501; recipe_versions — server-only.
- Латентный fail-open GET marketplace/[id] при transient-ошибке чтения корня — LOW, зафиксирован (§9), не менялся.

## 12. OAuth

**Yandex ID / Google (реальный флоу, main):**
- initiation: state = 32B random → httpOnly cookie (10 мин, path=/api/auth/oauth, sameSite=lax, Secure в prod); `mode=check` для UI.
- callback: state сверяется timing-safe (`secure-compare.ts`), cookie гасится при ЛЮБОМ исходе (one-time); обмен code→token (Yandex token endpoint, secret опционален для public-клиента), профиль через login.yandex.ru/info; синтетический email запрещён (fail-closed); анти-мерж: парольный аккаунт/другой провайдер → `account_merge_forbidden` (без сброса пароля); повторный callback с тем же state → отказ (cookie погашен); ошибки провайдера → redirect /oauth/finish?error=…; безопасный return URL (фиксированный /oauth/finish, NEXT_PUBLIC_APP_URL); сессия — одноразовый handoff-cookie (60 c, httpOnly).
- Nonce/PKCE: не применяются (Yandex confidential-flow; допустимо), state достаточен для CSRF.
- Не проверялось (внешний блокер): реальный Yandex-клиент, redirect URI в кабинете, реальный обмен.

**VK ID:** на main — честная заглушка: initiation всегда «не настроен» (независимо от VK_CLIENT_ID → 501), callback — JSON-заглушка. Полная реализация — в `release-candidate/gate-20` (a7e169a…9ca33d7: PKCE S256, id.vk.com authorize/token/user_info, device_id, 83 OAuth-теста, 2FA-паритет, rate-limit, provider-subject 0067, анти-open-redirect). **Слияние — не точечный перенос:** ветка разошлась на 83 коммита и отстаёт от main на 209; миграции ветки 0062–0067 коллидируют по номерам с main (0062_cart_sync… 0067_recipe_ingredients…); UI/роуты OAuth на ветке перезаписывают main'овские (85394d8). Требуется ре-интеграция с ревью и перенумерацией — отдельная задача владельца.

## 13. YooKassa и webhook

- verifyWebhook: production — IP-allowlist (официальные диапазоны IPv4+IPv6, корректный CIDR), X-Real-IP/хвост XFF с TRUSTED_PROXY_HOPS; нет IP → reject; dev — allow-all (документировано).
- Matching: строго по `yookassa_payment_id = object.id` (refund.* — по object.payment_id); legacy-фолбэк metadata.orderId только в dev.
- Fail-closed production: нет кредов → 500 (повторная доставка); getPaymentStatus неуспех → 500; сумма из webhook сверяется с re-fetched провайдером (копейки) и с payments.amount (amount_mismatch → фрод-лог, без зачисления); canceled → enum-safe; refund.succeeded — RPC 0039 + re-fetch (status/payment_id/сумма).
- Идемпотентность: CAS orders→escrow (side-effects только у победителя); платежи upsert по yookassa_payment_id; ledger-записи с idempotency_key.
- Тесты: route.test.ts 15, route.http.test.ts 8, E2E 24/24 (независимо воспроизведено).
- Не проверялся реальный провайдер (внешний блокер — §20).

## 14. Миграции и PostgreSQL 18

- 77 файлов на диске после R03V (0001..0078; отсутствуют 0016-как-отдельный — существует 0016b, 0056, 0073-резерв). Ledger == диск == линейка (харнесс).
- Независимые прогоны: (a) pre-fix повтор харнесса предыдущего агента — SUCCESS; (b) post-0078 прогон с R03V-секцией — SUCCESS; (c) мой расширенный probe-скрипт — 3 чистых применения. Rerun 0075/0076/0077/0078 — 0 ошибок; partial (2 statement) + полный файл — восстановление ок; GRANT-assertions 15; прямые пробы 42501 ×2.
- Prodpath harness применяет statement-by-statement (dollar-quote-aware сплиттер, как боевой psql) — ложноположительный результат исключён дизайном (STRICT, per-file ошибки); ложно-позитивов в rerun-логике не найдено.
- Production не затрагивался; живая dev-БД (:54329, .pgdata) не пересоздавалась.

## 15. Тесты (полная таблица)

| # | Проверка | Команда | Exit | Результат |
|---|---|---|---|---|
| 1 | TypeScript | `bunx tsc --noEmit` | 0 | 0 ошибок (до и после фиксов) |
| 2 | ESLint | `bun run lint` | 0 | 0 замечаний |
| 3 | Vitest полный | `bunx vitest run` | 0 | **94 файла, 1433/1433** (до фиксов 1433/1433; после фиксов повторно 1433/1433) |
| 4 | Inventory route/lib tests | в составе (3) | — | write-off.idempotency, inventory-quantity-via-movement — pass |
| 5 | Recipe purchase tests | в составе + E2E | — | pass |
| 6 | Recipe moderation tests | в составе | — | moderation-bypass (4) — pass |
| 7 | Payment webhook | route.test 15 + route.http 8 | 0 | pass |
| 8 | E2E payment-webhook-idempotency | `bunx playwright test …` | 0 | **24/24** |
| 9 | E2E recipe-purchase-flow | `--workers=1` | 0 | **14/14, 0 skipped** (у предыдущего прогона 8 skipped-гвардов — данные теперь есть) |
| 10 | E2E smoke | | 0 | 10/10 |
| 11 | Production build (webpack, изолированная копия) | `NODE_OPTIONS=… bun next build --webpack` | **0** | Compiled 70s + TypeScript 45s + 247 статических; **356 маршрутов** |
| 12 | Production build (turbopack, изолированная копия) | `bun next build` | 137 (OOM) | **невоспроизводим в песочнице** (4GB cgroup; compile проходит, TS-фаза убивается) — см. §16 |
| 13 | Prodpath (чистая PG18) | `node scripts/verify/prodpath-release03-verify.mjs` | 0 | SUCCESS ×3 |

Skipped: 0 (Vitest). В E2E recipe-flow skipped=0 в повторе. Причины прежних 8 skipped — by-design guard'ы спеков (нет данных), не сбои.

**Про 4 «падения из-за upload-файлов» (RELEASE-03):** на момент верификации защищённые файлы существуют, полный Vitest зелёный — воспроизвести падения невозможно; косвенное подтверждение связи с файлами: 1418→1433 (+15 тестов) после их восстановления. НЕ подтверждено напрямую.

## 16. Production build — особый случай (честная фиксация)

- Турбопак-билд (как у предыдущего агента) в текущей песочнице: compile ✓ (60–68s), затем OOM-kill на TS-фазе при heap 1100/1400/1500/1900/2000/2400 (exit 137; cgroup 4GB, next-server dev держит ~1.2GB). С dev-сервером остановленным — то же. **Вывод о функциональной ошибке не делался.**
- Webpack-пайплайн (полный): при 1500MB — heap-abort TS-воркера; при 1900MB — **реальные 4 route-type ошибки** (§18, фикс a6d468d) → после фикса EXIT 0.
- Расхождение с EXIT 0 предыдущего агента: те же 4 файла существуют без изменений с `3733db4` (2026-11-08, до RELEASE-03), нулевой diff `00f0c9c..HEAD`. Почему их turbopack-прогон не поймал ошибки — проверить нечем (их log показывает «Finished TypeScript», но turbopack-путь здесь невоспроизводим). Зафиксировано как **неподтверждённое утверждение** с работающим обходным доказательством (webpack EXIT 0 + независимый tsc с build-типами).

## 17. Защищённые upload-файлы (только метаданные)

- Пути: `src/app/api/upload/route.ts`, `route.test.ts`, `src/app/api/services/upload/route.ts`, `route.test.ts`.
- Состояние на момент проверки: **существуют на диске** (mtime 21:04 — восстановление окружением, совпадает с пустым env-коммитом e0304e4), индекс чист, git-флаги `H` (обычные; **не** skip-worktree/assume-unchanged), blob'ы присутствуют в HEAD. Прежнее состояние «4 удаления (D)» (зафиксировано в evidence RELEASE-03 r03-e2e-…txt) более не наблюдается.
- Содержимое не читалось; флаги/hooks/защитные механизмы не менялись; тесты, зависящие от них (upload route tests) — проходят.
- Владельцу: восстановление уже произошло со стороны окружения; происхождение подтверждается git-историей (blob в HEAD). Риски восстановления: отсутствие (файлы идентичны HEAD).

## 18. Найденные дефекты и исправления

**R03V-1: не-хендлерные экспорты в route-файлах (build-blocker для webpack/tsc-с-build-типами)**
- Доказательство: `.next/types/**` TS2344 ×4; webpack build «Failed to type check»; `tsc --noEmit` в изолированной копии с build-типами exit 1.
- Файлы: supplier/warehouse (validateProduct), inventory/items (extractItemUpdates + 2 приватных парсера), crm/tickets/[id]/messages (mapTicketMessage + межмаршрутный импорт), services (SERVICE_PROVIDER_ROLES).
- Исправление: `a6d468d` (вынос в `src/lib/supplier-warehouse-validation.ts`, `src/lib/inventory.ts`, `src/lib/crm/ticket-messages.ts`; de-export константы; обновлены 2 тест-импорта). Контракты не менялись.
- Проверка: tsc 0, eslint 0, vitest 1433/1433, webpack build EXIT 0 (356 маршрутов), E2E 48/48.

**R03V-2: мёртвая авторская ветка RLS-политики покупок (латентен с 0075)**
- Доказательство: изоляционная проба «B-автор видит покупки своего рецепта → 0»; SQL политики 0012:345-347 (`SELECT id FROM recipe_marketplace`) vs 0075 (recipe_id = recipes.id); клиентский виджет фильтрует по id офферов.
- Исправление: `db393a4` — миграция `0078_recipe_purchases_author_read_policy_fix.sql` (DO-гвард по нормализованному qual-признаку `recipe_marketplace.id`; recreate с `SELECT recipe_id`; rerun-safe — подтверждено харнессом) + `recipe-developer-dashboard.tsx` (фильтр по корневым recipe_id, маппинг заголовков).
- Проверка: prodpath SUCCESS (policy assert + probe «автор видит 1/1»); изоляционные пробы 19/19; vitest 1433/1433.

## 19. Неподтверждённые утверждения (сводка)

1. Production build turbopack EXIT 0 — невоспроизводим здесь (OOM); компенсировано webpack EXIT 0.
2. Vitest «1414/1418 с 4 upload-падениями» — падения невоспроизводимы (файлы восстановлены).
3. «ahead 206» — фактически 209 на e0304e4 (учёт собственного коммита поправки + env-коммита).
4. OAuth «production-ready» — не заявлялся и не подтверждён (нет реального провайдера) — корректно отражено как внешний блокер.

## 20. Остаточные риски и внешние блокеры

- **YooKassa production** (реальный кабинет/webhook-URL/IP-список) — не проверен; контрактная готовность доказана.
- **Yandex ID** — нужен реальный OAuth-клиент (client_id/secret/redirect) и smoke-проход.
- **VK ID** — заглушка на main; интеграция из gate-20 требует ре-интеграции (коллизии миграций 0062–0067, переработка OAuth-роутов с учётом 85394d8).
- **TurboPACK build OOM в песочнице** — средовая проблема (4GB cgroup), не дефект кода; для release gate рекомендован webpack-путь или окружение с ≥6GB.
- SECURITY DEFINER без `SET search_path` (13 функций) — низкий риск, рекомендация вне этой задачи.
- Latent fail-open GET marketplace/[id] — LOW, зафиксирован.
- `search_products` EXECUTE для клиента — осознанно (UI-поиск), к остаткам не обращается.

## 21. Новые коммиты (созданы в рамках R03V)

| Commit | Содержание |
|---|---|
| `a6d468d` | fix(routes): не-хендлерные экспорты → lib (10 файлов) |
| `db393a4` | fix(db): 0078 RLS-политика покупок автора + виджет роялти + harness |
| `7c4843e` | chore(release): R03V evidence (privilege/RLS/prodpath/prod-build) |
| `d26e8c8` | chore(release): R03V evidence E2E (24/24, 14/14, 10/10) |

- Исходный HEAD: `e0304e4` → конечный HEAD: `a858765`; ahead 209 → **214**; behind 0.
- Рабочее дерево чистое; push/merge/PR/deploy/reset/rebase **не выполнялись**; защищённые файлы не тронуты; история RELEASE-03 не переписывалась.

## 22. Рекомендация и финальный статус

Шесть решений владельца — в `docs/release/RELEASE-03_OWNER_DECISIONS.md` (Q-3.1, Q-3.2, Q-4, Q-6, Q-7, Q-10). Ни одно не реализовано сверх уже существующего поведения.

Проверка запрещающих условий READY FOR PUBLICATION: прямой обход склада не найден; обход модерации не найден; entitlement-модель — решение владельца (Q-3.2); OAuth — заглушки/внешние блокеры; миграции воспроизводимы; история подтверждена. → публикация требует решений владельца и внешних конфигураций.

## **ФИНАЛЬНЫЙ СТАТУС: `READY FOR OWNER REVIEW`**

Техническая работа завершена, критические проверки выполнены на реальных доказательствах (код, SQL, disposable PG18, E2E, build), остаточные риски перечислены, решения подготовлены. Не `READY FOR PUBLICATION` — по определению задания (требуются решения владельца Q-3.1/Q-3.2/Q-4/Q-6/Q-7/Q-10 и внешние конфигурации).
