# Architecture — «Уездный кондитер» v2.0

## Stack

| Слой | Технология | Версия |
|---|---|---|
| Frontend | Next.js (App Router, Turbopack) | 16.1.3 |
| Backend | Next.js API Routes (Route Handlers) | — |
| Database | Supabase PostgreSQL | 15 (self-hosted) |
| ORM/Client | @supabase/supabase-js | 2.112.3 |
| SSR Auth | @supabase/ssr | 0.5.2 |
| State | Zustand (legacy) → TanStack Query | 5.82.0 |
| UI | shadcn/ui (Radix) + Tailwind CSS 4 | latest |
| Realtime | Supabase Realtime (postgres_changes) | built-in |
| Storage | Supabase Storage + imgproxy | built-in |
| Search | PostgreSQL FTS + pg_trgm | built-in |
| Automation | pg_cron + Edge Functions (Deno) | built-in |
| Auth | Supabase GoTrue (email/pass, OAuth, Magic Link, 2FA) | built-in |
| Reverse Proxy | Caddy 2.8 | auto-HTTPS |
| CI/CD | GitHub Actions | deploy.yml |
| Container | Docker Compose | single stack |

## Module Boundaries (Composable Architecture)

```
┌─────────────────────────────────────────┐
│              Next.js App                │
├─────┬──────┬──────┬──────┬──────────────┤
│Auth │Market│ Cake │ Chat │  Dashboards  │
│     │place │Build │      │              │
├─────┴──────┴──────┴──────┴──────────────┤
│  CRM  │  CMS  │  Tenders  │  Geo  │ Auto │
├───────┴──────┴───────────┴───────┴──────┤
│           Supabase (Postgres + Auth)     │
│           Realtime + Storage + Edge      │
└─────────────────────────────────────────┘
```

## Data Flow

```
User → Browser → Next.js SSR → supabaseBrowser (RLS)
                                    ↓
                              Supabase Kong (:8000)
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
               GoTrue (:9999)  PostgREST (:3000)  Realtime (:4000)
                    ↓               ↓               ↓
                    └───────────────┴───────────────┘
                                    ↓
                          PostgreSQL 15 (:5432)
                          + pg_cron + pg_trgm + FTS
```

## File Structure (v2.0)

```
src/
├── app/                    # App Router pages + API routes
│   ├── (29 public pages)
│   ├── login/              # Supabase Auth page
│   ├── auth/callback/      # OAuth callback
│   ├── dashboard/          # Role-based redirect
│   └── api/                # 205 route handlers
├── components/
│   ├── layout/             # Header, Footer, AuthModal
│   ├── dashboard/          # 5 v2 dashboards + 21 legacy
│   ├── cake-builder/       # 8-step wizard (930 lines)
│   ├── marketplace/         # Cart, checkout, product cards
│   ├── _shared.tsx         # DashboardShell, StatCard, etc.
│   └── ui/                 # shadcn/ui primitives
├── lib/
│   ├── supabase/           # 10 hook files (96 hooks)
│   │   ├── browser.ts      # Client-side Supabase
│   │   ├── server.ts       # SSR Supabase (cookies)
│   │   ├── admin.ts        # Service role (bypass RLS)
│   │   ├── auth.ts         # getSession, requireRole
│   │   ├── use-auth.ts     # 10 auth hooks
│   │   ├── use-marketplace.ts
│   │   ├── use-cake-builder.ts
│   │   ├── use-chat.ts     # Realtime + typing + presence
│   │   ├── use-dashboards.ts
│   │   ├── use-crm.ts
│   │   ├── use-cms.ts
│   │   ├── use-automation.ts
│   │   ├── use-tenders.ts
│   │   └── use-geo.ts
│   ├── db.ts               # Compatibility shim → supabaseAdmin
│   ├── store.ts            # Zustand (legacy, being replaced)
│   └── finance.ts          # Pricing, delivery calculation
├── middleware.ts           # Supabase session refresh + CSRF
└── styles/globals.css      # Tailwind + design tokens

supabase/
├── config.toml             # CLI config
├── kong.yml                # API gateway routing
├── migrations/             # 9 SQL migrations
├── functions/              # 10 Edge Functions (Deno)
├── seed.sql                # 28 categories
└── seed_cms_crm.sql        # CMS + CRM + automation seed

docker-compose.supabase.yml  # 10 services
docker-compose.yml           # Production (Next.js + Caddy)
Caddyfile                    # Reverse proxy + health-check
.github/workflows/deploy.yml # CI/CD
scripts/deploy.sh            # Production deploy
scripts/health-check.sh      # 34 endpoint checks
```

## RLS Strategy

Every table with user data has RLS policies:
- `auth.uid()` checks ownership
- `EXISTS (SELECT 1 FROM user_roles WHERE role IN ('ADMIN', ...))` for role-based access
- Admin can see all, users see only own data
- Public reads on published content (products, CMS pages, banners)

## Realtime Strategy

Three realtime channels:
1. `chat-messages-{channelId}` — INSERT/UPDATE/DELETE on chat_messages
2. `negotiation-messages-{negotiationId}` — INSERT on negotiation_messages
3. `ticket-messages-{ticketId}` — INSERT on ticket_messages
4. `typing-{channelId}` — broadcast events (typing/stop_typing)
5. `presence-{channelId}` — presence sync (online/offline)
