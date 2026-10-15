# U-12/U-13 fix — когерентный oversized-payload контракт upload-endpoint'ов (Release Gate v4.1)

- **Task ID:** A-3c · **Date (UTC):** 2026-10-15 23:00–23:20
- **Base HEAD:** `b8bdcbf` (`b8bdcbf4b53ddd96c16657af9c0d06baff7182b9`, main) · no push
- **Scope:** закрыть FINDING «oversize → 400 BAD_REQUEST» из `U-12-upload-general-1362744.md` и `U-13-upload-services-1362744.md`: pre-parse 422 `FILE_TOO_LARGE` по Content-Length в общем хелпере, платформенный кап задокументирован, лимит 10 МБ не менялся (DEV-20).
- **Files:** `src/lib/upload-service.ts`, `src/app/api/upload/route.ts`, `src/app/api/services/upload/route.ts` + 3 тест-файла + `scripts/verify/upload-oversize-verify.mjs`. Файлы-запреты (`src/app/api/products/**`, `src/lib/postgrest/**`, `src/lib/supabase/use-marketplace.ts`, crm/payment/webhook/escrow/payout/refund) не тронуты.

## 1. Три зоны контракта (после фикса)

| зона | условие | ответ | примечание |
|---|---|---|---|
| Ниже лимита | Content-Length ≤ 10 MiB, валидный multipart | **201** `{url}` / `{urls}` | прежний путь, без изменений |
| Над app-гейтом | Content-Length > 10 MiB (`MAX_UPLOAD_BYTES`) | **422** `{"error":"FILE_TOO_LARGE","message":"Файл слишком большой: больше 10 МБ"}` | pre-parse: тело не читается, storage не вызывается |
| Над платформенным капом | тело > 10 MiB (клон тела для middleware/proxy обрезается молча) при Content-Length > 10 MiB | **422** `FILE_TOO_LARGE` (тот же) | гейт срабатывает ДО того, как обрезанное тело ушло бы в `formData()`; раньше здесь был бессмысленный 400 |
| Документированный край | chunked без Content-Length (или нечисловой), разбор не удался | **400** `BAD_REQUEST` «Ожидается multipart/form-data» | прежнее поведение сохранено сознательно; платформенный кап (`middlewareClientMaxBodySize`) НЕ трогали |

Форма ответа ошибки везде неизменна: `{error: <CODE>, message: <text>}`. 413 нигде не вводился (в upload-путях его не было и нет; 413 остаётся только в product-media, вне скоупа).

## 2. Chain (file:line, working tree @ verification time)

```
src/lib/upload-service.ts:21        MAX_UPLOAD_BYTES = 10 * 1024 * 1024  — ЛИМИТ НЕ МЕНЯЛСЯ
src/lib/upload-service.ts:49-51     OVERSIZE_UPLOAD_MESSAGE («Файл слишком большой: больше 10 МБ»)
                                    — формат согласован с per-file сообщением saveUploadedFile (…: больше N МБ)
src/lib/upload-service.ts:54-59     contentLengthOf() — CL как число или null (chunked/нечисловой)
src/lib/upload-service.ts:81-100    parseUploadRequest(request):
                                      :84-86  pre-parse гейт: CL > MAX → 422 FILE_TOO_LARGE (тело не читается)
                                      :90-98  catch: CL > MAX → та же 422 (defense-in-depth для зоны
                                              обрезки платформой); иначе 400 BAD_REQUEST (прежний контракт)
src/app/api/upload/route.ts:38-52         POST /api/upload         → parseUploadRequest + {error,message}
src/app/api/services/upload/route.ts:38-52 POST /api/services/upload → parseUploadRequest + {error,message}
Платформа (документировано, НЕ менялось):
node_modules/next/dist/server/body-streams.js:30      DEFAULT_BODY_CLONE_SIZE_LIMIT = 10 MiB
node_modules/next/dist/server/body-streams.js:95-106  молчаливая обрезка клона тела (p1.push(null))
                                                      → formData() бросает TypeError "Unexpected end of form"
src/proxy.ts                                        middleware/proxy присутствует → кап клона применяется
next.config.ts / Caddyfile                          капы тела отсутствуют; задокументированный knob
                                                    middlewareClientMaxBodySize не изменялся (owner's call)
```

## 3. Live probe (dev :3000, hot-reload; `node scripts/verify/upload-oversize-verify.mjs` → exit 0)

Паттерн `scripts/verify/product-media-verify.mjs`: CSRF double-submit pair из `GET /api/csrf-token` (cookie `csrf_token` + header `x-csrf-token`), login демо-кондитера `confectioner@demo.ru` (пароль — см. константу в verify-скрипте), `Authorization: Bearer <accessToken>`, случайный `x-real-ip` против анти-фрод лимита. Тела — Buffer через node fetch (fetch сам ставит честный Content-Length).

