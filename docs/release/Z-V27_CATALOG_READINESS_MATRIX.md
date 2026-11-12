# Z-v27 — CATALOG READINESS MATRIX (12 товаров)

Дата: 2026-11-11 · HEAD `664e1e5` · источник: реальный acceptance-gate
(`agent-ctx/zv27/catalog-map.mjs`, read-only к рабочей БД, delivery = сегодня+3)

BLOCKING_CODES: `RECIPE_MISSING, LOW_STOCK, PURCHASE_ETA_MISSING, PURCHASE_ETA_AFTER_DEADLINE,
CAPACITY_EXCEEDED, DEADLINE_TOO_CLOSE, INVENTORY_UNIT_MISMATCH` (последний добавлен Z-v27).
`MISSING_PRODUCT_DATA` — warning (не блокирует).

## Итоговая карта (гейт реально прогнан для каждого товара)

| # | Товар | Цена | Рецепт | Время | Кондитер | Gate | Blocking codes | Итоговый статус |
|---|---|---|---|---|---|---|---|---|
| 1 | Свадебный торт «Ягодный бархат» | 18500 ₽ | ✓ «Красный бархат (демо)» | — (warning) | Сахарная печать | ✗ | `LOW_STOCK` + `PURCHASE_ETA_MISSING` (Ягоды −250 г/торт) | **DATA_INCOMPLETE** (под-статусы: STOCK_BLOCKED + PROCUREMENT_REQUIRED) |
| 2 | Домашний «Наполеон» | 2400 ₽ | — | — | Сахарная печать | ✗ | `RECIPE_MISSING` | **OWNER_DECISION_REQUIRED** |
| 3 | Бенто-торт «Нежность» | 1200 ₽ | — | 6 ч | Сахарная печать | ✗ | `RECIPE_MISSING` | **OWNER_DECISION_REQUIRED** |
| 4 | Капкейки ванильные (12 шт.) | 1900 ₽ | — | 6 ч | Сладкая уездная | ✗ | `RECIPE_MISSING` | **OWNER_DECISION_REQUIRED** |
| 5 | Макаронс ассорти (15 шт.) | 2600 ₽ | — | — | Сладкая уездная | ✗ | `RECIPE_MISSING` (+warning) | **OWNER_DECISION_REQUIRED** |
| 6 | Имбирные пряники с росписью (9 шт.) | 1500 ₽ | — | — | Сладкая уездная | ✗ | `RECIPE_MISSING` (+warning; склад -0102 пуст) | **OWNER_DECISION_REQUIRED** |
| 7 | 3D-торт «Коровка» | 6500 ₽ | — | 12 ч | Кондитерская Купец | ✗ | `RECIPE_MISSING` + `CAPACITY_EXCEEDED` | **OWNER_DECISION_REQUIRED** (+CAPACITY_BLOCKED) |
| 8 | Зефирный букет «Пион» | 3200 ₽ | — | — | Кондитерская Купец | ✗ | `RECIPE_MISSING` (+warning; склад -0103 пуст) | **OWNER_DECISION_REQUIRED** |
| 9 | Пастила яблочная без сахара (200 г) | 690 ₽ | — | — | Сахарная печать | ✗ | `RECIPE_MISSING` (+warning) | **OWNER_DECISION_REQUIRED** |
| 10 | Кэнди-бар шоколадный (30 персон) | 5900 ₽ | — | — | Сладкая уездная | ✗ | `RECIPE_MISSING` (+warning; склад -0102 пуст) | **OWNER_DECISION_REQUIRED** |
| 11 | Порционные десерты (20 шт.) | 4400 ₽ | — | — | Кондитерская Купец | ✗ | `RECIPE_MISSING` (+warning; склад -0103 пуст) | **OWNER_DECISION_REQUIRED** |
| 12 | Леденцы на палочках (25 шт.) | 2500 ₽ | — | — | Кондитерская Купец | ✗ | `RECIPE_MISSING` (+warning; склад -0103 пуст) | **OWNER_DECISION_REQUIRED** |

## Сводка

`READY: 0` · `DATA_INCOMPLETE: 1 (№1)` · `OWNER_DECISION_REQUIRED: 11` ·
`CODE_DEFECT: 0` (дефект P исправлен и покрыт тестами) · `NOT_FOR_SALE: 0`.

## Существующие рецепты (справочно, без изменений с Z-v26)

| Рецепт | Ингредиенты → склад |
|---|---|
| Красный бархат (демо) | Мука 450г ✓; Сливки 600мл ✓; Шоколад 300г ✓; Яйца 8шт ✓ (дес-конверсия); **Ягоды 250г — НЕТ на складе** |
| Бенто-торт «Лавандовое наслаждение» | Мука/Сахар/Лаванда/Черничный джем — inventory_item_id=NULL, точных совпадений со складом нет |
| Премиум-рецепт «Свадебный многоярусный» | Бисквит/Ганаш/Мастика/Цветы — на складе отсутствуют |
| Шоколадный торт «Три шоколада» | Тёмный ✓/Молочный ✗/Белый ✓/Масло — имена не совпадают точно |

## Особое наблюдение по №7 («3D-торт «Коровка»», 12 ч)

`production_time_hours=12` = 720 мин > дневного окна по умолчанию (480 мин, 9:00-18:00) →
даже после привязки рецепта гейт даст `CAPACITY_EXCEEDED`, пока владелец не:
а) задаст `confectioner_capacity` с окном ≥720 мин, или б) пересмотре время производства.
Включено в список действий владельца.

## Как проверить закрытие (после ввода данных владельцем)

1. `bun agent-ctx/zv27/catalog-map.mjs` → товар переходит в GATE-PASS.
2. `node scripts/verify/p11-hardening-verify.mjs` → 17/17 (сейчас 12/17, каскад F1).
3. HTTP checkout товарной позиции → 200/201 (сейчас 422, причины точны).

## Дополнение Z-v32 (2026-11-12): цены с историей

Цены товаров в этом отчёте — фиксированные `products.price` (INTEGER RUB) на момент сессии Z-v27. С пакета цен Z-v32 действует система истории цен (миграции 0083–0086): `product_price_history` (half-open `[from, to)`), функции `set_product_price`/`get_product_price_at`/`sync_effective_product_prices`, фиксация версии цены в заказе (`order_items.price_version_id`, `orders.metadata.pricing`). Актуальное описание подсистемы — блок «Z-v32 ADDENDUM: система цен с историей (2026-11-12)» в `docs/operations/PRODUCT_OPERATING_SYSTEM.md`; открытые остатки — ZV32-005/006/007 в `docs/operations/PRODUCT_BACKLOG.md`.
