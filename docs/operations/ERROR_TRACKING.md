# ERROR_TRACKING — единая регистрация ошибок (DEPLOY-01 §3)

**DEPLOY-01 EXTENDED (§3) · Дата: 2026-11-10**
Исходники: `src/lib/diagnostics/{event-store,capture,client-report,masking,fingerprint,global-handlers}.ts`, `src/instrumentation.ts`, `src/lib/http-helpers.ts`, `src/proxy.ts`, `src/app/api/diagnostics/client-errors/route.ts`, `scripts/verify/route-error-coverage.mjs`, миграция `supabase/migrations/0079_diagnostics_incidents.sql`.

Инвариант §3: сбой диагностики НИКОГДА не влияет на бизнес-код (fire-and-forget), ни одно событие не пишется без маскирования, одна логическая ошибка = один fingerprint = один инцидент.

---

## 3.1 Единая структура события (`app_error_events`, 0079)

Запись создаётся только сервером (`storeErrorEvent`, event-store.ts:209). Ключевые поля:

| Поле | Заполнение |
|---|---|
| `event_id` | `crypto.randomUUID()` на стороне приложения; UNIQUE-гват в БД |
| `occurred_at` | `new Date()` в момент захвата |
| `environment` | `DIAGNOSTICS_ENV`, иначе `NODE_ENV=production → "production"`, иначе `"development"` |
| `app_version` | `APP_VERSION` или `"2.0.0-dev"`; в Docker передаётся `GIT_SHA` (Dockerfile → ENV) |
| `service` | константа `conditera-web` |
| `component` | `frontend|api|database|auth|orders|payments|chat|inventory|recipes|infrastructure|diagnostics-selftest` |
| `severity` | `debug|info|warning|error|critical` (CHECK в БД) |
| `error_code` | опциональный код (`http_500`, `unhandled_route_error`, `dependency:<name>`, `uncaught_exception`, …), обрезан 128 |
| `message` | маскированная строка (≤512) |
| `correlation_id`, `request_id` | из `x-request-id` (см. §3.6), обрезка 128 |
| `route`, `http_status` | маршрут/статус; только для серверных событий |
| `stack_trace` | ТОЛЬКО серверные события (`source!=="client"` → null); маскированный стек ≤8000 |
| `fingerprint` | sha-256 (первые 40 hex) от `component|errorCode|normalizeMessage(message)|route` — `computeFingerprint()` |
| `source` | `server|client|cron|chat|n8n` (CHECK в БД) |
| `actor_id` | `auth.users.id` (только id, без PII) |
| `metadata` | jsonb после `scrub()` (≤4000 симв.) |

Стабильность fingerprint (`fingerprint.ts`): нормализация сообщения вырезает UUID, hex-хэши ≥16, числа ≥4 знаков, десятичные цены, числа в кавычках/скобках; route-сегменты с UUID/числами заменяются на `<seg>`; нижний регистр, схлопнутые пробелы, ≤300 символов.

## 3.2 Маскирование (§3.2) — единая точка `masking.ts`

