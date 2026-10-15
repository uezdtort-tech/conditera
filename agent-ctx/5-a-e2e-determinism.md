# Task 5-a — E2E determinism + per-spec tally contract (DEV-05/06/07)

Agent: Z.ai Code (e2e-determinism)
Date: 2026-10-15
Commits: 3b50ad0 (DEV-05), daedd88 (DEV-06/07). No push.

## What was done
1. **DEV-05 — fixture determinism** (`tests/e2e/integration-auth-flow.spec.ts`):
   - Defect (TZ §8.2) confirmed: fixed fixture phone `+79990000000` → second run got 409 phone-taken, misclassified as "email taken" → `test.skip()` → cascade skips of steps 2–4.
   - Fix: per-run unique fixtures `e2e-<runid>@e2e.test` (RFC 2606 .test) + `+7999<7 random digits>` (lines 34–43, exported); 409 classified BY RESPONSE BODY (route returns `{error:"Телефон уже зарегистрирован"}` vs `{error:"Email уже зарегистрирован"}`, see `src/app/api/auth/register/route.ts` steps 3–4) → PHONE_TAKEN/EMAIL_TAKEN, test FAILS (lines 50–94); 429/500 fail with error+retryAfter; `test.describe.serial` removed (serial itself cascades skips), steps 2–3 assert preconditions honestly (login must 200, fresh refresh must 200), step 4 independent CSRF-negative.
   - Only permitted skip in suite remains E2E_FULL_STACK (onboarding-flow.spec.ts:60).
   - Audited unchanged: `auth-flow.spec.ts:30` fixed values are in a validation-negative path (password `123` → 400 before uniqueness, no DB state); onboarding-flow already per-run unique.
   - Evidence: two consecutive canonical-runner dev runs — run1 @ f28b090 and run2 @ d2f192b, both `expected=17 unexpected=0 flaky=0 skipped=0`, exit 0. Artifacts: `integration-auth-flow.dev.f28b090-run1.json`, `integration-auth-flow.dev.d2f192b-run2.json`.
2. **DEV-07 — verifier** (`scripts/verify/e2e-tally-contract.mjs`):
   - Identity = (spec, recorded-mode, projects, startTime) — never filename guesswork; byte-identical group members = one logical run (`integration-auth-flow.early-prod.json` ≡ `.prod.json`, same sha256+startTime); different bytes at same identity → FAIL.
   - Exclusions R1 (OOM-evidence partial run), R2 (duplicate copy), R3 (non-canonical-mode diagnostics: payment-webhook.prod IP-gate 3/1/8; integration-auth-flow.prod — recorded mode behaviorally unconfirmable, honestly documented).
   - Determinism: same-(spec,mode) runs must have identical stats; newest = canonical, older = corroboration. Skip audit: only E2E_FULL_STACK allowed. Recomputed totals vs claim 148/0/0/1/149 + per-spec drift vs TALLY.md table.
   - Output: `docs/evidence/e2e-tally/tally-contract-3b50ad0.json` (paths/hashes/counts/modes only).
   - Result: RECOMPUTED TOTALS 148/0/0/1/149 == claim; VERDICT PASS; exit 0.
3. **DEV-06 — TALLY.md**: rewritten as "AGGREGATED PER-SPEC CANONICAL TALLY — не единый прогон" with 12-column per-spec runtime contract (mode, command, SHA, DB, artifact, exit, counts, skip reason), identity/dedup rules, SHA provenance (`sha-absent-in-artifact` + session 89b6708 + re-verify 7a8d878 + HEAD encoded in -runN names), recorded-mode-vs-behavior discrepancy note, fixture determinism section.

## Gotchas for next agents
- Playwright JSON reporter does NOT embed source SHA or runtime env — provenance lives in TALLY.md + filenames; keep the `<spec>.<mode>.<HEADshort>-run<N>.json` convention for new canonical runs.
- Parallel agents commit to main frequently — HEAD moves mid-session; artifact filenames pin the HEAD each run actually used (run1/run2 differ: f28b090/d2f192b, spec code identical between them).
- Canonical runner `scripts/e2e-one.sh` restarts :3000 by design (its reproducibility contract); PG :54329 / chat :3030 untouched. Anti-fraud register window is 3/hour — check `order_fraud_logs` (action=register) before reruns; do NOT delete rows manually.
- Verifier hard-fails if TALLY.md table is not the full 12-column per-spec contract; keep table format in sync with `parseTallyTable()`.
- worklog.md Task 5-a section appended but intentionally UNCOMMITTED (repo convention: prior agent sections left uncommitted).
