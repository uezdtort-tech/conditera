# U-12 — Upload (general) `POST /api/upload` live probe

**Status: PASS** (one documented contract note on the oversize case)

- HEAD: `1362744` (1362744c442b5f3f66f12ac51742b772f4a28697)
- Date (UTC): 2026-10-15 19:28–19:29
- Route studied first: `src/app/api/upload/route.ts` + `src/lib/upload-service.ts` (auth 401; `MAX_UPLOAD_BYTES = 10 MiB` → 422 FILE_TOO_LARGE; `sniffMime` magic-bytes → 415 UNSUPPORTED_MEDIA_TYPE; storage shim bucket `media` → files under `upload/storage/media/<category>/<uuid>.<ext>`, served by `src/app/storage/v1/[...path]/route.ts`).

## Steps and observed results (probe `node .run/acc/u12-u13.mjs`, exit 0; tiny 1×1 PNG generated in-memory, 69 bytes; CSRF pair per canonical helper)

| case | request | code | observed |
|---|---|---|---|
| a | no auth, no CSRF | **403** | edge CSRF gate fires first (`CSRF-токен отсутствует…`) |
| a2 | valid CSRF pair, **no auth token** | **401** | route-level auth: `{"error":"UNAUTHORIZED","message":"Требуется аутентификация"}` |
| b | valid auth (minted confectioner probe token, roles from DB), **no CSRF** | **403** | CSRF gate: header/cookie pair required for POST |
| c | valid auth + CSRF + 1×1 PNG (`multipart/form-data`, field `file`, category `acc-u12`) | **201** | `{url}` — absolute path `…/storage/v1/object/public/media/acc-u12/<uuid>.png` (uuid filename; original name not stored) |
| c read-back | `GET <returned url>` | **200** | 69/69 bytes; `content-type: image/png`; **sha256 sent == sha256 read-back → MATCH** (`ce2295b5…fb5875`, hash only in evidence) |
| d | `text/plain` upload (magic-byte sniff) | **415** | `{"error":"UNSUPPORTED_MEDIA_TYPE","message":"Файл note.txt: тип не распознан (допустимы JPEG/PNG/WebP/GIF/MP4/WebM/PDF)"}` |
| e | oversize blob (>10 MiB, `.png` name) | **400** | live body-parse rejection `{"error":"BAD_REQUEST","message":"Ожидается multipart/form-data"}` — see note |

### Note (FINDING, no action taken)

Code-level size gate is `422 FILE_TOO_LARGE` at 10 MiB (`src/lib/upload-service.ts:52-57`), but a >10 MiB multipart body is rejected **earlier** by the runtime body parse (400 BAD_REQUEST, caught by the route's formData try/catch). Root cause confirmed in `dev.log`: `Request body exceeded 10MB for /api/upload. Only the first 10MB will be available unless configured` — Next.js truncates the body at 10 MB, the multipart payload becomes unparsable, `request.formData()` throws → route returns 400. Both are 4xx rejections; the 422 branch is not reachable live for bodies this size in this runtime. Tuning `middlewareClientMaxBodySize` (or pre-parse rejection) is owner's call — documented as observed contract.

## Cleanup (finally)

All uploaded files deleted from `upload/storage/media/` and matching `storage.objects` rows removed: `files deleted=3 of 3` (incl. leftover from the first aborted probe run). Category dir `acc-u12` removed.

## Artifacts

- `.run/acc/u12-u13.mjs`, `.run/acc/u12-u13-transcript.txt` (gitignored; sha256 hashes only, no secrets)
