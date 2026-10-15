# U-02 — Roles/RBAC: existing vitest suites fresh run + live negative

**Status: PASS**

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:13–19:15 (vitest), 19:17 (live negative)
- Environment: vitest (mocked pool), live dev stack :3000 for the negative probe.

## Existing RBAC vitest files found

Search: `grep -rl "403" src/app/api --include=*.test.ts` plus broader `roles|CONFECTIONER|SUPPORT|forbidden` scan over `src/**/*.test.ts`. Most relevant files:

| test file | scope | fresh run result | exit |
|---|---|---|---|
| `src/lib/role-guards.test.ts` | role guard matrix (24 tests) | **24/24 passed** | 0 |
| `src/app/api/orders/[id]/route.test.ts` | order GET/PATCH scope per role (401/403/404/200, courier-scope, admin/support) | **12/12 passed** | 0 |
| `src/lib/ai-dialogue-access.test.ts` | dialogue access checks (7 tests) | **7/7 passed** | 0 |

Commands: `bun run test -- src/lib/role-guards.test.ts` etc. (vitest 4.1.10).

## Live negative (read-only, no rows created)

Foreign-buyer probe against a synthetic order created by the U-07/U-08/U-09 session (synthetic user `acc-u07-<run>@conditera.test`; the demo account `customer@demo.ru` was used read-only as the foreign buyer):

- `POST /api/auth/login` as seeded demo buyer → 200 (token)
- `GET /api/orders/<synthetic order id owned by the synthetic user>` with buyer token → **403**
  - error body class: `{"error":"Нет доступа к этому заказу"}` (static route text; matches `src/app/api/orders/[id]/route.ts` GET isOwner/isConfectioner/isPrivileged/isCourierAssigned gate)

Additional live role-gate negatives observed in the same session (documented in U-10): PATCH status transition with wrong role → **403** «Роль CUSTOMER не может менять статус…»; invalid transition → **400**.

## Result

All RBAC suites green (43/43 across 3 files); live cross-user order read denied with 403 per contract.

## Artifacts

- `.run/acc/u07-u09-transcript.txt` (contains the `u02:` negative probe lines)
- vitest console outputs (session log)
