# U-08 fix — PostgREST shim: base-table PK (`id`) preserved in embedded select translation (DEV-19)

**Status: FIX VERIFIED (v4.1)** — shim fix reviewed/completed, unit+route tests green, typecheck green, live probe PASS with cleanup, evidence scan exit 0.

- HEAD: `8e67d3b` (8e67d3beb629c6922baeda948b0f5bb5fd603727), main, **no push**
- Date (UTC): 2026-10-15 22:43–22:52
- Task: A-2c (Release Gate v4.1). Closes the U-08 finding «ticket list rows have no `id` field» (owner-finding #2 from 8-b; owner-finding #3 — ticket creation idempotency — is **NOT** touched here, locked as-is by test).
- Scope guard: `src/app/api/products/**`, `src/lib/supabase/use-marketplace.ts`, `src/app/api/upload*`, `src/lib/upload-service.ts` untouched (U-06/U-12 units).

## 1. Root cause (before → after), file:line

**Defect.** For `select=*,rel(...)` the shim planned the embed join on a base-table column and, if that column was not *explicitly* named in the select list, put it into `hidden` — and deleted every `hidden` column from the output rows after attaching embeds. For a one-to-many embed (e.g. `support_tickets ← ticket_messages`) the join column on the base side is the **PK `id`** itself, and `*` did not count as "explicitly selected". Result: every row of an embedded list lost `id` (ticket list, orders, inquiries, quotes, negotiations, leads — every `select=*,rel(...)` consumer).

- **Before** (`src/lib/postgrest/translate.ts:435-437` at HEAD 8e67d3b):
  ```ts
  for (const e of embeds) {
    const col = resolveColumn(table, e.thisColumn);
    if (!items.some((i) => i.column && i.column.name === col.name)) hidden.add(col.name);
  }
  ```
  `items` for `select=*,messages:ticket_messages(...)` contains a single non-embed item `{name:"*"}`, so the `id` check never matched → `hidden.add("id")` → SQL `SELECT *, "id" FROM support_tickets` → after embeds, `translate.ts:527-533` deleted `id` from all rows.

- **After** (`src/lib/postgrest/translate.ts:435-447`):
  ```ts
  for (const e of embeds) {
    const col = resolveColumn(table, e.thisColumn);
    // `*` покрывает ВСЕ колонки базовой таблицы, включая join-колонку …
    if (!items.some((i) => i.column && (i.column.name === "*" || i.column.name === col.name))) {
      hidden.add(col.name);
    }
  }
  ```
  Semantics (PostgREST-compatible): base columns are top-level, embeds live under relation keys. `*` covers **all** base columns (PK and FK join columns survive); a join column **not** selected by an explicit (non-`*`) select is still hidden — semantics not widened. Downstream `hidden` deletion (`translate.ts:526-533`) unchanged; embed attach (`translate.ts:489-524`) unchanged — relation FK/PK values stay **inside** embed objects, no duplicate/incorrect top-level fields (`id` of the base row wins at top level; the related row's `id` only exists inside the embed object).

**Diff stat:**
```
 src/lib/postgrest/translate.ts | 10 +++++++++-
 1 file changed, 9 insertions(+), 1 deletion(-)
```

## 2. Test coverage (new, committed with this fix)

- `src/lib/postgrest/translate.test.ts` (354 lines, 7 tests) — hermetic `handleSelect` regression on hand-built introspection + fake `QueryExecutor` that plausibly projects SQL columns:
  - `select=*` + embed → base PK `id` top-level, exact key set = base columns + relation key (no dup/leak); embed grouping works;
  - `rel(*)` → relation FK `ticket_id` stays **inside** embed objects, never top-level;
  - `select=*,id` and `select=id` → explicit selection keeps `id`;
  - `select=subject` (no `*`) → unselected join column still hidden (semantics not widened);
  - many-to-one (`ticket_messages → support_tickets`) → base FK top-level under `*`, related PK only inside embed (base PK wins);
  - no embeds → unchanged.
- `src/app/api/crm/tickets/route.test.ts` (561 lines, 17 tests) — hermetic e2e: real supabase-js client (custom fetch) → real `/rest/v1` shim route → fake pg pool with information_schema emulation; auth helpers mocked per repo convention (cf. `orders/[id]/route.test.ts`, `health/route.test.ts`, U-06 tests at 8e67d3b):
  - (a) list rows carry base `id` + intact `messages` embed (`select=*,rel(...)`);
  - (b) open specific ticket by id taken from the list → 200, correct record (`/api/crm/tickets/[id]`, UI message mapping `mapTicketMessage`, internal notes hidden for non-staff owner);
  - (c) byte-identical resubmit POST → **2 tickets (duplicate)** — locks CURRENT creation semantics with an explicit comment: idempotency is owner-finding #3, NOT changed in this task;
  - (d) repeated list GET → same ids (owner `own` and SUPPORT `all`);
  - (e) role isolation matrix (below) incl. 401 unauthenticated.

**Commands and results:**
```
bun run test -- src/lib/postgrest/translate.test.ts src/app/api/crm/tickets/route.test.ts
  → Test Files 2 passed (2), Tests 24 passed (24), exit 0
bun run test            (FULL suite — embed-consumer regression audit)
  → Test Files 43 passed (43), Tests 963 passed (963), exit 0
bun run typecheck       → exit 0 (0 errors)
bun run lint            → exit 0
```
(24 = 7 translate + 17 route; route file gained one symmetric-isolation assertion during review — see role matrix.)

## 3. Embed-consumer audit (regression verdict)

Server routes issuing `select=*,rel(...)` through supabaseAdmin → shim (verified by static sweep of `src/app` + `src/lib/supabase`):

| Consumer | Select shape | Effect of fix |
|---|---|---|
| `api/crm/tickets` route + `[id]` | `*, messages:ticket_messages(id,…)` / `(*)` | **fixed** — rows carry `id` (this task's target) |
| `api/orders/[id]` | `*, items:order_items(*), payment:payments(*), delivery:deliveries(*)` | `orders.id` + FKs now top-level (previously stripped) — consumers read named fields; no test asserted exact shape |
| `api/inquiries` | `*, negotiations:negotiations(*)` | `inquiries.id` preserved — required for row actions |
| `api/quotes` | `*, confectioner_quotes:confectioner_quotes(*)` (incl. `!inner` variant) | `quotes.id` preserved; `!inner` hint remains unsupported by shim parse (pre-existing, out of scope) |
| `api/negotiations/[id]` | `*, inquiry:…, messages:…, revisions:…` | `negotiations.id` preserved |
| `api/crm/leads/[id]` | `*, activities:lead_activities(*)` | `leads.id` preserved |
| `api/gamification/badges` | explicit cols + `badges:badge_id (…)` | unchanged (no `*`; join col `badge_id` explicitly selected; the space-in-embed-name parse quirk is pre-existing and unrelated) |
| `api/map/confectioners` | `confectioner:auth.users!…fk(id)` | unchanged by fix (auth.users FK-hint syntax unsupported by shim parse — pre-existing) |
| client hooks (`use-crm.ts`, `use-dashboards.ts`, `use-chat.ts`, `use-cake-builder.ts`) | `*, rel(...)` via browser supabase-js → same shim | benefit from preserved base PK; extra previously-hidden FK columns are additive keys, benign for named-field consumers |

**Verdict:** fix is additive only (columns that PostgREST would return anyway); no consumer narrows; FULL vitest suite 963/963 green — no shape assertions broke anywhere. No changes to any consumer required.

## 4. Role matrix (unit, route-level; route contract mirrored from `route.ts` + `[id]/route.ts`)

| Actor | Request | Result |
|---|---|---|
| OWNER (CUSTOMER) | `GET ?filter=own` | 200 — only own ticket (`tk-aaaa-1`), other's ticket absent |
| OTHER (CUSTOMER) | `GET ?filter=own` | 200 — only own (`tk-bbbb-2`); owner's ticket invisible (symmetric-isolation test added in review) |
| OWNER | `GET ?filter=all` | **403** «Только support может видеть все тикеты» |
| OTHER | direct `GET /api/crm/tickets/{owner ticket}` | **403** «Нет доступа к этому тикету» |
| OWNER | direct `GET /api/crm/tickets/{other ticket}` | **403** |
| OWNER | `GET` unknown id | **404** «Тикет не найден» |
| anon | list / by-id | **401** |
| SUPPORT | `GET ?filter=all` | 200 — all users' tickets (`scope не сужен`) |
| ADMIN | `GET ?filter=all` | 200 — all users' tickets |
| ADMIN | `PATCH {status:"resolved"}` other's ticket | 200 — status+`resolved_at` persisted (staff powers unchanged) |
| OWNER | `PATCH {status:"closed"}` own ticket | 200 |
| OWNER | `PATCH {assignedTo:…}` own ticket | **403** «Только support может назначать тикеты» |
| OTHER | `PATCH {status:…}` foreign ticket | **403**, DB status unchanged |

## 5. Live spot-check (dev :3000, PG :54329 — PASS, exit 0)

Probe `.run/a2c-live-tickets-probe.mjs` (pattern of `scripts/verify/product-media-verify.mjs`; CSRF double-submit pair `x-csrf-token` + `Cookie csrf_token=…` from `GET /api/csrf-token`): login `confectioner@demo.ru` / `admin@demo.ru` → POST **synthetic** ticket (subject marked `acc-a2c-synthetic…`) → list GETs → **cleanup in finally**.

- 16/16 asserts PASS, exit 0: POST → 201 with non-empty `ticket.id`; created ticket found by `id` in `filter=own`; all rows (`own` and admin `filter=all`) carry non-empty string `id`; embed `messages` intact (1 first message); `filter=all` as CONFECTIONER → **403**; repeated `filter=all` → same ids.
- JSON shape excerpt (**ids only, no PII**):
  ```json
  { "id": "af272154-7fdf-43f4-8041-f37a8c25b41d", "idType": "string",
    "keys": ["assigned_to","category","closed_at","created_at","first_response_at","id","messages","messages_count","metadata","number","order_id","priority","resolved_at","status","subject","updated_at","user_id"],
    "messagesEmbedKeys": ["created_at","id","is_internal","sender_id","text"] }
  ```
- Cleanup proof: `messages=1, tickets=1` deleted → `synthetic rows left = 0 tickets / 0 messages` (baseline restored). Honest artifact note: `support_tickets.number` is trigger-generated from a sequence — the sequence advanced by one consumed value; rows fully removed.

## 6. Gate

- `node scripts/scan-evidence.mjs` → exit 0 (see worklog A-2c).
- Commit (this task, only these files): `src/lib/postgrest/translate.ts`, `src/lib/postgrest/translate.test.ts`, `src/app/api/crm/tickets/route.test.ts`, this evidence doc. `worklog.md` deliberately **not** committed.
