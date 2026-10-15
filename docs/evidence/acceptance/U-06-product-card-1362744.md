# U-06 — Product card: whole + cutaway (UI acceptance)

- **Date:** 2026-10-15, agent session (task 8-c)
- **HEAD short:** `1362744`
- **Live server:** http://127.0.0.1:3000 (pre-existing dev server, not restarted)
- **Tool:** agent-browser (headless Chromium), viewport 1440×900; DB read via `pg` on 127.0.0.1:54329/conditera (read-only SELECT)
- **Status: PASS** (with an honest DB-state caveat, see §2; the caveat was re-probed and
  precisely root-caused in §7 «Positive case (added later)» — task 8-d: the dedicated
  «Срезы» section is data-unreachable without a code change, evidence attached)

## 1. How product images are seeded

- `scripts/db/seed-product-media.mjs` (read in full): seeds demo product №1
  (`slug LIKE 'deserty-portSIONnyye-20'`) with **3 approved photos** (sort_order 10/20/30,
  first = `is_cover`) into `product_media` + copies PNGs to
  `storage/products/<productId>/published/photos/`; plus 1 **pending** photo (sort_order 40)
  intended for the moderation queue; second published product is picked "без медиа".
- Media source of truth in DB (checked via information_schema + SELECT):
  - `product_media` (id, product_id, media_type 'photo'|'video', storage_path, status, is_cover, sort_order…)
  - `product_slices` (id, productId, fillingName, image, config, caption, sortOrder) — **0 rows** (checked)
  - `products.fillings` (jsonb) — **empty (`[]`) for every product** (checked)
  - legacy `products.images` text[] — all seeded products have 1 legacy PNG
- Public API `GET /api/products/[id]` (`src/app/api/products/[id]/route.ts`): returns
  `product.media` = approved product_media only (cover first), `product.images` = media ∪ legacy ∪ uploads (deduped), `slices` = product_slices.

### Products picked

| Role | id | slug | title | media (approved) | images merged |
|---|---|---|---|---|---|
| **WITH cutaway/multi-photo** | `aaaaaaaa-0000-4000-8000-00000000000b` | deserty-portSIONnyye-20 | Порционные десерты (20 шт.) | 3 (f001 cover + f002 + f003; f004 pending — не должен показываться) | 4 |
| **WITHOUT cutaway** | `aaaaaaaa-0000-4000-8000-000000000001` | svadebnyy-tort-yagodnyy-barhat | Свадебный торт «Ягодный бархат» | 0 | 1 (legacy PNG) |

## 2. Caveat (honest DB state)

A dedicated "cutaway" (срез/разрез) in this codebase = `product_slices` rows (фото разреза,
рендерится секцией «Срезы торта по начинкам» / `ProductSliceGallery`, показывается при
`product.fillings.length > 0`). In the current DB **product_slices is empty and
products.fillings is empty for all products**, therefore no product carries a true seeded
cutaway photo. The scenario was executed against the closest real state: the seeded demo
product with the whole-product cover + 2 additional approved views (multi-photo gallery),
and a product without any product_media (single legacy image). The cutaway section itself
is verified as **gracefully absent** (no broken images, no empty box) on both cards.

## 3. Browser assertions

### WITH (`/product?id=aaaaaaaa-0000-4000-8000-00000000000b`)

- `h1` = «Порционные десерты (20 шт.)»; final URL `http://127.0.0.1:3000/product?id=aaaaaaaa-0000-4000-8000-00000000000b`.
- Gallery (`ProductMediaGallery`): main `<img src="/api/product-media/…f001">` (cover) +
  thumbnail row `[role=listbox]` with **4 options** (f001 «Главное» badge, f002, f003, legacy
  `/uploads/products/deserty-portionnyye-20.png`).
- **Image count:** main 1 + thumbnails 4; **every gallery img loaded OK** (`complete && naturalWidth > 0`, zero broken).
- **Pending media f004 does NOT render** anywhere in DOM (moderation filter works).
- Click on thumbnail #2 → main image switches to `…f002` (gallery navigation works).
- Price shown: **«4 400 ₽»** + JSON-LD `offers.price = 4400` — matches API `price: 4400`. ✓
- «Срезы торта по начинкам» section: absent (fillings empty) — graceful, no artifacts.
- Screenshot: `U-06-card-1362744-with-cutaway-gallery.png` (после переключения на 2-е фото).

### WITHOUT (`/product?id=aaaaaaaa-0000-4000-8000-000000000001`)

