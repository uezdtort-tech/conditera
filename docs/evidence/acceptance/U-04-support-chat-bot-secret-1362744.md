# U-04 — Support chat (BOT_SECRET path) + client-side secret exposure scan

**Status: PASS**

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:10–19:12 (gate run), 19:12 (static scan)
- Environment: live dev stack :3000 + chat-server :3030.

## Support-chat coverage (from the same fresh 48/48 gate run as U-03)

Relevant lines from `docs/evidence/acceptance/U-03-runtime-gate-1362744.log`:

- `✅ create support room A — type=support`
- `✅ room:join A → support room` (online_users relayed)
- `✅ bot:quick_reply в своей комнате: userMsg получен`
- `✅ support: FAQ bot-ответ получен (real-time)` — bot reply delivered in real time
- `✅ bot:quick_reply B в чужую → message:error, C ничего не получил` (authorization)
- `✅ support: bot-ответ персистентен (BOT_SECRET работает)` — bot answer persisted through the `x-bot-secret` authenticated Next route

## Client-side BOT_SECRET exposure scan (requirement: none)

```
grep -rn "BOT_SECRET" src/            → only 2 files:
  src/app/api/chat/bot-trigger/route.ts        (server route; fail-closed if env missing)
  src/app/api/chat/rooms/[id]/bot-message/route.ts (server route; x-bot-secret timing-safe check)
"use client" check per file            → none of them is a client component (server-side API routes)
grep BOT_SECRET in src/components src/lib → 0 matches
grep "NEXT_PUBLIC.*BOT"               → 0 matches (no public env leak path)
mini-services/chat-server/index.ts    → BOT_SECRET consumed server-side only (sends x-bot-secret header to Next)
```

Result: **no `"use client"` file imports/references BOT_SECRET**; the secret is confined to server routes + chat-server process env.

## Artifacts

- `docs/evidence/acceptance/U-03-runtime-gate-1362744.log` (shared artifact with U-03; hygiene scan clean — see U-03 file)
