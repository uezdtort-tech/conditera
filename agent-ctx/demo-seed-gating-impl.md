# Task: demo-seed-gating — production-safe gating of demo/mock seed data

Agent: implementation (Conditera). Base HEAD: a0b0d2a12bc18ca4e220b7a2a89e78fcffe9e953 (clean, except pre-existing untracked agent-ctx/*).

## Changed files

| File | Change |
|---|---|
| `src/lib/demo-seed.ts` | NEW — `isDemoSeedEnabled()` / `DEMO_SEED_ENABLED` / `demoSeed<T>(mock: T[]): T[]` |
| `src/lib/demo-seed.test.ts` | NEW — 5 vitest cases (vi.stubEnv: dev keeps mock; test≈dev; prod→[]; prod+NEXT_PUBLIC_DEMO_SEED='true'→mock; strict 'true' compare) |
| `src/lib/store.ts` | `import { demoSeed } from "./demo-seed"` (line 109); all array mock seeds wrapped in initial state; NO shape/action changes |
| `src/components/layout/notifications-bell.tsx` | polling gated on auth (see below) |

## Gating applied (store.ts, file:line after edit)

- :552 `chatRooms: demoSeed(MOCK_CHAT_ROOMS)`, :553 `chatMessages`
- :570 `confectioners`, :571 `couriers`, :572 `products`
- :661 `orders`, :662 `channelPosts`, :663 `channelStories`, :664 `channelFollowers`, :665 `inquiries`, :666 `teamTasks`
- :668 `promotions`, :669 `venues`, :670 `venueServices`, :671 `venueVendors`, :673 `recipes`, :674 `inventory`, :675 `stockMovements`, :676 `ganttTasks`, :677 `reminders`
- :681 `corporateEvents`, :682 `blacklist`, :683 `semaphores` (composite spread wrapped whole)
- :687 `decorShops`, :688 `decorProducts`, :689 `bundles`, :690 `serviceShops`, :691 `serviceProducts`, :692 `userHolidays`, :693 `giftCertificates`, :696 `videoReviews`
- :700 `cmsPages`, :701 `cmsBlocks`, :702 `banners`, :704 `navMenu`, :705 `reviewsModeration`, :706 `negotiations`

Contract: dev/test keep mocks (vitest NODE_ENV='test' ≈ development so store.test.ts stays valid — documented in demo-seed.ts header); production → empty arrays unless `NEXT_PUBLIC_DEMO_SEED === 'true'` (staging/demo opt-in). Env choice: NEXT_PUBLIC_ prefix required because store is client-side ('use client' confirmed).

## Deliberately left ungated (with reason)

- `fillings: FILLINGS_SEED` (:672) — static reference dictionary (ingredient catalog for cake builder), not fake account/catalog records.
- `referral: MOCK_REFERRAL` (:695) — singleton object, not an array; gating would change store shape (task forbids shape changes).
- `courierTracking: MOCK_COURIER_TRACKING` (:698) — singleton object (tsc caught it: `CourierTracking`, not an array); reverted to ungated.
- `siteSettings: MOCK_SITE_SETTINGS` (:703) — singleton settings object consumed by render everywhere; emptying breaks shape/render.
- Hydrators (`live-products-hydrator.tsx`, `live-decor-hydrator.tsx`, `live-services-hydrator.tsx`) — inspected via grep: NO mock fallbacks; they only push live rows when API returns non-empty (setters guard empty). Honest states already. Untouched.
- Persist `partialize` (store.ts:2133) — keeps `chatMessages` (last 500) by design (chat history); mock chat rows could survive in a localStorage that first visited a demo deploy. Out of scope per "initial values only"; noted for a future storage-key bump.

## notifications-bell.tsx

- Auth source: `useAppStore((s) => s.user)` (store hydrates from `/api/auth/session` via SupabaseAuthSync + persist; reactive on SPA login/logout). Bell previously polled unconditionally → 401×N for guests.
- `pollEnabled = !!user && !sessionExpired`; poll effect skips+clears when disabled; `401` response sets `sessionExpired=true` (self-healing stop for expired tokens); new `user` resets it. `loadNotifications` wrapped in `useCallback` for hook deps.

## Verification

- `bunx vitest run src/lib/demo-seed.test.ts src/lib/store.test.ts` → 24/24 passed (5 new + 19 existing).
- `bun run lint` → clean. `bunx tsc --noEmit` → 0 errors.
- Homepage `GET /` → 200, dev.log shows API routes compiling/serving normally.
