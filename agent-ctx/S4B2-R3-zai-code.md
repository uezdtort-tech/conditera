# S4B2-R3-CONT (recreate-3) — Платежи: отчёт агента (z-ai-code)

Дата: 2026-11-20 UTC | Проект: /home/z/my-project/conditera-v2 | База: HEAD 1d9698b [S4B1]
Режим: продолжение — предыдущий агент оставил блок незакоммиченным; миссия: аудит → гейты → коммит → бандл → отчёт.

## 1. Итог блока

Блок S4B2 реализован предыдущим агентом ПО СПЕКЕ полно и корректно: аудит
дефектов КОДА не выявил (все 8 пунктов спеки подтверждены чтением каждого
файла + repo-grep + runtime-пруфы). Правились только гейт-скрипты (см. §5).
Всё закоммичено, забандлено, задокументировано.

## 2. Money-flow (mock-пара проводок)

- Единственная точка движения денег пользователя: `src/lib/payments/ledger.ts`
  → `ledgerEntry(tx, {...})` ВНУТРИ транзакции вызывающего. balanceAfter
  считает pure-функция `calcBalanceAfter` (ledger-core.ts): текущий баланс +
  amount; списывающие kind (payment/payout/hold) при минусе бросают
  `LedgerBalanceError` → tx откатывается. Истина баланса — ПОСЛЕДНЯЯ проводка
  журнала (у Profile денежного поля нет).
- Mock-оплата (PAYMENTS_MODE=mock, default) пишет ПАРУ: `topup +total`
  (симулированное пополнение) → `payment −total` — баланс не уходит в минус,
  оба движения аудируются (`writeMockPayPair`, идемпотентна: пропускается,
  если payment-проводка заказа уже есть). Порядок топап→списание критичен.
- Refund: `ledgerEntry` kind=refund +amount на баланс покупателя (в tx
  админ-роута). Payout/hold/release — S4B3, ТОЛЬКО через этот же файл.
- Платформенный аудит FinancialLedgerEntry (рубли, append-only, дедуп по
  idempotencyKey) — ДРУГОЙ контур: payment_succeeded / payment_canceled /
  refund_confirmed пишутся в тех же tx «после факта», деньги не двигает.
- Проверка single-entry-point: repo-grep `balanceLedger.create|update|upsert`
  — единственный кодовый INSERT в ledger.ts; балансовые записи seed
  (scripts/db/seed.ts, демо-данные S1B2) — вне рантайма, помечены как
  известное исключение.

## 3. Webhook-контракт идемпотентности (/api/webhooks/yookassa)

Порядок проверок жёсткий:
1. CSRF-whitelist (префикс /api/webhooks/ в csrf-shared.ts) с компенсирующими
   контролями ниже.
2. Источник ДО чтения тела: `clientIpFromRequest` ∈ YOOKASSA_WEBHOOK_IPS
   (точные IP + CIDR v4; IPv6 — точное совпадение). Пустой список → 403
   forbidden_source ВСЕГДА (fail-closed, webhook отключён).
3. Тело: событие payment.succeeded|payment.canceled; object.status обязан
   соответствовать событию (иначе 400); object.id обязателен.
4. Идемпотентность: Payment по providerPaymentId=object.id уже в целевом
   статусе → 200 {"ok":true,"duplicate":true} при НУЛЕ side-effects.

Четыре независимых слоя дедупа (проверены runtime-пруфом: после двойной
доставки ровно ev=1/led=2/fin=1/pay=1):
- шаг 4 выше (duplicate:true, до tx);
- Payment.idempotencyKey `wh-<objectId>` @unique (строка Payment);
- guard writeMockPayPair по payment-проводке заказа (refType=order/refId);
- FinancialLedgerEntry.idempotencyKey `wh-succeeded-<objectId>` @unique.
Поздняя доставка по заказу не в PENDING → Payment помечается succeeded,
деньги/статусы не трогаются → ignored:order_state (порядок event↔статус
проверен: canceled на CONFIRMED → 200 ignored:state).

## 4. Гейт-числа

- Статика: db:push — синхронно; lint 0; tsc --noEmit 0; vitest 19/19.
- curl-матрица (agent-ctx/s4b2-matrix.sh): PASS=36 FAIL=0.
- YooKassa fail-closed (s4b2-yookassa-failclosed.sh при PAYMENTS_MODE=yookassa
  без ключей, env-переключение + рестарт): PASS=3 FAIL=0 (503
  payment_provider_unavailable; env восстановлен на mock).
- Спот-верификация (свои curl, не матрица): тампер-пруф (pay с {"amount":1} →
  200, в БД amount=order.total=370000, пара 370000/−370000); webhook 403 с
  XFF 8.8.8.8; webhook ×2 из 127.0.0.1 → ok:true, duplicate:true, DB
  ev(PENDING→CONFIRMED)=1, led=2, fin=1, pay=1; refund customer 403 / admin
  200 (Refund completed, ledger refund +370000, OrderEvent CONFIRMED→REFUNDED
  ADMIN, Payment refunded, заказ REFUNDED); /checkout/success аноним 307,
  чужой 404.
