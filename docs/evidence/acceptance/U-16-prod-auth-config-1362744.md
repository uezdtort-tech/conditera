# U-16 — Production auth config: fail-closed registration gate (static re-verification)

**Status: PASS for fail-closed verification · NEEDS OWNER DECISION for real provider topology**

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:30
- Baseline citation: `docs/evidence/release-gate/auth-prod-preflight-82ae685.md` (exists, verdict «fail-closed ПОДТВЕРЖДЁН»).

## Why static-only (explicit)

Toggling `NODE_ENV=production` behavior cannot be done safely on the live shared dev server: the running Next process on :3000 is shared, env is loaded at start, and restarting/reconfiguring is prohibited for this task. One fresh confirmation is therefore a **static re-verification of the gate lines** on HEAD `1362744` (the preflight doc was recorded at `82ae685`).

## Fresh static verification (this HEAD)

1. **Prod gate (fail-closed)** — `src/app/api/auth/register/route.ts:261-267`:
   on `authErr` (GoTrue admin `createUser` failure):
   ```ts
   if (process.env.NODE_ENV !== "development") {
     return NextResponse.json({ error: "Не удалось создать пользователя в Auth", details: authErr.message }, { status: 500 });
   }
   ```
   The `return` precedes the dev-only `auth.users` stub INSERT (`:276-290`) and the profiles/user_roles upserts (`:292+`) → in production a GoTrue failure yields **500 with zero auth.users/profiles/user_roles rows**. Behavior gate (by `authErr` fact), not env-presence gate — matches preflight doc §2.
2. **Stub admin client warns in prod** — `src/lib/supabase/admin.ts:27-33`: `_isStub = !supabaseUrl || !serviceRoleKey`; when stub and `NODE_ENV === "production"` an explicit console warning is emitted (fail-closed at call time for admin ops).
3. **Local GoTrue stub remains 501** — `src/app/auth/v1/[...path]/route.ts:16-27`: all `/auth/v1/*` → `501 LOCAL_AUTH_DISABLED` (unchanged), i.e. the `authErr` trigger is deterministic in local prod-like runs.

No code changed between `82ae685` and `1362744` in these files (verified by reading current sources; gate lines identical to the cited preflight).

## NEEDS OWNER DECISION (unchanged from preflight)

Whether production will run a **real GoTrue/provider topology** (self-hosted Supabase with service-role env) — the fail-closed gate above is verified, but the actual prod registration path (`auth.admin.createUser` accepted) can only be proven against the owner's real provider; not testable in this sandbox (no Docker stack).

## Artifacts

- `docs/evidence/release-gate/auth-prod-preflight-82ae685.md` (baseline, cited)
- This file's quoted gate lines (static, from HEAD `1362744`)
