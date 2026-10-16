# Release Gate v4.1 — FINAL HANDOFF (Этап 5)

- Checkpoint HEAD at writing: `b567b42` (main). Push: NOT performed (no push in v4.0/v4.1 by mandate).
- Tree state: CLEAN (nothing staged, nothing untracked) at checkpoint; this document + closing worklog status lines are committed by the final `docs(release)` commit.
- Ahead of `origin/main`: **66** commits (remote main = 8454b3a, unpublished per GitHub-API check at stage 1 — re-verify before publish).
- Scope of this doc: commit ledger since `bbe286b`, disposition of every owner finding (resolved vs still open, each with risk + option), and the owner action plan (publish → CI on exact SHA → Docker gate → post-publish verification).

## 1. Gate status snapshot at checkpoint (all machine-verified)

| Gate | Result | Evidence |
|---|---|---|
| vitest (statics) | 49 files / 1011 tests, exit 0 | `v41-vitest-9ec40f7.log` |
| Runtime env-sync suite | PASSED 48/48, exit 0 | `v41-runtime-9ec40f7.log` |
| E2E canonical tally | PASS 148/0/0/1/149 — claim == recomputed, drift 0 | `e2e-tally/tally-contract-9ec40f7.json` (+ re-emitted `tally-contract-8252163.json`) |
| Production build | exit 0 (109 s, 331 routes), SHA-binding proven | `v41-build-9ec40f7.log` |
| Post-build live checks | health 200 + homepage render OK | `v41-postbuild-9ec40f7.log` |
| E2E smoke (prod, fresh) | 11 expected / 0 unexpected / 0 flaky, **EXIT=0** with the aligned readiness contract | `e2e-v41/smoke.prod.9ec40f7-run2.json` |
| Evidence hygiene scan | exit 0 (real findings 0; 243 synthetic markers) | re-ran `scripts/scan-evidence.mjs` after 97a32a6 |
| Production env template | exit 0 (6 required vars, 63 keys, CHANGE_ME placeholders only) | `production-env-template.mjs` |
| ensure-dev stack | exit 0; `:3000` health 200 + homepage 200 (aligned unmanaged probe — stage-4 prod bundle serving; dev-managed server retakes port on next cycle) | this session |

Smoke/run2 live health shape during the run: `status:"degraded"`, `auth:"unreachable"`, `database:"ok"`, `environment:"production"` — exactly the documented 8cbf9c6 production shape, now accepted by the spec's coherence invariant (not by a weakened check — see §2, commit 47ba4d4).

## 2. Commit ledger v4.1 (from bbe286b onward — one line each)

