# S2B4-R3 — zai-code — Storage v2: верификация прерванного рогона, доисправление, гейты, артефакты (recreate-3)

Task ID: S2B4-R2-CONT (в отчётной цепочке — S2B4-R3). Дата: 2026-11-20.
Статус: ЗАВЕРШЕНО — все гейты пройдены (lint/tsc 0/0; boot OK; curl-матрица
53/53; agent-browser 17/17), коммит кода + docs-коммит + bundle созданы,
дерево чистое.

## Контекст

Прерванный прогон S2B4-R2 успел ИМПЛЕМЕНТИРОВАТЬ storage-контур (незакоммичено:
20 новых файлов/каталогов + 8 изменённых, поверх 197fe30), но НЕ успел: гейты,
коммиты, worklog, bundle, отчёт; apply-статус миграции был неизвестен. Задача
R3: ПРОВЕРИТЬ готовый код, ДОИСПРАВИТЬ дефекты, прогнать все гейты, создать
артефакты (НЕ переимплементировать). Спека: docs/rebuild/prompts/S2B4-storage.md
(§6 запреты, §7 критерии, §8 верификация). Ground truth:
agent-ctx/S2B4-R-zai-code.md — решения, отклонения 1–9, уроки 1–5 подтверждены
и перенесены 1:1. Хэндофф S2B3: agent-ctx/S2B3-R3-zai-code.md (мера 13
baseline «RLS/Storage placeholder» → РЕАЛИЗОВАНО (S2B4), см. baseline).
База: S2B3-R3 (код 3c486b2 + docs 197fe30). Корень
/home/z/my-project/conditera-v2, dev :3100, шим :3040, embedded PG :54330,
все команды `cd conditera-v2 && env -u DATABASE_URL`. Старый проект — только
чтение (:3000/:54329/:3030 не тронуты; pkill-шаблоны строго с "-p 3100" и
"bun --hot mini-services/auth-shim").

Проверка входного состояния (по хэндоффу):
- Полный аудит новых/изменённых файлов (buckets, magic-bytes, signing,
  adapter, access, image-dimensions, 6 route-файлов, file-upload.tsx,
  files-page ×2, storage-init.ts, cron-обёртка, RLS sql, schema/migration,
  next.config, rate-limit, csrf-shared, baseline, .gitignore,
  .env.local.example) — ДЕФЕКТОВ В КОДЕ ПРИЛОЖЕНИЯ НЕ НАЙДЕНО; все правки —
  в гейт-инструментарии (см. «Дефекты»).
- .env.local (gitignored) уже содержит STORAGE_MODE=local и CRON_SECRET —
  доисправлений env не потребовалось (значения не печатаются).
- Миграция 20261120134142_add_files была УЖЕ применена в БД прерванным
  рогоном (подтверждено запросом _prisma_migrations: finished_at 2026-11-20,
  таблица files существует); гейт дополнительно прогнал db:push (синхронность
  подтверждена) и db:setup (идемпотентен).
- Комментарии: «звёздочка-слэш» в текстах комментариев нет (скан по новым
  файлам — только закрытия JSDoc на границах).

## Дефекты, найденные и починенные

Дефектов В КОДЕ приложения не обнаружено. Починены дефекты ГЕЙТ-
ИНСТРУМЕНТАРИЯ (диагностика двухслойная: сначала /tmp/v2-dev.log, потом
гейт-скрипты):

1. **db:push при `env -u DATABASE_URL` → P1012** «Environment variable not
   found: DATABASE_URL»: prisma CLI авто-читает ТОЛЬКО .env, а DATABASE_URL
   этого проекта живёт в .env.local (db:setup не падает — setup.mjs сам
   парсит .env.local). Фикс гейта: значение передаётся в env программно из
   .env.local (не печатается) ПОСЛЕ гарда «URL указывает на embedded
   @127.0.0.1:54330» — анти-защита от проталкивания схемы во внешний
   кластер. После фикса: db:push exit 0, таблица files в БД.
2. **agent-browser upload: CDP «Node is not a file input element»**: в
   a11y-снапшоте input[type=file] представлен кнопкой с aria-label
   «Выбрать файл для «Бакет»», а триггер-кнопка имеет текст ровно
   «Выбрать файл»; жадный grep 'Выбрать файл' брал первую строку (триггер)
   → upload уходил НЕ в input. Диагностика по слоям: dev.log — 0 POST
   /api/upload (запрос не покидал клиент) → снапшот — две строки с общим
   префиксом. Фикс: grep 'Выбрать файл для' (суффикс «для» только у input).
