# Z31-3-e — Admin CMS tabs: store-only → DB persistence via /api/cms/*

Task ID: Z31-3-e. Date: 2026-02-14 (session). Agent: Z.ai Code.
Prev context: `agent-ctx/Z31-3-d-zai-code.md` (public CMS wiring: usePublishedHomeCms).

## Problem

`src/components/dashboard/admin-cms-tabs.tsx` (~800 lines): `AdminBannersTab`,
`AdminCmsPagesTab`, `AdminSettingsTab` read/wrote ONLY the Zustand store
(`banners`/`cmsPages`/`siteSettings` from `MOCK_BANNERS`/`MOCK_CMS_PAGES`/`MOCK_SITE_SETTINGS`).
Admin edits never reached the DB; the public home (Z31-3-d) reads
`GET /api/cms/banners` + `GET /api/cms/settings`, so admin changes were invisible.

## API contracts discovered (verified against routes + migrations + generated types)

### /api/cms/settings (`src/app/api/cms/settings/route.ts`)
- Table `site_settings` (migration **0017_sync_missing_tables.sql**, camelCase
  columns: `id, key, value, category, description, updatedAt, updatedBy`;
  NOT the 0005 `cms_site_settings`). Confirmed in `src/lib/supabase/types.generated.ts:8438`.
- `GET` (public) → `{ settings: [{ id, key, value, category, description, updatedAt, updatedBy }] }`, optional `?category=`.
- `PUT` (ADMIN/SUPER_ADMIN) body `{ key: string, value: string }` → `{ setting }`.
- **Pre-existing bug fixed (required for persistence):** PUT wrote
  `updated_at` — column does not exist (it is `updatedAt` camelCase) → any PUT
  would fail with Supabase PGRST204. Now writes `updatedAt` + `updatedBy`
  (user.email fallback user.id) and validates key/value types (400 otherwise).

### /api/cms/banners (`src/app/api/cms/banners/route.ts`)
- Table `cms_banners` (migration **0005_crm_cms.sql**): `title, image_url,
  link_url, position, text, cta_text, starts_at, ends_at, is_active,
  sort_order, impressions_count, clicks_count, created_at, updated_at`.
  Confirmed in `types.generated.ts:1833`.
- `GET` (public) → `{ banners: [...] }`, filter `is_active=true`, order
  `sort_order asc`, optional `?position=`. NEW: `?include_inactive=true`
  returns all rows **only for ADMIN/SUPER_ADMIN/COPYWRITER** (otherwise same
  public behavior) — admin must see hidden banners to re-enable them.
- `POST` (ADMIN/SUPER_ADMIN/COPYWRITER) camelCase body → `{ banner }` 201.
  **Pre-existing bug fixed (required for persistence):** insert used
  `start_at`/`end_at` — columns are `starts_at`/`ends_at` → any POST would
  fail. Also now persists `subtitle→text` and `buttonText→cta_text`
  (accepted both `subtitle|text`, `buttonText|ctaText`); previously these UI
  fields were silently dropped.
- `PATCH` **NEW** (ADMIN/SUPER_ADMIN/COPYWRITER) body `{ id, ...partial fields
  (title, imageUrl, linkUrl, position, sortOrder, isActive, startAt, endAt,
  subtitle|text, buttonText|ctaText) }` → `{ banner }`. Was absent — toggle
  had no way to persist.
- `DELETE` **NEW** (ADMIN/SUPER_ADMIN only, like cms_pages DELETE) `?id=`
  → `{ ok: true }`. Was absent — delete had no way to persist.

### /api/cms/pages (`route.ts` + `[slug]/route.ts`) — used as-is, no changes
- `GET /api/cms/pages?include_drafts=true` → `{ pages: [...] }` (drafts only
  for ADMIN/SUPER_ADMIN/COPYWRITER); rows snake_case: `id, slug, title,
  description, content, seo_title, seo_description, status('draft'|'published'),
  is_in_menu, menu_order, published_at, created_at, updated_at, deleted_at`.
