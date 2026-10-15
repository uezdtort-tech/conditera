# U-09 — Issue/return form: resubmit idempotency + role visibility matrix

**Status: PASS** (behaviors documented; idempotency finding — observation, not failure)

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:17 (resubmit), 19:22–19:24 (visibility matrix)
- Route: `src/app/api/crm/tickets/route.ts`.

## Resubmit probe (identical POST body, same buyer, same CSRF pair)

- First `POST /api/crm/tickets` → **201** (`TKT-2026-0001`).
- Resubmit of the byte-identical request → **201**, second `ticket.id` issued (`6f8b1ef4-…`), both rows in DB.

**FINDING:** ticket creation is **not idempotent** — no Idempotency-Key support, no client/one-per-order guard; an accidental double-submit of the issue/return form creates two tickets for the same order. Documented as behavior (per acceptance plan this is a finding either way). Cleanup removed both (transcript: `support_tickets=2`).

## Visibility matrix (live, tokens: API-issued for the synthetic buyer; minted HS256 probe tokens for demo roles with roles taken from DB — server truth)

| caller (roles from DB) | request | code | observed |
|---|---|---|---|
| SUPPORT (`support@demo.ru`) | `GET /api/crm/tickets?filter=all` | **200** | ticket present (by `number`), `order_id` linkage correct, messages embedded; row lacks `id` (see U-08 FINDING) |
| ticket owner (synthetic buyer) | `GET /api/crm/tickets?filter=own` | **200** | ticket present (count=1); row lacks `id` |
| CONFECTIONER (`confectioner@demo.ru`) | `GET /api/crm/tickets?filter=all` | **403** | contract per route: only ADMIN/SUPER_ADMIN/SUPPORT/MODERATOR may list all |

Note: an intermediate diagnostic run recorded `filter=all` as 200-but-"not found" and one 401; both were probe artifacts (response rows lack `id` → match-by-id failed; one login hit the 20/hour IP rate limit → 401 on empty token). Re-probe above used match-by-`number` + minted tokens; conclusion unchanged.

## Result

Support sees the order-linked ticket; confectioner role is denied the all-tickets list per contract; owner sees own ticket; resubmit duplicates (documented).

## Cleanup

All synthetic rows removed in finally (tickets, messages, orders, user rows) — rowcounts in transcripts.

## Artifacts

- `.run/acc/u07-u09.mjs` / `.run/acc/diag-tickets.mjs` / `.run/acc/u09-u10-u14.mjs` + transcripts (all under gitignored `.run/acc/`)
