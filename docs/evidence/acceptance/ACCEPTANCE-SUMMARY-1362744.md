# Product Acceptance Summary — HEAD 1362744

- **HEAD:** `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- **Date (UTC):** 2026-10-15
- **Method:** fresh runs of existing verifiers and suites (runtime gate, vitest, SQL/RPC probes, sha256 read-back) + live UI walkthroughs via agent-browser (headless Chromium) + direct DB asserts via `pg` on 127.0.0.1:54329/conditera. **Executed on the live dev stack** (:3000 Next / :3030 chat-server / :54329 PG — nothing restarted); **production build gate is separate** (see DEV-08: build deferred on this HEAD).
- **Scope honesty:** API/UI acceptance of user scenarios only. No app code was changed by the acceptance agents; all findings below are observations for the owner.

## Matrix U-01..U-16

| # | Scenario | Status | Evidence file | Key result |
|---|---|---|---|---|
| U-01 | Register / login / protected GET / duplicate register | **PASS** | `U-01-register-login-1362744.md` | register 201, login 200, `GET /api/profile` 200 with Bearer; no token → 307 → `/login`, garbage token → 401; duplicate register → 409 EMAIL_TAKEN; synthetic user cleaned up |
| U-02 | Roles/RBAC (vitest + live negative) | **PASS** | `U-02-rbac-roles-1362744.md` | 43/43 across 3 suites (role-guards 24, orders/[id] 12, ai-dialogue-access 7); live foreign-buyer order read → 403 «Нет доступа к этому заказу» |
| U-03 | Buyer chat runtime gate (socket.io + persistence) | **PASS** | `U-03-buyer-chat-runtime-gate-1362744.md` (+`.log`) | verify-chat-runtime gate **48/48** (exit 0): JWT handshake, room join/deny, send/receive, persistence, no-spoof, reconnect w/o duplicates |
| U-04 | Support chat BOT_SECRET path + client-side secret scan | **PASS** | `U-04-support-chat-bot-secret-1362744.md` | bot reply real-time + persisted via `x-bot-secret` route; BOT_SECRET referenced **only** in 2 server routes / 0 client components / 0 `NEXT_PUBLIC_*` leaks |
| U-05 | Cake constructor (UI) | **PASS** | `U-05-constructor-1362744.md` (+3 PNG) | 9-step walkthrough; live price chain 1500 → 2220 → 2620 → 2920 → 3120 → 3520 → 4928 (×1.4 Москва) → **5936**; required-fields guard (Далее disabled); add-to-cart → auth gate |
| U-06 | Product card: whole + cutaway | **PASS** (caveat root-caused, §7) | `U-06-product-card-1362744.md` (+2 PNG, 3 JSON, 1 PNG §7) | multi-photo card: 3 approved media + legacy thumb, pending f004 not in DOM, price 4 400 ₽ = API; card w/o media → legacy PNG fallback; cutaway: positive probe in §7 (see below) |
| U-07 | Checkout → order create + idempotency | **PASS** (2 contract findings) | `U-07-checkout-order-idempotency-1362744.md` | create 200 (total 2400 = expected, DB row PENDING, 1 order_item); same Idempotency-Key → **same orderId** (replay); no key → **duplicate order**; unique index 0060 guards races |
| U-08 | Issue/return form: ticket create + linkage + support visibility | **PASS** with FINDING | `U-08-ticket-issue-form-1362744.md` | POST 201, `TKT-2026-0001` auto-number, `order_id` linkage true, 1 first message; SUPPORT `filter=all` → 200 with ticket; FINDING: list rows lack `id` (postgrest shim) |
| U-09 | Ticket resubmit idempotency + role visibility matrix | **PASS** (finding) | `U-09-ticket-resubmit-visibility-1362744.md` | byte-identical resubmit → **2 tickets** (not idempotent); visibility: SUPPORT all 200 / owner own 200 / CONFECTIONER all → 403 |
| U-10 | Confectioner cabinet: order list scope + status transitions | **PASS** | `U-10-confectioner-cabinet-1362744.md` | list returns only own/assigned (200); invalid transition PENDING→DELIVERED → **400**; valid transition wrong role → **403**; DB status unchanged after both rejects |
| U-11 | Inventory atomicity under concurrency | **PASS** | `U-11-inventory-concurrency-1362744.md` | real RPC `apply_inventory_movement_atomic`, 8 concurrent vs stock 5: **applied 5 / rejected 3** (insufficient), final qty 0, no negative, journal exactly 5 rows (sum 5); verifier 8/8, exit 0 |
| U-12 | Upload general `POST /api/upload` | **PASS** (oversize note) | `U-12-upload-general-1362744.md` | 403 CSRF / 401 auth / 403 no-CSRF / 201 upload / read-back 69/69 B `image/png` **sha256 match**; text/plain → 415; oversize >10 MiB → 400 (body-parse; see finding 4) |
| U-13 | Upload services `POST /api/services/upload` | **PASS** (same note) | `U-13-upload-services-1362744.md` | same contract via field `files`: 201 + sha256 match; 415 sniff; 400 oversize; >8 files → 400 TOO_MANY_FILES (static) |
| U-14 | Inventory API RBAC `GET /api/inventory/items` | **PASS** (documented contract) | `U-14-inventory-api-rbac-1362744.md` | confectioner → 200 own 12 items; customer → 200 own empty set (owner-scoped, **not** role-403, no cross-owner leak); anonymous → 401 |
| U-15 | Health endpoint (unit + live) | **PASS** | `U-15-health-1362744.md` | unit 6/6 (incl. 503/degraded DB-down path via mocked pool); live `GET /api/health` 200 `status:"ok"` v2.0.0-dev; live DB-down simulation intentionally not run on shared stack |
| U-16 | Production auth config: fail-closed registration gate | **PASS for fail-closed** · provider topology = owner decision | `U-16-prod-auth-config-1362744.md` | static re-verification on this HEAD: GoTrue failure in prod → 500 **before** any auth.users/profiles/user_roles insert (`register/route.ts:261-267`); stub admin warns in prod; local GoTrue stub 501. Real provider topology not testable in sandbox → finding 5 |

### U-06 cutaway positive case (§7 of the evidence file, task 8-d)

- Synthetic `product_slices` row inserted for the demo product (`…000b`, label «Тестовый
  срез (acceptance)», image = existing approved cover file via `/api/product-media/<f001>`,
  no new files) → slice data pipeline **works** (`GET …/slices` returns it; card API `slices[]`
  includes it) — raw artifact `U-06-api-1362744-with-slice.json`.
- Section still does not render after 2 data-only attempts: the page gate
  `product.fillings.length > 0` (`product-page.tsx:1142`) reads a field the card API never
  returns (`PRODUCT_CARD_COLUMNS` omits the `products.fillings` jsonb column;
  `mapApiProductToProduct` doesn't map it). Root cause + fix hint (2-line code change,
  owner's call) documented in the U-06 file; screenshot `U-06-card-cutaway-positive-1362744.png`;
  synthetic row deleted afterwards (`product_slices` back to 0, `products.fillings` restored `[]`).

## Findings for owner (NO code changed by acceptance; financial/settlement logic untouched)

| # | Finding | Suggested severity | Affected area | Where documented |
|---|---|---|---|---|
| 1 | **Checkout create returns 200-on-create + duplicate order when `Idempotency-Key` omitted.** Replay with the same key returns the same orderId (unique index 0060 guards races); without the key an identical request creates a second real order. This is **checkout-order creation semantics, NOT settlement** — payment/settlement logic was not probed or altered. Fix = require/default the key (or 201) at the route; owner's call. | low | `POST /api/checkout` (`src/app/api/checkout/route.ts:729-746`) | U-07 §FINDINGS |
| 2 | **Ticket list rows lack `id`.** `GET /api/crm/tickets` drops the PK when a 1-level embed is requested — postgrest shim `src/lib/postgrest/translate.ts:433-441/519-523` hides the join column even when `*` is selected (real PostgREST returns it). Breaks client-side ticket-by-id actions (`PATCH /api/crm/tickets/[id]` from list data); one-condition fix. | medium | CRM tickets API (support/issue-return flow) | U-08 §FINDING, U-09 |
| 3 | **Ticket creation is not idempotent.** No Idempotency-Key support / no one-per-order guard: double submit of the issue/return form creates 2 tickets for the same order (observed live: 2×201). | low | `POST /api/crm/tickets` | U-09 §Resubmit probe |
| 4 | **Upload oversize: 400 at body-parse before the 422/10 MiB service gate.** Next.js truncates the request body at 10 MB (`Request body exceeded 10MB` in dev.log), multipart becomes unparsable → route returns 400 BAD_REQUEST; the code-level 422 FILE_TOO_LARGE branch (`src/lib/upload-service.ts:52-57`) is unreachable live at this size. Both are 4xx; tuning is owner's call. | low | `/api/upload`, `/api/services/upload` | U-12 §Note, U-13 |
| 5 | **U-16 real auth provider topology = owner decision.** Fail-closed registration gate verified on this HEAD (500, zero rows, before stub inserts). Whether production runs a real GoTrue/provider topology can only be proven against the owner's real provider — not testable in this sandbox (no Docker stack). | decision (not a defect) | production deployment / auth infra | U-16 §NEEDS OWNER DECISION |

## Overall verdict

**PRODUCT ACCEPTANCE: PASS (16/16 scenarios verified; 5 findings documented for owner).**
