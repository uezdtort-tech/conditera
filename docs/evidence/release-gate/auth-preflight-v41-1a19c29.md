# Release Gate v4.1, Этап 3.1 (C-1) — GoTrue reachability preflight в /api/health (документ-свидетельство)

- HEAD на момент фиксации (и якорь имени файла): `1a19c29` (main; push НЕ
  выполнялся). Между фиксацией и коммитом C-1 в main параллельными агентами
  легли чужие коммиты (`7bcf817` simplex non-root, `50214d6` config
  re-verify) — файлы юнита C-1 (health/register/auth-lib) они не трогали,
  diff-периметр §8 относится к состоянию `1a19c29`.
- Тип: код + тесты (минимальная реализация, TZ v4.1 Этап 3.1)
- Вердикт: **fail-closed НЕ тронут** (`src/app/api/auth/register/route.ts` — 0 diff);
  `/api/health` дополнен живой reachability-пробой GoTrue: production +
  configured + недостижим → top-level `status:"degraded"` (семантика
  required:true); dev/стаб → фактическая классификация БЕЗ false-positive
  прод-отказа; env-presence семантика прежних компонентов сохранена.
- База: docs/evidence/release-gate/auth-prod-preflight-82ae685.md (DEV-18) —
  его §4 «Гэп (reachability-проба)» настоящей задачей закрыт.

## 1. Топологический контракт (выведен из кода, file:line)

1. **Шаг 7 регистрации (единственный путь создания пользователя в проде)** —
   `src/app/api/auth/register/route.ts:252-257`:
   `supabaseAdmin.auth.admin.createUser({ email, password, ... })` →
   admin-API GoTrue `POST {SUPABASE_URL}/auth/v1/admin/users`. Клиент —
   `src/lib/supabase/admin.ts:41-58`; base URL — единая точка
   `resolveSupabaseServerUrl()` (`src/lib/supabase/url.ts:25-29`: env-URL
   как есть, при отсутствии — локальный `http://127.0.0.1:3000`).
   Следовательно: в проде (env-пара задана) регистрация ОБЯЗАНА проходить
   через GoTrue на base-path `{SUPABASE_URL}/auth/v1` — канонический
   health-эндпоинт этого сервиса: `GET {SUPABASE_URL}/auth/v1/health`.
2. **Fail-closed гейт (неизменный)** — `route.ts:259-267`: при `authErr` и
   `NODE_ENV !== "development"` → `500` ДО шага 8: ни dev-стаб
   `INSERT INTO auth.users` (`route.ts:278-290`, dev-only), ни
   profiles upsert (`:297-313`), ни user_roles (`:333-355`) не выполняются.
3. **Stub-режимы dev-рантайма**: клиент без env-пары создаётся в stub-режиме
   (`admin.ts:21-27`, «stub-service-key», admin-операции падают в runtime);
   локальная заглушка GoTrue `src/app/auth/v1/[...path]/route.ts:17-27` —
   любой `GET/POST /auth/v1/*` → `501 LOCAL_AUTH_DISABLED` (живо проверено:
   `curl :3000/auth/v1/health → 501`).

**Итог контракта**: проба должна бить в тот же base-path, что и регистрация,
классифицировать результат и НЕ менять поведенческий гейт регистрации.

## 2. Дизайн пробы (`checkGoTrue()`, src/app/api/health/route.ts)

- `GET {resolveSupabaseServerUrl()}/auth/v1/health`, таймаут **3s**
  (AbortController; паттерн — существующие checkDatabase/checkN8n), заголовок
  `apikey` с сервисным ключом — как ходит сам admin-клиент (Kong-гейтвей может
  требовать apikey даже на health). Функция никогда не бросает.
- Классификация (3 состояния):
  | состояние | условие |
  |---|---|
  | `not-configured` | нет env-пары (URL / сервисный role-ключ) — fetch НЕ выполняется; совпадает с `configured:false` компонента `supabase` |
  | `reachable` | HTTP 2xx от `/auth/v1/health` |
  | `unreachable` | сетевая ошибка / таймаут 3s / не-2xx — вкл. 501 локальной заглушки, 404 неверного пути, 5xx шлюза: GoTrue не подтверждён |
