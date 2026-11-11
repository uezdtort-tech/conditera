# Z31-3-d — Public pages consume admin-published CMS — Work Record

**Task ID:** Z31-3-d (backlog ZV31-001)
**Agent:** zai-code (implementation agent)
**Date:** 2026-11-11
**Status:** COMPLETED (files created/modified; NO shell verification per constraints — no lint/typecheck/browser run)

## Scope

Wired public home page to admin-published CMS content (site settings + banners)
via the existing PUBLIC read-only API routes, with graceful fallback to the
previous hardcoded hero / zero-render when CMS data is absent or errored.

## Created files

1. `src/hooks/use-published-cms.ts` ("use client") — exports:
   - Types: `PublishedHeroCms { title, subtitle, ctaLabel?, ctaHref?, imageUrl? }`,
     `PublishedBannerCms { id, title?, subtitle?, imageUrl?, href?, sortOrder }`,
     `PublishedHomeCms { hero: PublishedHeroCms | null, banners: PublishedBannerCms[] }`.
   - `usePublishedHomeCms()` — plain `fetch` (matching `useRealReviews`
     convention in home-page.tsx) to `GET /api/cms/settings` + `GET /api/cms/banners`
     in parallel; never throws, never blocks render; initial/loading/error →
     `{ hero: null, banners: [] }`; 10s module-level in-memory cache + in-flight
     de-dup (no refetch storms across SPA view transitions); fetch starts only
     in useEffect (no SSR/hydration risk).
   - `isExternalCmsHref(href)` / `cmsInternalView(href)` — href helpers
     (external → `<a target=_blank>`, internal → strip leading "/" → SPA
     `store.navigate(view as ViewKey)`; no `any`).
   - Defensive parsing: `asRecord`/`typeof` guards over unknown JSON; strings
     clamped (title ≤200, subtitle ≤400, url ≤2048); banners filtered client-side:
     `is_active !== false`, position in `{"top","hero","home_hero"}` (both
     vocabularies: admin UI and migration 0005), display window
     `starts_at|start_at` / `ends_at|end_at` (invalid date = open, same as
     `useCmsBanners`), sorted by `sort_order` asc (stable sort).
   - Hero built from site_settings key-value rows, keys: `hero_title|home_hero_title`
     (activation key — no title ⇒ hero=null), `hero_subtitle|home_hero_subtitle|hero_description`,
     `hero_cta_label|hero_cta_text|home_hero_cta_label`, `hero_cta_href|hero_cta_link|home_hero_cta_href|hero_link`,
     `hero_image|hero_image_url|home_hero_image`.

## Modified files

2. `src/components/pages/home-page.tsx` (surgical, 7 edits):
   - imports: hook + helpers + `import type { ViewKey } from "@/lib/types"`.
   - module helper `isOptimizableImage()` (next/image whitelist: `/…` or
     `https://images.unsplash.com/…` — the hosts configured in next.config
     `images.remotePatterns`; other CMS urls → plain `<img>` fallback so
     next/image cannot crash on arbitrary admin URLs).
   - `HomePage()`: `const cms = usePublishedHomeCms()`, `cmsHero`, `cmsCta`
     (label+href only when both present), `openCmsHref()` (external →
     window.open noopener; internal → navigate).
   - Hero h1: CMS title when `cmsHero`, else ORIGINAL hardcoded JSX untouched.
   - Hero p: CMS subtitle when present (hero w/o subtitle key falls back to
     hardcoded text), else ORIGINAL hardcoded JSX untouched.
   - CMS CTA button (btn-primary-gradient, Sparkles icon) rendered as FIRST
     button in the existing row only when cmsCta present; all existing buttons
     untouched.
   - NEW banner strip section directly after hero, before ConfectionersMarquee,
     rendered ONLY when `cms.banners.length > 0`: `container mx-auto px-4`,
     grid 1/2/3 cols (gap-4), cards `h-36` (144px) object-cover image
     (next/image for whitelisted hosts, else `<img lazy>`), dark gradient
     overlay, title (line-clamp-1) + subtitle (line-clamp-2) bottom-left,
     whole-card link: external → `<a target=_blank rel=noopener>`, internal →
     `<button type=button>` → SPA navigate, no href → non-clickable div.
   - products/reviews/categories logic untouched.

