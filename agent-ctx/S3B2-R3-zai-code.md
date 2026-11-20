# S3B2 — Каталог и карточки товаров (recreate-3, R3 + CONT) — отчёт субагента

Дата: 2026-11-20. Репозиторий: `/home/z/my-project/conditera-v2`, ветка main.
Статус: **DONE** (полное исполнение, все гейты green).

## Коммиты

| # | Sha | Содержание |
|---|-----|------------|
| 1 | `778f323` | [S3B2] catalog: filters/search/pagination, product card with ingredients+allergens+reviews, review API with moderation, search adapter seam (recreate-3) — весь код (26 файлов: 11 модифицированных/удалённых, 15 новых путей) |
| 2 | `40d2160` | [S3B2] docs: worklog S3B2-R3 (sha/bundle pinned) — только worklog.md |

Не пушено, bundle не создавался (по инструкции координатора), my-project не коммитился.

## Что сделано CONT-прогоном

Первое исполнение (R3) упало по дедлайну ПОСЛЕ завершения имплементации. CONT
выполнил: аудит готового кода по спецификации → гейты → curl-матрица → браузер-матрица
→ коммиты → worklog → отчёт. **Код после аудита не менялся: ни одного дефекта не
найдено** (подробности ниже).

## Карта API

| Эндпоинт | Параметры | Коды |
|----------|-----------|------|
| `GET /api/products` | `category` (slug, строго categoryId), `confectioner` (slug или id), `q` (SearchProvider), `minPrice`/`maxPrice` (целые рубли → копейки), `sort` = popularity\|price_asc\|price_desc\|newest, `page` ≥1; 20/стр | 200; 400 (sort вне whitelist, page<1/не-число, minPrice>maxPrice, цена не целая); 429 (120/мин/IP) |
| `GET /api/products/[slug]` | — | 200 (состав/аллергены/categoryId/кондитер/агрегат approved); 404 (не найден ИЛИ isAvailable=false); 429 |
| `GET /api/products/[slug]/reviews` | `page` (5/стр) | 200 (approved + собственные pending автору в ownPending); 404; 429 |
| `GET /api/categories` | — | 200 (плоский список с productsCount активных); 429 |
| `POST /api/reviews` | JSON `{productSlug\|productId, rating 1..5 int, text 5..2000}` | 201 pending; 403 `{"error":"csrf"}` (без one-time токена); 401 (без сессии); 403 (роль GUEST); 400 (валидация тела); 404 (товар не найден/снят); 429 (burst 5/мин/IP + 20/сутки/Profile.id, Retry-After обязателен) |

Порядок guard: **CSRF → rate-limit(admin-mutation 30/мин) → auth → RBAC** (центральный
`withRole` из S2B3). Review.userId = **Profile.id** (резолв из guard-контекста, не auth id).

## Закрытие D11

- Категория — **только categoryId**: slug → `category.findUnique` → `where.categoryId`;
  LIKE/ILIKE по названию категории запрещён архитектурно (curl-гейт: фильтр по
  имени-строке даёт 0 товаров). guessCategory отсутствует.
- Состав (ingredients) и аллергены (allergens) — из БД, на карточке товара
  (`data-testid=ingredients-block` / `allergens-block`).
- Отзывы: чтение — только approved (агрегат avg+count через один `groupBy` при
  чтении, не колонки Product); создание — всегда `status=pending`; собственный
  pending виден только автору (viewerProfileId), с бейджем «На модерации».

## Отклонение от промпта (задокументировано)

Публикация товара — флаг **isAvailable** (isAvailable=true); поля isPublished в
схеме S1B2 нет, миграцию ради переименования не делали. Зафиксировано в JSDoc
queries-слоя, worklog и здесь.

## Архитектура

- **queries-слой** `src/lib/catalog/queries.ts` — единый контур чтения витрины для
  Route Handlers и RSC-страниц (страницы не читают Prisma напрямую). `src/lib/db/
  queries/products.ts` — тонкий фасад для S4/S5.