**Ключевой уровень — 35 регистронезависимых паттернов `SENSITIVE_KEY_PATTERNS`**: значение ключа заменяется на `[REDACTED]` целиком: пароли/секреты/токены/authorization/cookies/api-key/ private-key/session/номера карт/CVC/bank/yookassa/OTP-2FA/telegram-bot/cron-secret/jwt/dsn/salt/encrypted/**email/phone/ИНН-КПП-СНИЛС (PII)**.

**Консервативное REDACT-целое** (расширение §3.2): приватные переписки и содержимое файлов не сохраняются даже фрагментом — ключи-объекты `msg|message|messages`, `body|content`, `files|attachments|documents|uploads|media-data`, составные `message[-_](body|content|text)`, `chat[-_](…)`, `private[-_](…)`, `(file|attachment|document|upload)[-_](content|data|base64|body)`, `\bbase64\b|data[-_]?uri`. Обоснование: вложенные ключи (`message.body`) scrub-у отдельно не видны, потерять строку отладки дешевле, чем пропустить переписку.

**Значимый уровень — 7 паттернов `SENSITIVE_VALUE_PATTERNS`** (применяются к любой строке, даже под «безопасным» ключом): JWT (`eyJ…` 3 сегмента), `Bearer …`, `sk_/pk_(live|test)_…`, Supabase/service-role двойной base64url ≥40, пароль в URL (`://user:pass@`), банковская карта (13–19 цифр с разделителями), inline-файлы `data:*/*;base64,…`.

**Лимиты и защита:** `MAX_STRING=512`, `MAX_METADATA_CHARS=4000`, `MAX_STACK_CHARS=8000`, `MAX_DEPTH=6`, массивы ≤50 элементов, защита от циклических ссылок (seen-set), проверка суммарного размера ДО добавления поля; `stripControlChars()` — C0/C1 удаляются, `\n`/`\r` → пробел (anti log-injection, одна строка = одна запись); `Error` сериализуется как `{name, message}`. Клиентский ingest стек не принимает вовсе (только флаг `hasStack`) — двойное маскирование: `buildClientPayload` на клиенте + `scrub` на сервере.

## 3.3 Надёжность канала (§3.3) — константы `event-store.ts`

| Механизм | Значение | Эффект |
|---|---|---|
| Ограниченная очередь | `QUEUE_MAX=500`, drop-oldest (`totalDropped++`) | лавина ошибок не растит память |
| Батч-запись | `FLUSH_INTERVAL_MS=300`, таймер `unref()` | не держит процесс; не блокирует ответ |
| Таймаут записи | `WRITE_TIMEOUT_MS=3000` (Promise.race) | зависший pg не блокирует flush |
| Circuit-breaker | 5 подряд неудач → канал открыт 30с (`CIRCUIT_COOLDOWN_MS`) | события консоль-логируются локально |
| Per-fingerprint лимит | `PER_FINGERPRINT_LIMIT=20` / `WINDOW_MS=60_000` | всплеск одной ошибки не засоряет таблицу |
| Рекурсия-гвард | `inInternalErrorHandling` | сбой записи не порождает новое событие |
| Динамический импорт pg | `getPoolAsync()` (кэш) | клиентский бандл error.tsx не тянет node:dns |
| Инцидент-агрегация | `upsertIncident` на КАЖДОЕ событие, включая rate-limited | дроп raw-строки не теряет факт ошибки (occurrence_count) |
| Честная деградация | `getStoreStats()` → queueLength/circuitOpen/consecutiveFailures/totalDropped | видимость в админ-метриках |

## 3.4 Точки врезки

**Сервер, API-роуты — `handleRouteError` (src/lib/http-helpers.ts:115):**

```ts
export async function POST(request: NextRequest) {
  try {
    // ... бизнес-логика, может бросать HttpError
  } catch (error) {
    return handleRouteError(error, { route: "/api/x", component: "orders", requestId, actorId });
  }
}
```
`HttpError` < 500 — контролируемая ошибка (info, без записи в журнал); `HttpError` ≥ 500 — `captureServerError` с `errorCode: http_<status>`, severity `error`; прочие (unexpected) — `errorCode: unhandled_route_error`. Тело запроса/заголовки НЕ копируются.

**Прочие серверные точки:** `captureServerError(error, {component, severity, errorCode, route, httpStatus, requestId, actorId, metadata})` — cron/чат-хуки/фоновые задачи; `captureDependencyError(dependency, message, requestId?)` — component `infrastructure`, severity `warning`, errorCode `dependency:<name>`.

**Клиент:** `reportClientError(error, extras)` (client-report.ts) → `POST /api/diagnostics/client-errors` c `keepalive`; payload ≤ `CLIENT_PAYLOAD_MAX_BYTES=16000`, message ≤ `CLIENT_MESSAGE_MAX=400`, стек не передаётся; сбой отправки полностью игнорируется. Ingest-роут: 202 Accepted; CSRF-exempt с компенсирующими контролями — rate-limit 20/мин/IP (429 + Retry-After), жёсткая валидация, size-guard 413, `component` принудительно `frontend` (клиент не может подменить источник на серверный), severity только `error|warning`.

## 3.5 Глобальный страховочный слой (catch-all)

`src/instrumentation.ts` — `register()` выполняется один раз при старте nodejs-сервера (только `NEXT_RUNTIME === "nodejs"`; импорт динамический) и ставит идемпотентные `installGlobalErrorHandlers()` (global-handlers.ts): `process.on("uncaughtException")` и `process.on("unhandledRejection")` → `captureServerError` с `component: "infrastructure"`, `severity: "critical"`, `errorCode: uncaught_exception | unhandled_rejection`. Обработчики не бросают и не await'ят; процесс не убивается — решение о рестарте за оркестратором (Docker HEALTHCHECK/restart). Это единственный путь для ошибок, ускользнувших от handleRouteError и error-boundaries.

## 3.6 Correlation-id (сквозной идентификатор запроса)

`src/proxy.ts` (сегмент «Correlation id»): берётся существующий `x-request-id` от LB/CDN либо генерируется `crypto.randomUUID()`; пробрасывается в downstream-роуты (пересобранный `NextRequest` с обновлёнными заголовками) и возвращается клиенту в заголовке ответа `x-request-id` (в т.ч. в 403-ответах CSRF-гейта). Роуты читают его через `requestIdFrom(req)` (capture.ts: `x-request-id` → `cf-ray` → новый UUID) — событие в `app_error_events` сопоставляется с конкретным запросом/логом доступа по одному id.

## 3.7 CI-гвард покрытия (§3.7)

`node scripts/verify/route-error-coverage.mjs` — входит в job `evidence-hygiene` (ci.yml). Для закрытого списка `CORE_ROUTES` (47 маршрутов критичного бизнес-периметра: заказы/платежи/чат/склад/рецепты/выплаты/медиа заказа) проверяется наличие `handleRouteError` | `captureServerError` | `captureDependencyError` в исходнике. `KNOWN_ABSENT`: `src/app/api/order-media/route.ts` (корневого route.ts нет в репозитории). Новый непокрытый core-маршрут = FAIL — 5xx не попал бы в `app_error_events`, инцидент не создался бы.

**Измерено 2026-11-10 (локально):** `route-error-coverage: checked=46/47` → `✅ все маршруты критичного периметра используют единую регистрацию ошибок`, exit code 0.

## 3.8 Хранение и ретеншн

Таблица `app_error_events` (0079): индексы по fingerprint/occurred_at/severity/component; RLS — admin-only SELECT, клиентских INSERT/DELETE-политик нет (fail-closed, запись только сервером через pg-пул service-role). Retention: `DELETE … WHERE occurred_at < now() - DIAGNOSTICS_RETENTION_DAYS` (по умолчанию 90, максимум 3650) — cron `/api/cron/diagnostics-cleanup`, см. MONITORING.md §5. Инциденты и история — реестр, не удаляются автоматически.