3. `docs/operations/PRODUCT_BACKLOG.md` — ZV31-001 row: status OPEN →
   IN_PROGRESS; Доказательство cell appended:
   "; Z31-3-d: wiring реализован (usePublishedHomeCms + hero/banners на главной),
   прогон и браузерная проверка NOT RUN (shell недоступен)". Table well-formed.

4. `agent-ctx/Z31-3-d-zai-code.md` — this record.

## Discovered CMS shapes (evidence)

- `GET /api/cms/settings` → `{ settings: Row[] }` from table `site_settings`
  (migration 0017: id, key, value, category, description, updatedAt, updatedBy;
  no is_public/published column). Public GET returns ALL rows; PUT is
  ADMIN-gated (key/value update) — so settings ARE admin-writable storage.
- `GET /api/cms/banners?position=` → `{ banners: Row[] }` from `cms_banners`
  (migration 0005: title, image_url, link_url, position default 'home_hero',
  text, cta_text, starts_at, ends_at, target_audience, is_active, sort_order,
  metrics). Server filter: `is_active=true`, order `sort_order asc`. POST is
  ADMIN/COPYWRITER-gated. NOTE: route GET uses table `site_settings` while
  `use-cms.ts` (supabase) uses `cms_site_settings` (migration 0005) — two
  different settings storages coexist; the hook consumes the API (route) one.
- Admin UI (admin-cms-tabs.tsx) writes via Zustand store only (no network):
  banners `{title, subtitle, image, link, buttonText, position: hero|top|
  category|sidebar|footer, isActive, sortOrder, startDate, endDate}`; cmsBlocks
  sections `hero|stats|cta_confectioner|advantages|steps|testimonials`;
  siteSettings categories general|commission|delivery|loyalty|tax|seo|social
  (SETTNG keys from mock-data-cms.ts, e.g. site_name, support_email, seo_*).
- Seed (seed_cms_crm.sql) has NO hero_* keys ⇒ with seeded DB hero stays null
  ⇒ fallback hero renders ⇒ zero visual change until admin adds keys/banners.
- `use-cms.ts` hooks (not modified): `useSiteSettings(category?)` →
  SiteSetting `{key, value, value_type, description, category, is_public,
  updated_at}` from `cms_site_settings` (is_public=true); `useCmsBanners
  (position?)` → CmsBanner from `cms_banners` (is_active + date windows,
  sort_order asc).

## Fallback guarantee

When hook returns `{hero:null, banners:[]}` (initial render, loading, network
error, non-OK HTTP, JSON parse error, empty CMS, no hero_title key, no
top/hero/home_hero banners): the home page renders the exact same DOM as
before — original h1/p JSX preserved verbatim, no extra CTA button, banner
section not mounted. SSR HTML and first client render both use the empty
state (fetch starts in useEffect) — no hydration mismatch.

## NOT verifiable without shell (honesty per PRODUCT_OPERATING_SYSTEM §1)

- `bun run lint` / `tsc --noEmit` — NOT RUN. Compile-plausibility reviewed
  manually (strict mode, no `any`, imports verified by re-read). Residual
  risks: `@next/next/no-img-element` warning on the `<img>` fallback (same
  pattern already used in admin-cms-tabs.tsx); TS narrowing inside closures
  (`cmsCta.href`, `banner.href`) — believed valid (const narrowing).
- Browser verification (hero/banner rendering, click-through) — NOT RUN.
- Live API responses from `/api/cms/settings` + `/api/cms/banners` (real DB
  row shapes may include extra/absent columns) — NOT RUN; parsing is
  defensive to both.
- Cache behavior across route transitions in the running app — NOT RUN.
