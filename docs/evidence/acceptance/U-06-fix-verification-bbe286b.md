# U-06 fix verification — fillings end-to-end (Release Gate v4.1)

- **Task ID:** A-1c · **Date:** 2026-10-15 22:30 UTC
- **Base HEAD:** `bbe286b` (`bbe286bcf4dca71e277d0b2f488a9c853edb13b3`, main) · no push
- **Scope:** finish the interrupted U-06 fillings fix left uncommitted by a dead agent; review → complete → test → live-verify on real data → commit only the U-06 unit.
- **Related evidence:** `U-06-product-card-1362744.md` §7 (root cause) / §8 (FIX VERIFIED v4.1), `U-06-api-bbe286b-with-fillings.json` (predecessor API-level snapshot), screenshots `U-06-fixed-with-slice-bbe286b.png`, `U-06-fixed-negative-nofillings-bbe286b.png`.

## 1. Diff verdict (dead agent's work vs this session)

**What the dead agent had (uncommitted at `bbe286b`):**
- `src/app/api/products/[id]/route.ts` — `fillings` appended to `PRODUCT_CARD_COLUMNS` + explanatory comment. ✔ correct and minimal.
- `src/lib/supabase/use-marketplace.ts` — `ApiProduct.fillings?: { name: string; priceModifier?: number }[] | null` (interface exported for tests) + mapper block in `mapApiProductToProduct` (always-array normalization, string-name filter, `priceModifier` → finite number default 0). ✔ correct and minimal.
- 3 new hermetic test files (route / hook / gate component) asserting both directions (fillings present → data flows; empty → section absent / `[]`). ✔ follow repo conventions (`src/app/api/health/route.test.ts` style: docblock with regression context, hermetic `vi.mock`, Russian describe/it, no weakened assertions).
- Evidence JSON `U-06-api-bbe286b-with-fillings.json` (API-level proof) + a live DB leftover: synthetic slice `acc-u06-slice-v41` never cleaned up (caption «Срез: шоколадный ганаш (U-06 v4.1 fix verification)», created 22:17, minutes before this session).

**What I changed:**
1. `src/app/api/products/[id]/route.test.ts` — typing only: the supabase-builder mock was declared `Record<string, ReturnType<typeof vi.fn>> & Thenable`, which fails `tsc --noEmit` (index signature vs `then`). Replaced with an explicit `QueryBuilder` type (same shape, same behavior). **No test logic or assertions changed.** This was the only defect found.
2. Live DB: removed the predecessor's leftover synthetic row and inserted my own labeled synthetic slice for verification (both cleaned afterwards — §5).
3. Evidence docs + this file.

**Checks against the root cause (`worklog.md` Task 8-d):** `PRODUCT_CARD_COLUMNS` includes `fillings` ✔; `mapApiProductToProduct` maps it ✔; client hook carries `fillings` to `StoreProduct` ✔; jsonb → typed array consistent with `StoreProduct.fillings?: { name: string; priceModifier: number }[]` (`src/lib/types.ts:578`) ✔; **no unrelated changes** in the two modified files ✔ (only the `export` on `ApiProduct`, required by the hook test and documented in a comment).

## 2. Chain trace (file:line, working tree @ verification time)

```
products.fillings (jsonb, migration 0043)
 1. src/app/api/products/[id]/route.ts:51-56   PRODUCT_CARD_COLUMNS — «…, published_at, images, fillings»
 2. src/lib/supabase/use-marketplace.ts:838    ApiProduct.fillings?: { name; priceModifier? }[] | null  (interface exported)
 3. src/lib/supabase/use-marketplace.ts:891    export function mapApiProductToProduct
 4. src/lib/supabase/use-marketplace.ts:963-980  fillings: Array.isArray ? filter(name:string).map(priceModifier→number) : []
    → StoreProduct.fillings (src/lib/types.ts:578) — always array, never undefined
 5. src/components/pages/product-page.tsx:1142  gate: product.fillings && product.fillings.length > 0 → ProductSliceGallery
 6. src/components/cake-slice/cake-slice-visualizer.tsx:809  fetch(`/api/products/${productId}/slices`)
 7. src/components/cake-slice/cake-slice-visualizer.tsx:823  slices.find(s => s.fillingName === filling.name)
 8. src/components/cake-slice/cake-slice-visualizer.tsx:895-896  <img src={fw.slice.image} alt={fw.name}>
 (route serving slices: src/app/api/products/[id]/slices/route.ts:57-85 — select *, order sortOrder/createdAt)
```

## 3. Diff stat (U-06 unit as committed)

```
 src/app/api/products/[id]/route.ts                        |  7 +++++--
 src/lib/supabase/use-marketplace.ts                       | 29 +++++++++++++++++++++++++-
 2 files changed, 33 insertions(+), 3 deletions(-)

 new file:   src/app/api/products/[id]/route.test.ts                       (178 lines)
 new file:   src/components/pages/product-page.fillings-gate.test.tsx      (199 lines)
 new file:   src/lib/supabase/use-marketplace.fillings.test.ts             (102 lines)
 new file:   docs/evidence/acceptance/U-06-api-bbe286b-with-fillings.json
 new file:   docs/evidence/acceptance/U-06-fixed-with-slice-bbe286b.png
 new file:   docs/evidence/acceptance/U-06-fixed-negative-nofillings-bbe286b.png
 new file:   docs/evidence/acceptance/U-06-product-card-1362744.md (updated, append-only §8)
 new file:   docs/evidence/acceptance/U-06-fix-verification-bbe286b.md (this file)
```

