# Z-v27 — FIRST PRODUCT ACCEPTANCE REPORT

Дата: 2026-11-11 · Режим: LOCAL ONLY · Публикация запрещена
HEAD на начало: `664e1e5` · HEAD на завершение: `664e1e5` (+ незакоммиченные изменения, см. §8)
Предыдущий этап: Z-v26 (PARTIAL — OWNER INPUT REQUIRED)

---

## 1. Ground Truth (фактическое состояние на старте)

| Проверка | Результат | Расхождение с Z-v26 |
|---|---|---|
| Путь / ветка | `/home/z/my-project`, `main` | нет |
| HEAD | `664e1e5` (совпадает с заданием) | нет |
| Git status | clean (0 записей), stash пуст, незавершённых операций нет | нет |
| Ahead/behind | 239 / 0 (локальные refs, без сети) | нет (239 = 238 + коммит Z-v26) |
| Protected 4 upload-файла | присутствуют, флаги `H`, drift нет | нет |
| Guard / hooksPath | `scripts/hooks/pre-commit`, `core.hooksPath=scripts/hooks` | нет |
| Snapshotter | процессов нет | нет |
| PostgreSQL | embedded 18.4, порт 54329, БД `conditera` | нет |
| Dev server / Chat / n8n / Gateway | 200 / ok (uptime 7500s) / 200 / 200 | нет |
| Z-v26 документы (5 шт.) | существуют; сверены с кодом и БД — совпадают | нет |

Фактические данные БД (read-only) — идентичны зафиксированным в Z-v26:
12 published-товаров; `recipe_id` только у №1 («Красный бархат (демо)»);
«Ягоды» на складе НЕТ; черновик закупки `eaf5ae25…` `status=draft`, `expected_eta=NULL`.

## 2. Проверка изменений Z-v26 (Этап 2) — независимо подтверждены

| Изменение | Проверка | Вердикт |
|---|---|---|
| F2: `scripts/apply-migrations.ts` честный exit 1 | чтение кода: per-file учёт, `❌ Migration FAILED … exit 1`, success только при totalFailed=0 | ПОДТВЕРЖДЕНО |
| F4: advisory lock в `setup.mjs` | `pg_advisory_lock(hashtext('conditera_migrations'))`, release в `finally`, дубликат-гейт ДО SQL (exit 1) | ПОДТВЕРЖДЕНО |
| CI runner | `supabase/init-scripts/01-apply-migrations.sh`: per-file транзакции, `ON_ERROR_STOP=1` | ПОДТВЕРЖДЕНО |
| Acceptance-gate (`src/lib/ops/acceptance.ts`) | BLOCKING_CODES = CAPACITY_EXCEEDED, PURCHASE_ETA_AFTER_DEADLINE, PURCHASE_ETA_MISSING, DEADLINE_TOO_CLOSE, LOW_STOCK, RECIPE_MISSING; MISSING_PRODUCT_DATA — warning | ПОДТВЕРЖДЕНО |
| Checkout-гейт | `src/app/api/checkout/route.ts:427-448`: 422 при `!canAccept`; accept-путь (`/api/orders/[id]/accept`) дополнительно блокирует по `canProduce` | ПОДТВЕРЖДЕНО |
| Collation-работа | `earliestPurchaseEta`: сравнение и original-имен, и JS-lowercase (C-коллация PG учтена) | ПОДТВЕРЖДЕНО |

## 3. Первый товар «Свадебный торт «Ягодный бархат»» (Этапы 3-4)

- Рецепт: «Красный бархат (демо)» (`45ff30b0…`), prep/cook = NULL (warning MISSING_PRODUCT_DATA).
- Потребность на 1 торт (реальный `computeIngredientNeeds`): Мука 450 г ✓ (склад 25 кг),
  Сливки 600 мл ✓ (7 л), Шоколад 300 г ✓ (5.5 кг), Яйца 8 шт ✓ (15 дес = 150 шт, конверсия «дес» работает),
  **Ягоды 250 г → `no_stock` (нет позиции на складе, `inventory_item_id=NULL`)**.
- Агрегация: 2 торта → Ягоды 500 г (корректно).
- Гейт: `canAccept=false`; причины `MISSING_PRODUCT_DATA` (warning) + `PURCHASE_ETA_MISSING` + `LOW_STOCK` (−250 г);
  мощность: fits=true (глобальные дефолты 9:00-18:00).
- Закупка: черновик `eaf5ae25…` (draft, ETA NULL, «Ягоды»×3 + «Шоколад белый»).

**`FIRST_PRODUCT_ACCEPTANCE = BLOCKED_OWNER_DATA`** — владелец с Z-v26 данных не предоставил
(ни остатка «Ягоды», ни ETA). Система данные не придумывает; обход гейта запрещён.

## 4. Версионирование рецептов (Этап 5) — риск ПОВЫШЕН до P2

