# Z-v26 — CHECKOUT EVIDENCE

Дата: 2026-11-11 · HEAD `b69ff88` · скрипты и полные логи: `agent-ctx/zv26/`

## A. Изолированные acceptance-gate тесты — `gate-scenarios.mjs` — 28/28 PASSED

Среда: disposable PostgreSQL 18.4, БД `conditera_zv26_gate` (создана штатным `DATABASE_URL=… node scripts/db/setup.mjs`, exit 0, 79 миграций + сиды). Использован РЕАЛЬНЫЙ код проекта (`@/lib/ops/acceptance`, `breakdown`, `capacity`, `lifecycle`) через bun. Все фикстуры синтетические (маркер zv26).

| Сценарий | Проверки | Результат |
|---|---|---|
| A — корректный товар | canAccept, availability=available, 0 кодов, capacity fits, estimate 360 мин (product) | 5/5 ✔ |
| B — без рецепта | canAccept=false, RECIPE_MISSING, unavailable | 3/3 ✔ |
| C — время не задано | MISSING_PRODUCT_DATA присутствует; warning (available_with_warning); estimateSource=category (240, approximate); с hours кода нет | 4/4 ✔ |
| D — дефицит | LOW_STOCK + PURCHASE_ETA_MISSING блокируют; Ягоды −150 г точен | 3/3 ✔ |
| E — закупка с ETA | CAN_ACCEPT_WITH_PURCHASE (warning), canAccept=true | 2/2 ✔ |
| F — ETA неизвестна | PURCHASE_ETA_MISSING блокирует (не превращается в доступность) | 2/2 ✔ |
| G — конкурентные резервы | ровно 1 резерв; второй → OVERLAP (23P01, EXCLUDE 0054) | 2/2 ✔ |
| H — повторный резерв заказа | ORDER_ALREADY_RESERVED (uq_capacity_reservations_order_active) | 1/1 ✔ |
| I — правка рецепта | разбор исторического заказа меняется 250→500 г (версии не снапшотятся — модельное наблюдение) | 2/2 ✔ |
| J — отмена | PENDING→CANCELLED; резерв → released; запись сохранена | 4/4 ✔ |

Команда: `DATABASE_URL='postgresql://postgres@127.0.0.1:54329/conditera_zv26_gate' bun agent-ctx/zv26/gate-scenarios.mjs` → `PASSED: 28 FAILED: 0`, exit 0.

## B. HTTP через реальный API главного dev-сервера — `http-checkout-scenarios.mjs` — 19/19 PASSED

Команда: `node agent-ctx/zv26/http-checkout-scenarios.mjs` (BASE=http://127.0.0.1:3000; рандомный x-real-ip на прогон из-за честного rate-limit checkout 5/min — сам лимитер подтверждён: первый прогон без рандомизации получил 429).

| Шаг | Проверка | Результат |
|---|---|---|
| L1 | регистрация zv26-http-* → accessToken (+userId) | ✔ |
| L2 | GET /api/products → 200 | ✔ |
| L3 | POST /api/cart товар `…-0001` → inserted | ✔ |
| L4 | POST /api/checkout (товар, Idempotency-Key) → **422** | ✔ |
| L4b | reasons = `MISSING_PRODUCT_DATA\|PURCHASE_ETA_MISSING\|LOW_STOCK` | ✔ |
| L5 | заказ НЕ создан (0 строк) | ✔ |
| L5b | корзина НЕ очищена (1 позиция) | ✔ |
| L5c | inventory_movements = 12 (без изменений) | ✔ |
| L5d | capacity_reservations = 0 | ✔ |
| L6 | POST /api/checkout custom (конструктор) → **200**, заказ **UK-2026-449305**, total 4440 | ✔ |
| L6b | isStub=true (YooKassa не настроена — честный stub) | ✔ |
| L7 | повтор с тем же Idempotency-Key → **тот же orderId** `48819462-092c-4d08-b5b2-2d1dd97d2a8d` | ✔ |
| L7b | в БД ровно 1 заказ | ✔ |
| L8 | order_items: 1 позиция ×2, snapshot server-цены | ✔ |
| L8b | orders.total == Σ order_items.total (4440) | ✔ |
| L8c | selected_attributes сохранены | ✔ |
| L9/L9b | cleanup: заказы/ledger/payments/cart/sessions/profiles удалены (вкл. остатки прерванного прогона) | ✔ |

Примечание: HTTP против изолированной БД — NOT RUN (environment: второй dev-сервер невозможен при доступной памяти; OOM подтверждён двумя попытками). Компенсация: изолированные проверки реальным кодом (A) + HTTP на рабочей БД (B).

## C. Профильный регресс (команды и exit codes)

| Команда | Результат | Exit |
|---|---|---|
| `bun run typecheck` | 0 ошибок | 0 |
| `bun run lint` | 0 ошибок | 0 |
| `bun run test` | 109 файлов / 1571 тестов passed | 0 |
| `node scripts/verify/order-lifecycle-verify.mjs` | 81 passed, 0 failed | 0 |
| `node scripts/verify/inventory-concurrency-verify.mjs` | 8/8 (атомарность списания) | 0 |
| `node scripts/verify/checkout-idempotency-verify.mjs` | PASS 15 / FAIL 0 | 0 |
| `node scripts/verify/diagnostics-verify.mjs` | 16/16 | 0 |
| `node scripts/verify/ops-center-verify.mjs` | PASS 37 / FAIL 0 | 0 |
| `node scripts/verify/route-error-coverage.mjs` | 47/48 (базлайн) | 0 |
| `node scripts/verify/cart-schema-verify.mjs` | PASS | 0 |
| `bun run ops:backup` / `bun run ops:restore-verify` | OK / PASSED | 0 / 0 |

## D. Production build

- `NODE_OPTIONS=--max-old-space-size=2048 bun run build` → exit 0, «Compiled successfully in 33.6s», BUILD_ID `mgI0It6qj3SKs_FXTByW4`.
- Две попытки при работающем dev-сервере → SIGKILL/OOM (exit 137) — задокументировано; успешная сборка при 3.1 GiB available (dev-сервер временно остановлен, затем восстановлен супервизором).

## E. Runner-исправления (F2/F4) — доказательства

- F2 (legacy apply-migrations.ts): ломающая миграция `SELECT * FROM public.nonexistent_zv26` → `❌ Migration FAILED: 40 statement(s) failed in 2 file(s)` → **exit 1** (было exit 0 + «successfully»); тривиальные миграции → «✅ All migrations applied successfully!» → **exit 0**. Логи: `agent-ctx/zv26/f2-test.log`, `f2-success2.log`.
- F4 (setup.mjs advisory lock): без lock — параллельный прогон дал spurious-падение A (`pg_namespace_nspname_index`, exit 1; лог `flock-A.log`); с lock — A exit 0 (79 миграций), B ждал и завершился exit 0 (`flock2/flock3`); однократный транзиентный обрыв TCP у B в первом прогоне зафиксирован честно, на повторе не воспроизвёлся.

## F. Состояние БД до/после HTTP-сценариев

- inventory_movements: 12 → 12 (без изменений; ни один сценарий не списал склад);
- capacity_reservations: 0 → 0;
- published-товары: 12 → 12 (статусы/цены не менялись);
- синтетические артефакты: удалены полностью (zv26-http-* отсутствуют);
- disposable-БД: `conditera_zv26_gate` оставлена как доказательство (только чтение), `flock`/`f2test` — удалены.
