# Z-v27 — TEST EVIDENCE

Дата: 2026-11-11 · HEAD `664e1e5` · все команды выполнены фактически, exit codes зафиксированы.

## A. Полный регресс (Этап 13) — сравнение с базой Z-v26

| Проверка | Команда | Результат | Exit | База Z-v26 | Дельта |
|---|---|---|---|---|---|
| TypeScript | `bun run typecheck` | 0 ошибок | 0 | 0 | = |
| ESLint | `bun run lint` | 0 ошибок | 0 | 0 | = |
| Vitest | `bun run test` | **110 файлов / 1575 тестов** | 0 | 109/1571 | +1 файл/+4 теста — `acceptance.test.ts` (регрессия Z-v27) |
| Order lifecycle | `node scripts/verify/order-lifecycle-verify.mjs` | 81 passed, 0 failed | 0 | 81/81 | = |
| Inventory concurrency | `node scripts/verify/inventory-concurrency-verify.mjs` | 8/8 | 0 | 8/8 | = |
| Checkout idempotency | `node scripts/verify/checkout-idempotency-verify.mjs` | PASS (15) | 0 | 15/15 | = |
| Diagnostics | `node scripts/verify/diagnostics-verify.mjs` | 16/16 | 0 | 16/16 | = |
| Ops center | `node scripts/verify/ops-center-verify.mjs` | PASS (37) | 0 | 37/37 | = |
| Route coverage | `node scripts/verify/route-error-coverage.mjs` | 47/48 | 0 | 47/48 | = (базлайн) |
| Cart schema | `node scripts/verify/cart-schema-verify.mjs` | PASS | 0 | PASS | = |
| p11-hardening | `node scripts/verify/p11-hardening-verify.mjs` | 12/17, exit 1 | 1 | 12/17 | = (5 FAIL — каскад F1: checkout блокируется гейтом из-за ОТСУТСТВИЯ данных владельца; задокументировано Z-v26 как ожидаемое до ввода данных) |
| Backup | `bun run ops:backup` | OK | 0 | OK | = |
| Restore | `bun run ops:restore-verify` | PASSED | 0 | PASSED | = |
| Production build | `NODE_OPTIONS=--max-old-space-size=2048 bun run build` | Compiled successfully 36.9s, BUILD_ID `C0Y-TMnEjz5Ubj4yHM5GA` | 0 | PASS (mgI0It6qj3SKs_FXTByW4) | новый BUILD_ID |

Число тестов изменилось ровно на добавленные Z-v27 регрессионные тесты (4) — иных расхождений нет.

## B. Изолированные сценарии A-P (Этап 6) — disposable PostgreSQL 18.4

БД: `conditera_zv27_gate` (создана `CREATE DATABASE` + штатный `scripts/db/setup.mjs`, 79 миграций, exit 0).
Реальный код проекта: `acceptance/breakdown/capacity/lifecycle` + RPC `apply_inventory_write_off_batch`.
Лог: `agent-ctx/zv27/gate-scenarios-after-fix.log`. Команда:
`DATABASE_URL=postgresql://postgres@127.0.0.1:54329/conditera_zv27_gate bun agent-ctx/zv27/gate-scenarios.mjs` → **PASSED: 41 FAILED: 0, exit 0**.

| ID | Сценарий | Проверок | Результат |
|---|---|---|---|
| A | Полностью готовый товар | 5 | PASS (canAccept, available, fits, estimate 360 product) |
| B | Нет рецепта | 3 | PASS (RECIPE_MISSING блокирует) |
| C | Время не задано | 2 | PASS (warning, не блокирует) |
| D | Недостаточный остаток | 3 | PASS (LOW_STOCK, дефицит −150 г точен) |
| E | ETA успевает | 2 | PASS (CAN_ACCEPT_WITH_PURCHASE) |
| F | Закупка без ETA | 2 | PASS (PURCHASE_ETA_MISSING) |
| G | Конкурентные резервы | 2 | PASS (ровно 1; OVERLAP 23P01) |
| H | Повторный резерв | 1 | PASS (ORDER_ALREADY_RESERVED) |
| I/M | Правка рецепта после заказа | 5 | PASS (разбор меняется 250→500; accept блокируется 409; откат восстанавливает) |
| J | Отмена | 4 | PASS (резерв released, запись сохранена) |
| L | Повторное списание | 5 | PASS (replay idempotent:true; ровно 1 movement) |
| N/O | Конкуренция списаний / оверселл / минус | 5 | PASS (ровно 1 из 2; insufficient; CHECK nonnegative) |
| P | Неизвестная единица | 2 | **PASS ПОСЛЕ ИСПРАВЛЕНИЯ** (до: P1 FAIL — fail-open) |