- `h1` = «Свадебный торт «Ягодный бархат»»; final URL `http://127.0.0.1:3000/product?id=aaaaaaaa-0000-4000-8000-000000000001`.
- Gallery: **single** main `<img src="/uploads/products/svadebnyy-tort-yagodnyy-barhat.png">`
  (legacy `products.images`), loaded OK (`naturalWidth > 0`); **thumbnail row not rendered**
  (`count > 1` condition) — 0 thumbnails.
- **No broken img icon**: 0 imgs with `naturalWidth === 0` on the page; the "Фото появятся
  после модерации" empty-state (`[role=status]`, `ImageOff`) is correctly NOT shown because
  a legacy image exists — the legacy image is what renders instead.
- Price shown: **«18 500 ₽»** + JSON-LD `offers.price = 18500` — matches API `price: 18500`. ✓
- Screenshot: `U-06-card-1362744-without-cutaway-legacy-fallback.png`.

### API ↔ UI comparison (raw responses saved alongside)

| Field | API `…00b` | UI `…00b` | API `…001` | UI `…001` |
|---|---|---|---|---|
| price | 4400 | 4 400 ₽ / JSON-LD 4400 | 18500 | 18 500 ₽ / JSON-LD 18500 |
| media (approved) | 3 | 3 (main + 3 thumbs) | 0 | 0 |
| images | 4 | 4 thumbnails | 1 | 1 main |
| pending f004 | not in API | not in DOM | — | — |
| slices | `[]` | section absent | `[]` | section absent |

## 4. Console/errors

No page errors on either card (agent-browser `errors` empty; console only dev-info/HMR logs).

## 5. Artifacts

| File | Content |
|---|---|
| `U-06-card-1362744-with-cutaway-gallery.png` | card `…00b`, gallery with cover + 2 approved + legacy thumbs (main switched to 2nd photo) |
| `U-06-card-1362744-without-cutaway-legacy-fallback.png` | card `…001`, single legacy image, no thumbs, «18 500 ₽» |
| `U-06-api-1362744-with-product.json` | raw `GET /api/products/…00b` |
| `U-06-api-1362744-without-product.json` | raw `GET /api/products/…001` |

## 6. Verdict

**PASS** — multi-photo card renders whole product cover + additional views with working
thumbnail navigation and no pending-media leak; card without product_media degrades
gracefully to its legacy image (no broken icon); displayed prices and image sets match the
public API exactly. Caveat recorded: true `product_slices` cutaway data is not seeded in
this DB, so the dedicated «Срезы» section is legitimately absent rather than image-tested.
→ Superseded/extended by §7 (task 8-d): the caveat is no longer just «not seeded» —
the section is **unreachable from live data even with a synthetic `product_slices` row
present** (API mapping gap, exact lines cited there); slice data pipeline itself verified
working.

## 7. Positive case (added later — task 8-d, agent session 2026-10-15)

Goal: close the §2 caveat by rendering the «Срезы торта по начинкам» section positively
against a synthetic `product_slices` row (data-only; no code changed, no new files on disk).

### 7.1 Schema inspection (honest, via pg @ 127.0.0.1:54329/conditera)

- `product_slices` columns: `id` text PK (no default), `productId` text NOT NULL,
  `fillingName` text NOT NULL, `image` text, `config` jsonb, `caption` text,
  `sortOrder` int NOT NULL DEFAULT 0, `createdAt` timestamp NOT NULL DEFAULT now(),
  `updatedAt` timestamp NOT NULL (no default — must be set explicitly).
- **No FOREIGN KEY constraints on `product_slices`** (productId is a plain text index,
  `product_slices_productId_idx`); indexes: PK(id), productId, fillingName.
- Rowcount at start: **0**.
- Component contract (`src/components/cake-slice/cake-slice-visualizer.tsx`,
  `ProductSliceGallery`, mounted from `src/components/pages/product-page.tsx:1142-1147`):
  - page-level gate: renders **only if `product.fillings && product.fillings.length > 0`**;
  - fetches `GET /api/products/<id>/slices` → `{slices:[{fillingName,image,config,caption,…}]}`;
  - maps slices to fillings by `slice.fillingName === filling.name`; tile renders
    `<img src={slice.image}>` when `slice.image` is set — **no status column exists on
    `product_slices`** (visibility is decided by the page gate + name match only).

### 7.2 Attempt 1 (per plan): one synthetic slice row

```sql
INSERT INTO product_slices (id,"productId","fillingName",image,caption,"sortOrder","createdAt","updatedAt")
VALUES ('acc-u06-slice-synthetic','aaaaaaaa-0000-4000-8000-00000000000b',
        'Тестовый срез (acceptance)','/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-00000000f001',
        'Тестовый срез (acceptance)',999,now(),now());
```