| SHA | Message (abridged) | Logical change |
|---|---|---|
| `bbe286b` | ops(checkpoint): v4.1 stage-1 evidence | Checkpoint baseline: ahead 52/behind 0, remote main 8454b3a verified unpublished, upload-routes drift #7 restored with diff evidence, vitest 928→925 reconciled (health 9→6, zero assertion loss), build SHA-binding proven. Evidence-only. |
| `8e67d3b` | fix(catalog): expose product fillings through card API + mapper (U-06) | `PRODUCT_CARD_COLUMNS` += `products.fillings` (raw jsonb passthrough) + `ApiProduct.fillings` + normalization in `mapApiProductToProduct` — slice gallery gate `product.fillings.length > 0` now reachable on live data; 3 test files; live-verified with synthetic `product_slices` row + byte-exact cleanup. Resolves owner finding #5 (U-06). |
| `b8bdcbf` | fix(postgrest): preserve base-table PK in embedded select translation (DEV-19) | PostgREST shim keeps the base-table PK in embedded-resource selects — CRM ticket list rows carry `id`, enabling client-side ticket-by-id actions; tests + live spot-check with CSRF pair. Resolves owner finding #2 (ticket-list id). |
| `0bcb79a` | fix(upload): coherent oversized-payload error contract (DEV-20) | Pre-parse 422 via Content-Length on both upload routes (body-parse 400 no longer preempts the 10 MiB contract); platform cap documented; limit unchanged. Resolves owner finding #4 (oversize 400-vs-422). |
| `87fe425` | fix(checkout): stable idempotency key per logical submission (U-07) | Client generates a stable key that survives remount/reload/retry — double-click, network-timeout replay and post-reload resubmit no longer duplicate orders; deliberate re-order gets a fresh key (no false replay); server opt-in contract + unique index 0060 regression-tested; live 15/0 (same-key replay, no-key opt-in, 4× parallel race, lost-response). Client half of owner finding #1. |
| `1a19c29` | chore(agent-ctx): B-1 work record | Bookkeeping: agent-ctx record for the U-07 fix (no code). |
| `7bcf817` | fix(docker): simplex-bridge runs as non-root user (DEV-14) | 3 lines in `Dockerfile.simplex-bridge` (`chown -R node:node /app`, `USER node`, `ENV HOME=/home/node`) mirroring web/chat conventions; static checks 10/10 (compose has no user/volume overrides that would break it); runtime proof T1–T6 = owner Docker gate (§4). Resolves the code half of owner finding #7. |
| `50214d6` | ops(config): v4.1 re-verification — contracts present (DEV-12/13/15/16) | Evidence-only re-verification at HEAD: MEILI_URL on web in-network, GIT_SHA→APP_VERSION in CI+Dockerfile, mailu.env profile wiring, `.env.production.example` contract — all PRESENT, zero code changes. |
| `8cbf9c6` | feat(health): GoTrue reachability preflight in readiness (DEV-18) | `/api/health` gains a LIVE GoTrue probe (`GET {base}/auth/v1/health`, 3 s, same base-path as `admin.createUser`); top-level `auth` + `auth_gotrue` dependency; production configured-but-unreachable → `status:"degraded"` BY DESIGN (registration fail-closed 500), dev/staging no false positive; fail-closed registration gate untouched (0 diff) and regression-locked. Root of the smoke drift fixed in 47ba4d4. |
| `9ec40f7` | ops(evidence): redact hygiene finding in config re-verify doc (C-3) | Hygiene: false-positive value redacted with marker + scanner learns `[REDACTED BY C-N HYGIENE]`; scan exit 1→0. |
| `8252163` | ops(gates): v4.1 stage-4 gate suite on 9ec40f7 | Stage-4 evidence: desync remediation, runtime 48/48, statics 1011/1011, e2e dev re-verified (IAF 17/17 after OOM-retry, PWI 12/12), prod build PASS, prod smoke 10/1 with ONE genuine finding (smoke health `degraded` vs spec `ok`) recorded honestly, sanity sweep exits 0. |
| `97a32a6` | ops(evidence): redact placeholder db-conn in v41 vitest log + scanner downgrade (E-1) | Hygiene found at final sweep: the vitest log (committed in 8252163 outside the step-6 pre-commit scan set) carried 3 real-class hits — a literal placeholder connection string from the http-helpers fixture and 2 name-based hits on the admin client's documented absence warning. Value redacted with marker; scanner gains a narrow line-format downgrade for the absence warning + task-generic redaction marker. Regression: real-shaped secrets still FINDING (exit 1). Scan exit 0. |
| `47ba4d4` | test(e2e): smoke health assertions aligned with auth-preflight readiness contract (8cbf9c6 follow-up) | `smoke.spec.ts` health test: hardcoded `status==='ok'` (would fail every prod nightly without a Supabase stack) replaced by the documented coherence invariant — status ∈ {ok,degraded}; production `auth:"unreachable"` ⇒ `degraded`; `status:"ok"` ⇒ auth ok or non-production, AND `database:"ok"`; service/timestamp presence checks kept verbatim. Fresh prod re-run 11/0/0/0 EXIT=0 first attempt (`smoke.prod.9ec40f7-run2.json`). Note: the prod-unreachable implication is environment-qualified because dev `unreachable`+`ok` is the documented anti-false-positive contract (8cbf9c6 vitest) — stronger overall, nothing weakened. |
| `b567b42` | docs(worklog): v4.1 execution log — stages 1-4, agent records, machine-readable tally contract | Bookkeeping: worklog v4.1 sections (A-1c…D-1r + E-1 status lines), agent-ctx C-1 (auth preflight) and C-2 (simplex non-root + config re-verify) records, machine-readable tally contracts (9ec40f7 + 8252163 emission). |

## 3. Owner findings disposition

### 3a. Resolved in v4.1 (code + tests + live/static evidence)

