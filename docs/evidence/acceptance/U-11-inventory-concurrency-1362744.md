# U-11 — Inventory atomicity under concurrency (real RPC, race-safe contract)

**Status: PASS**

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:20
- Environment: PG 127.0.0.1:54329/conditera (direct, DB-level; no HTTP involved — the app's only stock-decrement path is the RPC below).

## Background / reuse

`scripts/verify/inventory-concurrency-verify.mjs` (untracked worktree file left by an earlier attempt) was inspected before running: it does **not** re-implement logic — it calls the app's real stock-decrement RPC `public.apply_inventory_movement_atomic` (migration `0048_inventory_atomic_movement.sql`: `SELECT … FOR UPDATE` → guard «OUT ≥ 0» → UPDATE → INSERT journal; signature verified against `supabase/migrations/0048*.sql`), creates a synthetic fixture (`inventory_items` row, owner = existing demo confectioner profile, FK-safe), and cleans up in `finally`. No bugs found; **no fixes required**; file left untracked at `scripts/verify/inventory-concurrency-verify.mjs` for the orchestrator to commit.

## Command and exit code

```
node scripts/verify/inventory-concurrency-verify.mjs   → exit 0
```

## Observed results (8 concurrent decrements vs stock=5, step 1)

```
PASS RPC apply_inventory_movement_atomic существует (0048)
PASS успешных списаний ровно 5 (из 8 параллельных) — applied=5, codes=applied×5,insufficient×3
PASS отказов insufficient ровно 3 — rejected=3
PASS нет ошибок клиента/сервера (все вызовы дошли до RPC) — other=[]
PASS финальный остаток = 0
PASS отрицательного остатка нет
PASS журнал inventory_movements: ровно 5 строк (отказы не журналируются)
PASS сумма списаний в журнале = 5 (нет lost update)
SUMMARY: 8/8 passed
U-11 VERDICT: PASS
```

Key numbers: concurrency **8**, applied **5**, rejected **3** (code `insufficient`), final qty **0**, no negative values, journal exactly **5** rows with sum **5**.

## Cleanup (finally, executed)

```
cleanup: inventory_movements deleted=5, inventory_items deleted=1 (synthetic acc-u11)
```

## Artifacts

- `scripts/verify/inventory-concurrency-verify.mjs` (untracked; orchestrator commits)
- session transcript (full PASS log above embedded verbatim)
