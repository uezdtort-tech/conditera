# S2B1-R3 — zai-code — GoTrue-единственный auth-контур: верификация + доводка (recreate-3)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Агент 7-B (задача S2B1-R2): предыдущий исполнитель был прерван ПОСЛЕ
имплементации, ДО верификации и артефактов. Задача — ПРОВЕРИТЬ готовый код,
доисправить дефекты, прогнать все гейты, создать артефакты (НЕ
переимплементировать). Спека: docs/rebuild/prompts/S2B1-auth.md; уроки 1–5 —
agent-ctx/S2B1-R-zai-code.md; зависимости S1B2-R3 (23b0c98) + S1B3-R3
(9879fe4 + docs b16b5f8) не задеты. Корень /home/z/my-project/conditera-v2,
dev :3100, shim :3040, PG :54330; все команды `cd conditera-v2 && env -u
DATABASE_URL`. Старый проект — только чтение (:3000/:54329 не тронуты,
S1B2-health контракт сохранён).

## Артефакты
- Коммит кода: **95057b8** (95057b8c92c740a4de04e9fbb2a0e9c25553d8c9)
  `[S2B1] auth: GoTrue-only contour, ssr cookies, claims self-healing,
  auth-modal, dev shim :3040 (recreate-3)` — 31 файл, +3124/−109, поверх
  b16b5f8, дерево чистое; .env.local и scripts/db/.auth-shim-users.json —
  gitignored (проверено check-ignore).
- Docs-коммит: **6825160** `[S2B1] docs: worklog S2B1-R3 (sha/bundle pinned)`
  (worklog.md +127 строк — роуты, claims-схема, флаги, уроки).
- Bundle: /home/z/my-project/backups/conditera-v2-S2B1-95057b8.bundle
  (**612 539 bytes**), `git bundle verify`: ref refs/heads/main = 95057b8,
  complete history — OK (содержит S1B1+S1B2+S1B3+S2B1; docs-коммит 6825160 —
  поверх, как в паттерне S1B3).
- Скриншоты: agent-ctx/s2b1-r3-modal.png (модалка, вкладка Регистрация,
  чипы ролей), agent-ctx/s2b1-r3-logged-in.png (тост «Вы вошли» + имя
  в шапке), agent-ctx/s2b1-r3-mobile-390.png (модалка 390, dialogOpen=true).
- worklog.md v2 — полная запись S2B1 (9 пунктов, 4 решения, 11 гейтов).

## Что чинилось при верификации (найденные дефекты)
1. **КРИТИЧНО — JWT в куке без ролей после register**: signUp/shim подписали
   access-token ДО записи claims (репликация app_metadata.roles идёт ПОСЛЕ
   signUp). Декод куки давал app_metadata без `roles` — гейт «декодировать
   access-token → roles» падал. ФИКС в register/route.ts и login/route.ts:
   после `syncUserRoleClaims` при `healed=true` — re-grant
   `signInWithPassword` (повторный password-grant подписывает JWT из УЖЕ
   обновлённого store GoTrue; куки ответа перезаписываются). refreshSession
   НЕ использован — cookie-read семантика внутри того же запроса
   недетерминирована. В штатном случае (claims актуальны, healed=false)
   re-grant не выполняется.
2. **OAuth demo-гейт был непроходим**: в .env.local все
   SUPABASE_OAUTH_*_ENABLED отсутствовали/off, а env-гейт стоит ДО
   demo-ветки («off → 403, даже в dev») — demo-вход давал 403 всегда.
   ФИКС: SUPABASE_OAUTH_YANDEX_ENABLED=1 в dev-.env.local (gitignored;
   example-файл остался с 0); vk/google остаются off → 403.
3. **Чистка наследства прерванного рогона**: shim-стор содержал
   testuser@s2b1.ru и cycle-user@s2b1.ru, PG — их orphan-профили (profiles=14
   вместо 11); устаревший dev-сервер прошлого агента занимал :3100
   (EADDRINUSE). Всё удалено/остановлено; seed после чистки: profiles=11,
   auth-users ×4 «уже существует» (идемпотентно).
4. Инструмент верификации (не дефект кода): значение куки @supabase/ssr 0.12
   префиксовано «base64-» — декодер JWT должен снимать префикс.

