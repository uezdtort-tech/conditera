# DEV-18 — Production registration: fail-closed preflight (документ-свидетельство)

- HEAD на момент фиксации: `82ae685` (2026-10-15)
- Тип: документация-префлайт (код НЕ менялся — правки не требуются)
- Вердикт: **fail-closed ПОДТВЕРЖДЁН** — прод без сконфигурированного
  GoTrue-провайдера отвечает на регистрацию **500**, без прямой записи в
  `auth.users` и без создания профиля; dev-фоллбэк достижим ТОЛЬКО при
  `NODE_ENV === "development"`.

## 1. Кодовый путь (file:line)

1. **Шаг 7 регистрации** — `src/app/api/auth/register/route.ts:252–257`:
   `supabaseAdmin.auth.admin.createUser({ email, password, ... })` — вызов
   admin-API GoTrue (`POST {SUPABASE_URL}/auth/v1/admin/users`) через клиент
   `src/lib/supabase/admin.ts:41–58` (service-role; при отсутствующих env
   клиент создаётся в stub-режиме — `admin.ts:21–27,43`, «stub-service-key» —
   и любая admin-операция падает в runtime с `authErr`).
2. **Прод-гейт (fail-closed)** — `src/app/api/auth/register/route.ts:259–267`:
   при `authErr` и `process.env.NODE_ENV !== "development"` → `500`
   `{ error: "Не удалось создать пользователя в Auth", details }`.
   Возврат происходит ДО шага 8 (profiles upsert, route.ts:292–313) —
   ни `auth.users`, ни `profiles`, ни `user_roles` в проде при отказе GoTrue
   не создаются. Прямой `INSERT INTO auth.users` (route.ts:278–290)
   находится в ветке, недостижимой в проде (см. п. 3).
3. **Dev-фоллбэк (только dev)** — `route.ts:268–274` (после раннего `return`
   п. 2 код доходит сюда только при `NODE_ENV === "development"`) +
   `route.ts:276–290`: стаб-строка в `auth.users` через pg-pool — нужен FK
   `profiles.id → auth.users.id`; пароль канонично хранит
   `profiles.password_hash` (bcrypt), логин от GoTrue не зависит.
4. **Источник 501 в локальном «прод-подобном» рантайме** — заглушка GoTrue
   `src/app/auth/v1/[...path]/route.ts:17–27`: все `/auth/v1/*` →
   `501 LOCAL_AUTH_DISABLED` → `authErr` → прод-ветка 500 (это и есть
   поведение, зафиксированное в TALLY.md «recorded-mode vs поведение»).

## 2. Точное прод-условие пропуска регистрации

Регистрация в проде успешна ⇔ admin-API GoTrue принимает service-role
`createUser` (шаг 7). Гейт **поведенческий** (по факту `authErr`), а не по
наличию env: даже при НАЛИЧИИ `NEXT_PUBLIC_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY`, но недостижимом/некорректном GoTrue — `authErr`
→ 500. Т.е. preflight-блокировка регистрации «до конфигурации провайдера»
выполняется по построению, любая ошибка конфигурации провайдера даёт отказ,
а не тишину.

## 3. Что уже surfaced префлайтами (проверено, без изменений кода)

- **`/api/health`** — `src/app/api/health/route.ts:116,126–132`: компонент
  `supabase` (`required: true`) проверяет НАЛИЧИЕ env
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; при отсутствии —
  `configured:false` → `allRequiredOk=false` → `status:"degraded"`
  (route.ts:169–173, когерентность статуса — DEV-17 d82d5f6).
- **`scripts/env-check.sh:132–137`** — секция «Database & Supabase»:
  `check_required` для `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — прод-сборка env без этих переменных префлайт
  не проходит.

## 4. Гэп (зафиксирован, НЕ реализуется в этой задаче)

Ни `/api/health`, ни `env-check.sh` не проверяют **достижимость GoTrue**
(например, `GET {SUPABASE_URL}/auth/v1/health`): оба префлайта —
env-presence only. Результат: URL «присутствует, но неверен» проходит оба
префлайта, а реальная регистрация падает 500 у первого живого пользователя.
Истинный гейт остаётся поведенческим (открытая точка TALLY.md: прод-прогон
регистрации требует `bun run build` + prod-топология — владелец).
Рекомендация владельцу (вне этой задачи): добавить в деплой-гейт один
behavioral-чек `POST /auth/v1/admin/users` сервисным ключом против
тестового payload, либо GET `/auth/v1/health` — отдельная задача, сюда не
входит (правка health/env-check меняет публичный контракт — сознательно не
делалась).

## 5. Что остаётся владельцу

1. Сконфигурировать реальный поддерживаемый auth-провайдер в прод-топологии:
   валидный `NEXT_PUBLIC_SUPABASE_URL` (реальный Kong/Supabase, не localhost —
   резолвер `src/lib/supabase/url.ts` локальные URL считает лок-рантаймом) +
   `SUPABASE_SERVICE_ROLE_KEY` с правами admin-API GoTrue.
2. Поведенческая приёмка: прод-регистрация → 201 (после конфигурации) /
   500 fail-closed (до) — прогон на прод-топологии, не в песочнице.
3. Решение по гэпу §4 (reachability-проба в префлайт) — отдельная задача.
