# Release Gate v4.0 — Final Report (HEAD ad787ed)

- **Full SHA:** `ad787ed22396dda9deed054f271a8bc982076d42`
- **Branch:** `main` · **Ahead of origin/main:** 51 commits · **Working tree:** clean (before this report's commit)
- **Date (UTC):** 2026-10-15 (build 19:49–19:53Z, live checks 19:53–19:58Z, runtime gate fresh run 19:58Z)
- **Executor:** task 10-a (final build + report). No push, no merge, no deploy — per mandate.

## TZ v4.0 §15 — Status table

| Gate | Status | Evidence / numbers |
|---|---|---|
| CHECKPOINT | **PASS** | HEAD `ad787ed`, ahead 51, tree clean at checkpoint |
| VARIANT B | **PASS** | `a0ace2c` + evidence (variant-b-check-7a8d878.txt / variant-b-check-a0ace2c.txt) |
| UPLOAD ROUTES | **PASS** | both protected routes restored & verified (U-12/U-13 sha256 read-back MATCH) |
| EVIDENCE HYGIENE | **PASS** | `6e8753d` + scans (scan-evidence exit 0, real findings 0 / 166 synthetic markers) |
| STATIC | **PASS** | `1362744`: typecheck 0 / lint 0 / vitest 925 / chat-tsc 0 (static-v4-*-9f05fef) |
| RUNTIME-ENV-SYNC | **PASS** | `23b437f`: regression 13/13, runtime gate 48/48 |
| E2E TALLY | **PASS** | `daedd88` + `76b5cf9`: recomputed 148 passed / 0 failed / 0 flaky / 1 skipped of 149 slots; verifier exit 0 (re-confirmed at ad787ed, `tally-contract-ad787ed.json`) |
| PRODUCT ACCEPTANCE | **PASS 16/16** with 6 owner findings | `5ed027e` (ACCEPTANCE-SUMMARY-1362744.md: 5 findings + U-06 §7 mapping gap) |
| BUILD (DEV-08 final) | **PASS — exit 0 at ad787ed** | attempt 1 exit 137 (OOM, dev stack co-resident, honest record); attempt 2 **exit 0 in 108s**; see §Build below |
| REMOTE CI | **NOT RUN ON CANDIDATE** | owner must publish; nightly on `8454b3a` was **FAIL** (run 38701876670; root causes (1)(2) fixed locally by 49604e0/b3a88ee, (3) resolved by 37d90ab); new CI validates only after push |
| PRODUCTION ENV | **PASS** for template + meili contract + GIT_SHA + mailu docs | `f87e057` / `29cee6c` / `142956e` / `f28b090`; verifier exit 0 at ad787ed |
| DOCKER COMPOSE CONFIG | **BLOCKED** (no engine; `163d6cf`) | sandbox has no Docker engine — honest BLOCKED, not PASS |
| DOCKER WEB/CHAT/SIMPLEX BUILDS | **BLOCKED ×3** | requires owner environment |
| DOCKER INSPECT | **BLOCKED** | requires owner environment |
| HANDOFF | **PASS** | worklog chain intact, all evidence SHAs resolvable from main |
| PUSH / MERGE / DEPLOY | **NOT PERFORMED** | out of mandate |
| PRODUCTION-READY | **NO** | remote CI + Docker gate open — both require owner environment |

## §Build (DEV-08 final at ad787ed) — honest record

- **Attempt 1** (`bun run build`, dev server :3000 + chat :3030 running, 19:49Z): **exit 137** — SIGKILL
  (kernel OOM, 4 GB RAM host; dmesg -T: `19:50:10 OOM killed next-build, anon-rss ~2.0 GB`). Duration 41 s.
- **Mitigation per DEV-04:** stopped **managed** processes only (state `.run/ensure-dev.state.json`:
  next pgid 10022; chat listener verified via cwd `mini-services/chat-server` → pgid 3691). Unmanaged
  processes were never touched by name/port.
- **Attempt 2** (dev processes stopped, 19:51Z): **exit 0, 108 s.** Next.js 16.3.5 (Turbopack),
  ✓ Compiled successfully in 53 s, 233/233 static pages generated.
- **Warnings worth noting (non-fatal):** 12× “Dynamic filesystem access causes tracing of the whole
  project” (Turbopack tracing, known repo pattern); 1× `[sitemap] Supabase query failed, fallback to
  mock: TypeError: fetch failed` (expected in sandboxed network; documented mock fallback path).
- **Artifacts:** `docs/evidence/release-gate/build-v4-ad787ed.log` (both attempts, full tail + exit codes),
  route table in log tail.

## §Post-build live checks — honest record (restart WAS needed)

- After attempt 2, the **restarted dev server was OOM-killed a second time by the kernel**
  (`dmesg -T: 19:54:52 OOM killed next-server, anon-rss ~2.6 GB`) while the cake-builder page was being
  compiled on demand — before that, it had already served a green homepage render (health 200, h1 verified).
- **Restart performed via `bash scripts/ensure-dev.sh`** (managed lifecycle, DEV-04): chat `action:"ok-managed"`,
  next `action:"started"`. After warm-up:
  - `GET /api/health` → **200** (`status:"ok"`, database ok, n8n ok, v2.0.0-dev).
  - Homepage `http://127.0.0.1:3000/` → **renders**: title correct, h1 «Торты и десерты / от уездных кондитеров»,
    body 8 762 chars, **no error boundary / no blank page**.
  - Deep page `http://127.0.0.1:3000/cake-builder` → **renders** (body 2 828 chars, no error boundary).
  - Screenshot: `docs/evidence/release-gate/postbuild-home-ad787ed.png` (fresh, post-restart).
- Chat :3030 `/health` → 200 throughout; chat process survived both OOM events.

## §Runtime gate (fresh, at the very end)

- `bun scripts/verify-chat-runtime.mjs` → **PASSED 48/48**, exit **0**.
- Log: `docs/evidence/release-gate/runtime-final-ad787ed.log` (incl. handshake / room-join / persistence /
  anti-spoof / reconnect / courier geolocation checks and `RUNTIME GATE SUMMARY`).

## §Final verifier sweep (all exit codes recorded)

| Verifier | Exit | Key output |
|---|---|---|
| `node scripts/scan-evidence.mjs` | **0** | real findings 0; synthetic-test-data markers 166 |
| `node scripts/verify/production-env-template.mjs` | **0** | compose 6 required vars; `.env.production.example` 63 keys; «контракт выполнен» |
| `node scripts/verify/e2e-tally-contract.mjs` | **0** | VERDICT vs CLAIM: **PASS**; recomputed = canonical = **148/0/0/1/149**; contract re-keyed `tally-contract-ad787ed.json` |

## §Owner findings (each with severity + minimal owner action)

From product acceptance (16/16 PASS, `5ed027e` — 5 summary findings + U-06 §7 root-caused gap):

1. **Checkout create: 200-on-create + duplicate order without `Idempotency-Key`.** Same key → same orderId
   (replay); no key → second real order (unique index 0060 guards races). Not settlement logic.
   Severity: **low**. Owner action: require/default the key (or return 201) in `POST /api/checkout` — one route change.
2. **Ticket list rows lack `id`** — postgrest shim `src/lib/postgrest/translate.ts:433-441/519-523` hides the
   join PK even on `select=*` (real PostgREST returns it); breaks client-side ticket-by-id actions.
   Severity: **medium**. Owner action: include the join PK in the shim’s projection; re-verify list→PATCH flow.
3. **Ticket creation is not idempotent** (byte-identical resubmit → 2 tickets, observed live 2×201).
   Severity: **low**. Owner action: add Idempotency-Key support or a one-open-ticket-per-order guard on `POST /api/crm/tickets`.
4. **Upload oversize: 400 at body-parse before the code-level 422/10 MiB gate** (`src/lib/upload-service.ts:52-57`
   unreachable live; Next truncates body at 10 MB). Both outcomes are 4xx.
   Severity: **low**. Owner action: optional body-size / error-mapping tuning on both upload routes.
5. **U-06 cutaway section unreachable for DB products** — page gate `product.fillings.length > 0`
   (`product-page.tsx:1142`) reads a field the card API never returns (`PRODUCT_CARD_COLUMNS` omits
   `products.fillings`; `mapApiProductToProduct` doesn’t map it). Root-caused with 2 data-only probes; pipeline
   works up to the API; cleanup verified (DB restored exactly).
   Severity: **low/medium (feature gap, not probe failure)**. Owner action: 2-line code change (add column to
   `PRODUCT_CARD_COLUMNS` + mapper) then validate slice gallery on real data.
6. **U-16: real auth provider topology = owner decision** (fail-closed registration gate already verified: GoTrue
   failure in prod → 500 **before** any `auth.users`/`profiles`/`user_roles` insert, `register/route.ts:261-267`;
   stub admin warns in prod; local GoTrue stub 501). Severity: **decision (not a defect)**. Owner action: prove the
   provider topology against the real provider in the owner environment (needs Docker/infra, not testable in sandbox).

Outside acceptance, raised by gate work (also blocking PRODUCTION-READY):

7. **DEV-14: simplex-bridge runs as root** (`Dockerfile.simplex-bridge` has no `USER`; ports 5225/5226 unprivileged;
   `/app/simplex.db` would need `chown` for non-root; full plan + runtime tests T1–T4 in
   `simplex-bridge-nonroot-assessment-001c4ff.md`). Severity: **security decision (P1, owner risk-accept)**.
   Owner action: accept root risk explicitly, or apply the documented non-root plan and validate in a Docker-capable
   environment (half-measure “edited Dockerfile without runtime proof” is forbidden by repo gate discipline).
8. **Firefox/WebKit E2E coverage = future task** — variant B pinned e2e.yml matrix to chromium-only (`37d90ab`,
   `TODO(future-task)` in workflow header; firefox/webkit projects commented out in playwright.config.ts).
   Severity: **low / process debt**. Owner action: either validate specs on firefox/webkit projects and restore the
   matrix + dispatch input, or consciously keep chromium-only nightly.

## §Artifacts produced by task 10-a

- `docs/evidence/release-gate/build-v4-ad787ed.log` — build log (attempt 1 OOM + attempt 2 exit 0, tail, timings)
- `docs/evidence/release-gate/postbuild-home-ad787ed.png` — post-build homepage screenshot
- `docs/evidence/release-gate/runtime-final-ad787ed.log` — fresh runtime gate 48/48 tail
- `docs/evidence/e2e-tally/tally-contract-ad787ed.json` — machine-readable tally contract re-keyed to ad787ed
- `docs/evidence/release-gate/final-report-v4-ad787ed.md` — this file
- worklog.md — `Task ID: 10-a` section

## §Bottom line

All local gates that can run in this environment are **green** (static, runtime 48/48, e2e tally
148/0/0/1/149, acceptance 16/16, production-build exit 0, env contract, evidence hygiene).
**PRODUCTION-READY: NO** — remote CI on the candidate and the Docker chain (compose config + 3 image
builds + inspect) require the owner environment (push + Docker engine). Owner’s ordered path:
(i) review findings §Owner findings; (ii) push the 51+ commits; (iii) watch the first CI run
(chromium matrix + PG bootstrap expected green); (iv) run the Docker gate in an engine-capable host;
(v) only then revisit PRODUCTION-READY.