| запрос | статус | тело ответа |
|---|---|---|
| `POST /api/upload`, multipart 10.5 MiB (CL 10.50 MiB) | **422** | `{"error":"FILE_TOO_LARGE","message":"Файл слишком большой: больше 10 МБ"}` |
| `POST /api/upload`, multipart 12 MiB (CL 12.00 MiB) | **422** | `{"error":"FILE_TOO_LARGE","message":"Файл слишком большой: больше 10 МБ"}` |
| `POST /api/upload`, 1×1 PNG 67 B (CL ~0.3 KiB) | **201** | `{"url":"http://127.0.0.1:3000/storage/v1/object/public/media/acc-a3c/a2f67bc2-97d6-49d6-b7e3-8af7d09ccdeb.png"}` |
| read-back того же URL | **200** | `image/png`, 67/67 байт, sha256 совпадает с отправленным |
| `POST /api/services/upload`, multipart 10.5 MiB | **422** | `{"error":"FILE_TOO_LARGE","message":"Файл слишком большой: больше 10 МБ"}` |
| `POST /api/services/upload`, 1×1 PNG 67 B | **201** | `{"urls":["…/media/services/1581405f-4925-46ae-ba0d-cd97b79c4e6c.png"]}` |

ИТОГО: PASS 8 / FAIL 0, exit 0.

`dev.log` (обещание платформы задокументировано, контракт приложения когерентен):
```
Request body exceeded 10MB for /api/upload. Only the first 10MB will be available unless configured. See https://nextjs.org/docs/app/api-reference/config/next-config-js/middlewareClientMaxBodySize for more details.
 POST /api/upload 422 in 64ms (next.js: 3ms, proxy.ts: 50ms, application-code: 12ms)
 POST /api/upload 201 in 952ms (…)
 POST /api/services/upload 422 in 250ms (…)
 POST /api/services/upload 201 in 87ms (…)
```
(предупреждение body-streams печатается на этапе клонирования тела для proxy — до обработчика; приложение отвечает 422, а не старым 400).

Cleanup: загруженные мелкие файлы удалены — `storage.objects rows deleted=2, files deleted=2 из 2`; oversize-запросы файлов не создают (reject pre-parse). Категорийная директория `acc-a3c` удалена.

## 4. Регрессионные тесты (vitest, конвенции `src/app/api/health/route.test.ts` — герметично, vi.mock, без сети)

| файл | кейсы |
|---|---|
| `src/lib/upload-service.test.ts` (5) | граница гейта: CL = MAX ровно → form разбирается; CL = MAX+1 (мусор-тело) → 422 pre-parse; chunked без CL → 400; нечисловой CL → 400; OVERSIZE_UPLOAD_MESSAGE формат + лимит 10 MiB не менялся |
| `src/app/api/upload/route.test.ts` (7) | 401; CL = MAX+1 мусор → 422 pre-parse (storage не вызывается); реальное multipart > 10 MiB с честным CL → 422; валидный PNG → 201 + проверка пути/буфера/contentType в storage; мусор без CL (text/plain) → 400; chunked multipart мусор → 400; multipart без файла → 400 NO_FILE |
| `src/app/api/services/upload/route.test.ts` (8) | 401; CL = MAX+1 мусор → 422; реальное > 10 MiB → 422; валидный PNG → 201 в `services/`; мусор без CL → 400; chunked мусор → 400; без файлов → 400 NO_FILES; 9 файлов → 400 TOO_MANY_FILES |

Результат: `bun run test` → **46 files / 983 tests passed, exit 0** (все 20 новых зелёные, ни один существующий тест не ослаблен/не изменён). `bun run typecheck` → 0 ошибок, exit 0. `bun run lint` → exit 0.

Примечание к окружению тестов: проектный vitest env — jsdom (setup требует window), а undici-парсер multipart в jsdom-глобалах падает на webidl brand check для файловых частей; в новых тестах глобальный `File` подменяется на `node:buffer` File (`vi.stubGlobal`) — задокументировано в docblock'ах тестов (зонд A-3c).

## 5. Gate

- `node scripts/scan-evidence.mjs` → exit 0.
- Commit (только юнит A-3c): `src/lib/upload-service.ts`, `src/app/api/upload/route.ts`, `src/app/api/services/upload/route.ts`, 3 тест-файла, `scripts/verify/upload-oversize-verify.mjs`, этот документ, аппендиксы FIX VERIFIED в U-12/U-13. `worklog.md` намеренно **не** коммитится.
