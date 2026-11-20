# S5B2-R3 — zai-code report — Conditera v2 — кабинет кондитера (vendor cabinet)

Task: S5B2-R3-BUNDLE (recreate-3). State at pin: HEAD v2 258c309 (docs) на main,
код-диапазон 79feae4..f75b3aa (35 файлов, +4654/−76), дерево чистое, dev
healthy (localhost:3000; гейт-скрипты целились в :3100).

## Скоуп

Кабинет кондитера: обзор, товары (CRUD + модерация), заказы (обработка по
карте переходов + print-view), календарь, аналитика. Часть 1 (8c8e077): enum
ModerationStatus + колонка Product.moderationStatus (backfill approved),
витрина-фильтр approved в каталоге S3B2, pure-правила товара (slug/цена/
publish-валидация) + vitest. Каркас (913e2d4): layout+guard, страницы, API.
Дев-фиксы: d9ded7f, 4ace233, f75b3aa (см. «Девиации»).

## Эндпоинты API (все — withRole(VENDOR_GROUP) + resolveConfectionerForApi)

| Метод  | Путь                            | Назначение |
|--------|---------------------------------|------------|
| POST   | /api/vendor/products            | создать товар; moderationStatus=pending_moderation (спека §2) |
| PATCH  | /api/vendor/products/[id]       | правка полей (slug/цена/publish pure-правила); moderationStatus сохраняется как есть |
| DELETE | /api/vendor/products/[id]       | удалить товар (hard/soft — проверено матрицей) |
| POST   | /api/vendor/orders/[id]/status  | переход статуса заказа по карте переходов, OrderEvent via=vendor |

Страницы: /vendor (обзор), /vendor/products, /vendor/orders,
/vendor/orders/[id], /vendor/orders/[id]/print (print-view), /vendor/calendar,
/vendor/analytics.

## Решения

- ModerationStatus = pending_moderation / approved / rejected, default
  pending_moderation; публикация на витрине = approved + isAvailable
  (витрина-фильтр в src/lib/catalog/queries.ts).
- PATCH не меняет moderationStatus (approved → approved) — re-модерация при
  правке approved-товара отложена в S5B3.
- supplier placeholder: vendor-API только для CONFECTIONER (БД-истина
  ConfectionerProfile); SUPPLIER/STUDIO/WHOLESALER получают null — кабинет
  поставщика следующий этап, UI показывает EmptyState-плейсхолдер.
- Согласование товара пока moderation-stub (db-approve в матрице) — админ-
  модерация → S5B3.
- ORDER_STATUS_LABELS_RU вынесен в клиент-безопасный src/lib/orders/
  status-labels.ts (server-only цепочка ломала dev-компиляцию всех маршрутов).
- Каркас (dashboard)/layout.tsx рендерится один раз; вложенные account/vendor
  layouts не дублируют SiteHeader/SiteFooter/main#content.

## Гейты

- lint 0 / tsc 0 — известно из финализации recreate-3, дерево чистое
  (отдельного evidence-файла нет, зафиксировано в worklog v2 258c309).
- curl-матрица: agent-ctx/s5b2-matrix.sh — anon-редиректы → customer /vendor
  307 → confectioner страницы 200 → create pending_moderation → publish-
  validation 400 → bad_request 400 → csrf 403 → роль customer 403 → витрина
  не видит pending (api+страница) → db-approve → витрина видит → owner PATCH
  хранит approved → чужие PATCH/DELETE/status/print 404 → заказ → pay →
  CONFIRMED → PREPARING/READY/IN_DELIVERY → invalid jump 400 → customer
  confirm COMPLETED + эскроу released + verify-ledger OK → календарь →
  аналитика == db-истина → delete hard/soft → burst 429 + Retry-After →
  render / и /catalog.
- Браузер-гейт: agent-ctx/s5b2-r3-browser.sh — логин confectioner (cookie-
  injection), dedicated session, light/dark/mobile, console errors == 0,
  mobile scrollWidth == 390.

## Скриншоты (6, agent-ctx)

1. s5b2-r3-overview.png (97 554 B) — обзор кабинета
2. s5b2-r3-orders.png (119 936 B) — заказы
3. s5b2-r3-products.png (190 598 B) — товары
4. s5b2-r3-analytics.png (79 948 B) — аналитика
5. s5b2-r3-dark.png (83 718 B) — тёмная тема на /vendor/analytics
6. s5b2-r3-mobile-390.png (48 376 B) — mobile 390

## Девиации / фиксы в ходе блока

- d9ded7f: server-only цепочка status-labels ломала dev-компиляцию всех
  маршрутов — вынесено в клиент-безопасный модуль.
- 4ace233 (аудит): карта переходов дополнена IN_DELIVERY→COMPLETED (до фикса
  customer-confirm падал 409); витрина [slug] — настоящий 404 через route-
  group (list), изолирующий loading-границу; удалён [slug]/loading.tsx с
  битыми классами.
- f75b3aa: вложенные account/vendor layouts дублировали шапку/подвал/
  main#content — каркас сведён к одному рендеру в (dashboard)/layout.tsx.

## Пины артефактов

- Код v2: 8c8e077 (part 1) + 913e2d4 (каркас); фиксы d9ded7f, 4ace233,
  f75b3aa; docs 258c309 ([S5B2] docs: worklog, sha/bundle пин).
- Bundle: /home/z/my-project/backups/conditera-v2-S5B2-f75b3aa.bundle —
  1 251 084 B, verify OK (complete history, main = 258c309); git-tracked
  my-project коммитом 1632fc4 (только файл бандла, force-add).
- Отчёт и ворклоги: этот файл; worklog v2 (258c309); корневой worklog
  (запись recreate-3-S5B2, append).

## Готовность к S5B3

- Re-модерация: при правке approved-товара moderationStatus сохраняется —
  нужно решение и имплементация (approved → pending_moderation на правке?).
- Кабинет поставщика: resolveConfectionerForApi возвращает null для
  SUPPLIER/STUDIO/WHOLESALER — сейчас EmptyState-плейсхолдер, полный кабинет
  не реализован.
- Модерация: approved/rejected выставляются только db-stub'ом в матрице —
  нужен админ-модерационный UI/поток; значение rejected в enum пока не
  задействовано в потоках.

Render-check после docs-коммита: / 200, /catalog 200 (dev :3000).