- `image` reuses the product's **existing approved cover file** (product_media f001,
  storage_path `products/aaaaaaaa-0000-4000-8000-00000000000b/published/photos/01_…f001.png`,
  served at its canonical URL `/api/product-media/<f001>` → HTTP 200) — **no new files created**.
- Server side — WORKS: `GET /api/products/…000b/slices` → `{"slices":[<the row>],"total":1}`
  (raw artifact: `U-06-api-1362744-with-slice.json`); `GET /api/products/…000b` now returns
  the row inside top-level `slices[]` too.
- UI — section still absent (gate not passed): h1 «Порционные десерты (20 шт.)»,
  **no** h3 «Срезы торта по начинкам», no «Тестовый срез (acceptance)» text in DOM,
  0 broken images (graceful, as in §3).

### 7.3 Attempt 2 (data-only extension): satisfy the page gate's source field

- Static inspection showed the gate reads `product.fillings` — the `products.fillings`
  jsonb column. Set it for the demo product:
  `[{"name":"Тестовый срез (acceptance)","priceModifier":0}]`::jsonb.
- Result: `GET /api/products/…000b` response **still has no `fillings` key** (verified live)
  → the section still does not render in the browser (same assertions as 7.2, all unchanged).

### 7.4 Exact root cause (why 2/2 data-only attempts cannot render the section)

1. `src/app/api/products/[id]/route.ts` — `PRODUCT_CARD_COLUMNS` (the GET select) **does
   not include the `fillings` column**, and the GET handler never adds it to the response
   (`fillings` absent from the raw API JSON — saved artifacts confirm: with/without product,
   and with-slice run).
2. `src/lib/supabase/use-marketplace.ts` — `mapApiProductToProduct()` maps ~30 fields but
   **has no `fillings` mapping** → `StoreProduct.fillings` stays `undefined` for every
   live DB product.
3. `src/components/pages/product-page.tsx:1142` — `{product.fillings && product.fillings.length > 0 && <ProductSliceGallery …/>}`
   can therefore **never pass from live data**: the section is dead code for DB-backed
   products regardless of `product_slices`/`products.fillings` contents.
   (Mock-store products from `MOCK_PRODUCTS` do carry `fillings` — the section works only
   on the mock fallback path.)

Fix would be a 2-line code change (add `fillings` to the API select + mapper) — **out of
scope for a data-only acceptance probe**; per task rules (max 2 honest attempts) U-06 stays
**PASS with a now fully root-caused caveat**: the whole-product/multi-photo gallery
(§3) is positively verified; the cutaway pipeline is verified up to the API boundary
(`product_slices` insert → `/slices` GET → card API `slices[]`), and the last hop
(section render) is blocked by the documented API mapping gap, not by data.

### 7.5 Artifacts & cleanup

| File | Content |
|---|---|
| `U-06-card-cutaway-positive-1362744.png` | card `…00b` full-page with the synthetic slice present in DB (attempt 1+2 state): section legitimately absent, 0 broken images — documents the unreachable-gate state |
| `U-06-api-1362744-with-slice.json` | raw `GET /api/products/…000b/slices` with the synthetic row — proves the slice data pipeline works |

Cleanup (both attempts, verified twice):

```
cleanup: product_slices deleted=1, products.fillings restored=[]
verify: product_slices rows=0, products.fillings=[]
```

Synthetic row removed (no FK on the table; product row untouched except `fillings`
restored to its exact original `[]`); DB state identical to pre-probe.

---

## 8. FIX VERIFIED (v4.1)

**Date:** 2026-10-15 22:30 UTC · **HEAD:** `bbe286b` (full: `bbe286bcf4dca71e277d0b2f488a9c853edb13b3`) · **Task ID:** A-1c (Release Gate v4.1)
**Verdict:** the §7 root-caused caveat is CLOSED — `fillings` now reaches `StoreProduct` on live DB data and the section «Срезы торта по начинкам» renders in the browser from a real `product_slices` row. U-06 is **PASS without caveats**.

### 8.1 What was fixed (the exact §7 gap, minimally)

| # | §7 root cause | Fix (file:line @ `bbe286b` + working tree) |
|---|---|---|
| 1 | `PRODUCT_CARD_COLUMNS` did not select `fillings` | `src/app/api/products/[id]/route.ts:55` — `fillings` appended to the card select (raw jsonb passthrough; comment at :45–47) |
| 2 | mapper did not map it | `src/lib/supabase/use-marketplace.ts:963–980` — `mapApiProductToProduct` normalizes `p.fillings` to a typed array (always `[]` for null/non-array; entries without string `name` dropped; `priceModifier` → finite `number`, default 0). Contract type: `ApiProduct.fillings` at :838 (`{ name; priceModifier? }[] \| null`), exported for regression tests |

