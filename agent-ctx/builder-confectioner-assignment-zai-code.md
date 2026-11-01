# Task: builder-confectioner-assignment — cart path gets a confectioner (agent: zai-code)

Commit: **5eba5f0** (base 9817384, clean tree; agent-ctx untracked files of other agents left untouched)

## FK findings (verified against LIVE DB at 127.0.0.1:54329/conditera, matches 0002_marketplace.sql)
- `orders.confectioner_id` UUID NULLABLE → **auth.users(id)** ON DELETE RESTRICT (`orders_confectioner_id_fkey`)
- `products.confectioner_id` UUID → **auth.users(id)** ON DELETE CASCADE
- There is NO `confectioner_profiles` table. The profile table is **`confectioners`**: `id` TEXT (dev seeds 'c0'..'c4'), `userId` TEXT (live seeds = UUIDs present in auth.users), `verified` BOOLEAN, `verificationStatus` TEXT.
- ⇒ Assigned value = **confectioners.userId** (profile id would violate the FK). Prisma schema.prisma disagrees (Order→Confectioner.id) but the runtime checkout uses supabaseAdmin/PostgREST shim → SQL FK is authoritative.
- Note: `orders.user_id` also FK → auth.users; `public.users` is empty (TEXT id) — irrelevant for checkout.

## Changed files
1. `src/lib/checkout/confectioner-assignment.ts` (NEW) — pure helpers: `isUuidLike` (zod `z.uuid()` guard before any DB query), `resolveCustomConfectioner(profRow, itemRef)` → `{ok, confectionerId=userId}` | `{ok:false, reason: missing_profile|unverified|bad_user_id}`; verified must be strictly `true`.
2. `src/lib/checkout/confectioner-assignment.test.ts` (NEW) — 10 unit tests (valid userId assignment, missing/unverified/bad_user_id, non-UUID guards, legacy seed 'c1'/'u2').
3. `src/lib/store.ts` — `addCustomToCart` input extended with optional `confectionerId` (default ""); written into CartItem only on the new-item path (dedup branch intentionally keeps quantity-only semantics — server cart PATCH is qty-only, overwriting would drift with DB-wins reconcile).
4. `src/components/cake-builder/cake-builder-page.tsx` — «Добавить в корзину» passes `confectionerId: selectedConfectioners[0] ?? ""` (no new UI; quote branch multi-select untouched).
5. `src/components/pages/extra-pages.tsx` (CheckoutPage) — custom items payload now includes `confectioner_id: item.confectionerId || undefined`.
6. `src/app/api/checkout/route.ts`:
   - item schema: optional `confectioner_id: z.string().max(100)` (lenient on purpose — invalid ids must not 400 the checkout);
   - custom order_item snapshot gets `confectioner_id` ONLY from the item's own metadata (raw client choice, transparency for the confectioner queue);
   - `resolveCustomConfectionerAssignment()`: UUID-guard → lookup confectioners by `id`, fallback by `userId` → first valid (verified + UUID userId) wins; every failure = `console.warn` + skip; lookup errors fail-open (null);
   - priority: product-backed `products.confectioner_id` first, custom assignment only as fallback (`productConfectionerId ?? customAssigned`);
   - 5a. FK safety net: on insert error 23503 with confectionerId set → retry once with `confectioner_id: null` (never fail checkout).

## Server-side validation / never trust client ids
- Non-UUID ids (dev mock 'c1'/'u2') → warn, no DB query, `confectioner_id = null`, order still 200.
- Unknown UUID → warn «профиль кондитера не найден», null.
- Unverified profile (`verified !== true`) → warn, null (unit-tested).
- Resolved userId must itself be a UUID (legacy seeds 'u2' → bad_user_id).

## Order visibility check (report only)
`GET /api/orders` (src/app/api/orders/route.ts:110-117): for CONFECTIONER/ADMIN/SUPER_ADMIN scopes `or(user_id.eq.<me>, confectioner_id.eq.<user.userId>)`; enrich maps orders.confectioner_id → confectioners by userId (fallback id). Since we assign `confectioners.userId` = auth.users id, **the assigned confectioner WILL see the order** — no mismatch. (Checkout :607-634 notification also targets the userId — consistent.)

## Gates / tests
- `bun run lint` ✅ clean; `bunx tsc --noEmit` ✅ clean.
- `bunx vitest run`: **66 files / 1164 tests passed** (incl. 10 new; ≥1154 required ✅).
- Live smoke against dev server (:3000, demo JWT + CSRF): 
  - A) custom item with userId UUID → 200, DB `orders.confectioner_id=11111111-1111-4111-8111-111111111102`, snapshot has `confectioner_id`;
  - B) `'c1'` → 200, confectioner_id=null + warn (no DB query);
  - C) unknown UUID → 200, confectioner_id=null + warn;
  - rows cleaned up afterwards; warns observed in dev.log lines 81/112.