Изолированно доказано (сценарии I/M на disposable PG 18.4):
1. Разбор исторического заказа меняется вслед за правкой рецепта (250→500 г) — версии не снапшотятся.
2. **НОВОЕ (Z-v27): правка рецепта после оплаты БЛОКИРУЕТ accept уже созданного заказа**
   (`/api/orders/[id]/accept` → 409 ORDER_NOT_FEASIBLE по `canProduce=false`) —
   оплаченный заказ становится неприемлемым; откат рецепта восстанавливает приемлемость.
3. Прямое списание НЕ зависит от рецепта (ручной путь — количества вводит кондитер; партийный путь —
   использует версии `recipe_production_card_versions`). Повреждения склада/истории списаний нет.

Классификация: **P2** (целостность бизнес-процесса, не данных). Модель решения, миграции и план
тестов — `Z-V27_RECIPE_VERSIONING_RISK.md`. Крупная миграция БЕЗ владельца не внедрялась.

## 5. Изолированные тесты (Этап 6) — disposable PG 18.4, БД `conditera_zv27_gate`

Сценарии A-P реальным кодом проекта (`agent-ctx/zv27/gate-scenarios.mjs`): **41/41 PASSED**
(после исправления дефекта P; до исправления 40/41 — см. §6). Полная матрица — `Z-V27_TEST_EVIDENCE.md`.

## 6. Найденный и исправленный дефект (Этап 14)

**P1→FIXED: checkout-гейт пропускал неизвестную единицу склада (fail-open, сценарий P).**
- Воспроизведение: склад «Ягоды» с единицей «ложка» → breakdown даёт `unit_mismatch`
  (не входит в shortages) → checkout `canAccept=true` → заказ создаётся и оплачивается →
  accept отклоняет (409, `canProduce=false`) → оплаченный заказ зависает.
- Исправление (минимальное, в слое гейта; контракт breakdown не менялся):
  `src/lib/ops/acceptance.ts` — новый блокирующий код `INVENTORY_UNIT_MISMATCH` в BLOCKING_CODES.
- Регрессия: `src/lib/ops/acceptance.test.ts` (4 теста: fail-closed ×2, отсутствие ложных блокировок,
  сохранение LOW_STOCK); изолированный сценарий P → PASS; vitest 110 файлов/1575 тестов → PASS.
- До исправления эти тесты падали (поведение fail-open), после — проходят.

## 7. HTTP-checkout первого товара (Этап 7) — 19/19 PASSED

`agent-ctx/zv27/http-checkout-scenarios.mjs` (главный dev-сервер): регистрация zv27-http-* →
товар в корзину → **товарный checkout 422** с точными кодами
(`MISSING_PRODUCT_DATA|PURCHASE_ETA_MISSING|LOW_STOCK`) → заказ НЕ создан, корзина сохранена,
`inventory_movements` 12→12, `capacity_reservations` 0 → custom-checkout 200 (stub isStub=true,
total 4440 = серверная цена ×2) → идемпотентность (тот же Idempotency-Key → тот же orderId,
в БД 1 заказ) → snapshot серверных цен → полный cleanup. Ограничение среды: HTTP против
disposable-БД НЕВОЗМОЖЕН (OOM второго dev-сервера, подтверждено Z-v26 двумя попытками) — компенсация
изолированными проверками реальным кодом (41 проверка).

## 8. Изменённые файлы (все, с обоснованием)

| Файл | Тип | Обоснование |
|---|---|---|
| `src/lib/ops/acceptance.ts` | fix | дефект P (fail-open при unit_mismatch) — блокер fail-closed контракта гейта |
| `src/lib/ops/acceptance.test.ts` | new | регрессия исправления (обязательна по §14 задания) |
| `agent-ctx/zv27/*` | evidence | скрипты/логи проверок Z-v27 (не исполняемый код приложения) |
| `docs/release/Z-V27_*.md` (6) | docs | обязательная документация этапа (§16 задания) |

Миграции БД не создавались (не требовались: исправление — слой TypeScript-гейта).
Коммит: см. финальный Git-контроль (§12).

## 9. Ограничения среды

- Память 4 GiB total; build потребовал временной остановки dev-сервера (паттерн Z-v26,
  dev-keeper остановлен stop-файлом, после сборки среда восстановлена и проверена).
- HTTP-путь проверен на рабочей БД; изолированный HTTP — NOT RUN (environment), компенсирован.

## 10. Ограничения проверки (честно)

- Внешние интеграции (Yandex/VK/YooKassa/SMTP/Telegram/n8n-workflow) — NOT RUN (нет credentials);
  локально подтверждён fail-closed (OAuth 501, stub-платёж честный).
- Полный товарный checkout 200 невозможен до данных владельца — это НЕ дефект, а контракт fail-closed.