- **Прод-гейт деградации** (в `GET()`):
  `authProductionFailure = NODE_ENV === "production" && configured && unreachable`
  → `allRequiredOk=false` → top-level `status:"degraded"` (та же семантика,
  что у required-компонентов; HTTP-гейт НЕ менялся: 200/503 определяется
  только database — env/auth-деградация код не гейтит, как и прежде).
- **Dev/стаб**: классификация фактическая (501-заглушка → `unreachable`),
  но `authProductionFailure=false` по построению (`NODE_ENV !== production`);
  `details` прямо сообщает «dev/local runtime, no production gate» —
  false-positive прод-мисконфига исключён.
- Проверки выполняются параллельно с БД/n8n в одном `Promise.all` —
  деградации latency readiness нет (худший случай = таймаут 3s пробы,
  перекрытый другими проверками).

## 3. Тело /api/health — до/после (имена полей)

- **До**: `app, database, n8n, status, service, version, timestamp, uptime,
  environment, features, dependencies[supabase, jwt, smtp, telegram_bot,
  yookassa, cron_secret]` (DependencyStatus: `name, required, configured,
  details?`); HTTP-гейт: 200/503 по database.
- **После** (аддитивно, прежние поля и HTTP-гейт без изменений):
  - top-level `auth`: `"ok" | "unreachable" | "not-configured"` —
    зеркалирует классификацию (`reachable` → `ok`);
  - компонент dependencies `auth_gotrue` (`required: true`) с новым
    опциональным полем `reachability` (3 состояния) и `details`
    (человекочитаемо; в проде недостижимость явно называет следствие —
    fail-closed 500 регистрации);
  - `DependencyStatus` расширен опциональным `reachability?` — прочие
    компоненты поле не выставляют.

## 4. Тест-матрица (vitest, герметично, без сети/БД)

`src/app/api/health/route.test.ts` — 6 → 11 (5 новых, прежние 6 не менялись):

| сценарий | мок fetch (/auth/v1/health) | NODE_ENV | ожидание |
|---|---|---|---|
| configured + GoTrue 2xx | `{status:200}` | production | HTTP 200, `auth:"ok"`, dep `reachability:"reachable"`, `status:"ok"`, проба бьёт в `/auth/v1/health` |
| configured + сеть недоступна | rejects ECONNREFUSED | production | HTTP 200 (БД-гейт не тронут), `auth:"unreachable"`, `status:"degraded"`, details содержит fail-closed |
| configured + 501 (сигнатура заглушки) | `{status:501}` | production | `auth:"unreachable"`, `status:"degraded"`, details `HTTP 501` |
| dev + локальная заглушка 501 | `{status:501}` | development | `auth:"unreachable"` (факт), но `status:"ok"` — НЕ false-positive прод-отказа |
| not-configured (dev) | env-пара удалена | development | `auth:"not-configured"`, fetch на `/auth/v1/health` НЕ выполнялся, деградация только от env-presence `supabase` (прежнее поведение) |

`src/app/api/auth/register/route.test.ts` — НОВЫЙ, 3 теста (фиксация
СУЩЕСТВУЮЩЕГО fail-closed; код роута 0 diff):

| сценарий | ожидание |
|---|---|
| production + createUser fail | `500` `{"error":"Не удалось создать пользователя в Auth"}`; пул (auth.users-стаб), profiles upsert, user_roles, referrals — НЕ вызваны; компенсация deleteUser не нужна |
| development + createUser fail | dev-фоллбэк: `201`, `INSERT INTO auth.users` через пул ×1, profiles upsert ×1 (гейт строго NODE_ENV-условный) |
| production + createUser ok | `201`, пул НЕ вызывается (dev-стаб в проде недостижим), профиль по `{onConflict:"id"}` |

Моки: `@/lib/anti-fraud`, `@/lib/supabase/admin`, `@/lib/auth`,
`@/lib/postgrest/pool`, `@/lib/yandex-metrika`, `@/lib/telegram-bot`,
`@/lib/email`. NODE_ENV в сценариях — через helper с гарантированным
восстановлением (в next-env типах поле read-only — мутируется через алиас).