## Что готово для следующих блоков
- **S2B2 (админ-RBAC)**: guards.ts — requireRole/requireAdmin/guardAdmin с
  готовым 401/403 (сигнатура guardAdmin(request) зафиксирована — Request
  зарезервирован под CSRF-проверки S2B3); claims self-healing работает
  (приоритет БД, перезапись app_metadata.roles через Admin API);
  ROLE_LABELS_RU ×27 — подписи для /register-roles; ADMIN_GROUP_ROLES ×8 —
  403-семантика саморегистрации.
- **S2B3 (security)**: SUPABASE_COOKIE_OPTIONS (httpOnly/lax/secure=false) —
  единая точка; errors.ts/isAuthTransportError — различение 503/401;
  санитайзинг session-ответа (без tfaSecret/factors/метаданных); proxy.ts —
  место для security-headers/timingSafeEqual.
- **S2B4 (Storage)**: httpOnly-куки → аплоады только через server-роуты;
  browser-клиент same-origin /auth/v1 (прокси src/app/auth/v1) — паттерн
  для same-origin storage-адаптера; STORAGE_MODE=local уже в env.
- **S3B1 (навигация)**: useAuthStore (modalOpen/modalTab/hydrated) — готовая
  точка для защищённых ссылок; удалить /api/diag/seed-check (TODO-remove в
  коде S1B2); auth-menu в header не трогать.
- **S6B1 (websocket)**: SUPABASE_JWT_SECRET в env; claims
  app_metadata.roles в HS256 JWT шима — jose-верификация без сюрпризов;
  iss=http://127.0.0.1:3040/auth/v1.

## Ключевые решения (унаследованы + новые)
1. ЕДИНСТВЕННЫЙ контур — GoTrue через @supabase/ssr: сервер держит сессию в
   httpOnly-куках; никаких собственных JWT/сессионных таблиц (D2/D3
   закрыты); jose не используется.
2. Fail-closed D3: getCurrentUser() — ЛЮБАЯ ошибка/нет профиля/блокировка →
   null → 401/403; транспортный сбой GoTrue → 503 (isAuthTransportError),
   НЕ маскируется под 401-credential.
3. Истина ролей — profiles.role; claims app_metadata.roles — реплика
   (register/login/OAuth/seed) с self-healing при расхождении; компенсация
   сбоя профиля — admin.deleteUser.
4. Ban-семантика: shim/GoTrue 400 ban_status → 403 «Аккаунт заблокирован»
   (+ дубль-проверка is_blocked) — не путать с единой 401.
5. Dev-шим — верный GoTrue-REST (:3040, DEV_AUTH_SHIM=1, exit(1) без флага,
   NODE_ENV=production запрещён): ПЛОСКАЯ форма /signup и /token (урок №1),
   ротация refresh в памяти + JSON-стор на диске (переживает рестарт —
   probe подтверждён).
6. Re-grant после claims-heal (НОВОЕ, решение №1 выше) — детерминированный
   способ получить JWT с ролями в той же сессии.
7. OAuth: env-гейты → 403 до всего остального; demo-вход через шим идёт ТЕМ
   ЖЕ контуром (signInWithPassword → httpOnly-куки), АНТИ-МЕРЖ парольных
   аккаунтов в upsertProfileForOAuth.
8. MFA: SUPABASE_MFA_ENABLED=off → честный 503 {mfaDisabled:true} на
   enroll/verify (dev); prod-включение — флагом (challenge/verify код
   готов).

## Гейты (результаты по пунктам, 2026-11-19)
1. `env -u DATABASE_URL bun run lint` → 0/0; `env -u DATABASE_URL bunx tsc
   --noEmit` → 0. PASS.
2. Boot одним батчем: shim :3040 → 200; `db:setup` идемпотентно (profiles=11
   после чистки, products=20, reviews=10, auth-users ×4 Demo123! — «уже
   существует»); dev :3100 Ready, / → 200. PASS.
3. /api/health → 200 {"status":"ok","database":"ok","auth":"ok",
   "storage":"local","n8n":"ok","version":"0.1.0-s2b1"} (S1B2-контракт не
   сломан). PASS.
4. register (test-s2b1r3-*, CUSTOMER) → 201 + куки sb-127-auth-token. PASS.
5. session → 200 {user, roles:['CUSTOMER']}. PASS.
6. Декод access-token из куки: register → app_metadata.roles=["CUSTOMER"]
   (после фикса №1); login customer@demo.ru → roles=["CUSTOMER"],
   iss=…:3040/auth/v1. PASS (до фикса — FAIL, чинилось).
