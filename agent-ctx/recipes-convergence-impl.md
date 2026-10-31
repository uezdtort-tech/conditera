# Task: recipes-convergence — Impl Report (implementation agent)

Date: 2026-10-31, HEAD base: 51ce38e (clean) → committed fix on top.

## Root cause of «/recipes показывает главную» (двухслойная)

1. **SSR-слой**: `RouteFallback` рендерит SPA-view из zustand-store; store на сервере всегда в
   дефолтном `nav.view='home'` (`navigate()` — только клиентский useEffect). Итог: SSR ЛЮБОГО
   stub-маршрута (/recipes, /about, /venues…) отдавал HomePage — краулер/первый кадр до гидрации
   видели hero/каталог/«Хиты продаж». Бейдж «src: mock (пусто в БД)» — это секция ConfectionersMarquee
   главной страницы (src/components/marketplace/confectioners-marquee.tsx:209), т.е. маркер того,
   что рендерилась именно HomePage.
2. **Данные**: `RecipesPage` читал `store.recipes` (seeding из MOCK_RECIPES, store.ts:670 /
   mock-data-extra.ts:272) и делал НОЛЬ запросов к API. `RecipeDetailPage` искал рецепт в том же
   mock-массиве (`recipes.find(r => r.id === nav.params.id)`).

## Changed files

| File | Change |
|---|---|
| `src/lib/recipe-view-model.ts` (NEW) | Чистый маппер строки БД `recipe_marketplace` (snake_case, numeric-поля строками) → UI-модель `Recipe`; `difficultyBucket` 1..5→easy/medium/hard/expert; честные дефолты (автора-имени в БД нет — не выдумываем). |
| `src/components/pages/recipes-catalog.tsx` (NEW) | Реализация каталога: TanStack useQuery + csrfFetch → GET /api/recipes/marketplace?sort=popular&limit=100; skeleton / error+«Повторить» / «Рецептов пока нет» / «Ничего не найдено» по фильтрам; карточки — реальные title/description/теги/цена/сложность/время/views/cover; клик → navigate('recipe-detail', {id: uuid}). |
| `src/components/pages/recipes-page.tsx` | Thin re-export на recipes-catalog (совместимость route-fallback/тестов). |
| `src/components/recipes-route.tsx` (NEW) | Оболочка /recipes: тот же app-shell (Header/Footer/гидраторы/модалки), но рецептурные view рендерит НАПРЯМУЮ (SSR-корректно), затем следует за store (SPA-навигация), чужие view → RouteFallback. |
| `src/app/recipes/page.tsx` | `RouteFallback` → `RecipesRoute` (view 'recipes'/'recipe-detail' по ?id=). |
| `src/components/pages/recipe-detail-page.tsx` | Источник рецепта: useQuery GET /api/recipes/marketplace/[id] (404→null) вместо store-поиска; loading-skeleton / error+retry / «Рецепт не найден»; добавлена покупка: POST /api/recipes/marketplace/[id]/purchase (csrfFetch; неавторизованным — auth-modal), кнопка «Купить за X ₽»/«Приобретено ✓»; hero без preview_image → градиент; блок acceptances сохранён (реальный API /api/recipes/{id}/acceptances, деградирует в empty). |
| `src/components/route-fallback.tsx` | SSR-фикс для остальных stub-маршрутов: до синхронизации store рендерит view из пропса (`activeView = synced ? currentView : view`), useSeoMetadata/isDashboard на activeView. |
| `src/app/sitemap.ts` | Удалены MOCK_CONFECTIONERS/MOCK_RECIPES/CATEGORIES; кондитеры — живой Supabase (ошибка/пусто → skip, никогда не throw); рецепты — без query-URL до появления canonical /recipes/<slug> (политика CLOUD-PREVIEW-SEO-REPORT). |
| `src/components/pages/recipes-page.test.tsx` (NEW) | 5 компонентных тестов (vitest+RTL, прецедент есть: product-page.*.test.tsx): запрос к API+рендер реальных строк, клик→navigate с uuid, error+«Повторить», «Рецептов пока нет», skeleton в полёте. |

## Verification

- `GET /api/recipes/marketplace` → 200, реальные строки («Шоколадный торт «Три шоколада»», 500 ₽…).
- Браузер (agent-browser): /recipes → «3 материалов…» с РЕАЛЬНЫМИ рецептами из БД (Три шоколада
  500₽/1248 views, Бенто-торт 350₽…); клик → detail из GET /api/recipes/marketplace/[id]
  (ингредиенты/шаги/★); «Купить за 500 ₽» → POST …/purchase → **201**, кнопка → «Приобретено ✓».
- Тесты: vitest 5/5 passed; `bunx tsc --noEmit` — чисто; `bun run lint` — чисто.
- `curl /recipes` (SSR-HTML) **по-прежнему отдаёт HomePage** — особенность среды, не кода: dev-сервер
  (boot 02:42, «turbopackFileSystemCacheForDev») исполняет снапшот модулей на момент boot — правки
  ЛЮБЫХ существовавших на boot модулей (включая app/recipes/page.tsx и route-fallback.tsx)
  не попадают в SSR, пока сервер не перезапустят (рестарт запрещён задачей). HMR обновляет только
  клиентские бандлы (поэтому в браузере всё живое). Диагностика: chunk-и в .next/dev/server/chunks/ssr
  содержат новый код (syncedWithStore, recipes-catalog), но рендер отдаёт boot-версию; свежескомпилированный
  /gift-certificates тоже отрендерил boot-версию route-fallback. SSR-логика исправлена корректно
  (RecipesRoute + activeView) и применится при следующем рестарте dev-сервера / в prod-build.
- sitemap.xml: 28 URL, статика + реальные slug-и кондитеров из БД, мок-сущностей нет.

## Follow-ups (не в рамках задачи)
- После рестарта dev-сервера проверить `curl /recipes` — SSR должен отдать каталог (header
  «Рецепты и мастер-классы от кондитеров» уже в SSR, список — после клиентского fetch react-query).
- Автор рецепта: в recipe_marketplace только author_id — для имени автора нужен join на profiles
  (отдельная задача, на UI честно не рисуем).