- `PATCH /api/cms/pages/{slug}` (ADMIN/SUPER_ADMIN/COPYWRITER) camelCase body
  `{ title?, description?, content?, seoTitle?, seoDescription?, seoKeywords?,
  isInMenu?, menuOrder?, status? }` → `{ page }`; status='published' sets
  published_at. `isPublished` checkbox maps to `status`.

## Files changed

1. `src/app/api/cms/banners/route.ts` — fixed POST columns (+text/cta_text),
   added PATCH + DELETE, GET `include_inactive` for admin roles. Header docs.
2. `src/app/api/cms/settings/route.ts` — PUT: `updated_at`→`updatedAt` +
   `updatedBy`, 400 validation.
3. `src/components/dashboard/admin-cms-tabs.tsx` — 3 tabs rewired:
   - **AdminBannersTab**: local state from `GET /api/cms/banners?include_inactive=true`
     (snake_case→camelCase mapper `mapBannerRow`); create→POST, toggle→PATCH
     `{id,isActive}`, delete→DELETE `?id=`; plain refetch after each mutation;
     loading/error/actionError cards (pattern copied from
     `admin-incidents-tab.tsx`); empty state «Нет баннеров — создайте первый»;
     «Обновить» button; spinner in submit button. UI (cards grid, dialog,
     field limits/validation `!title || !image`) preserved.
   - **AdminCmsPagesTab**: `GET /api/cms/pages?include_drafts=true` +
     `mapPageRow`; save→PATCH `/api/cms/pages/{slug}` with
     `{title, seoTitle, seoDescription, content, status}` (isPublished→status);
     loading/error/empty states; refresh button. UI (MarkdownEditor,
     badges, layout) preserved; `updatedBy` line dropped (cms_pages has no
     author column).
   - **AdminSettingsTab**: promo-popup block untouched; settings list now
     from `GET /api/cms/settings` (category filter client-side, unchanged
     SETTING_CATEGORIES); per-key save→PUT `{key, value}`; per-key spinner,
     toast success/error, error card, empty states («Настройки не найдены»,
     «Нет настроек в этой категории»); refresh button.
   - AdminCmsHomeTab / AdminReviewsModerationTab / AdminNavMenuTab —
     intentionally NOT touched (no GET/PUT API for cms_blocks/nav/reviews in
     scope; do not invent endpoints).
4. `docs/operations/PRODUCT_BACKLOG.md` — added row **ZV31-012** (P1, CMS/Админка,
   deps ZV31-001, IN_PROGRESS), 8-column table preserved.

## Client requests all use `csrfFetch` (`@/lib/api-client`)
- GET: `csrfFetch(url)` (credentials include); mutations add
  `Content-Type: application/json` (csrfFetch injects `x-csrf-token`,
  same as admin-incidents-tab.tsx / promo-popup usage already in this file).

## Left as-is / caveats
- Pages tab has no "create" UI (task: wire edit of existing pages only) —
  empty state hints POST /api/cms/pages.
- Admin banner positions (hero/top/category/sidebar/footer) differ from
  migration enum (home_hero|catalog_top|sidebar|footer|mobile) — pre-existing
  dictionary mismatch, UI kept identical; public home strip accepts top/hero/home_hero.
- site_settings PUT is update-only (no upsert): rows must pre-exist in DB
  (e.g. seeded); if table empty, tab shows empty state.
- COPYWRITER can create/edit banners but not delete (mirrors cms_pages DELETE policy).

## NOT verifiable without shell (honesty rule)
- `bun run lint` / tsc — NOT RUN (Bash unavailable in this task).
- Browser check of the three tabs (create/toggle/delete banner, save page,
  save setting; visible on public home) — NOT RUN. Backend responses,
  role gating, and CSRF flow follow verified existing patterns but are
  unverified at runtime.