- **params** `src/lib/catalog/params.ts` — изоморфный парсер (страница + API):
  page≥1, цены в рублях → копейки (regex `^\d{1,7}$`), sort whitelist, q ≤200,
  `buildCatalogHref` — общий построитель href (фильтры клиента и серверная
  пагинация шарят ссылки).
- **adapter-seam поиска** (решение владельца №2): `src/lib/search/` — интерфейс
  SearchProvider; активен PrismaSearchProvider (ILIKE contains insensitive по
  title/description/ingredients/tags через `unnest` + плейсхолдеры `Prisma.sql`,
  экранирование LIKE-метасимволов; COLLATE ICU для кириллицы при локали C);
  MeiliSearchProvider — задокументированная точка подключения (шаги 1–3 в
  докблоке), singleton провайдера на globalThis с BUILD_ID.
- **Rate-limit**: `CATALOG_READ_RULE` 120/мин/IP на публичных GET (public-get.ts —
  хелпер: GET-роуты публичны, но лимитируются от скрейпинга), `REVIEW_POST_RULE`
  5/мин/IP (burst, consume после guard до валидации тела), `REVIEW_USER_RULE`
  20/сутки/Profile.id. Store на globalThis, sweep с учётом windowMs записи,
  429 + Retry-After.
- **XSS**: текст отзыва — обычный текст, рендер React-экранированием
  (`{review.text}`); dangerouslySetInnerHTML в новых компонентах отсутствует;
  отправка через `csrfFetch` (one-time токен, prefetch перед каждой мутацией).

## Гейты (числа)

- `bun run lint`: **0** замечаний. `bun run typecheck` (tsc --noEmit, strict +
  noUncheckedIndexedAccess): **0** ошибок.
- curl-матрица (скрипт `agent-ctx/s3b2-curl-matrix.sh`, jar `-b -c` всегда вместе):
  **55 проверок — все green** (пагинация 20/стр + страница 2 отличается; фильтры
  category/q/цена/сортировки; category-by-name → 0; 400 на 4 типа битых параметров;
  дерево 8 категорий; карточка: ingredients/allergens/categoryId/агрегат 6 approved;
  404; CSRF: без токена 403 → токен → без сессии 401 → login → 201 pending →
  burst 429 + Retry-After 60; server-render /catalog?category=torty содержит товары
  категории).
  Нюанс: суточный бакет review-user (20/сутки) демо-покупателя был исчерпан
  накопленными тестами (R3-имплементация + CONT) — P/R-проверки довыполнены
  профилем support@demo.ru; лимит отработал как задумано (repro: `retryAfter: 85176`).
- Браузер (agent-browser, свежая сессия, load+sleep, **12/12**):
  1. /catalog 1440 — сетка, фильтры, сортировка; клик категории → URL `?category=torty` + сетка 6; поиск debounce 400мс → URL `q=` + сетка; пустой результат → EmptyState; пагинация → `/catalog?page=2` (3 карточки).
  2. /catalog/prod-demo-01 — крошки 4 уровня (Главная→Каталог→Торты→Товар), состав, аллергены, галерея-заглушка, цена 3 900 ₽; ?tab=reviews: 6 approved-отзывов разных seed-авторов + похожие товары той же категории.
  3. Вход через auth-modal (support@demo.ru) → форма отзыва → отправка → «Отзыв отправлен на модерацию» + own-pending с бейджем «На модерации».
  4. XSS-материал (pending-отзыв с `<script>alert(...)` и `<img onerror=...>`): рендер **как текст**, диалог не открыт (dialog status: no dialog), инъекций `img[src=x]`: 0, исполняемых script из отзыва: 0 (единственный match — штатный Next flight-payload).
  5. /confectioners — 2 карточки seed (города/рейтинг 4.8/«N изделий от …₽») → клик → `/catalog?confectioner=uezdny-konditer`, 12 товаров, чип мастера.
  6. Mobile 390: сетка 1 колонка, scrollWidth ≤390 на /catalog, /catalog/[slug], /confectioners; Sheet-фильтры (категории+цена, клик из Sheet меняет URL), footer `mt-auto` на месте; цветовой контур без indigo/blue.

