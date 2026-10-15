# U-01 — Register / Login / protected GET / duplicate register (API-level)

**Status: PASS**

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:12–19:13
- Environment: live dev stack :3000 (Next, hot reload), PG 127.0.0.1:54329/conditera. Nothing restarted, no build run.

## Steps and commands

Probe script: `node .run/acc/u01-auth.mjs` (transcript `.run/acc/u01-transcript.txt`; exit 0). Request shape taken from `tests/e2e/integration-auth-flow.spec.ts` (register body: `email/password/name/phone/role`; CSRF pair from `scripts/verify-chat-runtime.mjs`: `GET /api/csrf-token` → JSON token + `csrf_token` cookie → sent as `x-csrf-token` header + Cookie on mutations; `/api/auth/register` and `/api/auth/login` are CSRF-exempt per `src/proxy.ts:26-41`).

## Observed results

| step | request | code | notes |
|---|---|---|---|
| 0 | `GET /api/csrf-token` | 200 | token+cookie pair obtained (CSRF pair mechanics confirmed live) |
| 1 | `POST /api/auth/register` (synthetic: `acc-u01-<run>@conditera.test`, phone `+7999XXXXXXX`, role CUSTOMER) | **201** | body keys: `user, accessToken, refreshToken`; user.id captured |
| 2 | `POST /api/auth/login` (same synthetic credentials) | **200** | accessToken issued |
| 3 | `GET /api/profile` with `Authorization: Bearer <token>` | **200** | `profile.id === user.id` → signature accepted; `addresses: []` |
| 3b | `GET /api/profile` without token | **307** | edge middleware redirect to `/login` (fetch followed it on first attempt; re-run with `redirect:"manual"` shows 307; `curl -s` confirms 307; garbage `Bearer` token → **401** JSON `{"error":"Не авторизован"}`) |
| 4 | duplicate `POST /api/auth/register` (same email+phone) | **409** | body class `EMAIL_TAKEN`, static route text: «Email уже зарегистрирован» (registered-route reason class, no raw values in evidence) |

- Fresh unique synthetic email/phone generated per run (`acc-u01-<runid>@conditera.test`, `+7999…` from randomUUID).
- Protected GET with freshly issued token → 200: proves local JWT signing/verification path (register → login → Bearer accepted by `getUserFromRequest`).

## Cleanup (finally)

```
cleanup: user_roles=1 profiles=1 auth.users=1 (synthetic acc-u01 deleted)
```
Synthetic user fully removed (user_roles → profiles → auth.users stub). DB verified clean by returned rowcounts; both runs cleaned up (first run and re-run).

## Artifacts

- `.run/acc/u01-auth.mjs` (probe, untracked working file, gitignored `.run/`)
- `.run/acc/u01-transcript.txt` (redacted-safe: synthetic emails/phones only, no tokens/secrets printed)
- Contracts cross-checked against `src/app/api/auth/register/route.ts`, `src/app/api/profile/route.ts`
