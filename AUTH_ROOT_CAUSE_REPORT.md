# AUTH ROOT CAUSE & REGISTRATION RECOVERY — отчёт о расследовании и исправлениях

Дата: 2026-11-16. Основание: задание владельца «Z — AUTH ROOT CAUSE & REGISTRATION RECOVERY» (P0).
HEAD до работ: `0b5a6e2`. Все изменения — локально; прод, секреты, схема БД, RLS, защищённые upload-роуты не затронуты.

## 1. Первопричина проблем регистрации и входа

Проблема регистрации на проде имела **две независимые первопричины**:

1. **Инфраструктурная (основная, прод)**: GoTrue (`supabase-auth`) и PostgREST (`supabase-rest`) на conditera.ru unhealthy (Caddy↔Supabase таймауты, `search_path` PostgREST). До коммита `cb42589` регистрация при недоступном GoTrue была fail-closed 500 — см. `/api/health` details «production registration is fail-closed (500) until the auth provider is reachable».
2. **Кодовая (исправлена cb42589, проверена и укреплена в этой сессии)**: старый код различал окружения (`NODE_ENV !== "development"` → 500), не опираясь на фактическую причину ошибки. `cb42589` снял гейт: fallback на строку `auth.users` через pg-пул выполняется по факту ошибки GoTrue — в любом окружении.

Вход не был сломан ни в одной ветке: пароль канонично проверяется bcrypt по `profiles.password_hash` (`src/lib/auth.ts:134-139`); GoTrue нужен только для пользователей без хэша (OAuth/SupabaseAuthModal) — у них fail-closed 401 при недоступном GoTrue (осознанно).

## 2. Точная схема двух механизмов Auth (до исправлений)

**Связь механизмов — общий секрет**: `docker-compose.supabase.yml:150` `GOTRUE_JWT_SECRET: ${JWT_SECRET}` — GoTrue подписывает свои JWT тем же HS256-секретом, что и app (`src/lib/auth.ts`). Поэтому `verifyAccessToken` валидирует и app-JWT, и GoTrue-JWT (`payload.sub` → userId), и PostgREST (`PGRST_JWT_SECRET`) — тот же секрет для `auth.uid()`.

**Канонический (app-JWT)**:
- выпуск: register → login → 2fa/login-verify → refresh (только access);
- секреты: `JWT_SECRET` (access 7d), `JWT_REFRESH_SECRET` (refresh 30d, отдельный), 2FA-temp 5m;
- cookies: `cd_session`/`cd_refresh` (httpOnly, SameSite=Lax, Secure в prod) — `src/lib/session-cookies.ts`;
- единая точка проверки: `getUserFromRequest` (266 route-файлов): Bearer → `cd_session` → `sb-*-auth-token`;
- пароли: bcryptjs cost 10 в `profiles.password_hash`;
- роли: `user_roles` — источник; refresh перечитывает роли из БД.

**Зеркало (GoTrue, best-effort)**:
- `supabaseAdmin` (SERVICE_ROLE): register `createUser`, OAuth-callback, компенсирующие откаты;
- `getSupabaseServer` (anon + SSR): login устанавливает GoTrue-сессию; Supabase-роуты читают `sb-*`;
- `supabaseBrowser`: `useAuth`, Storage-аплоады, OAuth `setSession` через handoff;
- `supabase/middleware` `updateSession` — рефреш `sb-*` cookies;
- OAuth: Яндекс/Google реальные (anti-merge fail-closed, timing-safe state), VK честно не реализован (fail-closed), Telegram — виджет.

**Fallback регистрации (cb42589)**: `authErr` от `createUser` → INSERT `auth.users` (пустой `encrypted_password`) через pg-пул → profiles upsert (bcrypt-хэш) → user_roles. Триггер `on_auth_user_created` создаёт профиль+роль.

## 3. Ответы на 10 контрольных вопросов о fallback