## Аудит: что нашёл / что не нашёл

- Пройдены все пункты спецификации: mock-данных нет, LIKE-категории нет, Review.userId
  = Profile.id, csrfFetch в форме, rate-limit в роутах, store на globalThis, strict-
  типизация, дерево категорий (одноуровневое — parentId в схеме S1B2 нет, честно
  документировано), 20/стр, URL-состояние.
- Единственный подозреваемый на дефект — «битые» arbitrary-классы в product-view/
  [slug]/loading/footer (`pb-ax(...`, `grid-cols-inmax(...`) — **артефакт дисплея
  транспорта** (пара «скобка+m» съедается при плоском выводе): od -c показал
  корректные байты `pb-[max(...)]`, `grid-cols-[minmax(0,1fr)_360px]`. Код не тронут.
  Урок S3B1 подтверждён вторично; в worklog цитат классов/env-литералов нет, после
  append worklog health/каталог = 200 (source-not директива работает).
- Стартовое состояние БД: products=23, reviews=28 (15 approved seed + 13 pending
  тестов), prod-demo-01: 6 approved → 2 страницы по 5.

## Уроки для верификатора

1. Суточный in-memory rate-limit бакет — состояние песочницы между прогонами;
   перед write-гейтами учитывать накопленное предыдущими агентами (менять
   тестовый профиль, не полагаться на «свежесть»).
2. Сессию для curl ставить через origin приложения (`POST /api/auth/login`) —
   Set-Cookie сессии даёт только SSR-контур; прямой POST на шим :3040 куку
   приложения не возвращает.
3. `python print(bool)` → «True» ≠ «true» в bash-сравнениях — нормализовать
   `.lower()` на стороне генератора.
4. CONT-аудит: байты проверять od -c до правок — оба «дефекта» дисплея в этом
   блоке оказались артефактами, нулевой diff по коду.

## Что готово для следующих блоков

- **S3B3 (SEO/OG/метрика)**: `generateMetadata` уже на /catalog и /catalog/[slug]
  (title/description из БД), поверх — canonical/OG через `getAppUrl` (app-url каркас
  S1B2/S3B1 готов), sitemap/robots расширяются маршрутами каталога.
- **S5B3 (модерация отзывов + админ-CRUD)**: pending-очередь уже пишется; админ-
  список — паттерн ListingShell (S3B1), мутации — центральный guard + csrfFetch
  как в admin-roles; справочник категорий уже читается витриной (getCategoryTree).
- **S4B1 (цены)**: сквозные копейки в params/queries; блоки принимают готовые
  строки форматирования (`formatPriceRub`) — контракты ShopCard не менять.
- **S9B1 (Meilisearch)**: точка подключения описана в meili-provider.ts (env
  MEILI_HOST/MEILI_KEY, индексация после мутаций витрины S5), переключение — одна
  строка в фабрике getSearchProvider.

## Артефакты

- Скриншоты: `agent-ctx/s3b2-r3-catalog.png` (1440), `s3b2-r3-product.png` (1440),
  `s3b2-r3-review-moderation.png` (1440, форма+бейджи), `s3b2-r3-confectioners.png`,
  `s3b2-r3-mobile-390.png` (390×844), `s3b2-r3-mobile-sheet.png`.
- curl-матрица: `agent-ctx/s3b2-curl-matrix.sh` (идемпотентная, самодокументируемая).
- Worklog: `conditera-v2/worklog.md` — «## 2026-11-20 — recreate-3: S3B2 каталог
  (первое исполнение, R3 + CONT)».
