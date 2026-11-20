# S2B3-R3 — zai-code — security-фундамент v2: верификация прерванного рогона, доисправление, гейты, артефакты (recreate-3)

Task ID: S2B3-R2-CONT (в отчётной цепочке — S2B3-R3). Дата: 2026-11-20.
Статус: ЗАВЕРШЕНО — все гейты пройдены (lint/tsc 0/0; curl-матрица 40/40;
agent-browser 16/16), коммит кода + docs-коммит + bundle созданы, дерево чистое.

## Контекст

Прерванный прогон S2B3-R2 успел ИМПЛЕМЕНТИРОВАТЬ security-фундамент
(незакоммичено: 13 изменённых файлов +299/−46 и 9 новых), но НЕ успел:
гейты, коммиты, worklog, bundle, отчёт. Задача R3: ПРОВЕРИТЬ готовый код,
ДОИСПРАВИТЬ дефекты, прогнать все гейты, создать артефакты (НЕ
переимплементировать). Спека: docs/rebuild/prompts/S2B3-security.md (§6
запреты, §7 критерии, §8 верификация). Ground truth: agent-ctx/S2B3-R-zai-code.md
(точный дизайн решений, отклонения 1–8, уроки 1–5 — все решения подтверждены
и перенесены). База: S2B2-R3 (код 3d4a04a + docs 82310c7). Корень
/home/z/my-project/conditera-v2, dev :3100, shim :3040, embedded PG :54330,
все команды `cd conditera-v2 && env -u DATABASE_URL`. Старый проект — только
чтение (:3000/:54329/:3030 не тронуты; pkill-шаблоны строго с "-p 3100").

Проверка входного состояния (по хэндоффу):
- .env.local (gitignored) уже содержит SAFE_FETCH_ALLOWLIST=127.0.0.1,localhost,::1,
  SECURITY_CSP_MODE=dev, SECURITY_CSP_EXTRA_CONNECT_SRC= — доисправлений не
  потребовалось; .env.local.example — те же три переменные с комментариями.
- rewrite-семантика healing: login/route.ts уже переведён на
  healClaimsToDbTruth (ПЕРЕЗАПИСЬ claims ровно на [profileRole] через
  replicateRolesToClaims, включая user_metadata.role); session/route.ts сам
  файл не модифицирован и НЕ ТРЕБУЕТ правки: он делегирует getCurrentUser()
  (src/lib/auth/current.ts, модифицирован в этом же прогоне) — там тот же
  healClaimsToDbTruth, т.е. rewrite-семантика в session присутствует и
  подтверждена живым гейтом (i2/i3: SQL-дивергенция → session вернула роли
  из БД, claims свернулись).
- In-memory state (csrf/rate-limit) — проверен: ТОЛЬКО globalThis-store
  (__conditeraCsrfStore / __conditeraRateLimitStore на globalThis).
- Комментарии: последовательности «звёздочка-слэш» в текстах нет (проверено
  grep по новым файлам).

## Дефекты, найденные и починенные

Дефектов В КОДЕ приложения не обнаружено (полный аудит новых/изменённых
файлов: csrf, csrf-shared, csrf-client, headers, mask, rate-limit, safe-fetch,
sanitize, safe-html, /api/csrf, guard, current, login, register, 2fa ×2,
oauth, health, proxy, auth-modal, admin-roles-client, styleguide-content).
Один ложный кандидат — «битый префикс лога ealth]» в /api/health — оказался
дисплей-артефактом bash-вывода (od -c подтвердил корректный `[health]`;
урок №5). Починены дефекты ГЕЙТ-ИНСТРУМЕНТАРИЯ (не приложения):

1. curl-матрица, гейт (h): наивный `grep '<script>alert(1)'` по всему HTML
   страницы — ЛОЖНОПОЛОЖИТЕЛЬНЫЙ дизайн: RSC flight-payload легитимно
   содержит строку-исходник демо (с "<script>") внутри инлайн-скрипта.
   Ужесточено: контейнер-скоуп [data-safe-html] (0 живых <script>), проверка
   экранирования источника в <pre> (&lt;script&gt;alert(1)) и отсутствие
   НЕэкранированной пары <script>alert(1)</script>. Код приложения верен.
