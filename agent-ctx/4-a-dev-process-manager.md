# Task 4-a — dev-process-manager (DEV-04, TZ v4.0 §7)

Agent: Z.ai Code
Status: DONE, commit 23b437f (single commit, not pushed)

## What was built
- `scripts/lib/dev-process-manager.mjs` — managed process lifecycle (ensure-chat/ensure-next/status CLI):
  ownership via state file `.run/ensure-dev.state.json` (kill only recorded groups, never by name/port),
  non-secret fingerprints sha256(secret)[0:12], env extraction via /proc/<pid>/environ,
  managed fingerprint change → safe group restart; unmanaged → diagnose only
  (aligned → continue; desync → exit 2 + actionable DESYNC message naming PID).
  ensureNext unmanaged: functional probe GET /api/profile (garbage token must 401, current-secret HS256 token must NOT 401).
- `scripts/ensure-dev.sh` — chat/next blocks now call the manager (secrets via environment, set -u, exit-2 propagation, idempotent).
- `scripts/verify-process-env-sync.mjs` — regression on isolated ports 13030/13032/13033 + isolated state file:
  8 scenarios incl. A→B secret rotation restart, socket.io handshake accept(B)/reject(A), unmanaged aligned/desync, secret hygiene (values + 16-char substrings).
- `.gitignore` — added `/.run/`.

## Key runtime decisions (fingerprints only)
- :3030 listener PID 3692 fingerprint e0022e0df8f9 == .env.local → ALIGNED → kept.
- pgids 1042/917 were MIXED groups (chat + n8n-receiver + simplex-bridge) → individual PID kills only: 1180, 1210, 1230, 1240 (chat-server cwd dupes). n8n/simplex members untouched.
- :3000 next PID 3418 → ok-unmanaged-aligned-probe (404 = signature verified) → left running.

## Results
- Regression: PASS 13/13 (node AND bun), clean finally-cleanup.
- ensure-dev.sh ×2: exit 0/0, idempotent, no restarts.
- Runtime gate verify-chat-runtime.mjs: PASSED 48/48, exit 0.
- scan-evidence.mjs: exit 0 (0 real findings).
- Evidence: process-cleanup-before-a0ace2c.txt, process-env-sync-regression-a0ace2c.log, runtime-verify-after-desync-fix-a0ace2c.log, process-env-sync-remediation-a0ace2c.log.

## Deviations (documented in worklog)
1. chat signature via cmdline + cwd==chat-server dir (group leader `bun run dev` lacks index.ts in cmdline).
2. Managed branch additionally requires listener pgrp == recorded group (port ownership).
3. envLocalHash stored as sha256[0:12].
4. Probe endpoint /api/profile (getUserFromRequest; spec's "getAuthUser").
5. Test port 13031 reserved; numbered scenarios cover chat only (full next lifecycle exercised live on :3000).
