# S2B4-R — zai-code — Storage: 7 бакетов, upload pipeline magic-bytes, signed URLs HMAC (recovery)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены (boot + curl-matrix 53/53 PASS), коммит + bundle созданы.

## Контекст
Ре-исполнение S2B4 (спек: docs/rebuild/prompts/S2B4-storage.md; DECISIONS.md №4 — STORAGE_MODE=local в песочнице) поверх S1B1-R (f4038b6) → S1B2-R (7fcf60b) → S1B3-R (3e43022) → S2B1-R (9eb3a77) → S2B2-R (96a18a6/ca122bc) → S2B3-R (8628458). Корень /home/z/my-project/conditera-v2, dev :3100, shim :3040, `env -u DATABASE_URL`. Старые дефекты: 6+ upload-маршрутов → ОДИН /api/upload; user-имена в путях → uuid; доверие Content-Type → magic-bytes.

## Что готово для следующих блоков
- **Реестр бакетов** src/lib/storage/buckets.ts (КЛИЕНТ-БЕЗОПАСНЫЙ — без node:*) — 7 бакетов: публичные avatars/portfolios/products/recipes; приватные documents/chat-attachments/cms (signed TTL 300 с). Config: public, maxBytes, mimes, uploadRoles ("ANY_AUTH" | список), title/description RU. Хелперы getBucket/canUploadToBucket/allowedExts/extForMime/mimeForExt/formatBytes. Матрица: avatars+chat-attachments — любой auth; portfolios/products/recipes — VENDOR_GROUP (+SERVICE_GROUP для portfolios; +RECIPE_DEVELOPER для recipes; +ADMIN/SUPER_ADMIN); documents — исполнители+admin; cms — content.moderate. Лимиты per-mime: image 10 МБ / pdf 5 МБ / mp4 50 МБ (только portfolios).
- **Magic-bytes** src/lib/storage/magic-bytes.ts — detectMime: png/jpeg/webp/gif/pdf + mp4 (ftyp), null → 415; MIME_MAX_BYTES таблица. image-dimensions.ts — width/height из контейнеров png/gif/jpeg/webp (null-safe, анти-мусор sanity).
- **Подписи** src/lib/storage/signing.ts — HMAC-SHA256(SUPABASE_JWT_SECRET, `bucket:path:exp`) hex; verifySignedPath: форма → timingSafeEqual по sha256-дайджестам → exp (TTL 300 с, SIGNED_URL_TTL_SECONDS); buildLocalSignedUrl → /api/storage/file/{bucket}/{path}?exp=..&sig=..; без секрета — fail-closed (null/503).
- **Адаптеры** src/lib/storage/adapter.ts — interface StorageAdapter{upload,remove,exists,read,publicUrl,signedUrl} + mode; localAdapter (.storage-data/<bucket>/, gitignored, safeJoin анти-traversal, 0o640) и supabaseAdapter (service-role .storage: upload upsert:false, createSignedUrl, getPublicUrl; без env → throw). getStorageAdapter() — ТОЛЬКО по STORAGE_MODE (неизвестный флаг → throw fail-closed).
- **Права приватных** src/lib/storage/access.ts — canReadFile: documents owner+QUALITY_INSPECTOR/CERTIFICATION_AGENT/ADMIN; cms owner+content.moderate; chat-attachments owner+участники ChatRoom (refType="chat-room", refId=roomId; без привязки — fail-closed owner only; АДМИН-БАЙПАСА НЕТ по спеке); canDeleteFile: owner или ADMIN/SUPER_ADMIN.
- **Модель File** (files): id/bucket/path@unique/ownerId/refType?/refId?/size/mime/width?/height?/createdAt; индексы ownerId+createdAt, bucket+refType+refId, createdAt. Миграция prisma/migrations/20261119184818_add_files (migrate dev, env -u DATABASE_URL).
- **Роуты** (все runtime nodejs, force-dynamic):
  - POST /api/upload — pipeline: rate-limit (upload 5/мин/IP consume на каждой попытке; uploadUser 100/сутки/authId после auth) → auth 401 → CSRF 403 → multipart 400 → матрица 403 → bucket-лимит 413 (declared size, до чтения) → magic 415 → per-mime 413 → dims → uuid-путь {authId}/{yyyy}/{uuid}.{ext} → адаптер → row files (сбой → компенсация удаления) → {id,bucket,path,url|signedUrl,mime,size,width,height}. refId опционален, refType клиенту НЕ доверяется (ставит блок S3–S6).
  - DELETE /api/upload/[id] — CSRF → 401 → 404 → owner/ADMIN → объект+row (гейт: повторный GET 404).
  - GET /api/files — свои 100 последних (?bucket= фильтр), публичные URL/свежие подписи.
  - GET /api/files/[id]/url — подпись приватного после canReadFile (401/404/403/400 public/503).
  - GET /api/storage/signed?bucket&path — подпись по row (bucket+path) после canReadFile.
  - GET /api/storage/file/[...path] — local-раздача: public → 200 (Cache-Control public, max-age=3600); private → ТОЛЬКО verifySignedPath (без/битая/просроченная → 403; анти-оракул; Cache-Control private no-store); Content-Type по каноническому расширению; supabase-режим → 503 (раздаёт Supabase).
  - POST /api/cron/storage-cleanup — X-Cron-Secret (timingSafeEqual sha256; без CRON_SECRET → 503; CSRF exempt /api/cron/ помечен в baseline): сироты refType/refId пустые >30 дней → объект+row; local: дисковые сироты → удалить, строки без объекта → ремонт. Обёртка scripts/cron/storage-cleanup.mjs (секрет из env/.env): `node scripts/cron/storage-cleanup.mjs [APP_URL]`.