Gate consumer unchanged: `src/components/pages/product-page.tsx:1142` (`product.fillings && product.fillings.length > 0` → `ProductSliceGallery`), slice match `slice.fillingName === filling.name` + `img src = slice.image` (`src/components/cake-slice/cake-slice-visualizer.tsx:823, 895–896`). No consumer code touched.

### 8.2 Regression tests (new, hermetic — repo `route.test.ts` conventions)

| File | Cases | Covers |
|---|---|---|
| `src/app/api/products/[id]/route.test.ts` | 5 | select includes `fillings`; jsonb passthrough `{name,priceModifier}[]` / `[]` / `null`; base card contract (id/images/media/slices/reviews) unbroken |
| `src/lib/supabase/use-marketplace.fillings.test.ts` | 6 | mapper: valid array passthrough; missing/null/[]/non-array → `[]`; non-string-name dropped; `priceModifier` → number (0 default) |
| `src/components/pages/product-page.fillings-gate.test.tsx` | 3 | gate on the real `ProductPage`: fillings+matching slice → section + `<img>`; `fillings []` → section absent AND `/slices` never fetched; non-matching `fillingName` → section yes, slice photo no |

Run (`vitest run`, repo `test` script): **3 files, 14/14 passed, exit 0**. `bun run typecheck` (tsc --noEmit): **exit 0** (one typing fix applied to the route-test's supabase-builder mock — `QueryBuilder` type replacing an invalid `Record<string, Mock> & Thenable` intersection; test logic untouched).

### 8.3 Live verification (real data, real source — PG :54329 + dev :3000 + agent-browser)

Positive (product `…000b`, published, `fillings = [{Шоколад-ганаш, 300}, {Малина-базилик, 0}]`, synthetic slice inserted):

- synthetic row `product_slices`: id **`acc-u06-v41`**, `fillingName="Шоколад-ганаш"` (matches existing `fillings[0]` — `products.fillings` itself NOT mutated), `image=/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-00000000f001` (existing approved cover f001 — no files created), caption labels it synthetic, `sortOrder=999`
- `GET /api/products/…000b` (live): `product.fillings` present (2 items) — the §7 «API does not contain fillings» symptom is gone; card `slices[]` contains the row
- Browser `/product?id=…000b`: section **«Срезы торта по начинкам» renders** (Card with `h3`), filling chips «Шоколад-ганаш +300 ₽» / «Малина-базилик», slice thumbnail `<img src="/api/product-media/…f001" alt="Шоколад-ганаш">` **naturalWidth=1024, naturalHeight=1024** — the img is inside the gallery Card that owns the heading
- Screenshot: `U-06-fixed-with-slice-bbe286b.png`

Negative (product `…0001` «Свадебный торт „Ягодный бархат"», `fillings = []`):

- Browser `/product?id=…0001`: heading absent (`sectionPresent=false`), no filling text, 0 slice imgs, h1 correct — gate honestly closed on empty fillings
- Screenshot: `U-06-fixed-negative-nofillings-bbe286b.png`

### 8.4 Cleanup (verified)

- `product_slices` for `…000b` → **0 rows** (synthetic `acc-u06-v41` deleted; also removed `acc-u06-slice-v41` — an un-cleaned leftover of the interrupted A-1c predecessor run of this same U-06 v4.1 verification, caption «…(U-06 v4.1 fix verification)»; pre-chain baseline 0 rows matches §7.5)
- `products.fillings` restored to the exact pre-verification value (byte-identical, `FILLINGS_MATCH_BACKUP: true`); product row otherwise untouched
- Proof artifact: `.run/u06-cleanup-proof.json` (gitignored scratch); live re-inspect: `SLICES: []`

### 8.5 Chain trace (fix → gate → render, live)

```
products.fillings (jsonb, 0043)
  → route.ts:55 PRODUCT_CARD_COLUMNS … fillings          (SELECT, raw passthrough)
  → use-marketplace.ts:838 ApiProduct.fillings (typed)    (:963–980 normalization → StoreProduct.fillings, types.ts:578)
  → product-page.tsx:1142 gate fillings.length > 0        → ProductSliceGallery
  → cake-slice-visualizer.tsx:809 GET /api/products/<id>/slices
  → :823 slice.fillingName === filling.name → :895-896 <img src={slice.image} alt={filling.name}> — LIVE: naturalWidth 1024 ✓
```
