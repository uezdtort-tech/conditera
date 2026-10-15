# Evidence Hygiene Report — d6d5f9c

- Date: 2026-10-15
- HEAD: `d6d5f9c0ea10c3bd7fc6fdd7c1e5d928743b84a1`
- Scope: all 20 tracked files under `docs/evidence/` (incl. the two runtime logs added in `d6d5f9c` and the `.gitignore` whitelist `!docs/evidence/**/*.log`).
- Tool: `scripts/scan-evidence.mjs` (redacted scanner — output is path/line/category/marker only; matched values are never printed or stored).
- Command: `node scripts/scan-evidence.mjs` → exit code 0.

## Categories scanned
private keys; Bearer tokens; JWT-like tokens; cookie headers; Supabase service-role keys; API-key patterns (sk-/ghp_/github_pat_/AKIA); DB connection strings with credentials; .env secret assignments (JWT_SECRET, BOT_SECRET, MEILI_MASTER_KEY, POSTGRES_PASSWORD, CRON_SECRET, N8N_ADMIN_PASSWORD, SIMPLEX_BRIDGE_API_KEY, SUPABASE_*, OPENAI_API_KEY, …); password literals; phone/email PII.

## Result
- Real findings: **0**
- Synthetic-test-data markers: **24** (all verified by manual line inspection, values masked):
  - `e2e-tally-verify-7a8d878.txt` / `runtime-verify-pass-48-7a8d878.log` — digit-run false positives (table numbers, UUID sequences).
  - `TALLY.md:86`, 4× `*.prod.json` — the documented fixed test fixture phone `+79990000000` (synthetic, and itself the subject of DEV-05 remediation).
- Email-like matches across all 20 files: **0**.

## Manual verification of markers
Confirmed locally (values masked): markers are UUIDs, numeric table cells, and the synthetic test phone documented in TALLY.md — no live credentials, cookies, tokens, or customer PII.

## Verdict
EVIDENCE HYGIENE: **PASS**. Tracked evidence (including the two runtime logs whitelisted in `d6d5f9c`) is safe to keep/serve as release proof. No redaction, no owner credential-rotation action required.

Residual risk (tracked): DEV-05 must replace the fixed fixture phone with per-run unique values so future evidence does not accumulate even synthetic PII-like data.