2. agent-browser: (а) innerText-проверка входа искала «Выйти из аккаунт» —
   это aria-label, НЕ входящий в innerText (видимый текст кнопки — «Выход»,
   продолжение урока S2B2 №4); заменено на DOM-запрос
   button[aria-label="Выйти из аккаунта"] + видимое имя «Демо-администратор».
   (б) Первый заход в next dev (Turbopack): HMR делает ПОЛНЫЙ reload страницы
   в первые секунды — рефы снапшота протухали, клики молча не работали
   (2 FAIL-прогона подряд на неизменном коде приложения; dev.log — повторные
   GET /, console — [Fast Refresh] rebuilding, fs.watch — 0 событий вне
   .next). Лечение: пауза-settle 15с + генерационный маркер window.__gateGen
   (действие по рефам только если reload не случился между снапшотом и
   действием) + клик по модалке ТОЛЬКО когда поля не найдены (без тогглинга
   открытой модалки). Финальный прогон 16/16.
3. Boot-секция гейтов: одиночная проверка шима после sleep 3 заменена poll-
   циклом до 15с (холодный старт); лог-пути унифицированы /tmp/v2-shim.log,
   /tmp/v2-dev.log.

## Артефакты

- Коммит кода: **3c486b2**
  `[S2B3] security: CSRF one-time (sha256+timingSafeEqual), headers,
  sanitize+SafeHtml, safe-fetch, rate-limit, masking, baseline (recreate-3)`
  — 24 файла, +1655/−46, поверх 82310c7, дерево чистое.
  Проверено: .env.local и scripts/db/.auth-shim-users.json — gitignored
  (git check-ignore), в коммит НЕ попали.
- Docs-коммит: **197fe30** `[S2B3] docs: worklog S2B3-R2-CONT (sha/bundle
  pinned)` — worklog.md +169 строк (структура, отклонения, гейты, уроки).
- Bundle: /home/z/my-project/backups/conditera-v2-S2B3-3c486b2.bundle
  (**699 923 bytes**), `git bundle verify`: «is okay», ref refs/heads/main =
  197fe30, «records a complete history» — OK (полная история S1B1→S2B3,
  docs-коммит поверх, как в паттерне S2B1/S2B2).
- Скриншоты (agent-ctx): s2b3-r3-safehtml.png (секция SafeHtml /styleguide,
  свежая, 91 312 B), s2b3-r3-mobile-390.png (мобильный 390, 268 645 B).
- Гейт-скрипты: /home/z/gates/s2b3-r3-matrix.sh (boot + curl-матрица a-j+k),
  /home/z/gates/s2b3-r3-browser.sh (boot + agent-browser), s2b3-sql.mjs
  (SQL-помощник; DATABASE_URL из .env.local не печатается).

## Что готово для следующих блоков

- **S2B4 (Storage)**: httpOnly-куки сессии → аплоады ТОЛЬКО через server-
  роуты (клиент никогда не говорит со Storage напрямую); RLS-политики Supabase
  Storage — СНЯТЬ placeholder меры 13 docs/SECURITY_BASELINE.md; STORAGE_MODE
  =local только dev (решение №4: никогда в prod). safeFetch уже обязателен
  для исходящих.