3. **agent-browser eval оборачивает строковый результат в кавычки**
   (`"390:390"`) — grep-проверка мобильного overflow с ^-анкором и кавычками
   давала ложный FAIL при корректных значениях scrollWidth=390=clientWidth.
   Фикс: fixed-string grep -qF '390:390'.
4. **Список файлов не пуст на старте** (leftover-записи customer-avatars от
   предыдущих прогонов): проверки счётчиков переведены на ОТНОСИТЕЛЬНЫЕ
   (N0 → N0+1 после загрузки → N0 после удаления) вместо абсолютных.

Дополнительно: в boot-секцию гейта добавлены проверка наличия миграции в
prisma/migrations, db:push и запрос to_regclass('public.files'); storage:init
×2 перенесён до старта dev (порядок спечного гейта).

## Артефакты

- Коммит кода: **712126c**
  `[S2B4] storage: 7 buckets, upload pipeline magic-bytes, signed URLs HMAC,
  local adapter, RLS sql, cleanup cron, FileUpload UI (recreate-3)`
  — 28 файлов, +2843/−10, поверх 197fe30, дерево чистое.
  Проверено git check-ignore: .env.local (.env*), .storage-data/, .pgdata/,
  scripts/db/.auth-shim-users.json, dev.log — в стейдж/коммит НЕ попали
  (git status --porcelain после коммита — 0 записей).
- Docs-коммит: **2b5bf17** `[S2B4] docs: worklog S2B4-R2-CONT (sha/bundle
  pinned)` — worklog.md +240 строк (структура, дефекты гейтов, гейты,
  отклонения, уроки).
- Bundle: /home/z/my-project/backups/conditera-v2-S2B4-712126c.bundle
  (**751 892 bytes**), `git bundle verify`: ref refs/heads/main = 2b5bf17,
  «The bundle records a complete history» — OK (полная история
  S1B1→S2B4, docs-коммит поверх, паттерн S2B1/S2B2/S2B3).
- Скриншоты (agent-ctx): s2b4-r3-files.png (61 588 B — /dashboard/files,
  drop-зона + список с превью после UI-загрузки), s2b4-r3-mobile-390.png
  (63 204 B — mobile 390, без горизонтального overflow).
- Гейт-скрипты: /home/z/gates/s2b4-r3-matrix.sh (boot + curl-матрица a–l
  + files-реестр), /home/z/gates/s2b4-r3-browser.sh (boot + agent-browser).

## Что готово для следующих блоков

