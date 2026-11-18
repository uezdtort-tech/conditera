# ПРОМПТ S2B1 — Supabase Auth (GoTrue): единственный контур аутентификации

Этап 2 «Auth/RBAC» | Блок 1. Зависимости: S1B2 (схема, profiles),
S1B1 (клиенты supabase-js/ssr).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер по безопасности. По указанию владельца
аутентификация v2 строится на Supabase Auth (GoTrue) — ЕДИНСТВЕННОМ
контуре сессий. Дефекты старого проекта — dual-auth (собственный
jose-контур ПАРАЛЛЕЛЬНО с GoTrue) и fail-open fallback
(auth.ts:293–296) — в v2 невозможны архитектурно.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui (New York, Lucide); без indigo/blue.
- Auth: Supabase Auth через @supabase/ssr (браузерный и серверный
  клиенты, cookie-сессии). App-данные — только Prisma (profiles из
  S1B2). Backend: только Route Handlers.
- Безопасность: fail-closed ВСЕГДА — ошибка/недоступность GoTrue →
  пользователь null (роут 401/503). НИКАКИХ fallback-пользователей,
  НИКАКИХ fallback-INSERT в auth.users (анти-паттерны старого
  auth.ts:293–296 и register-роута). SUPABASE_SERVICE_ROLE_KEY —
  только серверный код.
- Локальный dev: если Supabase недоступен — dev-shim GoTrue
  (mini-services/auth-shim, bun, порт 3040, эмулирует
  /auth/v1/{signup,token,user,logout,admin} + CORS для :3000)
  включается ТОЛЬКО явным env-флагом DEV_AUTH_SHIM=1; без флага —
  fail-closed с понятной ошибкой в логе. Shim — dev-исключение из
  правила абсолютных путей (Supabase-клиенту нужен абсолютный base
  URL; в prod — домен Supabase-проекта владельца). В prod-сборку шим
  не попадает (гвард по NODE_ENV/env при старте).
- Процесс: коммит `[S2B1] ...`; tsc→vitest→agent-browser; worklog.md;
  тесты не писать.
- Запреты: не трогать прод/секреты; не печатать .env*; старый проект —
  только чтение.

## 3. ЦЕЛЬ БЛОКА
Полный auth-контур на Supabase: регистрация 19 self-register ролей,
вход/выход, cookie-сессии с авто-refresh (@supabase/ssr), 2FA (MFA
TOTP), OAuth-колбэки, синхронизация profiles и репликация ролей в JWT
(app_metadata.roles), fail-closed гварды — и НИКАКИХ собственных
JWT/сессионных таблиц.

## 4. ШАГИ
1. Клиенты src/lib/supabase/{browser,server,admin}.ts: browser
   (createBrowserClient), server (createServerClient с cookies() из
   next/headers), admin (createClient с service-role — импорт ТОЛЬКО
   в Route Handlers/server-файлах). Обновление сессии в middleware
   (@supabase/ssr паттерн getUser в src/middleware.ts).
2. Route Handlers (тонкие обёртки над GoTrue, бизнес-логика в lib):
   - POST /api/auth/register: валидация (email lowercase-unique —
     проверка в profiles ДО signUp, пароль ≥8, имя, телефон опц., role
     из ALLOWED_SELF_REGISTER_ROLES: CUSTOMER, CONFECTIONER, STUDIO,
     SUPPLIER, WHOLESALER, COURIER, VENUE_OWNER, ANIMATOR_AGENCY,
     RECREATION_CENTER, KIDS_CLUB, FOOD_SERVICE, EVENT_ORGANIZER,
     PICKUP_POINT, BLOGGER, TASTER, NUTRITIONIST, COPYWRITER,
     CORPORATE_CLIENT, FRANCHISEE); запрос ADMIN-роли → 403
     «назначается администратором»;
     supabase.auth.signUp({email, password, options:{data:{role,
     display_name, phone}}}) → server-side upsert profiles
     (userId, role, displayName…) → шаг 3 (claims) → автологин
     (ssr-клиент ставит куки). Если проект требует подтверждение
     email — вернуть {needsConfirmation:true} (флаг настройки — env
     SUPABASE_EMAIL_CONFIRMATION, dev: off).
   - POST /api/auth/login: signInWithPassword; ЕДИНАЯ ошибка «Неверный
     email или пароль»; после getUser — проверка is_blocked в profiles
     → 403 «Аккаунт заблокирован».
   - POST /api/auth/logout; GET /api/auth/session → {user, roles} —
     roles из claims app_metadata.roles (fallback profiles);
     чувствительные поля НЕ отдавать (факторы MFA, подтверждения,
     внутренние метаданные).
   - POST /api/auth/oauth/[provider] + GET .../callback:
     signInWithOAuth → redirect → обмен кода на сессию → upsert
     profiles → redirect на исходную страницу (паттерн старого
     oauth-колбэка). Провайдеры по решению владельца №6: Yandex, VK,
     Google — настройки в консоли Supabase уже есть у владельца; в v2
     включаются env-гвоздями SUPABASE_OAUTH_YANDEX_ENABLED /
     SUPABASE_OAUTH_VK_ENABLED / SUPABASE_OAUTH_GOOGLE_ENABLED (секреты —
     в консоли Supabase, не в коде); в dev-шиме OAuth эмулируется
     «мгновенным входом» демо-провайдера только при DEV_AUTH_SHIM=1.