| Finding | Resolution commit | Proof |
|---|---|---|
| U-06: cutaway section unreachable (card API never returned `fillings`) | `8e67d3b` | Live positive case on real data (synthetic `product_slices` row inserted → gallery rendered → cleanup byte-exact); unit tests both sides of the contract |
| Ticket list rows lack `id` (shim hid join PK) | `b8bdcbf` | Shim translation fixed, embed-consumer audit, live spot-check with CSRF pair |
| Upload oversize: 400 at body-parse preempted the 422/10 MiB contract | `0bcb79a` | Pre-parse Content-Length 422 on both routes; contract documented; limit unchanged |
| Checkout duplicate on retry/timeout/reload (client had no stable key) | `87fe425` | Live verifier 15/0: same-key×2 = 1 order; 4× parallel race resolved by unique index 0060; lost-response replay returns same orderId; no-key behavior unchanged (opt-in — see 3b) |
| Auth production-readiness blind spot: no live GoTrue check in readiness | `8cbf9c6` (+ spec alignment `47ba4d4`) | 5 new health unit tests + 3 register fail-closed regressions; prod smoke re-run green with the real degraded shape |
| Simplex-bridge runs as root (P1 risk-accept decision was pending) | `7bcf817` | Static 10/10; runtime T1–T6 explicitly left to owner Docker gate (3b/§4) |

### 3b. Still open for owner (each with risk + option) — NO code changed by v4.1 on these

1. **Checkout no-key opt-in contract.** POST `/api/checkout` without `Idempotency-Key` creates a new order every call (documented opt-in; index 0060 only guards keyed requests). Risk: any non-UI client (script, curl replay, future integrations) can silently duplicate orders; financial-adjacent. Option A: make the key REQUIRED server-side (422 without it) — breaking contract change, needs client rollout; Option B: keep opt-in but document it in the public API reference and monitor duplicate orders by `user_id`+`metadata`. 
2. **Ticket duplicate-on-resubmit.** Byte-identical resubmit of `POST /api/crm/tickets` → 2×201 (observed live). Risk: support-queue noise, double-work. Option A: honor `Idempotency-Key` on ticket creation (reuse checkout extract helper); Option B: one-open-ticket-per-order guard (partial unique index) — cheapest.
3. **`product_slices` / `products.fillings` content ops.** The pipeline is code-complete, but nothing in prod populates fillings/slices (admin UI has no editor for them). Risk: the U-06 feature stays invisible in production content until data exists. Option: define the content workflow (SQL seed or admin CRUD) and fill real data for flagship cakes first.
4. **U-06 needs real cutaway content.** Verification ran on a synthetic slice row (cleaned up afterwards). Risk: gallery unproven against real imagery at scale (aspect ratios, alt-texts). Option: owner uploads real slice images for 2–3 products, then re-runs the U-06 positive-case check on live data.
5. **Checkout 200-vs-201 semantics.** Order creation answers 200 (not 201) with the order payload. Risk: contract mismatch for strict API consumers; zero functional impact in-app. Option A: switch to 201 + update api-v2 expectations; Option B: document 200 as the contract. Either is a one-line change + regression sweep.
6. **Simplex runtime T1–T6 (Docker gate).** Non-root image is built by CI only after publish; the sandbox has no Docker engine. Risk: unproven runtime behavior of `USER node` against `/app/simplex.db` writes (EACCES class) — the exact unknown the v4.0 assessment flagged. Option: run the T1–T6 checklist (§4); rollback on any failure = delete the 3 lines + rebuild (documented in `simplex-bridge-nonroot-impl-1a19c29.md` §5).
7. **Firefox/WebKit E2E coverage (future task).** e2e.yml matrix is pinned chromium-only by owner decision variant B; firefox/webkit projects remain commented out in `playwright.config.ts`. Risk: cross-engine regressions (CSS/JS) unseen by nightly. Option: enable the projects, validate specs on both engines, then restore the matrix + the `browser` dispatch input (TODO block in workflow header).
8. **U-16: real auth provider topology.** All GoTrue evidence is sandbox-derived (stub → 501; unit-level probes). Fail-closed registration is regression-locked, but the real provider behavior (Kong gateway apikey handling on `/auth/v1/health`, latency > 3 s timeout, multi-tenant topology) is unproven. Risk: production readiness could misclassify a slow-but-working provider as `unreachable` → `degraded` (fail-closed 500 on registration until fixed). Option: in the owner environment run `GET {SUPABASE_URL}/auth/v1/health` with the apikey header, confirm 2xx within 3 s (or raise `GOTRUE_PROBE_TIMEOUT_MS` consciously), then run the full stack with `E2E_FULL_STACK=1` so smoke sees `auth:"ok"/status:"ok"`.