## 5. Гейты (exit-коды и счётчики)

- Таргет: health (11) + register (3) → **14/14 passed**.
- `bun run test` (полный): **49 files / 1011 tests passed, exit 0**
  (до задачи: 48 / 1003 → +1 файл, +8 тестов, потерь нет).
- `bun run typecheck` → exit 0; `bun run lint` → exit 0.
- `node scripts/scan-evidence.mjs` → exit 0 (real findings: 0).
- `scripts/env-check.sh` — НЕ трогался (владелец — другой агент, задача C-1 его исключает).

## 6. Живая проверка (:3000, dev-рантайм)

- `curl :3000/auth/v1/health` → `501` (локальная заглушка — подтвердилась).
- `GET :3000/api/health` → **HTTP 200**, новое поле присутствует и когерентно
  dev-классификации (env-пара задана, URL локальный → проба бьёт в заглушку):

```json
{
  "app": "ok", "database": "ok", "n8n": "ok",
  "auth": "unreachable",
  "status": "ok",
  "environment": "development",
  "dependencies": [
    { "name": "supabase", "required": true, "configured": true },
    { "name": "auth_gotrue", "required": true, "configured": true,
      "reachability": "unreachable",
      "details": "GoTrue unreachable (HTTP 501) — dev/local runtime, no production gate" },
    { "name": "jwt", "required": true, "configured": true }
  ]
}
```

(показаны релевантные поля; timestamp/uptime опущены)
- dev.log: проба видна живьём — `GET /auth/v1/health 501 in 34ms` сразу после
  `GET /api/health 200` (проба выполняется самим роутом).
- Когерентность dev: `auth:"unreachable"` при `status:"ok"` — заглушка
  классифицируется фактически, прод-отказ НЕ маркируется. Ожидаемое прод-
  поведение: `auth:"ok"` при живом GoTrue; при configured+недостижимом —
  `status:"degraded"` (HTTP остаётся по БД-гейту).
- Ops-заметка: Turbopack hot-reload не перекомпилировал health-роут по
  изменению самого файла; инвалидация сработала через импортируемый модуль
  (`src/lib/supabase/url.ts`, touch + revert) — на контракт не влияет.

## 7. .env.production.example (READ-ONLY проверка, задача п.3)

Файл не менялся. Значения секретов — ТОЛЬКО плейсхолдеры `CHANGE_ME_*`
(DATABASE_URL-пароль, anon/сервисные ключи, MEILI, n8n, simplex, JWT/TFA/
соли/cron/bot) либо пустые строки (OAuth/telegram/yookassa/mailgun).
Непустые не-секретные значения: публичные домены (conditera.ru), порты/хосты
внутренней сети compose, публичный ID счётчика Метрики, размеры бакетов.
**Реально выглядящих секретов НЕ обнаружено** — файл остаётся шаблоном.
Номенклатура env-имён совпадает с ожидаемой кодом (URL-пара Supabase —
`admin.ts:21-22`; проба читает те же имена).

## 8. Что изменено (diff-периметр)

| файл | изменение |
|---|---|
| `src/app/api/health/route.ts` | + checkGoTrue (3s, 3-состояния), + top-level `auth`, + dep `auth_gotrue`, + authProductionFailure в статус-гейт, докблоки |
| `src/app/api/health/route.test.ts` | +5 сценариев GoTrue-пробы (6 прежних без изменений), докблок |
| `src/app/api/auth/register/route.test.ts` | НОВЫЙ: 3 fail-closed регрессии |
| `docs/evidence/release-gate/auth-preflight-v41-1a19c29.md` | этот документ |

Запретные файлы (Dockerfile.simplex-bridge, docker-compose.yml,
.env.production.example, scripts/env-check.sh, payment/webhook/escrow/
payout/refund код) — 0 diff. Регистрационный роут — 0 diff (READ-ONLY,
fail-closed сохранён: см. §4).
