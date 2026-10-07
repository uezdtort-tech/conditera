# Task p1-d — витрина: /api/products total/category/search + каталог/карточка (is_available, prepTime, live-отзывы)

## Status: DONE

## Files changed
1. `src/app/api/products/route.ts` (GET):
   - select дополнен полями карточки 0052 (короткие/длинные описания, размеры, composition, min_order_qty, custom_order_available, is_available, production_time_hours) — их НЕ было в select (в worklog прошлого экземпляра это было заявлено, но фактически отсутствовало; после правки карточки в каталоге видят isAvailable/prepTime).
   - **total** = count:exact head:true с теми же фильтрами (status/category/confectioner/search), а не размер страницы; при ошибке count — fallback на длину страницы (не роняем выдачу).
   - **категория**: category_id в products — UUID FK; витрина шлёт slug («cakes») → резолв slug→id через product_categories (UUID-параметр проходит напрямую). Неизвестный slug → честное `{products:[], total:0}` (не отсутствие фильтра).
   - **поиск**: `toSafeIlikePattern()` — разделители or() (`(),"\`) вырезаются, внутренние пробелы → `%` («торт,тест» → `%торт%тест%`); паттерн идентично применяется в основном и count-запросе.
2. `src/app/api/products/[id]/route.ts` (GET): отзывы — в select добавлен `photos` (JSONB, 0057), в ответе санитайз `photos: string[]`.
3. `src/lib/types.ts`: добавлен витринный `interface Review {id, author, avatar?, rating, text, date, photos?, pros?, cons?}` (раньше типа не существовало).
4. `src/lib/supabase/use-marketplace.ts`:
   - `formatPrepTime()` (pluralRu): production_time_hours → «12 ч / 1 день / 1 дн 4 ч / 2 дня»; null/0/битое → undefined (mapApiProductToProduct.prepTime).
   - `isAvailable: p.is_available ?? true` (в БД NOT NULL DEFAULT true).
   - `mapApiReviewToReview()` — defensive-маппер (никогда не бросает, все поля опциональны); `useLiveProductDetail` теперь возвращает `{product, reviews}` (404/ошибка → `reviews: []`); обратная совместимость: старые потребители читают `.product`.
5. `src/components/pages/catalog-page.tsx`:
   - `maxPrice = useMemo(max(15000, …prices))`; слайдер `max={maxPrice}`; условие фильтра `(priceRange[1] >= maxPrice || p.price <= priceRange[1])` (слайдер с шагом 100 не всегда встаёт на maxPrice); AI-бюджет `Math.min(f.budget, maxPrice)`; оба reset-кнопки → `[0, maxPrice]`.
   - sync-эффект: если пользователь не трогал цену (hi === прежний потолок), при росте maxPrice верх поднимается автоматически; prevMax фиксируется в локальную переменную ДО setPriceRange (updater React вызывается позже — иначе ref уже перезаписан и hi не матчится; первый вариант имел именно этот баг).
6. `src/components/pages/product-page.tsx`:
   - строка «N готовка» — целиком условная (вместе с разделителем «•»), исчезает при prepTime undefined;
   - `ProductReviewsList` (avatar-инициалы, имя, 5 звёзд с aria-label, дата ru-RU, текст, фото-превью) + `initialsOf/formatReviewDate` (защита от битой даты); в TabsContent reviews рендерится при `liveReviews.length>0` вместо заглушки «Подробные отзывы…»; пустой стейт (0 счётчик И 0 live) сохранён; liveReviews = `detail.data?.reviews ?? []`.
7. `src/components/marketplace/product-card.tsx`: бейдж «Нет в наличии» (bg-muted, НЕ красный) при `isAvailable===false`; кнопка корзины disabled+aria-disabled+title; guard в handleAddToCart.

## Демо-данные (БД, не миграция)
- production_time_hours: svadebnyy-tort-yagodnyy-barhat=48, bento-tort-nezhnyy=28, tort-korovka-3d=72, kapkeyki-vanilnyye-12=12 (сид имеет NULL — поля 0052 не заполнялись).
- chokolatnyy-candy-bar (5900 ₽) → is_available=false (демо бейджа; товар не участвует в order_items/favorites/cart — проверено запросами).

## Контракты
- GET /api/products → `{products[], total(count по фильтрам), limit, offset}`; category=slug|uuid|all; q — безопасный паттерн; сортировки/пагинация без изменений.
- GET /api/products/[id] → `{product(+0052 поля), slices, reviews[{id,rating,text,pros,cons,helpfulCount,photos,createdAt,author{id,name,avatar}|null}]}`.
- useLiveProductDetail → `{product: StoreProduct|null, reviews: Review[]}`.

## Проверено
- `npx tsc --noEmit` = 0; `bun run lint` = 0.
- curl: `?limit=5` → total=12 (=COUNT в БД, страница 5); `?q=торт,тест` → 200 total=0 (раньше 400); `?q=торт` → 3; `?category=cakes` → 2 (napoleon+svadebnyy); `?category=bento` → 1; `?category=no-such-cat` → `{[],0}` (честная пустота — задокументировано).
- curl detail: svadebnyy → reviews[0] с author.name=«Демо Покупатель», photos, createdAt; candy-bar → is_available:false; no-such → 404.
- Браузер (agent-browser): /catalog — слайдер aria-valuemax=18500, thumbs [0,18500], счётчик «12 товаров», свадебный торт виден; карточка candy-bar с бейджем «Нет в наличии» и disabled корзиной; /product?id=svadebnyy… — «2 дня готовка», мета-карта «2 дня/срок», живой отзыв (инициалы ДП, имя, звёзды, дата) в табе «Отзывы (1)», заглушка исчезла; bento — «1 дн 4 ч готовка»; candy-bar — «Временно недоступен» + disabled кнопка; 375px — h-scroll нет.
- dev.log — ошибок по моим файлам нет (единственный [browser] Socket.IO-варнинг — от закрытия моего браузера, зона chat p1-b).

## Осталось / заметки
- Клиент total не потребляет (useLiveProducts читает только products; каталог фильтрует локально, limit=60, без пагинации) — исправление чисто API-сторона, ничего в клиентах ломать не пришлось.
- production_time_hours в сидах NULL — пока сид не обновят, prepTime показывается только у 4 демо-товаров (данные, не код).
- reviews_count в products — счётчик сида (может расходиться с фактическими approved-отзывами): сводка «На основе N» считает по колонке, список рендерит live — при расхождении список полнее; автопересчёт счётчика вне скоупа.
- «Fallback на store.reviews» из ТЗ невозможен — StoreProduct/reviews поля не существует (в mock тоже нет); fallback = прежние заглушка/пустой стейт.
- Границы соблюдены: checkout/конструктор/корзина (p1-a), customer-dashboard/repeat/wishlist (p1-c), chat (p1-b), notifications (p1-e), ops/* — не тронуты.