- agent-browser: PASS=15 FAIL=0 (вход cookie-injection → /account/orders →
  «Оплатить» по aria-label → /checkout/success: CD-номер + «Подтверждён» +
  «Оплата получена» → бейдж обновлён в списке, кнопка исчезла 10→9; console/
  page errors 0; mobile 390 scrollWidth 390 на orders+success; dark).
  Скриншоты: agent-ctx/s4b2-r3-{success,account-orders,mobile-390,dark}.png.
- Render-check после docs-коммита: / 200, /catalog 200, /account/orders 307
  (анон-гейт), /api/health ok — Tailwind-урок c4c90d5 подтверждён
  (@source not "**/*.md" в globals.css; PAYMENTS.md и новые записи worklog
  prose-only: без env(...) и arbitrary-классов).

## 5. Аудит: дефекты и правки (спека НЕ ослаблялась)

Код — 0 дефектов. Гейт-скрипты — 3 дефекта (правки в agent-ctx/*):
1. s4b2-runner.sh: `pkill -f "next dev"` убивал и системный dev my-project
   :3000 → kill строго владельцев :3100 (ss -ltnp → pid/родитель).
2. s4b2-matrix.sh: фиксированный webhook-id `wh-test-001` — Payment из
   прошлого прогона легитимно отдавал duplicate:true с нулём side-effects
   (идемпотентность работала ПРАВИЛЬНО, а гейт не видел полный путь) →
   уникальный WH_ID на прогон; ledger-пара проверялась на абсолютный баланс 0
   → проверка сумм и непрерывности balanceAfter (у демо-аккаунта история
   проводок прежних прогонов).
3. s4b2-browser.sh: `find text "Оплатить"` кликал абзац-описание
   («…кнопкой «Оплатить»») вместо кнопки → оплата не происходила → eval-клик
   по `button[aria-label="Оплатить заказ"]`; унаследованная вкладка держала
   старые чанки Turbopack → ChunkLoadError на рестарте → `close --all` +
   reload + `console --clear` перед счётом ошибок.

## 6. YooKassa go-live чек-лист (полная версия — docs/PAYMENTS.md §7)

1. Тестовый магазин + тестовые оплата/возврат на стендовом окружении.
2. Секреты ТОЛЬКО в серверном окружении (YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY);
   PAYMENTS_MODE=yookassa + PAYMENT_MODE=YOOKASSA.
3. api.yookassa.ru → SAFE_FETCH_ALLOWLIST (в prod список обязателен —
   без него safeFetch блокирует всё, fail-closed).
4. YOOKASSA_WEBHOOK_IPS = РЕАЛЬНЫЕ CIDR-диапазоны YooKassa (док «URL-адреса
   уведомлений»), dev-значение 127.0.0.1 удалить; проверить 403 на спуф XFF.
5. Зарегистрировать webhook-URL /api/webhooks/yookassa (HTTPS), события
   payment.succeeded + payment.canceled.
6. Первая боевая проверка возврата: оплата → admin-refund → Refund-строка +
   проводка refund + REFUNDED/refunded; повтор webhook → duplicate:true,
   счётчики не растут.
7. Метрики payment_succeeded/refund_processed (при OAuth-токене Метрики).

## 7. Коммиты/артефакты

- Код v2: 561a823 — [S4B2] payments: mock/yookassa provider seam, ledger
  single-entry-point, idempotent webhook, admin refund (recreate-3);
  21 файл, 2299 insertions.
- Docs v2: f875e9a — [S4B2] docs: worklog + PAYMENTS.md (sha/bundle pinned).
- Bundle: /home/z/my-project/backups/conditera-v2-S4B2-561a823.bundle —
  1 052 028 байт, `git bundle verify`: complete history, main=f875e9a;
  git-tracked в my-project коммитом 07ee097 (только файл бандла).

## 8. Девиации от буквы спеки (осознанные, задокументированы)

- Статус оплаты после mock: спека-цель «заказ → paid» реализована картой
  статусов v2 (S4B1): заказ CONFIRMED + paymentStatus=succeeded (enum
  OrderStatus не содержит paid; «Ожидает оплаты» = PENDING). Фиксировано в
  PAYMENTS.md и матрице.
- Ledger-пара mock-оплаты (topup+payment) — решение владельца S4B2 (баланс
  не уходит в минус, двойная запись аудита осознанная); отражено в
  PAYMENTS.md §4 и unit-тестах.
- Webhook amount при create через webhook — из тела провайдера (авторитетный
  источник события); суммы клиентских запросов нигде не читаются (тампер-пруф).
- YOOKASSA_WEBHOOK_IPS=127.0.0.1 — dev-значение по спеке; прод — п.4 чек-листа.

## 9. Остатки/передача

- Техдолг не блокирующий: PAYMENT_MODE продублирован в .env.local (строки 35
  и 90, оба STUB — dotenv first-wins, функция не страдает).
- S4B3 (escrow/выплаты): queries/ledger.ts (stub fail-closed) заменить
  реализацией; payouts.ledgerId NOT NULL — проводки только через
  src/lib/payments/ledger.ts; 2FA completedTfaAt; комиссия №10.
- Инфра: dev :3100 (env -u DATABASE_URL bun run dev), shim :3040, PG :54330;
  n8n «unavailable» в health — норма (сервис в песочнице не поднят).
