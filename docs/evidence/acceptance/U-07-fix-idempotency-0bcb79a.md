# U-07 FIX — Checkout idempotency: стабильный клиентский ключ на логическую отправку

**Status: FIX VERIFIED (client-only)** — сервер не менялся; контракт зафиксирован регрессиями
- Base HEAD: `0bcb79a` (0bcb79ab70adc82c496e1d50e5ecc9552683f2e4), main; push НЕ выполнялся
- Date (UTC): 2026-10-15 23:15–23:50
- Task: B-1, Release Gate v4.1. Finding source: `U-07-checkout-order-idempotency-1362744.md` (HEAD 1362744)
- Запретная зона (payment/webhook/escrow/payout/refund/bonus-balance) НЕ затронута — diff ниже это показывает.

## 1. Chain trace (file:line)

### Client — кто шлёт POST /api/checkout

**a) CheckoutPage (реальный UI-путь)** — `src/components/pages/extra-pages.tsx`
- ДО фикса: ключ генерился один раз на МОНТИРОВАНИЕ страницы — `useState(() => crypto.randomUUID() | fallback)` (было `extra-pages.tsx:1453-1457` на HEAD 0bcb79a); отправлялся как **заголовок** `Idempotency-Key` (было `:1556`).
- Семантика ДО: стабилен по кликам/ретраям внутри смонтированной страницы (двойной клик, повтор после ошибки валидации), но **перегенерировался при remount** (перезагрузка страницы, уход и возврат). Сценарий «первый запрос дошёл и создал заказ → ответ потерян → пользователь перезагрузил страницу → повтор» получал НОВЫЙ ключ → дубль-заказ.
- ПОСЛЕ фикса: ключ привязан к **сигнатуре тела логической отправки** и живёт в sessionStorage — см. §3.

**b) useCreateOrder (публичный хук, вызывающих в компонентах нет — dead code, но контракт публичного API)** — `src/lib/supabase/use-marketplace.ts:582-622` (на HEAD 0bcb79a)
- POST `/api/checkout` (`:593-604`) отправлялся **вообще без Idempotency-Key** → каждый resubmit = дубль. Это и есть «duplicate order on resubmit» из U-07: сервер opt-in, клиент ключ не прислал.

### Server — как ключ обрабатывается (НЕ менялось)