## C. HTTP через реальный API (Этап 7) — 19/19 PASSED

`node agent-ctx/zv27/http-checkout-scenarios.mjs` (BASE=http://127.0.0.1:3000, случайный x-real-ip
из-за честного rate-limit 5/min). Лог: `agent-ctx/zv27/http-checkout.log`.

| Шаг | Проверка | Результат |
|---|---|---|
| L1/L1b | регистрация zv27-http-* → токен/userId | ✔ |
| L2 | GET /api/products → 200 | ✔ |
| L3 | POST /api/cart товар №1 → inserted | ✔ |
| L4/L4b | товарный checkout → **422**, codes=`MISSING_PRODUCT_DATA\|PURCHASE_ETA_MISSING\|LOW_STOCK` | ✔ |
| L5-L5d | заказ не создан; корзина сохранена; movements 12→12; reservations 0 | ✔ |
| L6/L6b | custom checkout → 200, UK-2026-800508, stub isStub=true, total 4440 | ✔ |
| L7/L7b | тот же Idempotency-Key → тот же orderId; в БД 1 заказ | ✔ |
| L8-L8c | snapshot серверной цены; totals; selected_attributes | ✔ |
| L9/L9b | cleanup: заказы/payments/ledger/cart/sessions/profiles удалены | ✔ |

## D. Дефект P: доказательство «старое падает — новое проходит»

- До исправления: сценарий P1 → `canAccept=true` при единице склада «ложка» (fail-open),
  лог `agent-ctx/zv27/gate-scenarios.log`: `PASSED: 40 FAILED: 1`.
- После исправления: `PASSED: 41 FAILED: 0` (`agent-ctx/zv27/gate-scenarios-after-fix.log`).
- Vitest-регрессия `src/lib/ops/acceptance.test.ts`: 4 теста (unit_mismatch ×2 блокируют;
  совместимые остатки не блокируются; LOW_STOCK сохраняется) — до исправления падали бы
  2 из 4 (новый код INVENTORY_UNIT_MISMATCH отсутствовал), после — 13/13 в связке с breakdown.test.ts.

## E. Production build

- Память до: available 707 MB (dev 1.85 GB) → остановка dev по паттерну Z-v26
  (stop-file `/home/z/.diag/dev-keeper.stop`, keeper disarmed, kill dev) → available 2704 MB.
- `NODE_OPTIONS=--max-old-space-size=2048 bun run build` → exit 0, 36.9s, BUILD_ID `C0Y-TMnEjz5Ubj4yHM5GA`.
- Восстановление: stop-file удалён, dev перезапущен (3000 → 200), n8n-receiver перезапущен,
  dev-keeper re-armed, health-свитч чист.
- Пост-скриптум (честно): после завершения сборки сессия агента столкнулась с поведением
  песочницы — процессы, заспавненные из tool-сессии, снимаются на границе вызовов инструментов
  (проверено 4 способами: setsid/nohup/plain/&/cron-агент). Из-за этого dev и receiver
  с "сессийным" запуском гасли; финальное восстановление выполнено через boot-scoped
  hot-сессию n8n-receiver (PPID→1) и его штатный dev-keeper: dev (next-server) снова
  является ребёнком keeper-цепи, как и до работ. Проверено: 3000→200, 5678→ok, 3030→ok,
  персистентность подтверждена между вызовами. Остаточное: один лишний bun --hot watcher
  (PPID 1, не держит порт, безвреден).

## F. Браузерный smoke (Этап 12)

Страницы: главная, каталог, карточка (`/product?id=svadebnyy-tort-yagodnyy-barhat`), корзина,
`/login` (вкладки+OAuth-кнопки), checkout («Оформление заказа»), мобильная 390×844 (скриншот
`agent-ctx/zv27/ui-home-mobile.png`). Console errors: **0** (единственное сообщение —
не-ошибочное предупреждение Next.js о scroll-behavior). Серверных ошибок нет.

## G. Интеграционные пробы (Этап 10)

- `GET /api/auth/oauth/yandex` → **501** (fail-closed, live).
- Yandex/VK/YooKassa/SMTP/Telegram credentials — **ABSENT** (проверка наличия имён в .env.local).
- n8n receiver `:5678/healthz` → `{status:"ok", service:"n8n-receiver"}` (workflow-engine отсутствует).
- Chat `:3030/health` → `{status:"ok", uptime>7500s}`.

## H. Миграции на чистой PostgreSQL 18.4 (Этапы 6/11)

`conditera_zv27_gate`: setup.mjs exit 0, 79 миграций, леджер без дубликатов (79 файлов).
Основная БД: леджер 79 файлов, 0 дубликатов ID, tail `0080_cart_remove_zombie_check.sql`.
