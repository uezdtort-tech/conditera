# Release Gate v4.1 — Stage 4 Summary (task D-1 / D-1r)

**ALL results in this document are bound to HEAD `9ec40f729bd0f58fa9b4cfe1306cc072f7264733` (branch `main`).**
Executed 2026-10-16 (steps 1–5 by predecessor D-1 at 00:22–00:36 UTC; step 6 remediation + re-verification by D-1r at 00:48–01:14 UTC). No push performed.

## 1. Full step table (steps 1–6)

| # | Step | Command | Exit | Metric | Evidence |
|---|------|---------|------|--------|----------|
| 1 | Checkpoint | `git rev-parse HEAD; git branch --show-current; git status --short; git rev-list --count origin/main..HEAD` | 0 | HEAD `9ec40f7`, `main`, clean of gate files | `docs/evidence/release-gate/v41-checkpoint-9ec40f7.log` |
| 2 | Typecheck | `bun run typecheck` | 0 | `tsc --noEmit` clean | `docs/evidence/release-gate/v41-typecheck-9ec40f7.log` |
| 3 | Lint | `bun run lint` | 0 | `eslint .` clean | `docs/evidence/release-gate/v41-lint-9ec40f7.log` |
| 4 | Chat strict tsc | `cd mini-services/chat-server && bunx tsc --noEmit --strict …` | 0 | chat-server strict-clean | `docs/evidence/release-gate/v41-chat-tsc-9ec40f7.log` |
| 5 | Unit tests | `bun run test` | 0 | **Test Files 49 passed (49); Tests 1011 passed (1011)** | `docs/evidence/release-gate/v41-vitest-9ec40f7.log` |
| 6 | Runtime gate | `bun scripts/verify-chat-runtime.mjs` | attempt-1: **2** → remediated → rerun: **0** | attempt-1 DESYNC (chat :3030 held stale empty JWT secret); rerun **PASSED: 48/48** | attempt-1: `v41-runtime-attempt1-desync-9ec40f7.log`; diagnosis: `v41-chat-desync-fix-9ec40f7.log`; final: `v41-runtime-9ec40f7.log` |
| 6r | Desync remediation (D-1r) | orchestrator `kill 1202` → `bash scripts/ensure-dev.sh` | 0 | managed chat started `pid 20163`, fingerprint **`766c8ee89480`**; **triple-check MATCH** (manager state == `/proc/<pid>/environ` == `.env.local` manager-convention); chat `/health` 200; next `/api/health` 200 (`auth:"unreachable"`, top-level `status:"ok"` — dev-mode classification) | `v41-chat-desync-fix-9ec40f7.log` (sections «remediation EXECUTED», «remediation note») |
| 7 | Build | `bun run build` | 0 | **exit 0, 109 s, 331 page/route entries** (route-table rows 334 incl. 3 legend rows); pre-build: DEV-04 managed stop of chat pgid 20163 + next pgid 21370, ports verified FREE, MemAvailable ~3.3 GB | `v41-build-9ec40f7.log` |
| 7r | Post-build restart | `bash scripts/ensure-dev.sh` → health + render | 0 | managed chat `pid 22011` (fp `766c8ee89480`) + managed next `pid 22031` (`envLocalHash b7f1648add2f`); `/api/health` 200; `GET /` 200 with `<h1>` + title `Уездный кондитер — маркетплейс кондитерских изделий`; chat `/health` 200 | `v41-postbuild-9ec40f7.log` |
| 8 | Sanity sweep | `node scripts/scan-evidence.mjs` / `production-env-template.mjs` / `e2e-tally-contract.mjs` | 0 / 0 / 0 | hygiene: 0 real findings (tracked files AND the 9 new v41 files pre-commit); env-template: all required names present; tally contract: **VERDICT PASS — recomputed 148/0/0/1/149 == canonical claim, UNCHANGED** by D-1r work | `v41-sanity-9ec40f7.log` |

## 2. E2E re-verification (fresh runs at HEAD `9ec40f7`)

Artifacts in **`docs/evidence/e2e-v41/`** (NEW directory — the v4.0 canonical `docs/evidence/e2e-tally/` + its contract verifier are untouched; the verifier scans only `e2e-tally/` (hardcoded `EVIDENCE_DIR`), so these artifacts cannot pollute the 148/0/0/1/149 verdict — confirmed by the step-8 sweep).

| Spec | Mode | Command | Stats (expected/unexpected/flaky/skipped) | Exit | Artifact |
|------|------|---------|-------------------------------------------|------|----------|
| integration-auth-flow | dev | `E2E_SERVER_MODE=dev bash scripts/e2e-one.sh integration-auth-flow` | attempt-1: 9/8/0/0 → attempt-2: **17/0/0/0** | 1 → **0** | `integration-auth-flow.dev.9ec40f7-run1.json` (attempt-2) |
| payment-webhook-idempotency | dev | `E2E_SERVER_MODE=dev bash scripts/e2e-one.sh payment-webhook-idempotency` | **12/0/0/0** | **0** | `payment-webhook-idempotency.dev.9ec40f7-run1.json` |
| smoke | prod | `E2E_SERVER_MODE=prod bash scripts/e2e-one.sh smoke` | attempt-1: 4/7/0/0 → attempt-2: **10/1/0/0** | 1 / **1** | `smoke.prod.9ec40f7-run1.json` (attempt-2) |