## 4. Owner actions (ordered)

### 4.1 Publish → CI on the exact SHA
1. Re-verify remote state, then push `main` to `origin` (66 commits ahead at checkpoint b567b42; the final handoff commit adds one more — publish the EXACT SHA you audit, and record it).
2. Watch `ci.yml` on that SHA: lint/typecheck/vitest/build matrix must be green; the web image is built with `GIT_SHA=<sha>` → `APP_VERSION` (verify `/api/health` `version` equals the published SHA in the deployed environment).
3. Nightly `e2e.yml` (chromium, prod server, no Supabase stack) is expected green from 47ba4d4 onward: health smoke accepts the documented `degraded`+`not-configured`/`unreachable` prod shapes and still hard-fails on any incoherent readiness body.

### 4.2 Docker gate (simplex non-root, T1–T6 — from `simplex-bridge-nonroot-impl-1a19c29.md` §5)
- T1 `docker compose --profile simplex build simplex-bridge`
- T2 `docker compose --profile simplex up -d smp-server web simplex-bridge` then `docker compose ps` → healthy after start_period 30 s
- T3 `docker exec conditera-simplex-bridge sh -c 'id; echo HOME=$HOME; ls -la /app /home/node/.simplex'` → uid 1000 (node), HOME=/home/node, `.simplex` owned by node
- T4 round-trip inside the network: create profile via the bridge API (bridge API key header) → 200; send a message → inbound event reaches the web `/api/simplex/incoming` endpoint
- T5 `docker restart conditera-simplex-bridge` → health 200 → profile/contacts persisted (non-root re-read the DB)
- T6 `docker inspect --format '{{.State.Health.Status}}'` → healthy; `docker logs conditera-simplex-bridge 2>&1 | grep -Eic 'EACCES|EPERM|permission denied'` → 0
- Any failure → rollback: remove the 3 lines (`RUN chown…`, `USER node`, `ENV HOME`) + rebuild; re-open the finding with the log excerpt.

### 4.3 Post-publish verification checklist
- [ ] CI green on the exact published SHA (both workflows; record run URLs next to this doc)
- [ ] Deployed `/api/health`: HTTP 200; `database:"ok"`; with the real auth provider reachable → `status:"ok"`, `auth:"ok"` (if `degraded`+`unreachable` appears in PRODUCTION, registration is fail-closed — fix provider reachability, do not mute the probe)
- [ ] Real end-to-end registration of one user through the deployed prod (exercises the GoTrue admin path the preflight protects)
- [ ] Docker gate T1–T6 passed and recorded (§4.2)
- [ ] Production env: all 6 required vars filled with real values in `.env.production` (template contract verified at 50214d6); mailu.env provided if mail/full profile used
- [ ] `node scripts/scan-evidence.mjs` exit 0 on the published tree (true at b567b42 and after the handoff commit — re-run after any future evidence change)
- [ ] Decide + record dispositions for the 8 open items in §3b (one line each: chosen option, date, owner)

## 5. Provenance

- Generated by task E-1 (Release Gate v4.1, final alignment + bookkeeping), UTC 2026-10-16.
- All claims above are bound to evidence files in `docs/evidence/` (release-gate + e2e-v41 + e2e-tally) and `agent-ctx/` records; nothing in this document requires trusting session memory.
- v4.1 chain: bbe286b (stage 1) → 8e67d3b/b8bdcbf/0bcb79a/87fe425 (stage 2 fixes) → 7bcf817/50214d6/8cbf9c6/9ec40f7 (stage 3) → 8252163 (stage 4 gates) → 97a32a6/47ba4d4/b567b42 (E-1 final alignment + bookkeeping) → this commit (Этап 5 handoff).
