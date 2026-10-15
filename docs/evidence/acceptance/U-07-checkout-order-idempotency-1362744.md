# U-07 — Cart/checkout/order: create via API + DB assert + resubmit idempotency

**Status: PASS** (core assertions pass; two documented contract FINDINGS below — they are observations, not probe failures)

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:16–19:17
- Environment: live dev stack :3000, PG 127.0.0.1:54329/conditera. Route studied first: `src/app/api/checkout/route.ts`.

## Steps and commands

Probe: `node .run/acc/u07-u09.mjs` (exit 0; transcript `.run/acc/u07-u09-transcript.txt`).

1. Synthetic buyer registered via `POST /api/auth/register` → 201 (same flow as U-01; `acc-u07-<run>@conditera.test`, phone `+7999XXXXXXX`).
2. CSRF pair from `GET /api/csrf-token`.
3. Published product picked read-only from DB (price 2400 ₽, qty 1 → expected total = **2400**, pickup → delivery 0, no promo).
4. `POST /api/checkout` with `Idempotency-Key: acc-u07-<run>` + Bearer + CSRF pair, body `{cartItems:[{product_id, quantity:1}], deliveryType:"pickup", deliveryCity, customerName, customerPhone, paymentMethod:"card"}`.

## Observed results

| call | request | code | result |
|---|---|---|---|
| #1 create | with `Idempotency-Key` | **200** | `orderId` + `orderNumber` + `total=2400`, `isStub=true` (local payment stub) |
| DB assert | `orders` row by orderId | — | `status=PENDING`, `total=2400` = expected, `user_id` = synthetic user, `order_items` rows = 1 |
| #2 resubmit | identical body, **no** Idempotency-Key | **200** | **new** `orderId` (different from #1) → duplicate order created |
| #3 resubmit | identical body, **same** Idempotency-Key | **200** | **same** `orderId` as #1 (replay), no `isReplay` field in body |
| DB | orders of user with this `idempotency_key` | — | exactly **1** row (unique index 0060 + replay path hold) |

### FINDINGS (documented behavior, either way per acceptance plan)

1. **Checkout create returns 200, not 201.** `POST /api/checkout` success path ends with `NextResponse.json({...})` without status (default 200) — `src/app/api/checkout/route.ts:729-746`. Consistent for create and replay; clients must not rely on 201.
2. **Idempotency is opt-in.** Repeating the identical checkout **without** `Idempotency-Key` creates a second real order (200, new id). With the same key within the 15-minute window (and race-protected by unique index 0060) the existing order is replayed (200, same id). Documented for the owner: duplicate protection depends on clients sending the key.

## Cleanup (finally)

```
cleanup: ticket_messages=2 support_tickets=2
cleanup: capacity_reservations=0 loyalty_transactions=0 orders=2
cleanup: user_roles=1 profiles=1 auth.users=1 (synthetic acc-u07 deleted)
```
All rows created by the probe removed (orders cascade to order_items/payments/history); synthetic user fully deleted.

## Artifacts

- `.run/acc/u07-u09.mjs`, `.run/acc/u07-u09-transcript.txt` (redacted-safe)

---

FIX VERIFIED (v4.1) — Task B-1, base HEAD `0bcb79a`, date 2026-10-15 UTC.

Verdict: **client-only fix, server untouched**. Server mechanism is sound when the key is sent (15-min replay + unique index 0060 race guard — proven live by a 4× parallel probe); the duplicate came from clients: `useCreateOrder` sent no key at all, CheckoutPage's key was per-mount (regenerated on reload/remount → duplicate after a lost response + page reload). Server stays lenient (opt-in contract kept and locked by regression; "reject without key" is the owner's call — legitimate keyless callers exist).

Fix (payment/webhook/escrow/payout/refund/bonus-balance untouched — 0 diff there):
- NEW `src/lib/checkout-idempotency.ts` — stable Idempotency-Key per LOGICAL submission: key bound to a canonical body signature, kept in sessionStorage across remounts/reloads while the outcome is unknown (network error/5xx → retry replays same order); closed on known outcome (2xx success / 4xx rejected) so a deliberate repeat order gets a NEW key (no false replay).
- `src/components/pages/extra-pages.tsx` (CheckoutPage) — uses the helper; single outcome-resolution point.
- `src/lib/supabase/use-marketplace.ts` (useCreateOrder) — now sends the header per the same contract (was: no key at all).

Evidence: `docs/evidence/acceptance/U-07-fix-idempotency-0bcb79a.md` (chain trace file:line, verdict, diff stat, tests, live matrix). Regression: 20 vitest (14 helper + 6 hook-level, conventions of use-marketplace.fillings.test.ts); live integrator `scripts/verify/checkout-idempotency-verify.mjs` — PASS 15/15, exit 0: A same-key ×2 → same orderId, 1 row; B no-key ×2 → 2 rows (current opt-in contract documented, owner finding stands); C 4× parallel same-key → all 200, exactly 1 order (`[checkout] idempotency race resolved via unique index (0060)` in dev.log); D lost-response (request processed, response discarded) → retry returns the SAME orderId, 1 row. Full suite 48 files / 1003 tests exit 0; typecheck 0; lint 0; scan-evidence 0. Cleanup verified: 0 residual synthetic rows.