- **S3B1 (навигация/контент)**: удалить /api/diag/* — вместе с ними исчезает
  префикс /api/diag/ из CSRF-whitelist (csrf-shared.ts); новые UI с user-HTML
  — ТОЛЬКО `<SafeHtml>`; исходящие вызовы — ТОЛЬКО safeFetch (upload-контур
  их не имеет; remotePatterns next/image НЕ добавлялись — next/image только
  с локальных /api/storage/file, требование спеки §6 соблюдено).
- **S3–S5 (привязки файлов к сущностям)**: refType/refId — products, reviews,
  портфолио кабинетов; refType СТАВИТ КОНТЕКСТ БЛОКА (клиенту не доверяется —
  pipeline /api/upload принимает только refId и пишет refType=null); индекс
  files(bucket, refType, refId) готов; FileUpload уже принимает refId.
- **S6B1 (чаты)**: chat-attachments — при отправке сообщения проставлять
  refType="chat-room"/refId=roomId; canReadFile (участники ChatRoom, БЕЗ
  админ-байпаса) уже реализован в access.ts; fail-closed без привязки.
- **S8B1 (cron-реестр)**: включить storage-cleanup в реестр cron — обёртка
  scripts/cron/storage-cleanup.mjs (секрет из env/.env.local) и роут
  POST /api/cron/storage-cleanup готовы; правила: сироты-строки (refType
  ПУСТОЙ ИЛИ refId пустой) > 30 дней → объект+row; local-дисковые сироты →
  удалить; строки без объекта → ремонт.
- **S9B1 (prod)**: STORAGE_MODE=supabase (адаптер готов: service-role .storage,
  upload upsert:false, createSignedUrl TTL 300 с, getPublicUrl) + применить
  docs/supabase-rls-storage.sql (re-runnable) в prod Supabase + сильный
  prod CRON_SECRET; scripts/storage-init.ts в supabase-режиме создаёт 7
  бакетов с fileSizeLimit/allowedMimeTypes (duplicate → no-op).
- **Точки применения при приёмке блоков S3–S9** (baseline): любые НОВЫЕ
  файловые сценарии — ТОЛЬКО через POST /api/upload (одна точка, никакого
  «зоопарка маршрутов»); приватные объекты — ТОЛЬКО signed URL после
  canReadFile; новые mime/лимиты — расширять buckets.ts/magic-bytes.ts
  (реестр — единственный источник истины).

## Отклонения от ground truth (S2B4-R-zai-code.md)

Решения ground truth ПЕРЕНЕСЕНЫ 1:1 и подтверждены гейтами; по архитектуре
расхождений НЕТ. Отклонения 1–9 из ground truth сохранены все (проверено по
коду и гейтам): 1) порядок rate → auth → CSRF на upload-семействе; 2) +burst
upload 5/мин/IP (consume на каждой попытке) к спечным 100/сутки/user;
3) mp4-детект (ftyp) и gif сверх базового набора; 4) proxyClientMaxBodySize
52 МБ — только внутри experimental; 5) XHR вместо fetch (реальный прогресс) +
встроенная drop-зона в Card вместо Dialog спеки §4.7; 6) /dashboard/files
вместо /dev/storage + GET /api/files (список своих); 7) .storage-data/ вместо
.uploads/, gitignored; 8) refType не принимается от клиента (анти-спуфинг
привязок), чистка считает сиротой строку с пустым refType ИЛИ refId > 30 дней;
9) админы НЕ имеют bypass на chat-attachments read (только участники).
Отличия recreate-3 от ground truth recovery-прогона (обоснованы):
- Имя миграции 20261120134142_add_files (ground truth: 20261119184818) —
  миграция пересоздана прерванным рогоном recreate-3 с новой датой; содержимое
  идентично по смыслу (files + unique path + 3 индекса), применена и
  зафиксирована в _prisma_migrations.
- Гейт-инструментарий (см. «Дефекты»): db:push с передачей DATABASE_URL из
  .env.local + гард :54330; относительные счётчики в browser-гейте; проверки
  mobile через fixed-string grep. Дефекты чеков, не кода; проверяемые факты
  те же, что в ground truth-гейтах.

## Гейты (все пройдены 2026-11-20)

1. **lint/typecheck**: `env -u DATABASE_URL bun run lint` → 0 ошибок;
   `env -u DATABASE_URL bun run typecheck` → 0 ошибок. PASS.
2. **Boot одним вызовом** (bash /home/z/gates/s2b4-r3-matrix.sh, timeout
   600000): defensive pkill строго по шаблонам "next dev -H 0.0.0.0 -p 3100"
   и "bun --hot mini-services/auth-shim" (старый проект не тронут); шим :3040
   /auth/v1/health 200 (poll 2s); миграция 20261120134142_add_files
   присутствует в prisma/migrations; db:push exit 0 + to_regclass('files') =
   files; db:setup exit 0 (идемпотентен, auth-users секция); storage:init #1
   exit 0, #2 — no-op на всех 7 бакетах; dev :3100 /api/health 200 (~5s)
   {status:ok, database:ok, auth:ok}; в dev.log НЕТ «Invalid next.config.ts
   options» (experimental.proxyClientMaxBodySize принят). PASS.
3. **curl-матрица 53/53 PASS** (тот же вызов; фиксстуры в /tmp — 1x1 PNG
   69 B / JPEG 345 B python3-генерация, fake-png текстовый, %PDF-1.4,
   big.pdf 6 291 465 B, big.png 11 534 336 B):
   - (a) anon POST /api/upload → 401. PASS.
   - (b) customer→products → 403 (матрица ролей). PASS.
   - (b2) customer→avatars без X-CSRF-Token → 403 {"error":"csrf"}. PASS.
   - (c1) customer→avatars 1x1png → 200; (c2) width/height = «1 1»;
     (c3) путь 0809ebca-…/2026/9483f1dc-….png — формат {authId}/{yyyy}/
     {uuid}.png, оригинального имени НЕТ; (c4) GET url → 200 image/png. PASS.
   - (d) fake-png (текст с .png-именем) → 415. PASS.
   - (e1) 6 МБ pdf→documents → 413 (per-mime 5 МБ); (e2) 11 МБ png→avatars →
     413 (bucket 10 МБ); (e3) «Request body exceeded» в dev.log отсутствует —
     большие тела дошли до валидации (52 МБ transport). PASS.
   - (f1) admin→documents jpeg → 200; (f2) прямой GET приватного без sig →
     403; (f3) /api/storage/signed?bucket=documents&path=… → 200 {url};
     (f4) GET по sig → 200 image/jpeg; (f5) tampered sig → 403; (f6) expired
     (HMAC-крафт exp=now-120, секрет из env без печати) → 403 «Ссылка
     истекла»; (f7) customer /api/files/:id/url → 403; (f8) customer
     /api/storage/signed → 403; (f9) admin /api/files/:id/url → 200. PASS.
   - (g1) confectioner→portfolios → 200; (g2) GET → 200 image/jpeg; (g3)
     DELETE /api/upload/:id своего → 200; (g4) повторный GET → 404. PASS.
   - (g5) customer DELETE чужого (admin documents) → 403. PASS.
   - (h1) DELETE своего аватара → 200; (h2) GET после DELETE → 404. PASS.
   - (i1) /dashboard/files anon → 307 → /; (i2) customer → 200. PASS.
   - (j1) POST /api/cron/storage-cleanup без X-Cron-Secret → 403; (j2) с
     секретом → 200 {mode:"local"}. PASS.
   - (k1) 5 загрузок подряд (X-Forwarded-For 203.0.113.81) → 200; (k2) 6-я
     за минуту → 429 + Retry-After: 60. PASS.
   - (l1) health 200; (l2) /styleguide 200; (l3) / 200; (l4) POST
     /api/admin/roles без CSRF-токена (admin jar) → 403 {"error":"csrf"};
     (l5) GET /api/auth/session anon → 401. PASS.
   - (d1, доп.) GET /api/files?bucket=documents (admin) → 200 {files}. PASS.
4. **agent-browser 17/17 PASS** (bash /home/z/gates/s2b4-r3-browser.sh, ОДИН
   вызов; load+sleep, НЕ networkidle; settle-пауза 15с после первого захода —
   Turbopack-HMR; aria-DOM запросы вместо innerText): кнопка «Войти в аккаунт»
   в DOM; вход customer@demo.ru/Demo123! через модалку успешен (снапшот-рефы
   email/password/submit; aria-кнопка выхода); /dashboard/files — drop-зона и
   Select рендерятся; загрузка 1x1 png: список 13→14, тост «Файл загружен»,
   превью img в списке (width/height из files); скриншот s2b4-r3-files.png;
   удаление через UI — 14→13 (файл исчез); mobile 390: scrollWidth=390 =
   clientWidth=390; скриншот s2b4-r3-mobile-390.png; консоль без ошибок. PASS.
5. **Артефакты**: коммит 712126c (код) + 2b5bf17 (docs), git status — 0
   записей; check-ignore секретов подтверждён; bundle 751 892 B, verify OK
   (complete history). PASS.

## Уроки (новые R3, обязательны к учёту)

1. **prisma CLI не читает .env.local** (только .env): любая прямая
   prisma-команда при `env -u DATABASE_URL` падает P1012. Гейт-паттерн:
   передать DATABASE_URL из .env.local программно (не печатая) ПОСЛЕ гарда
   «URL указывает на embedded :54330». db:setup проблемы не имеет —
   setup.mjs парсит .env.local сам.
2. **input[type=file] в a11y-снапшоте agent-browser — кнопка** с aria-label
   элемента; различать input и триггер-кнопку по УНИКАЛЬНОМУ суффиксу
   aria-label («Выбрать файл для …»), не по жадному префиксу — иначе CDP
   «Node is not a file input element», upload молча не выполняется, а
   dev.log (0 POST /api/upload) — первый диагностический слой.
3. **agent-browser eval оборачивает строковые результаты в кавычки** —
   проверки делать fixed-string grep (-qF) по подстроке; кавычки в выводе —
   не дефект приложения.
4. **Списки UI с накоплением от прошлых прогонов** — гейт-проверки счётчиков
   делать относительными (Δ+1 после загрузки, Δ−1 после удаления).
5. **git bundle create с -C repo требует АБСОЛЮТНЫЙ путь вывода** —
   относительный резолвится внутри каталога репозитория (conditera-v2/backups/
   не существует) и падает «Unable to create …lock».
6. Уроки ground truth S2B4-R (1–5) и S2B3-R3 (1–5) подтверждены и действуют:
   proxyClientMaxBodySize только в experimental (девиант 400 multipart —
   маркер proxy-обрезки); форма 64hex ДО timingSafeEqual + анти-оракул 403;
   expired — HMAC-крафт с прошлым exp; settle-пауза 15с + aria-DOM запросы;
   диагностика по слоям: логи → консоль → код.

## Дальше по карте

- **S3B1**: удалить /api/diag/* (вместе с whitelist-префиксом); SafeHtml/
  safeFetch-дисциплина.
- **S3–S5**: привязки refType/refId (products, reviews, портфолио) —
  refType ставит контекст блока; FileUpload принимает refId.
- **S6B1**: chat-attachments — refType="chat-room"/refId=roomId при отправке
  сообщения (canReadFile готов).
- **S8B1**: storage-cleanup в реестр cron (обёртка готова).
- **S9B1**: STORAGE_MODE=supabase + docs/supabase-rls-storage.sql в prod
  Supabase + prod CRON_SECRET.
- **S5B3 и далее**: dashboard-shell вокруг кабинетов; счётчик admin_actions
  кумулятивен между прогонами (append-only).

## Владельцу (реестр и эксплуатация)

**Реестр 7 бакетов** (src/lib/storage/buckets.ts — единственный источник
истины; повторён в docs/supabase-rls-storage.sql):

| Бакет | Режим | Кто грузит | Лимиты | Чтение |
|---|---|---|---|---|
| avatars | публичный | любой auth | изобр. ≤ 10 МБ | все |
| portfolios | публичный | исполнители (VENDOR+SERVICE) + ADMIN | изобр. ≤ 10 МБ, mp4 ≤ 50 МБ | все |
| products | публичный | VENDOR + ADMIN | изобр. ≤ 10 МБ | все |
| recipes | публичный | VENDOR + RECIPE_DEVELOPER + ADMIN | изобр. ≤ 10 МБ | все |
| documents | приватный | исполнители + ADMIN | изобр. ≤ 10 МБ, pdf ≤ 5 МБ | владелец + QUALITY_INSPECTOR/CERTIFICATION_AGENT/ADMIN, signed URL TTL 300 с |
| chat-attachments | приватный | любой auth | изобр. ≤ 10 МБ, pdf ≤ 5 МБ | владелец + участники беседы (S6B1), signed URL |
| cms | приватный | content.moderate | изобр. ≤ 10 МБ, pdf ≤ 5 МБ | владелец + content.moderate, signed URL |

**Как загружаются файлы в dev**: STORAGE_MODE=local — диск .storage-data/
(каталоги 0o750, файлы 0o640, gitignored; init — `bun run storage:init`,
идемпотентен). Единственная точка — POST /api/upload (multipart {bucket,
file, refId?}): burst 5/мин/IP + 100/сутки/user, CSRF one-time, матрица
ролей, bucket-лимит до чтения, mime ТОЛЬКО по magic-bytes (415), per-mime
лимиты (413), uuid-путь {authId}/{yyyy}/{uuid}.{ext} (оригинальные имена
никогда не попадают в путь), метаданные — в таблицу files (Prisma).
Публичные объекты раздаются /api/storage/file/{bucket}/{path} (Cache-Control
public, max-age=3600); приватные — ТОЛЬКО signed URL
/api/storage/file/{bucket}/{path}?exp&sig (HMAC-SHA256 по SUPABASE_JWT_SECRET,
TTL 300 с; битая подпись/истёкшая → 403; Cache-Control private, no-store).
Ссылки выдаёт сервер: GET /api/files/[id]/url или GET
/api/storage/signed?bucket&path — оба после canReadFile. Чистка сирот —
POST /api/cron/storage-cleanup (X-Cron-Secret) или `bun run storage:cleanup`.

**Как это будет работать в prod (S9B1)**: STORAGE_MODE=supabase — тот же
контракт роутов, объекты уходят в Supabase Storage через service-role клиент
(upload upsert:false; createSignedUrl TTL 300 с; getPublicUrl); ключ
service-role ТОЛЬКО на сервере (никогда не на клиент и не в бандл); раздачу
объектов выполняет сам Supabase (роут /api/storage/file в этом режиме
отвечает 503). Перед включением применить docs/supabase-rls-storage.sql
(re-runnable: owner-write по {auth.uid()}/*, public-read ×4, приватные —
SELECT по ролям из JWT app_metadata, листинг приватных закрыт) и выполнить
`bun run storage:init` (создаст 7 бакетов с лимитами).

**Что нужно от Supabase-проекта**: (1) Project URL + service_role key
(серверные env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — уже в схеме
.env.local.example, в prod из секретов хостинга); (2) включённый Storage;
(3) лимиты проекта: per-file потолки уже заданы реестром (10/5/50 МБ), стоит
сверить квоты бакетов и общий объём проекта; (4) prod CRON_SECRET (сильный
случайный) для /api/cron/storage-cleanup + внешний планировщик (Vercel Cron/
GitHub Actions) по расписанию; (5) кастомный домен — опционально для
публичных URL. Remote-домены next/image НЕ требуются: рендер идёт через
локальный /api/storage/file (dev) — в prod publicUrl Supabase можно добавить
в remotePatterns ТОЛЬКО домен проекта (спека §6).
