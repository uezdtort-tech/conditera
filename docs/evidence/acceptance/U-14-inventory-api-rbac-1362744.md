# U-14 — Inventory API RBAC (`GET /api/inventory/items`)

**Status: PASS** (documented contract: owner-scoped, not role-403)

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:22–19:24
- Route: `src/app/api/inventory/items/route.ts` (worklog Task 4-a: GET is owner-scoped via `owner_id = user.id`; no role whitelist by design).

## Live probes (minted HS256 probe tokens, roles from DB — server truth; read-only)

| caller | request | code | observed |
|---|---|---|---|
| CONFECTIONER (`confectioner@demo.ru`, roles `["CONFECTIONER","CUSTOMER"]`) | `GET /api/inventory/items` | **200** | `{items:[12]}` — the 12 seeded items owned by this confectioner (seed 0003); row keys `id,owner_id,name,category,quantity,unit,min_quantity,cost_per_unit` |
| CUSTOMER (`customer@demo.ru`, roles `["CUSTOMER"]`) | `GET /api/inventory/items` | **200** | `{items:[]}` — owner scope returns own (empty) set; **not** 403 |
| anonymous | `GET /api/inventory/items` | **401** | `unauthorizedResponse()` |

### Documented contract (per task option "or documented contract")

The endpoint is **owner-scoped, not role-gated**: every authenticated caller gets 200 with only their own `inventory_items` (buyer → empty list). A buyer therefore cannot read anyone's inventory data (isolation is by ownership, matching the route implementation and worklog Task 4-a contract: «GET (owner-скоуп…)»). Cross-owner writes are separately guarded (403/404 in POST/PATCH/DELETE — covered by worklog 4-a curl verification; not re-tested here to keep this probe read-only).

## Result

Confectioner sees own 12 items (200); buyer sees own empty set (200, no data leak); anonymous denied (401).

## Artifacts

- `.run/acc/u09-u10-u14.mjs`, `.run/acc/u09-u10-u14-transcript.txt` (gitignored)