7. logout → 200; session → 401 {"user":null}. PASS.
8. неверный пароль → 401 «Неверный email или пароль» (единое). PASS.
9. register role ADMIN → 403 «Эта роль назначается администратором…». PASS.
10. login customer@demo.ru/Demo123! → 200 {user, roles}. PASS.
11. oauth vk → 403 (env off), github → 400 (неподдерживаемый), yandex → 200
    demo-вход (claims CUSTOMER). PASS (до включения Yandex-флага — demo
    давал 403, чинилось env).
12. 2fa/enroll + 2fa/verify → 503 {"mfaDisabled":true}. PASS.
13. Set-Cookie: HttpOnly=true, SameSite=lax (secure=false — dev http). PASS.
14. Fail-closed probe: kill шима → / 200, session 401 {"user":null}, login
    503, health 200 auth:"unreachable" (top-level решает только БД); рестарт
    шима → session 200 (JSON-стор жив). PASS.
15. agent-browser: / → модалка; Регистрация — чипы ролей (6 radio, Покупатель
    checked); вход customer@demo.ru → тост + «Демо-покупатель»/«Выход» в
    шапке; выход → «Вход» вернулась; mobile 390: scrollWidth=390=clientWidth
    (нет overflow), модалка dialogOpen=true, чипы на месте. PASS.
16. git: 95057b8 + 6825160 (docs), дерево чистое; bundle 612 539 B, verify OK.
    PASS.

## Критические уроки (новые, обязательны к учёту)
1. **JWT подписывается ДО записи claims** (signUp/signIn выдали токен, потом
   app пишет app_metadata.roles) — кука без ролей. Детерминированный фикс —
   re-grant signInWithPassword после heal; refreshSession внутри того же
   запроса ненадёжен (cookie-read не видит set-ы запроса). Универсально и
   для реального GoTrue (там токен обновится только на refresh).
2. **@supabase/ssr 0.12 префиксует значение куки «base64-»** — декод
   сессионной куки (гейты/отладка) обязан снимать префикс перед base64.
3. **sonner-toast (top-right) перекрывает кнопку «Выход» в шапке** — клик по
   закрытому элементу в agent-browser молча не срабатывает (Playwright
   actionability): сценарии «вход → выход» ждать затухания тоста (~5s).
4. **Наследство прерванного рогона**: процессы в песочнице переживают вызовы
   НЕНАДЁЖНО (dev :3100 прошлого агента жил и ловил EADDRINUSE, shim из
   батча умирал между вызовами) — перед boot обязательны pkill по маскам
   проекта + проверка :3100/:3040; тестовые артефакты (профили
   test-*/cycle-*, пользователи shim-стора) чистить ДО гейтов, иначе seed
   counts «плывут» (profiles=14 → 11).
5. **Prisma-таблицы — snake_case (@@map)**: raw SQL (prisma db execute)
   требует FROM "profiles", а не "Profile" — P1014 по имени модели при
   raw-SQL означает неверное имя таблицы, не отсутствие БД.
6. **prisma db execute не читает .env.local** — DATABASE_URL передавать
   явно через env (значения в переменных, не печатать).
7. Шим должен оставаться ВЕРНЫМ GoTrue: не «помогать» приложению shim-магией
   (пресет ролей в signUp app_metadata) — это маскирует self-healing-путь;
   честная diverge→heal→re-grant цепочка и протестирована.

## Дальше по карте
- **S2B2 «Админ-RBAC»** — ЦЕЛЕВОЙ следующий блок: requireAdmin/guardAdmin
  готовы (сигнатура с Request — добавить CSRF-проверки), ROLE_LABELS_RU для
  /register-roles, ADMIN_GROUP_ROLES — 403-семантика; назначение/снятие
  ролей через Admin API + self-healing claims уже работают.
- S2B3 (security: headers, timing-safe, rate-limit), S2B4 (Storage:
  httpOnly → server-роуты аплоадов; remotePatterns для next/image).
- S3B1 (навигация): удалить /api/diag/seed-check (TODO в коде); защищённые
  ссылки через useAuthStore.
- Перед каждым блоком: worklog.md корня v2 + отчёт agent-ctx; bundle в
  backups после КАЖДОГО коммита (урок S1B2 №7).