`src/app/api/checkout/route.ts` (POST, ~807 строк):
- **Чтение**: `:160` → `extractIdempotencyKey(request)` — `src/lib/promo-codes.ts:274-281`: заголовок `Idempotency-Key`, trim, 8..100 символов, `[A-Za-z0-9._-]`, иначе ключ отбрасывается (трактуется как отсутствующий).
- **Replay-поиск**: `:161-177` — при наличии ключа `orders` по `user_id` + `metadata->>idempotency_key` + `created_at >= now-15min` (TTL `IDEMPOTENCY_TTL_MINUTES=15`, `:54`); найден → `buildReplayResponse` (`:761-806`) → **200, тот же orderId**, `idempotentReplay:true`, без создания заказа/платежа.
- **Хранение**: `:524-528` — `orders.metadata.idempotency_key = key ?? null`.
- **Гонка**: уникальный индекс 0060 `uq_orders_idempotency` — `supabase/migrations/0060_p11_hardening_integrity.sql:50-53`: `UNIQUE (user_id, (metadata->>'idempotency_key')) WHERE metadata->>'idempotency_key' IS NOT NULL`; на `23505` (`:533-557`) проигравший ищет свежий заказ с тем же ключом и возвращает replay (`:553-556`).
- **Ключ ОТСУТСТВУЕТ**: replay-поиск пропускается (`:161`), в metadata пишется `null` (`:526`) — строка вне частичного индекса → **каждый POST создаёт новый заказ** (текущий opt-in контракт).
- **Ключ КОНФЛИКТНЫЙ (тот же ключ, другое тело)**: тело не сверяется — первый заказ «побеждает», повтор получает replay первого (user-scoped: ключ ограничен `user_id`, cross-user коллизий нет). Стандартная семантика «возвращаем первый результат».
- **Create = 200, не 201**: `:729-746` (finding #1 U-07, вне скоупа B-1, не менялось).

## 2. VERDICT: клиентский фикс, сервер не менялся

- Механизм сервера **звук**: при переданном ключе — replay 15-минутного окна + race-safe через индекс 0060 (подтверждено живой гонкой 4×, секция C ниже).
- Требуемая гарантия ТЗ — «нет дубля при ретрае той же логической отправки» — нарушалась **только клиентом**: хук не слал ключ вовсе; страница слала ключ, нестабильный между remount'ами.
- Изменение сервера (reject без ключа) отклонено по blast radius: легитимные вызывающие без ключа существуют (`.run/acc/u07-u09.mjs` — контрольная секция B намеренно без ключа; скрипты/e2e, вызывающие checkout голым fetch). Контракт «без ключа → создаётся заказ» зафиксирован как есть регрессией (секция B прогона) с комментарием для владельца. Серверный маршрут — money-creation путь (рядом createPayment) — не трогался вовсе.

## 3. Что изменено (client-only)

Новый модуль **`src/lib/checkout-idempotency.ts`** (единственный новый код; ~170 строк):
- `computeCheckoutSubmissionSignature(body)` — канонический stringify (сортировка ключей, undefined не значимы) + FNV-1a + длина: стабильная сигнатура логической отправки без дублирования контактных PII в sessionStorage.
- `beginCheckoutIdempotencyAttempt(body)` → `{key, reused}`: та же сигнатура при НЕзакрытой попытке → **тот же ключ**; иначе новый (UUID, фолбэк `co_*` в формате серверного валидатора).
- `resolveCheckoutIdempotencyAttempt(key, outcome)`:
  - `success` (2xx) / `rejected` (4xx — сервер точно не создавал заказ) → ключ **закрыт**: следующая отправка (в т.ч. осознанный повторный заказ с той же корзиной) получает НОВЫЙ ключ — ложный replay невозможен;
  - `unknown` (сетевой сбой/таймаут/5xx — заказ МОГ создаться) → ключ **живёт**: повтор той же отправки вернёт replay.
- Носитель: `sessionStorage` (ключ переживает remount/перезагрузку страницы — сценарий lost-response+reload), фолбэк в память процесса, мусор/чужая запись в хранилище трактуется безопасно.

**`src/components/pages/extra-pages.tsx`** (CheckoutPage): ключ больше не `useState`-на-монтирование; тело собирается один раз → `beginCheckoutIdempotencyAttempt(body)` → заголовок `Idempotency-Key` → исход фиксируется в ЕДИНОЙ точке (2xx→success, 4xx→rejected, иначе/сеть→unknown, включая catch сетевого сбоя). Файл не содержит платёжной логики — только отправку checkout.

**`src/lib/supabase/use-marketplace.ts`** (useCreateOrder): теперь шлёт `Idempotency-Key` по тому же контракту (ключ на логическую отправку через сигнатуру payload, resolve по исходу, сеть→unknown). Хук остаётся без вызывающих (dead code) — зафиксировано, поведение выровнено для будущих подключений.

### Diff stat (base 0bcb79a)

```
 src/components/pages/extra-pages.tsx                 | 59 ++++++++++++++++++------------
 src/lib/supabase/use-marketplace.ts                  | 54 ++++++++++++++++++-------
 src/lib/checkout-idempotency.ts                      | (new) +173
 src/lib/checkout-idempotency.test.ts                 | (new) +172
 src/lib/supabase/use-marketplace.checkout-idem.test.tsx | (new) +206
 scripts/verify/checkout-idempotency-verify.mjs       | (new) +290
```

Сервер (`src/app/api/checkout/route.ts`, `lib/yookassa`, `api/payment/*`, webhook/escrow/payout/refund/bonus) — **0 изменений**.

## 4. Регрессионные тесты

**vitest (jsdom), 20 тестов — PASS:**

- `src/lib/checkout-idempotency.test.ts` — 14: повтор той же отправки → тот же ключ (`reused:true`); порядок свойств тела не влияет; изменённое тело → новый ключ; undefined-поля не значимы; `resolve(success|rejected)` → новый ключ (без ложного replay); `resolve(unknown)` → ключ живёт; resolve чужим ключом не трогает новую попытку; **перезагрузка страницы** (vi.resetModules + тот же sessionStorage) → тот же ключ; sessionStorage недоступен → фолбэк в память; форма ключа совместима с серверным валидатором (50 ключей, charset/длина/уникальность); сигнатура стабильна/чувствительна; мусор в sessionStorage безопасен.
- `src/lib/supabase/use-marketplace.checkout-idem.test.tsx` — 6 (renderHook + QueryClientProvider, fetch-мок, конвенции use-marketplace.fillings.test.ts): заголовок `Idempotency-Key` отправляется (раньше — никогда); ретай после сетевого сбоя → тот же ключ; ретай после 5xx → тот же ключ; после успеха → новый ключ; после 4xx → новый ключ; другой payload → другой ключ.

**Интеграционный верификатор (живой dev-стек)** — `scripts/verify/checkout-idempotency-verify.mjs`
(паттерн `scripts/verify/p11-hardening-verify.mjs` + `inventory-concurrency-verify.mjs`): секции A/B/C/D ниже; synthetic-данные (`u07fix-<run>`), cleanup в finally при любом исходе (включая заказ от «потерянного» запроса — догсбор по ключам), выход 0 = PASS.

## 5. LIVE matrix (:3000, PG 127.0.0.1:54329/conditera, run `u07fix-fsrs0k`, транскрипт `.run/acc/u07-fix-idempotency-transcript.txt`)

| # | Сценарий | Запросы | Коды | Заказов (БД) | orderId |
|---|---|---|---|---|---|
| A | replay / «потерянный ответ»: подряд два POST с ключом `u07fix-…-a` | 2 | 200, 200 (`idempotentReplay:true` на 2-м) | **1** | `5cdb93be-8c55-4e7c-9191-4349bdefa484` (оба) |
| B | без ключа (текущий opt-in контракт, finding #2 — владелец) | 2 | 200, 200 | **2** | `825549b0-…` и `36f512c7-…` (разные) |
| C | гонка: 4 параллельных POST, один ключ `u07fix-…-c` | 4 | 200×4 | **1** | `955a8d47-159e-4848-be53-1b059011a9ba` |
| D | lost response: POST ушёл, ответ выброшен, заказ создан → retry с тем же ключом | 2 | 200, 200 | **1** | lost=`2c10744d-846a-4cb2-ac1c-01d755412b08` → retry=**тот же** |

Итог: **PASS 15 / FAIL 0, exit 0**; cleanup: orders=5 (+payments/order_items/domain_events/notifications), остаточных synthetic-строк 0 (проверено SQL после прогона; предзаказы demo-пользователя не тронуты). Комментарий для владельца в секции B: дубли-защита при отсутствии ключа — opt-in контракт сервера, зафиксирован регрессией как есть; решение «reject без ключа» остаётся за владельцем (blast radius: легитимные вызывающие без ключа).

## 6. Проверки

- `bun run typecheck` — exit 0
- `bun run test` (полный сюит) — см. §7 записи: exit 0
- `node scripts/scan-evidence.mjs` — exit 0 (synthetic-маркеры only)
- Запретная зона: `git diff --stat` содержит только файлы из §3.

## 7. Full-suite результаты (прогон 2026-10-15 23:34 UTC)

| Проверка | Результат | Exit |
|---|---|---|
| `bun run typecheck` (tsc --noEmit) | чисто | 0 |
| `bun run test` (vitest, полный сюит) | **48 files / 1003 tests passed** (включая 20 новых: checkout-idempotency 14 + use-marketplace.checkout-idem 6) | 0 |
| `bun run lint` (eslint .) | 0 errors | 0 |
| `node scripts/scan-evidence.mjs` | real findings 0, synthetic markers 187 | 0 |
| `node scripts/verify/checkout-idempotency-verify.mjs` | PASS 15 / FAIL 0 | 0 |
| dev.log | ошибок нет; в гонке C живо сработал путь `[checkout] idempotency race resolved via unique index (0060)` | — |