- **scripts/storage-init.ts** (bun, резолвит @/ paths) — идемпотентно: local → mkdir 7 каталогов .storage-data; supabase → createBucket {public,fileSizeLimit,allowedMimeTypes} (повторный запуск — no-op, проверено). package.json: storage:init, storage:cleanup.
- **RLS-артефакт** docs/supabase-rls-storage.sql — re-runnable (DROP IF EXISTS): owner-write {auth.uid()}/* по каждому бакету, роли из JWT app_metadata.roles (conditera_jwt_roles/has_role/is_admin), public-read 4 публичных, приватные SELECT owner/роли (листинг закрыт), anon на приватные не имеет политик; комментарии-матрица. Применять ТОЛЬКО в prod Supabase (S9B1).
- **UI**: src/components/storage/file-upload.tsx — drop-зона+input, клиентская пре-проверка (размер/расширение из реестра), прогресс XHR (токен через fetchCsrfToken — csrf-client), RU-тосты 401/403/413/415/429/503; страница (dashboard)/dashboard/files — серверный гвард getCurrentUser→redirect("/"), Select разрешённых бакетов, список своих файлов (next/image unoptimized c width/height из files), удаление через csrfFetch, skeleton/empty/aria.
- **next.config.ts** — experimental.proxyClientMaxBodySize: 52 МБ (transport-потолок под mp4 ≤ 50 МБ; Next 16 default 10 МБ резал multipart).
- env: CRON_SECRET в .env (dev-значение) — .env.example уже содержал ключ.
- rate-limit.ts: +upload/+uploadUser buckets; maybeSweep исправлен (учёт windowMs бакета — иначе 24-часовые ключи выметались бы как часовые).
- csrf.ts: whitelist +/api/cron/ (компенсирующая контроль — X-Cron-Secret; строка в docs/SECURITY_BASELINE.md; мера 13 → «РЕАЛИЗОВАНО (S2B4)», мера 9 дополнена).

## Гейты (все пройдены 2026-11-19)
1. lint 0, tsc --noEmit 0.
2. Boot ОДНИМ вызовом (bash /home/z/gates/s2b4-gate.sh): PG :54330 listening; UP after 3s (shim=200 app=200); health database=ok.
3. **curl-matrix 53/53 PASS** (полный транскрипт в worklog): a) anon upload → 401; b) customer→products 403; b2) без CSRF → 403 csrf; c) customer→avatars 200 {path,url} → GET → 200 image/png (width=1); d) fake .png → 415; e1) 6 МБ pdf→documents 413; e2) 11 МБ png→avatars 413; f) admin→documents 200 → прямой GET 403 → /api/storage/signed 200 → GET по sig 200 image/jpeg → tampered sig 403 → expired (HMAC-крафт, exp-120с) 403 «Ссылка истекла» → customer /api/files/:id/url 403 + signed 403, admin 200; g) confectioner→portfolios 200 → GET 200 → DELETE 200 → GET 404; g2) customer DELETE чужого 403; h) DELETE своего 200 → GET 404; i) /dashboard/files anon 307 / customer 200 (drop-зона рендерится); j) cron: без секрета 403, с секретом 200 {mode:local}; k) 6-я загрузка за минуту 429 + Retry-After; l) регрессия health/styleguide/home/admin-CSRF-probe/session.
4. Коммит **e79dd21** (`[S2B4] storage: 7 buckets, upload pipeline magic-bytes, signed URLs HMAC, local adapter, RLS sql, cleanup cron, FileUpload UI (recovery)`, 28 файлов, +2797); bundle /home/z/my-project/backups/conditera-v2-S2B4-e79dd21.bundle (361042 B, verify OK, «The bundle records a complete history»); дерево чистое; worklog.md — полная запись (отклонения ×12, уроки ×5).

## Отклонения (ключевые, полный список в worklog.md)
1. Порядок rate → auth → CSRF на /api/upload (гейт: anon → 401; спека: без CSRF → 403 для auth) — семейство upload-роутов, не admin (докблок csrf.ts).
2. +Burst upload 5/мин/IP к спека-лимиту 100/сутки/user (гейт «6-я → 429»); consume на каждой попытке.
3. mp4-детект (ftyp) и gif — сверх набора задачи: спека §4.3 требует mp4 для portfolios ≤ 50 МБ; gif классифицирован изображением.
4. proxyClientMaxBodySize 52 МБ: Next 16 резал тела ≥ 10 МБ на proxy-уровне («Request body exceeded 10MB»), ключ только внутри experimental (middlewareClientMaxBodySize — deprecated-алиас; на верхнем уровне «Unrecognized key»).
5. FileUpload: XHR вместо fetch (реальный upload-progress), токен через fetchCsrfToken; Dialog спеки §4.7 заменён встроенной drop-зоной в Card (task-UI).
6. /dashboard/files вместо /dev/storage (task > спека); GET /api/files добавлен (список своих) — сверх §4.5.
7. .storage-data/ вместо .uploads/ (task > спека §2), gitignored.
8. refType не принимается от клиента (анти-спуфинг привязок): проставляет контекст S3–S6; чистка считает сиротой строку с пустым refType ИЛИ refId > 30 дней.
9. Админы не имеют bypass на chat-attachments read (спека: только участники); на documents/cms — по спеке.

## Уроки (обязательны к учёту)
1. Next 16 proxy обрезает тела ≥ 10 МБ молча (только warning в dev.log) → для upload-роутов experimental.proxyClientMaxBodySize; диагностический маркер — 400 «multipart» из formData() при больших телах.
2. deprecated-алиасы конфига могут не работать на верхнем уровне — проверять runtime-схему (config-schema.d.ts) и «Invalid next.config.ts options» в dev.log.
3. bc отсутствует в песочнице — bash $((...)) / python3.
4. Gate-хелперы держать вне каталогов, которые гейт стирает (rm -rf JARS).
5. Форма-проверка подписи (64 hex) ДО timingSafeEqual + анти-оракул 403 — expired-ветка тестируется крафтом HMAC с прошлым exp (секрет из .env, не печатается).

## Дальше
- S3B1: /api/diag/* удалить; SafeHtml/safeFetch-дисциплина.
- S3–S5: привязки refType/refId (products, reviews, портфолио кабинетов) — refType проставляет контекст блока; FileUpload уже принимает refId.
- S6B1: chat-attachments — проверка участников + refType="chat-room"/refId=roomId при отправке сообщения (canReadFile готов).
- S8B1: включить storage-cleanup в реестр cron.
- S9B1: STORAGE_MODE=supabase + docs/supabase-rls-storage.sql в prod Supabase + prod CRON_SECRET.
