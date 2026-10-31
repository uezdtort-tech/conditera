# confectioner-analytics — impl (agent record)

## Задача
Заменить hardcoded мок `CONFECTIONER_ANALYTICS` (src/lib/mock-data.ts:2272) в дашборде кондитера на реальные вычисления из заказов GET /api/orders.

## Исходное состояние
- HEAD до: `381f96ce52cf08ed07260a43fc81cdf0f5bed746` (clean, только `?? agent-ctx/baseline/`)
- Потребители мока (grep по src/): только `confectioner-dashboard.tsx` + определение в `mock-data.ts`.

## Изменения (commit 51ce38e3bebb787323937f9777d2a845e2ab3f2d)
1. **src/lib/analytics-compute.ts** (новый, 173 стр) — чистые функции:
   - `computeMonthlyRevenue(orders, months=6, now)`: только COMPLETED, окно N мес. вкл. текущий, нулевые месяцы присутствуют, будущие/битые даты → skip, null/NaN total → 0, бакетинг по UTC 'YYYY-MM' + ru-лейбл. Контракт возврата: `{label, revenue, month}[]`.
   - `computeOrdersByStatus(orders)`: ТОЛЬКО присутствующие в данных статусы (без нулевых секторов — задокументировано), сортировка count desc → алфавит.
   - `computeTopProducts(orders, limit=5)`: агрегация по `order_items.title`, count = Σquantity (qty<=0/нет → 1), revenue = Σ(price×qty), сортировка count desc → revenue desc → имя. null/undefined orders → [].
   - `STATUS_CHART_META`: ru-подписи + oklch fill-цвета для Pie Cells (в finance.ORDER_STATUS_LABELS цвета — Tailwind-классы, для SVG fill не годятся).
2. **src/lib/analytics-compute.test.ts** (новый, 14 тестов): empty/null вход, разные месяцы + skip будущего/вне окна/битых дат, только COMPLETED, null/NaN total, граница окна, статусы (нет нулей, сортировки), топ товары (агрегация, limit, пропуск пустых названий, tie-break).
3. **src/components/dashboard/confectioner-dashboard.tsx** — замена мока:
   - L102-107: импорт `CONFECTIONER_ANALYTICS` → импорт compute-функций из `@/lib/analytics-compute`.
   - L210-216: из `useRealOrders()` дополнительно деструктурированы `realOrders`, `isLoading: ordersLoading`.
   - L260-280: блок реальной аналитики — `realAnalyticsOrders = realOrders ?? []` (mock/store-фолбэк в аналитику НЕ попадает), `revenueChartData`, `statusChartData`, `topProductsData` (без CANCELLED), `hasRealOrders`, `revenueHasData`, `analyticsEmptyNote` («Загрузка данных…» пока грузится / «Нет данных за период» после).
   - L409: `revenueData={revenueChartData}` (BentoDashboard).
   - L463-471 (карточка «Доход за 6 месяцев», overview-legacy): данные + honest empty-state note.
   - L1303-1311 («Доход по месяцам», таб «Аналитика»): данные + note при `!revenueHasData`.
   - L1320-1324, 1330, 1337 («Заказы по статусам» Pie): `statusChartData` + note при `!hasRealOrders`.
   - L1348-1355, 1362 («Топ товаров»): `topProductsData`, `p.sold` → `p.count` + note при пустом списке.
   - **v2**: `confectioner-dashboard-v2.tsx` мок НЕ использует (grep: 0 вхождений CONFECTIONER_ANALYTICS / revenue / topProducts) — правок не требуется.
   - `CONFECTIONER_ANALYTICS` в mock-data.ts:2272 оставлен (других критичных потребителей нет — определение теперь ниоткуда не импортируется, кроме legacy-совместимости).

## Проверки
- `bunx vitest run src/lib/analytics-compute.test.ts` → **14 passed (14)**.
- `bun run lint` → exit 0, чисто.
- `bunx tsc --noEmit` → без вывода, новых ошибок типов нет.
- dev.log: GET /api/orders 200, order_items отдают title/price/quantity — источник данных подтверждён.

## HEAD после
`51ce38e3bebb787323937f9777d2a845e2ab3f2d` (3 файла: +411/−9; agent-ctx не коммитится).