- **S3B1 (навигация/контент)**: любые новые UI с user-HTML — ТОЛЬКО
  `<SafeHtml html={...}>` (data-safe-html — маркер приёмки); исходящие вызовы
  — ТОЛЬКО safeFetch; удалить /api/diag/* (в CSRF-whitelist префикс
  /api/diag/ исчезает вместе с ними — csrf-shared.ts).
- **S4B2 (платежи)**: webhook YooKassa — в CSRF-whitelist присутствует
  префикс /api/webhooks/ — НУЖНО: whitelist CSRF + ОБЯЗАТЕЛЬНАЯ HMAC-подпись
  (компенсирующий контроль уже записан в baseline); исходящие вызовы YooKassa
  — только safeFetch (allowlist: добавить api.yookassa.ru в
  SAFE_FETCH_ALLOWLIST прод-env).
- **S9B1 (prod-hardening)**: прод-CSP — nonce (сейчас strict-режим — заглушка
  без unsafe-eval); SAFE_FETCH_ALLOWLIST — явный prod-список ОБЯЗАТЕЛЕН
  (fail-closed: без allowlist safeFetch блокирует ВСЁ); HSTS включится
  автоматически (NODE_ENV=production → max-age=63072000; includeSubDomains).
- **Точки применения при приёмке блоков S3–S9** (чек-лист baseline):
  CSRF-токен нужен на мутирующих роутах вне whitelist (или обоснованная
  запись в таблицу baseline); user-HTML только SafeHtml; исходящие только
  safeFetch; новые лимиты — по образцу rate-limit.ts (globalThis store);
  ПДн в логах — только через mask.ts.

## Отклонения от ground truth (S2B3-R-zai-code.md)

Решения ground truth ПЕРЕНЕСЕНЫ 1:1 и подтверждены гейтами; расхождений по
архитектуре НЕТ. Совпадают (перечень — см. worklog, раздел «Отклонения»):
1. CSRF enforcement на РОУТАХ (guard.ts централизует admin-мутации; 2fa/oauth
   явно), не в proxy.ts (headers-only).
2. Whitelist шире спеки §4.1: + logout, session, /api/csrf, /api/diag/* —
   с компенсирующими контролями в baseline.
3. login-лимит — consume только на неуспехе, успех сбрасывает счётчик IP.
4. Burst-гейты с X-Forwarded-For (лимиты ключуются по XFF).
5. safeFetch возвращает SafeFetchResult (НЕ Response); redirect manual.
6. isomorphic-dompurify/jsdom НЕ ставятся (pure-string allowlist).
7. SafeHtml без "use client" (универсальный RSC+client).
Отличия от ground truth (обоснованы):
- Гейт (h) curl-проверка XSS ужесточена до контейнер-скоупа [data-safe-html] +
  двух дополнительных проверок (экранированный исходник в <pre>; отсутствие
  неэкранированной пары) — ground truth-проверка «0 живых script в rendered
  HTML» сохранена по смыслу, но глобальный grep заменён из-за ложных
  срабатываний на легитимном flight-payload (дефект чека, не кода).
- Гейт (i) исполнен иначе, чем буквальное чтение хэндоффа («добавь healing в
  session/route.ts»): файл session не менялся, т.к. rewrite уже сидит в
  getCurrentUser (current.ts этого же прогона) — двойное вшивание healing в
  роут было бы дублем; живой тест дивергенции подтверждает требуемую
  семантику (session из БД-истины).

## Гейты (все пройдены 2026-11-20)

1. **lint/typecheck**: `env -u DATABASE_URL bun run lint` → 0 ошибок;
   `env -u DATABASE_URL bun run typecheck` → 0 ошибок. PASS.
2. **Boot + curl-матрица — ОДИН вызов** (bash /home/z/gates/s2b3-r3-matrix.sh,
   timeout 600000): defensive pkill строго по шаблонам "next dev -H 0.0.0.0
   -p 3100" и "bun --hot mini-services/auth-shim"; shim :3040 health 200
   (poll до 15с); db:setup идемпотентен (exit 0, auth-users ×4 Demo123!);
   dev :3100 /api/health 200 {status:ok, database:ok, auth:ok}. PASS.
   Пункты матрицы (40/40 PASS):
   - (a) заголовки GET /: X-Frame-Options DENY, X-Content-Type-Options
     nosniff, Referrer-Policy strict-origin-when-cross-origin,
     Permissions-Policy (camera=()...), CSP присутствует (dev); HSTS
     ОТСУТСТВУЕТ (dev) — 6/6 PASS.
   - (b) login admin@demo.ru → 200; POST /api/admin/roles БЕЗ X-CSRF-Token →
     403 {"error":"csrf"}. PASS.
   - (c) GET /api/csrf → 200 + Set-Cookie cd_csrf + token 64 hex; POST
     /api/admin/roles С токеном (anon jar) → 401 (CSRF пройден, auth-guard).
     PASS.
   - (d) reuse ТОГО ЖЕ токена → 403 {"error":"csrf"} (one-time ротация). PASS.
   - (e) admin: GET /api/admin/users → 200 (total=12); assign MODERATOR
     confectioner с X-CSRF-Token → 200; DELETE потраченным токеном → 403;
     DELETE свежим → 200 (previousRole/restoredRole = CONFECTIONER). PASS.
   - (f) customer login → 200; GET /api/admin/users → 403. PASS.
   - (g) burst XFF 203.0.113.77: 11-й wrong-password POST /api/auth/login →
     429 + Retry-After: 60; XFF .78: 6-й register → 429; XFF .79: 6-я
     2fa/enroll → 429; demo-login БЕЗ XFF после burst → 200 (успех сбрасывает
     счётчик). PASS.
   - (h) GET /styleguide: 0 живых <script> внутри [data-safe-html]; маркер
     data-safe-html присутствует; исходник в <pre> экранирован
     (&lt;script&gt;alert(1)); неэкранированной пары
     <script>alert(1)</script> нет. PASS.
   - (i) rewrite-healing session: assign confectioner → MODERATOR, login
     (claims=MODERATOR), SQL: profiles.role=CONFECTIONER, GET /api/auth/
     session → roles=["CONFECTIONER"] (БД-истина), claims свернулись —
     GET /api/admin/roles/[userId] → divergent:false. PASS.
   - (j) health 200 {database:ok, auth:ok}; / 200; /styleguide 200. PASS.
   - (k, доп.) маскирование в логах: 10 строк ad***@demo.ru, 0 сырых
     admin@demo.ru. PASS.
3. **agent-browser — ОДИН вызов** (bash /home/z/gates/s2b3-r3-browser.sh,
   timeout 600000, закрыть+открыть сессию после рестарта dev): boot тот же →
   16/16 PASS: кнопка «Войти в аккаунт» найдена; вход admin@demo.ru/Demo123!
   через модалку УСПЕШЕН (csrfFetch подставил одноразовый токен: dev.log —
   GET /api/csrf 200 → POST /api/auth/login 200 → GET /api/auth/session 200);
   имя/меню в шапке («Демо-администратор», кнопка выхода по aria-label
   «Выйти из аккаунта»); /styleguide#safe-html — секция отрендерена
   (containers=1), 0 живых <script> в [data-safe-html], «С днём рождения!»
   виден, alert НЕ исполнялся, консоль без XSS/санитизационных ошибок;
   mobile 390: scrollWidth=390 = clientWidth=390 (без горизонтального
   overflow). Скриншоты сохранены (s2b3-r3-safehtml.png,
   s2b3-r3-mobile-390.png). PASS.
4. **Артефакты**: коммит 3c486b2 (код) + 197fe30 (docs), `git status` — 0
   записей; check-ignore .env.local / .auth-shim-users.json подтверждён;
   bundle создан и verify OK (полная история). PASS.

## Уроки (новые R3, обязательны к учёту)

1. **Первый заход в next dev (Turbopack) = HMR полный reload в первые
   секунды** (console: [Fast Refresh] rebuilding; dev.log: повторные GET /).
   Рефы agent-browser-снапшота, снятые ДО reload, протухают — клики МОЛЧА не
   работают (✓ Done без эффекта). Лечение в гейтах: settle-пауза ~15с после
   load + генерационный маркер window.__gateGen перед действиями по рефам;
   модалку не тогглировать повторным кликом (кликать только когда её полей
   ещё нет в снапшоте).
2. **innerText не содержит aria-label** (развитие урока S2B2 №4):
   logged-in-проверка — DOM-запрос button[aria-label="Выйти из аккаунта"],
   видимый текст кнопки — «Выход». Гейт-проверки входа строить на
   aria-снапшотах/DOM-запросах, не на innerText.
3. **XSS-проверка по сырому HTML страницы — только контейнер-скоуп или
   полная пара тега**: RSC flight-payload легитимно содержит строку-исходник
   (включая "<script>") внутри инлайн-скрипта — глобальный grep даёт ложный
   FAIL на корректном коде (проверено: экранирование `<\/script>` в payload
   сохраняет живым открывающий `<script>` внутри JS-строки).
4. **Диагностика по слоям, прежде чем менять код приложения**: dev.log
   (повторные GET /) → браузерная консоль ([Fast Refresh] rebuilding) →
   fs.watch проекта (0 событий вне .next) → eval-маркер в странице (reload
   подтверждён и разов). Оба «дефекта» гейта оказались инструментальными;
   код приложения не потребовал ни одного изменения.
5. **Bash-вывод инструментов может «съедать» «[h» в строках** (дисплей-
   артефакт: `[health]` отображался как `ealth]`) — байты сверять od -c /
   Read-инструментом; «дефект», которого нет, не править.

## Дальше по карте

- **S2B4 (Storage)**: httpOnly-куки → server-роуты аплоадов; RLS-политики
  (снять placeholder меры 13 baseline); STORAGE_MODE=local только dev.
- **S3B1**: новые UI с user-HTML — ТОЛЬКО SafeHtml; исходящие — ТОЛЬКО
  safeFetch; удалить /api/diag/*.
- **S4B2**: webhook YooKassa — whitelist CSRF + ОБЯЗАТЕЛЬНАЯ HMAC-подпись;
  исходящие YooKassa — safeFetch (+api.yookassa.ru в прод-allowlist).
- **S9B1**: прод-CSP nonce; явный SAFE_FETCH_ALLOWLIST; HSTS автоматически
  (NODE_ENV=production).
- **S5B3**: dashboard-shell вокруг /admin/roles; просмотр admin_actions
  (аудит append-only — счётчик кумулятивен между прогонами).
