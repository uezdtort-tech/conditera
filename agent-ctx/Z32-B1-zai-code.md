# Z32-B1 — Пакет B1: ZV31-017 + ZV31-006 (work record)

Agent: zai-code. Base HEAD: 6f1825f^ (2f2862e). Branch: main.

## Commits

| Commit | Scope |
|---|---|
| 6f1825f | B1a: ZV31-017 — mock-товары убраны из публичного каталога (11 files) |
| 132731c | B1b: ZV31-006 — тесты /api/diagnostics/client-errors (3 files) |
| 2837624 | Backlog: ZV31-017/ZV31-006 → CLOSED (PRODUCT_BACKLOG.md) |

## ZV31-017 — что сделано

Дефект: публичный каталог/главная рендерили `store.products` (в dev сидирован MOCK_PRODUCTS; LiveProductsHydrator подменял только непустой ответ). При пустом/ошибочном /api/products покупатель видел фейковые карточки с ценами («Торт „Купеческий медовик"» 2 300 ₽, id=p2 → 404).

Изменения:
- `src/lib/vitrine-products.ts` (NEW) — `selectVitrineProducts({demoMode,isError,live,storeProducts})` + `isDemoVitrineMode()` (NEXT_PUBLIC_DEMO_MODE==='1', по умолчанию OFF). Контракт: честный режим → только live; isError → live??[] (mock никогда не подменяет серверный сбой); demo → прежний dual-mode.
- `src/components/pages/catalog-page.tsx` — источник товаров = live (/api/products через useLiveProducts) + 4 честных состояния: loading → skeleton-грид (aria-busy, role=status), error → role=alert «Не удалось загрузить каталог» + кнопка «Повторить» (refetch), пустая БД → «Каталог пока пуст / Кондитеры ещё не опубликовали товары — загляните позже», фильтры → прежний «Ничего не найдено» (перенесён без изменений). Шапка: «Загружаем каталог…» при loading.
- `src/components/pages/home-page.tsx` — те же источник и состояния в секции «Популярные товары»; productCount/avgRating/categoryCounts/новинки считаются от live. Hero CMS-фолбэк не тронут.
- `src/components/dashboard/customer-dashboard.tsx` (legacy /dashboard) — блок «Рекомендуем вам»: MOCK_PRODUCTS.slice(0,4) → live-store products.slice(0,4), при пустоте — «Каталог пока пуст — рекомендации появятся позже»; import MOCK_PRODUCTS удалён.
- `src/lib/demo-seed.ts` — isDemoSeedEnabled() дополнен универсальным hatch NEXT_PUBLIC_DEMO_MODE='1' (prod по умолчанию по-прежнему пустой сид).

Не менялось (осознанно): store seed и дашборды (dev dual-mode сохранён — контракт demo-seed-gating), confectioners list/marquee (в prod demoSeed → пусто, честно; dev — прежний демо-сид), cake-builder (CAKE_BUILDER_OPTIONS — конфигуратор, не витринные товары), services/decor/corporate (не витринные PRODUCTS/PRICES из задачи).

Тесты: vitrine-products.test.ts 9/9; catalog-page.test.tsx 8/8 (loading/error+retry/empty/data/demo-hatch/demo-error); demo-seed.test.ts 7/7 (+2 новых кейса DEMO_MODE). vitest exit 0; check:quick exit 0 (typecheck/eslint/vitest PASS).

## ZV31-006 — что сделано

`src/app/api/diagnostics/client-errors/route.test.ts` — ПЕРЕПИСАН на реальные коллабораторы (mock только @/lib/postgrest/pool + @/lib/telegram-bot, по образцу event-store.test.ts). 18/18, exit 0. Покрытие: 202+INSERT(component=frontend, source=client, stack=NULL, fingerprint 40 hex); route-не-путь → NULL; severity critical→error; 400 (пустое тело/invalid JSON/нет message/>400); 413 (>16KB) — store не вызывается; rate-limit 20/мин/IP (реальный in-memory limiter): 21-й → 429+Retry-After, 20 записей, изоляция по IP, сброс скользящего окна (fake timers +61s); маскирование end-to-end: Bearer/JWT/карта → [REDACTED] в message INSERT-строки, password/apiKey/authorization поля отброшены allowlist'ом, userAgentShort маскирован, сырой IP не сохраняется (ipHash 16 hex); fail-open: pool.query reject → всё равно 202 {ok:true} без деталей; 4xx-тела — только {error: string}, без stack/путей/node_modules.

Дефектов не найдено: маршрут ведёт себя по документированному контракту (double-masking: route отдаёт message в store, маскирование выполняет storeErrorEvent/masking.ts — assert'ы по фактическим INSERT-параметрам).

## Проверки

- bunx vitest run (targeted) — exit 0 (24/24 Task1; 18/18 Task2).
- bun run check:quick — exit 0 (дважды: перед B1a и перед B1b; runner-артефакты latest.json + history JSON включены в соответствующие коммиты).
- Нарушений ограничений нет: без git reset/clean/add -A/push/merge/rebase; защищённые пути не тронуты; check:full не запускался.

## Не покрыто / риски

- Search — отдельной страницы нет (поиск = catalog с q-параметром), покрыт изменением каталога.
- Confectioners-page/marquee: dev-демо-сид кондитеров сохранён (dual-mode; в prod — пусто, честное состояние) — вне скоупа mock-ТОВАРОВ.
- HomePage целиком в RTL не рендерится в тесте (тяжёлые дети) — состояния главной покрыты через общий селектор + каталог-тест.
- rate-limit limiter не имеет reset-хука: тесты используют уникальные IP на кейс.