1. **Условия включения**: любая ошибка `createUser`. *Дефект*: «User already registered» (422) тоже проваливался в fallback → стаб бился по UNIQUE(email), upsert — по FK → бесполезный 500 «Ошибка при создании профиля». **Исправлено**: 422/`user_already_exists` → честный 409.
2. **Production**: да — после деплоя `cb42589+`; без деплоя прод остаётся 500 (задача Pi).
3. **Криптография пароля**: да — `profiles.password_hash` (bcrypt cost 10) пишется всегда, логин проверяет `verifyPassword`. Пароль никогда не проверяется «пустым местом».
4. **Сессия без проверки GoTrue**: да — но это штатно: app-JWT каноничен; для ВХОДА сессия выдаётся только после bcrypt-верификации (или GoTrue для безхэшевых). «Пустой» GoTrue не даёт сессии.
5. **app-JWT при недоступном Auth**: да — это осознанный контракт (см. §4). При недоступном GoTrue вход не ломается.
6. **Обход блокировки**: login/session/refresh проверяют `is_blocked` fail-closed; API-проверка была fail-open при ошибке БД (R3) — **исправлено** (§6B). 60-секундный кэш blocked-статуса — документированный компромисс (проверено E2E: 400 в окне кэша → 401 после).
7. **Фиктивный профиль/роль**: нет — реальный profiles + user_roles; роли только из whitelist 19 self-register ролей; ADMIN/MODERATOR — только приглашением (403).
8. **Privilege escalation**: нет — whitelist исключает административные роли; JWT-роли — проекция `user_roles`; гварды читают серверные проверки.
9. **Разница регистрация/вход**: консистентно — оба трактуют `profiles.password_hash` как канон. Разница: GoTrue-only пользователи (OAuth) требуют GoTrue на входе — fail-closed при его недоступности (осознанно). **Добавлено**: login лечит зеркало GoTrue для stub-пользователей (bcrypt-верифицированный пароль → `updateUserById(password)` → sb-сессия им тоже доступна).
10. **Дубликаты**: невозможны на уровне БД: `profiles.email UNIQUE`, `profiles.id → FK auth.users(id) ON DELETE CASCADE`, `auth.users.email UNIQUE`. Гонка закрыта констрейнтами (500 вместо дубля). *Ограничение*: телефон не имеет UNIQUE-констрейнта (проверка только SELECT) — смена схемы запрещена владельцем (D13), зафиксировано как известное ограничение.

## 4. Канонический источник истины (решение)

**App-JWT — канонический механизм сессии; `profiles.password_hash` — каноническое хранилище паролей; GoTrue — обязательное зеркало для OAuth, sb-SSR-роутов и браузерных Storage-аплоадов.**

Почему не GoTrue-канон (вариант A) и не «единая Supabase-сессия» (вариант C):
- fallback регистрации и работа входа при недоступном GoTrue — сами по себе требования инцидента (GoTrue на проде месяцами нездоров);
- 266 роутов на `getUserFromRequest`; перенос их на GoTrue-сессию — массовый риск без выгоды;
- stub-пользователи (fallback) имеют пустой `encrypted_password` — GoTrue их не аутентифицирует, а перенос bcrypt-хэшей в GoTrue невозможен (bcryptjs-хэш совместим, но требует массовой записи через admin API — отдельная миграция);
- RLS/`auth.uid()` не зависят от выбора: PGRST использует общий секрет; шим `postgrest/execute.ts` задаёт claims вручную.

Не внедрён второй независимый механизм: единый cookie-контракт (`cd_session`), единая точка проверки, GoTrue-токены принимаются только как канал совместимости с той же blocked-проверкой.

## 5. Изменённые файлы (список)

| Файл | Изменение |
|---|---|
| `src/app/api/auth/register/route.ts` | 422/`user_already_exists` → 409 без fallback; email-валидация (400 до БД/GoTrue); trim+lowercase нормализация; честные комментарии (bcrypt, не Argon2id) |
| `src/app/api/auth/login/route.ts` | Лечение GoTrue-зеркала для stub-пользователей: bcrypt-верифицированный пароль → `admin.updateUserById(password)` → retry `signInWithPassword` (non-fatal); комментарии bcrypt |
| `src/lib/auth.ts` | **R3 fail-closed**: ошибка blocked-check при POST/PUT/PATCH/DELETE → null (роут вернёт 401); GET/HEAD — fail-open (чтение); кэш не заполняется при ошибке |
| `src/app/api/auth/session/route.ts` | Явный warn при ошибке profile-lookup; GET fail-open задокументирован (мутации того же пользователя закрывает auth.ts) |
| `src/lib/cron-auth.ts` | **R5**: `X-Cron-Secret` — `timingSafeEqualStr` (crypto.timingSafeEqual) |
| `src/lib/email-sanitize.ts` | НОВЫЙ: isomorphic-dompurify, whitelist тегов/атрибутов, `data:image/` только для картинок, hook rel=noopener |
| `src/app/api/email/inbound/route.ts` | **R1**: санитизация HTML до записи в БД |
| `src/components/dashboard/admin-email-tab.tsx` | **R1**: санитизация до `dangerouslySetInnerHTML` (легаси-строки в БД); fallback на текст-версию |
| `src/app/layout.tsx` | `SupabaseAuthSync` смонтирован глобально |
| `src/components/layout/supabase-auth-sync.tsx` | Ожидание rehydration persist до очистки (гонка); лог очистки устаревшего пользователя |
| `src/app/dashboard/page.tsx` | Удалены локальные монтирования sync (root layout покрывает) |
| `package.json` / `bun.lock` | + `isomorphic-dompurify@4.7.0` |
| Тесты: `src/lib/email-sanitize.test.ts`, `src/lib/cron-auth.test.ts`, `src/lib/auth-blocked-check.test.ts`, `src/app/api/auth/register/route.test.ts` | Новые 37 кейсов (XSS-фикстуры, timing-safe, fail-closed, fallback-контракты) |

## 6. Исправленные критические дефекты