Stats lines (from the runner's summary): `integration-auth-flow: expected=17 unexpected=0 flaky=0 skipped=0 EXIT=0`; `payment-webhook-idempotency: expected=12 unexpected=0 flaky=0 skipped=0 EXIT=0`; `smoke: expected=10 unexpected=1 flaky=0 skipped=0 EXIT=1`.
E2E narrative evidence: `v41-e2e-dev-9ec40f7.log`, `v41-e2e-prod-smoke-9ec40f7.log`.

## 3. Failures / skips — every one explained (nothing masked)

1. **Step-6 attempt-1 runtime DESYNC (exit 2)** — chat `:3030` was held by PID 1202 (`bun --hot index.ts`, cwd `mini-services/chat-server` — proven ours per DEV-04) with an EMPTY JWT secret (env fingerprint `e3b0c44298fc` = sha256 of empty) while `.env.local` had been regenerated (mtime 2026-10-15 22:10:30). `ensure-dev.sh` correctly refused to touch the unmanaged process and emitted the actionable `kill 1202` message (exit 2). Remediation (D-1r): re-inspected first (no double-start), process killed, `ensure-dev.sh` started a MANAGED chat; secret re-sync proven by fingerprint triple-check `766c8ee89480`; runtime gate re-run → 48/48.
   *Fingerprint method note:* predecessor logged `.env.local` fingerprint `e5f96af492ff` — that is sha256 of the secret value **including the trailing newline** (raw `sed` pipeline). The manager convention (command substitution strips the newline) yields `766c8ee89480`, which is what the manager, the state file and the live process env now agree on. The file itself never changed.
2. **integration-auth-flow dev attempt-1 (exit 1, 9/8/0/0)** — dev server died mid-run during on-demand route compilation (`socket hang up`, then 7× `connect ECONNREFUSED 127.0.0.1:3000`): the sandbox OOM pattern documented in the `scripts/e2e-one.sh` header (dmesg history: `Out of memory: Killed process … next-server`). Infrastructure, not functional: 9/17 passed before the crash; attempt-2 passed **17/17** (canonical for this gate). Attempt-1 raw JSON was overwritten by the runner before the copy step — stats line + per-test diagnosis preserved in `v41-e2e-dev-9ec40f7.log`.
3. **smoke prod attempt-1 (exit 1, 4/7/0/0)** — 6 failures = `browserType.launch: Executable doesn't exist … chromium_headless_shell-1234` (Playwright browser cache had only revision -1200). Tooling gap, remediated with `bunx playwright install chromium` (Chrome Headless Shell 151.0.7922.34, exit 0). 1 failure = the genuine finding below. Attempt-1 raw JSON overwritten by the runner before copy — classification preserved in the log.
4. **smoke prod attempt-2 — GENUINE FINDING (exit 1, 10/1/0/0), recorded, spec NOT modified** — `health endpoint returns 200 OK` failed: `expect(body.status).toBe('ok')` received `"degraded"` (HTTP 200). Root cause: commit `8cbf9c6` (v4.1 Этап 3.1) added the GoTrue reachability probe to `/api/health` with a production degradation gate (`NODE_ENV=production` + Supabase URL configured + GoTrue unreachable → top-level `status:"degraded"`). In this sandbox there is no real Supabase (stub answers 501), so prod mode degrades by design while dev mode reports `status:"ok"` (dev classification without production-failure). `smoke.spec.ts:40` still asserts the literal `'ok'` — spec drift vs `8cbf9c6` behavior, exactly the health-shape change risk the gate plan flagged. The gate plan anticipated a *field-set* change (assertions are presence-based, so shape alone would pass) — the actual change is the **value** of `status` in production. With the full-stack Supabase compose (documented `E2E_FULL_STACK` condition) GoTrue would be reachable and `status` would be `"ok"`. Finding stands as recorded; fixing the spec or masking the result was explicitly out of scope.
5. **onboarding-flow prod skip (v4.0 canonical, unchanged)** — skipped with the documented `E2E_FULL_STACK` condition (requires full Supabase stack; precedent `onboarding-flow.spec.ts:60`). The sole allowed skip in the canonical tally (1 skipped / 149 slots); verified unchanged by the step-8 contract verifier.
6. **Tool outages during D-1r** — three `broken session: 403 Forbidden` outages (one killed a step-1 mutation attempt twice; one delayed step-4). All retried per policy; no state was mutated during outages; the orchestrator executed the step-1 `kill 1202` and the step-4 managed stop during one outage. Every resume re-inspected process state before acting (no double-start).

## 4. Desync incident — remediation narrative

During step 6 the runtime gate failed (exit 2) because the chat service on :3030 was a survivor of an earlier `.env.local` regeneration: it held an empty JWT secret (fingerprint `e3b0c44298fc`) while the file on disk had a new one. The DEV-04 process manager correctly diagnosed the desync, refused to kill an unmanaged process by port, and printed the actionable `kill 1202` instruction. After orchestrator-assisted termination, `ensure-dev.sh` started a managed chat whose secret fingerprint `766c8ee89480` was proven identical across manager state, `/proc` environment and `.env.local` (fingerprints only — secret values never logged), and the full runtime gate then passed 48/48; the manager now also auto-restarts chat/next on future fingerprint drift.

## 5. Verdict

- Statics: typecheck 0, lint 0, chat-tsc 0, vitest **1011/1011** (49 files).
- Runtime gate: **48/48** after desync remediation.
- Build: **PASS** (exit 0, 109 s, 331 routes); managed dev stack verified healthy post-build (health 200 + homepage render).
- E2E re-verified fresh at `9ec40f7`: integration-auth-flow 17/17 (dev), payment-webhook-idempotency 12/12 (dev), smoke 10/1 (prod — one genuine, honestly-recorded spec-drift finding vs `8cbf9c6`; not masked, spec untouched).
- Sanity sweep: all exit 0; v4.0 canonical tally contract **VERDICT PASS, 148/0/0/1/149 unchanged**.
- Everything above bound to `9ec40f729bd0f58fa9b4cfe1306cc072f7264733`.
