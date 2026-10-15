# U-10 — Confectioner cabinet: RBAC list scope + status transition contract

**Status: PASS**

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:22–19:26
- Environment: live dev stack :3000. Endpoints: `GET /api/orders`, `PATCH /api/orders/[id]`.

## Existing vitest coverage (run fresh, cited)

`src/app/api/orders/[id]/route.test.ts` — **12/12 passed**, exit 0 (`bun run test -- "src/app/api/orders/[id]/route.test.ts"`): 401 anon, 404 missing, 200 owner CUSTOMER / confectioner / assigned courier / ADMIN / SUPPORT, 403 foreign confectioner / unassigned courier / outsider, courier-scope regressions. Also `src/lib/role-guards.test.ts` 24/24 (see U-02).

## Live probes (minted HS256 probe token for `confectioner@demo.ru`, roles from DB `["CONFECTIONER","CUSTOMER"]`; CSRF pair used for PATCH)

1. **List scope** — `GET /api/orders` as CONFECTIONER → **200**, shape `{orders:[...]}`; returned the assigned order (`confectioner_id` == confectioner id, status CONFIRMED, seeded demo order DEMO-1048) and nothing out of scope. Contract per `src/app/api/orders/route.ts:94-107`: performer sees `user_id.eq.X OR confectioner_id.eq.X`.
   - Probe note: a first combined run logged "0 orders" — probe-side bug (empty roles array in the minted token due to a typo fallback); focused re-run with correct roles returned the assigned order. App behavior correct.
2. **Invalid status transition** — `PATCH /api/orders/<assigned order>` body `{status:"DELIVERED"}` from `PENDING` (synthetic confectioner-assigned order in the combined run) → **400** `{"error":"Запрещённый переход: PENDING → DELIVERED"}` (STATUS_TRANSITIONS table in `src/app/api/orders/[id]/route.ts:31-38`).
3. **Valid transition, wrong role** — `PATCH /api/orders/<CONFIRMED assigned order>` body `{status:"PREPARING"}` as CUSTOMER → **403** `{"error":"Роль CUSTOMER не может менять статус CONFIRMED → PREPARING"}`.
4. **No mutation on rejects** — DB status unchanged after both rejects (`statusAfter === statusBefore`, verified by direct SELECT).

## Result

Confectioner token lists only own/assigned orders; invalid transitions rejected 400; wrong-role transitions rejected 403; state untouched on rejects. Existing vitest suite green.

## Artifacts

- `.run/acc/u09-u10-u14-transcript.txt`, `.run/acc/diag-orders.mjs` transcript output (session log; gitignored)
