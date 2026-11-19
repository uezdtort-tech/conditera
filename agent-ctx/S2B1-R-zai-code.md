# S2B1-R — zai-code — GoTrue-единственный auth-контур + dev-шим :3040 (recovery)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Ре-исполнение S2B1 (Supabase Auth / GoTrue как ЕДИНСТВЕННЫЙ контур сессий) поверх
S1B1-R (f4038b6) + S1B2-R (7fcf60b) + S1B3-R (3e43022). Спек:
docs/rebuild/prompts/S2B1-auth.md; решения владельца: №6 (OAuth Yandex/VK/Google
env-гейты), №4 (dev-шим в песочнице). Корень /home/z/my-project/conditera-v2,
dev :3100, shim :3040, все команды `env -u DATABASE_URL`.

## Что готово для следующих блоков
- **Клиенты supabase реальные** (замена заглушек S1B1):
  `getSupabaseBrowserClient()` (браузер, без env → null), `getSupabaseServerClient()`
  (RSC/route handlers, cookies() из next/headers, cookieOptions httpOnly:true/lax),
  `getSupabaseAdminClient()` (service-role; ТОЛЬКО server-код; isAdminConfigured()).
- **Session-refresh**: src/proxy.ts (@supabase/ssr canonical pattern — getUser на
  каждом динамическом запросе + cookie write-back; fail-open на ПУБЛИЧНЫЕ страницы,
  fail-closed на app-данных). Matcher: исключены _next/static, _next/image,
  favicon.ico, api/health. Быстрый путь: без sb-куки — без сетевого вызова.
- **lib/auth**: roles.ts (ALLOWED_SELF_REGISTER_ROLES ×19, ADMIN_GROUP_ROLES ×8 —
  403 «назначается администратором», ADMIN_ADMIN_ROLES [ADMIN, SUPER_ADMIN],
  ROLE_LABELS_RU — переиспользовать в /register-roles S2B2), current.ts
  (getCurrentUser() fail-closed → null при ЛЮБОЙ ошибке/блокировке), guards.ts
  (requireRole/requireAdmin/guardAdmin → готовый 401/403 NextResponse),
  client-store.ts (zustand `useAuthStore` — ТОЛЬКО публичный профиль, refresh()
  через GET /api/auth/session).
- **Route handlers /api/auth/**: register (19 ролей; admin-группа → 403; unique в
  profiles ДО signUp → 409; компенсирующий deleteUser при сбое профиля;
  SUPABASE_EMAIL_CONFIRMATION=on → {needsConfirmation:true}), login (единая 401
  «Неверный email или пароль»; ban_status/is_blocked → 403 + signOut; шим
  недоступен → 503), logout, session ({user, roles}, санитайзинг — без
  tfaSecret/factors/метаданных; self-healing claims), 2fa/enroll+verify (флаг
  SUPABASE_MFA_ENABLED=off → честный 503 {mfaDisabled:true}), oauth/[provider]
  (env-гейты off → 403; demo-мгновенный вход при DEV_AUTH_SHIM=1) + callback
  (exchangeCodeForSession → upsert → claims → /?auth=ok|error).
- **Клеймы**: истина ролей — profiles.role; репликация в app_metadata.roles через
  admin.updateUserById (register/login/OAuth/seed); self-healing при расхождении
  на session/login. Проверено декодированием access-token (roles=['CUSTOMER']).
- **Dev-шим** mini-services/auth-shim/ (bun :3040, boot-guard DEV_AUTH_SHIM=1 else
  exit(1)): GoTrue-REST имитация (signup, token password|refresh_token, user
  GET/PUT, logout, admin users POST/GET/PUT/DELETE + email-фильтр, /auth/v1/health,
  /health), HS256 JWT (SUPABASE_JWT_SECRET из v2/.env, bun автозагрузка), refresh
  map с ротацией, store scripts/db/.auth-shim-users.json (gitignored, переживает
  рестарт), CORS :3100 (localhost+127.0.0.1), apikey любой непустой, ошибки в
  формах GoTrue (invalid_grant/user_already_exists/ban_status/invalid_claim).
  App-код шим НЕ импортирует — общается как с обычным GoTrue через
  NEXT_PUBLIC_SUPABASE_URL.
- **Seed**: секция 2b — 4 учётки Demo123! (admin/customer/confectioner/
  support@demo.ru) через admin API, идемпотентно (listUsers → find), self-heal
  claims, привязка profile.userId; шим недоступен → «auth-users: отложено» и
  сид продолжается.
- **Frontend**: auth-modal.tsx (Dialog, вкладки, чипы покупатель/кондитер/
  поставщик/курьер/юрлицо + «Другая»→Select, ошибки+sonner, хинт /register-roles),
  auth-menu.tsx (Вход/Регистрация → имя + Выход) в header.
- package.json: `bun run shim` (:3040), `bun run shim:dev` (--hot).

## Критические уроки (обязательны к учёту)
1. **auth-js v2.119 hasSession()** требует ПЛОСКИЕ access_token/refresh_token/
   expires_in в теле /signup и /token — вложенный session-объект молча теряется
   (сессия не сохранялась; поймано гейтом b). Шим возвращает плоскую форму + user.
2. **@supabase/ssr дефолт httpOnly=false** — httpOnly задаётся через
   cookieOptions при создании клиента (проверено: sb-127-auth-token HttpOnly=true).
3. **Имя куки от IP-URL**: hostname 127.0.0.1 → «sb-127-auth-token» (первая метка
   hostname) — при отладке искать куки по подстроке «auth-token».
4. fail-closed probe подтверждён: shim down → session 401 {user:null}, login 503,
   health 200 (database=ok, auth=unreachable), /styleguide 200 — app жив.
5. Ban-семантика: шим 400 ban_status → login-роут 403 «Аккаунт заблокирован»
   (+ profiles.is_blocked дубль-проверка) — не путать с единой 401 credential.

## Гейты (все пройдены 2026-11-19)
1. lint 0, tsc --noEmit 0.
2. Boot одним вызовом: shim :3040 200 + app :3100 200 (auth:"ok", database:"ok").
3. Seed: auth-users ×4 (Demo123!), app-данные стабильны (products=20, reviews=10).
4. curl-цикл: register=201(+cookies) → session=200 {user,roles} → logout=200 →
   session=401 → wrongpass=401 единое сообщение → register ADMIN=403 →
   login customer@demo.ru=200 → claims roles=['CUSTOMER'].
5. Fail-closed probe + флаги: oauth off=403, demo=200, 2fa=503 {mfaDisabled:true};
   после kill shim: 401/503/200; рестарт шима → session 200 (store жив).
6. httpOnly=true, SameSite=Lax (secure=false — dev http).
7. Коммит **9eb3a77** (`[S2B1] auth: GoTrue-only contour, ssr cookies, claims
   self-healing, auth-modal, dev shim :3040 (recovery)`); bundle
   /home/z/my-project/backups/conditera-v2-S2B1-9eb3a77.bundle (226925 B, verify
   OK, полная история); дерево чистое. worklog.md — полная запись (отклонения ×10,
   уроки ×4).

## Дальше
S2B2 (админ-RBAC: requireAdmin/guardAdmin готовы; /register-roles — подписи в
ROLE_LABELS_RU), S2B4 (Storage: httpOnly-кука → аплоады через server-роуты),
S3B1 (публичный каркас), S6B1 (websocket: jose-верификация JWT GoTrue — клеймы
app_metadata.roles).