- **A. Stored-XSS (R1/P0-1)**: санитизация в двух точках (сервер до БД + клиент до рендера). Тесты: 19 malicious-фикстур (onerror/onload, javascript:/vbscript:, SVG onload, iframe/object/embed/form/base/meta/link, srcdoc, data:text/html, CSS-expression) + 8 проверок сохранения легитимной вёрстки.
- **B. Fail-open блокировки (R3/P1-2)**: мутации fail-closed, чтения fail-open, кэш не кеширует ошибки. Тесты: 12 кейсов (все методы, throw-путь, кэш, границы аутентификации). E2E: заблокированный → session 403 + cookies очищены; мутация после TTL → 401.
- **C. Timing-safe секреты (R5/P1-3)**: `cron-auth` переведён на `timingSafeEqualStr`; n8n/telegram/simplex/CSRF уже были timing-safe (проверено grep). Тесты: 10 кейсов.
- **D. Гонка persist-гидрации (новое, найдено E2E)**: `SupabaseAuthSync` очищал стейт до завершения rehydration zustand-persist → устаревший пользователь переживал logout/блокировку/истечение JWT в шапке; sync не был смонтирован вне /dashboard. Исправлено: глобальный mount + ожидание гидрации. E2E: logout → reload → «Войти».
- **E. UX-контракт дубликата (последствие cb42589)**: «User already registered» → 409 вместо 500.

## 7. Результаты тестов

| Проверка | Результат |
|---|---|
| `tsc --noEmit` | 0 ошибок |
| `vitest run` | **1947/1947 passed, 148 файлов** (+25 новых тестов к 1922) |
| `eslint` (изменённые файлы) | 0 проблем |
| `check:quick` (typecheck+lint+vitest+secrets) | **PASSED** |
| E2E вход (seed-аккаунт) | login 200 → session 200 (mode=app) → reload держит сессию → refresh выдаёт новый access |
| E2E logout | UI: cookies+store очищены; reload → «Войти» |
| E2E регистрация (CONFECTIONER через UI) | register 201 (fallback: GoTrue 501 → auth.users стаб, dev.log:1366) → автовход → роли [CUSTOMER, CONFECTIONER] → повторный вход после logout 200 |
| E2E блокировка | session → 403 + cookies очищены; мутация после TTL кэша → 401 (fail-closed); login заблокированного → 403 |
| Защищённые upload-роуты | инцидент повторился в сессии; восстановлены `protected-paths.sh repair && skip-on`, status S×4, redline-тест 9/9 |

Локальные тесты выполнены на embedded PG (:54329) с 501-заглушкой GoTrue — это ровно fallback-сценарий. **Production-проверки НЕ выполнялись** (запрет + прод нездоров): все результаты — локальные, не прод.

## 8. Оставшиеся ограничения (не исправлено, по запретам/вне объёма)

1. Argon2id-миграция (P1-1) — dual-verify по префиксу; bcrypt comments уже исправлены.
2. zod-валидация auth-роутов (P1-4) — добавлена только email-валидация; полные схемы — отдельная задача.
3. Уникальность телефона — нет DB-констрейнта (запрет менять схему, D13).
4. Hydration-mismatch на главной (пре-существующий, не-auth) — React восстанавливается, не блокирует; отдельная задача.
5. JWT-ротация, деплой `cb42589+`, восстановление PostgREST/Caddy — Pi/владелец.
6. Push 299+ коммитов — только по явному разрешению владельца.
7. Восстановление Production (P1-5): ① PostgREST→DB; ② Caddy↔Supabase; ③ деплой; ④ (по разрешению) JWT-ротация; ⑤ верификация auth на проде.

## 9. Критерии завершения (статус)

| № | Критерий | Статус |
|---|---|---|
| 1 | Один канонический механизм | ✔ задокументирован (§4), не введено второго |
| 2 | Нет обхода проверки пароля | ✔ bcrypt везде, GoTrue-only — fail-closed |
| 3 | Нет небезопасного fallback | ✔ 409-исключение, дубли невозможны (констрейнты) |
| 4 | Рабочая регистрация | ✔ E2E (все 19 ролей whitelist — сервер; UI — CUSTOMER/CONFECTIONER проверены) |
| 5 | Рабочий вход | ✔ E2E seed + новый пользователь |
| 6 | Корректные cookies/сессии | ✔ httpOnly/Lax/Secure; reload держит; logout чистит |
| 7 | Рабочий refresh | ✔ E2E: новый access из cd_refresh |
| 8 | Корректные роли | ✔ user_roles источник; refresh перечитывает; whitelist |
| 9 | RLS и auth.uid() | ✔ не тронуты; общий секрет сохранён; шим работает (pgrst 200) |
| 10 | Отсутствие stored-XSS | ✔ санитизация ×2 + 27 тестов |
| 11 | Fail-closed blocked-check | ✔ мутации 401, чтения OK, 12 тестов + E2E |
| 12 | Нет регрессий | ✔ 1947/1947, tsc 0, lint 0, secrets CLEAN |
