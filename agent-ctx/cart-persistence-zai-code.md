# cart-persistence — work record (zai-code)

Задача: серверная персистентность корзины для залогиненных (Conditera).
Базовый HEAD: 02ccee2. Финальный HEAD: 9817384. Рабочее дерево чистое.

## Stage 1 — миграция 0062 (commit 88b2905)
- `supabase/migrations/0062_cart_custom_items.sql`: `product_id DROP NOT NULL`,
  `metadata JSONB` (IF NOT EXISTS), CHECK `cart_items_product_or_custom_check`
  (product_id OR metadata ? 'custom'), COMMENT на metadata. Аддитивно.
- `scripts/apply-0062-cart-custom-items.ts` — apply по паттерну ops-apply
  (файл = транзакция, маркеры, ledger `public.schema_migrations`).
- Применена на embedded runtime `postgresql://postgres@127.0.0.1:54329/conditera`.
- Верификация (psql, прямой запрос к information_schema/pg_constraint):
  - cart_items.metadata — jsonb, nullable ✓
  - cart_items.product_id — uuid, nullable ✓
  - constraint cart_items_product_or_custom_check ✓
  - ledger: 62 файла ✓

## Stage 2 — Cart API (commit f646ffd)
- `src/app/api/cart/route.ts`: GET (скоуп user_id, created_at ASC, cap 50,
  embed `product:products(id,title,price,images,confectioner_id)`, wire-шейп
  `{dbId, productId|null, quantity, selectedAttributes, metadata, product|null}`);
  POST (валидация zod: productId-UUID или custom, quantity 1..99; товарная —
  upsert по (user_id, product_id, сигнатура selected_attributes) с атомарным
  инкрементом и клэмпом 99; custom — всегда INSERT, metadata = {custom, title,
  image, price, confectionerId, customization} — клиентский снапшот, цена НЕ
  доверенная); DELETE `?id=` (или body {id}, скоуп user_id, идемпотентно) и
  `?all=1`. Rate limit: `enforceRateLimit` RATE_LIMITS.api (паттерн checkout).
- `src/app/api/cart/[itemId]/route.ts`: PATCH {quantity 1..99}, скоуп
  user_id, 404 если строка не своя/удалена. Динамический сегмент — конвенция
  проекта (params Promise, как /api/chat/rooms/[id]).
- `src/lib/validations/cart.ts`: схемы + `stableStringify` (канонический JSON
  для сравнения кастомизаций). Auth: `getUserFromRequest` из `@/lib/auth`
  (единый контракт, как orders/wishlist/checkout). Race note: read-modify-write
  upsert допустим для корзины (не деньги), инкремент — одиночный UPDATE.
- Тесты `src/app/api/cart/route.test.ts` (24): 401 всем методам; GET-маппинг;
  POST upsert/инкремент/клэмп 99/дубликат кастомизации/400-кейсы; POST custom
  INSERT с metadata.custom; DELETE скоуп (user_id в фильтрах, ?all=1, body id,
  мусорный id 400); PATCH (успех/404/400); stableStringify. Мок: цепочечный
  PostgREST-билдер (паттерн role-guards.test.ts) + мок getUserFromRequest.

## Stage 3 — клиентская синхронизация (commit 1921722)
- `src/lib/types.ts`: CartItem + `dbId?: string`.
- `src/lib/cart-sync.ts` (чистый модуль, без импорта store):
  `mergeServerCart(serverItems, localItems)` — DB-wins: товарные дубликаты
  (productId + stable-сигнатура кастомизации) → одна позиция, quantity =
  MAX(local, server), dbId от сервера, локальный itemId сохранён; серверные
  без пары → serverToCartItem (title/image/price из product-embed; для custom —
  из metadata-снимка, конфиг → item.custom); локальные без пары (и ВСЕ custom)
  → items + toPush; cap 50 (серверные приоритетны, лишние локальные не пушатся).
  Сетевые хелперы: `fetchServerCart/pushItem/patchQty/removeItem/clearServerCart`
  — fetchWithAuthRetry (Bearer + 401-refresh) + CSRF double-submit
  (getSessionAuthHeaders(await getCsrfToken()) — канонический паттерн
  notifications-bell.tsx); никогда не бросают, ошибки → console.warn.
- `src/lib/store.ts` (минимально инвазивно):
  - мутации fire-and-forget при `isAuthenticated && user.id`: addToCart /
    addCustomToCart → pushItem (ответ → attachDbId) или PATCH dbId, если позиция
    уже на сервере; removeFromCart → removeItem(dbId); updateCartQuantity →
    PATCH с debounce 500 мс на dbId; clearCart → clearServerCart();
  - reconcile при входе: `setSupabaseUser` (user != null) → setTimeout(0) →
    `reconcileServerCart()`: GET → mergeServerCart → set → push локальных-уникумов.
    Guards: in-flight флаг + `cartReconciledForUserId` (setSupabaseUser дёргается
    и на TOKEN_REFRESHED — повторного reconcile нет); SIGNED_OUT сбрасывает
    маркер. Проводка: src/lib/store.ts:855-876 (setSupabaseUser),
    :439-533 (хелперы sync + reconcile), :891-1005 (мутации).
- Тесты: `src/lib/cart-sync.test.ts` (16) — пустые случаи, MAX-quantity,
  custom never dropped, dbId propagation, cap 50, стабильность ключей;
  `src/lib/store.test.ts` (+4) — аноним без fetch; залогиненный addToCart →
  POST + dbId; removeFromCart → DELETE ?id=; debounce PATCH (2 клика → 1 запрос).
  fetch замокан глобально (vi.stubGlobal), Response — реальный undici.

## Stage 4 — checkout clear fix (commit 9817384)
- `src/app/api/checkout/route.ts`: zod item + `dbId` (optional, max 100);
  блок очистки корзины: `.map((c) => c.dbId ?? c.id)` (id/itemId — легаси
  fallback, старое поведение сохранено).
- `src/components/pages/extra-pages.tsx`: payload позиций добавляет
  `dbId: item.dbId` (обе ветки: custom и товарная). Клиентский clearCart()
  после оплаты дополнительно чистит серверную корзину через store-проводку.

## Final gates
- `bun run lint` — чисто.
- `bunx tsc --noEmit` — 0 ошибок.
- Целевые сьюты: cart route (24) + cart-sync (16) + store (23) = 63 passed.
- Полный suite: **65 файлов, 1154 тестов — все зелёные** (было ~1110, +44 новых).

## Заметки для следующих агентов
- /api/cart отдаёт 401 анонимам: клиентские вызовы имеют смысл только при
  `isAuthenticated` (cart-sync сам молчит для анонимов).
- `session_id`-анонимные корзины (0002) не трогали — фича только для залогиненных.
- dev server на момент работ был остановлен платформой (dev.log молчит с 20:12,
  до начала работ) — код проверен tsc/eslint/vitest; для превью платформа
  поднимает `bun run dev` сама.
