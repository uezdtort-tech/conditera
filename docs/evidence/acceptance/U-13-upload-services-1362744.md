# U-13 — Upload (services) `POST /api/services/upload` live probe

**Status: PASS** (same oversize contract note as U-12)

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:28–19:29
- Route studied first: `src/app/api/services/upload/route.ts` (field `files`, 1..`MAX_UPLOAD_FILES=8` → 400; shares `src/lib/upload-service.ts` engine with `/api/upload`; category hardcoded `services`).

## Steps and observed results (same probe run as U-12: `node .run/acc/u12-u13.mjs`, exit 0; 1×1 PNG in-memory)

| case | request | code | observed |
|---|---|---|---|
| a | no auth, no CSRF | **403** | edge CSRF gate first |
| a2 | valid CSRF, no auth token | **401** | `{"error":"UNAUTHORIZED",…}` (route auth) |
| b | valid auth, no CSRF | **403** | CSRF gate |
| c | valid auth + CSRF + 1×1 PNG (field `files`) | **201** | `{urls:[…]}` → `…/storage/v1/object/public/media/services/<uuid>.png` |
| c read-back | `GET <returned url>` | **200** | 69/69 bytes; `image/png`; **sha256 sent == sha256 read-back → MATCH** (`ce2295b5…fb5875`) |
| d | `text/plain` | **415** | `UNSUPPORTED_MEDIA_TYPE` (magic-byte sniff, identical message contract as U-12) |
| e | oversize >10 MiB | **400** | live body-parse rejection `BAD_REQUEST` (see U-12 note; code-level gate 422/10 MiB not reachable live at this size) |

Also verified statically: >8 files in one request → 400 `TOO_MANY_FILES` (route logic `src/app/api/services/upload/route.ts:50-55`; not exercised live — covered by reading the route; per-file errors short-circuit in `saveUploadedFiles`).

## Cleanup (finally)

Uploaded file deleted from `upload/storage/media/services/` + `storage.objects` row removed: `files deleted=3 of 3` across both routes in the run.

## Artifacts

- `.run/acc/u12-u13.mjs`, `.run/acc/u12-u13-transcript.txt` (gitignored)

---

## FIX VERIFIED (v4.1) — oversize-контракт когерентен (DEV-20, Task A-3c)

Несогласованный ответ на oversize (400 BAD_REQUEST вместо code-level 422, см. примечание в U-12) устранён тем же общим хелпером: `parseUploadRequest` (`src/lib/upload-service.ts:81-100`) в этом роуте (`src/app/api/services/upload/route.ts:38-52`) гейтит по Content-Length до разбора тела — `Content-Length > MAX_UPLOAD_BYTES` (10 МБ, лимит не менялся) → **422** `{"error":"FILE_TOO_LARGE","message":"Файл слишком большой: больше 10 МБ"}` (pre-parse, storage не вызывается); chunked без Content-Length — задокументированный 400. Live-прув (10.5 MiB → 422; малый PNG → 201 в `services/`) и тесты — см. `U-12-fix-oversize-contract-b8bdcbf.md`.