NOT committed (belongs to task A-2, left in working tree): `src/lib/postgrest/translate.ts`, `src/lib/postgrest/translate.test.ts`, `src/app/api/crm/tickets/route.test.ts`. Scratch scripts in `.run/` are gitignored.

## 4. Test results

Command (repo convention, `package.json` → `"test": "vitest run"`):

```
bun run test -- "src/app/api/products/[id]/route.test.ts" \
                "src/components/pages/product-page.fillings-gate.test.tsx" \
                "src/lib/supabase/use-marketplace.fillings.test.ts"
```

```
 ✓ src/components/pages/product-page.fillings-gate.test.tsx (3 tests)
 ✓ src/app/api/products/[id]/route.test.ts (5 tests)
 ✓ src/lib/supabase/use-marketplace.fillings.test.ts (6 tests)
 Test Files  3 passed (3)     Tests  14 passed (14)
EXIT=0
```

`bun run typecheck` (tsc --noEmit): **exit 0** (after the §1 typing fix; failed with 1 error before it).

Both contract directions asserted per file: present → flows through (jsonb in API response / section + `<img>` / `StoreProduct.fillings` populated); empty → absent/normalized (`[]` + no `/slices` fetch for the gate; `[]` for null/missing/garbage jsonb). No weakened assertions (e.g., hook test pins exact `toEqual` values incl. `priceModifier` coercion; component test asserts the negative fetch-absence, not just missing text).

## 5. Live verification (REAL data through the REAL source)

Environment: PG :54329 (db `conditera`), dev server :3000 (live), agent-browser (headless Chromium).

### 5.1 Data staging (task step 4b)

- Product `aaaaaaaa-0000-4000-8000-00000000000b` («Порционные десерты (20 шт.)», published): `fillings = [{"name":"Шоколад-ганаш","priceModifier":300},{"name":"Малина-базилик","priceModifier":0}]` — already contains a matching filling name, so **`products.fillings` was NOT modified** (backup taken anyway → `.run/u06-fillings-backup.json`).
- Pre-state of `product_slices` for `…000b`: 1 row — the dead agent's leftover `acc-u06-slice-v41` (same synthetic U-06 v4.1 chain, never cleaned).
- Inserted synthetic slice **`acc-u06-v41`**: `fillingName="Шоколад-ганаш"`, `image="/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-00000000f001"` (existing approved cover f001 — **no files created**), `caption="СРЕЗ-ЗАГЛУШКА (synthetic, U-06 v4.1 task A-1c live proof)"`, `sortOrder=999`, `updatedAt=now()` (column NOT NULL, no default — set explicitly). Post-insert count: 2.

### 5.2 API (the real source, `curl` → :3000)

- `GET /api/products/…000b` → `product.fillings = [{Шоколад-ганаш,300},{Малина-базилик,0}]` (§7 symptom «ответ не содержит fillings» gone); `slices[]` contains both rows.
- `GET /api/products/…0001` (negative candidate) → `fillings: []`.

### 5.3 Browser DOM facts (positive, `/product?id=…000b`)

```
heading      : «Срезы торта по начинкам» (h3 inside Card div.bg-card.text-card-foreground)
slice img    : <img src="/api/product-media/…f001" alt="Шоколад-ганаш"> naturalWidth=1024 naturalHeight=1024
img location : inside the SAME Card as the heading (div.grid.grid-cols-2 thumbnails → button → div.aspect-square → img)
filling chips: «Шоколад-ганаш +300 ₽», «Малина-базилик» (customization selectors read the mapped fillings)
screenshot   : docs/evidence/acceptance/U-06-fixed-with-slice-bbe286b.png (full page)
```

### 5.4 Browser DOM facts (negative, `/product?id=…0001`, fillings `[]`)

```
h1                : «Свадебный торт «Ягодный бархат»»
sectionPresent    : false   («Срезы торта по начинкам» not in body text)
ganashPresent     : false
slice imgs (alt)  : 0
screenshot        : docs/evidence/acceptance/U-06-fixed-negative-nofillings-bbe286b.png (full page)
```

## 6. Cleanup proof (finally-block semantics)

```
DELETED_MINE:        []   (acc-u06-v41 — deleted on the first cleanup run; second run idempotent, 0 rows)
DELETED_LEFTOVER:    []   (acc-u06-slice-v41 — dead-agent leftover, deleted on the first cleanup run)
FILLINGS_RESTORED:   [{"name": "Шоколад-ганаш", "priceModifier": 300}, {"name": "Малина-базилик", "priceModifier": 0}]
FILLINGS_MATCH_BACKUP: true (byte-identical to pre-verification backup)
SLICES_FINAL:        []   → product_slices for …000b back to 0 rows
```

- First cleanup run deleted both synthetic rows, then failed on `products."updatedAt"` (products uses snake_case `updated_at`; `product_slices` uses camelCase — naming is inconsistent across tables). Fixed the scratch script and re-ran: deletes idempotent (0 rows), fillings restore + verification completed; proof in `.run/u06-cleanup-proof.json`.
- Note on counts: count before **my** intervention was 1 (the predecessor's leftover); final is 0 because the leftover belonged to the same synthetic U-06 v4.1 chain (id family `acc-u06-*`, synthetic caption, inserted 22:17 by the interrupted run) and the pre-chain baseline (verified by Task 8-d cleanup, §7.5) is 0 rows.
- `products.fillings` restored to the exact backed-up value per task protocol. Residual note (documented, out of scope): that value itself predates this session (present at probe time; not from `supabase/seed_vitrine.sql`, which contains no `Шоколад-ганаш`) — it matches the dead predecessor's §7-attempt-2 shape. A filling without a matching slice renders the documented SVG-fallback path (component test 3), so the state is coherent.
- Browser closed; no other tables touched; server/PG not restarted.