3. Синхронизация ролей в JWT: истина — profiles; репликация в
   app_metadata.roles через auth.admin.updateUserById при регистрации
   (после signUp), назначении/снятии роли админом (S2B2). Гварды читают
   claims; при расхождении с profiles — приоритет БД и перезапись
   claims (self-healing).
4. src/lib/auth/current.ts: getCurrentUser() — server-клиент
   supabase.auth.getUser(); ЛЮБАЯ ошибка/недоступность → null
   (fail-closed, закрыть D3); профиль подгружается из Prisma по userId.
5. Гварды: requireRole(roles) / requireAdmin() + guardAdmin(request)
   с готовым 401/403-ответом (развитие — S2B2).
6. 2FA: Supabase MFA (TOTP): POST /api/auth/2fa/enroll (auth.mfa.enroll
   → QR-секрет), POST /api/auth/2fa/verify (challenge+verify →
   статус verified); вход: signInWithPassword → ответ с признаком
   mfa-required → challenge+verify → сессия. Если локальный шим MFA
   не поддерживает — фича-флаг SUPABASE_MFA_ENABLED (dev off, prod on)
   и честная пометка в worklog.
7. Фронтенд: auth-modal (shadcn Dialog): вкладки Вход/Регистрация,
   выбор роли при регистрации (быстрые: покупатель, кондитер,
   поставщик, курьер, юрлицо + «другая»; полный список 19 — на
   /register-roles, S2B2), состояния ошибок, тосты; после успеха —
   сессия Supabase (куки), клиентский Zustand-стор хранит только
   публичный профиль.
8. Seed: демо-юзеры (admin@demo.ru, customer@demo.ru,
   confectioner@demo.ru / Demo123!) создаются через auth.admin
   createUser + profiles-upsert, идемпотентно; если GoTrue недоступен
   и шим выключен — seed app-таблиц продолжается, auth-юзеры
   помечаются «отложено» (не падать).

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- src/app/api/auth/login/route.ts — контракт ошибок и sanitize ответа
  (без passwordHash/tfaSecret/lastLoginIp);
- src/app/api/auth/oauth/[provider]/callback/route.ts — паттерн
  OAuth-колбэка (адаптировать под signInWithOAuth);
- src/components/layout/auth-modal.tsx — UX вкладок и выбора ролей;
- уроки D2/D3: НИКАКОГО второго контура (собственных JWT) и
  fallback-INSERT; GoTrue недоступен → fail-closed, а не «демо-юзер».

## 6. ЗАПРЕТЫ
- Не создавать собственные сессионные таблицы и собственный выпуск
  JWT (jose допускается ТОЛЬКО для верификации JWT GoTrue в
  websocket-сервисе S6B1).
- Не делать fallback-INSERT в auth.users; не подменять пользователя
  при недоступности Auth (fail-closed, всегда).
- Не раскрывать в ответах tfaSecret/факторы/service-role; не логировать
  секреты.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] register → login → session → logout работают (curl-цикл);
- [ ] session после logout → 401; отсутствующая/битая сессия →
      getCurrentUser() = null (fail-closed);
- [ ] неверный пароль → 401 с единым сообщением;
- [ ] ADMIN-роль при self-register → 403;
- [ ] claims app_metadata.roles заполнены после регистрации
      (декодировать access-token и проверить);
- [ ] 2FA: enroll → verify → вход требует challenge → вход ок (или
      честный SUPABASE_MFA_ENABLED=off в dev + запись в worklog);
- [ ] DEV_AUTH_SHIM=0 и недоступный GoTrue → auth-роуты дают
      503/401, не падают, никого не подменяют;
- [ ] куки @supabase/ssr — httpOnly; tsc 0; lint 0; коммит [S2B1];
      worklog.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl-цикл: register (cookie jar) → session → logout → session (401);
- agent-browser: открыть /, модалка, вход demo-пользователем
  (customer@demo.ru / Demo123!), тосты, выход; mobile-вид модалки.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S2B1]; worklog (роуты, claims-схема, флаги
  DEV_AUTH_SHIM / SUPABASE_EMAIL_CONFIRMATION / SUPABASE_MFA_ENABLED).
- Отчёт владельцу: как устроен единственный контур на Supabase, как
  проверяется fail-closed, отличия от dual-auth старого проекта.
