# S4B3-R3-CONT (recreate-3) — Эскроу, бонусы, выплаты: отчёт агента (z-ai-code)

Дата: 2026-11-20 UTC | Проект: /home/z/my-project/conditera-v2 | База: HEAD 86ed863 [S4B3]
Режим: продолжение после recycle песочницы — предыдущая сессия восстановила
репозиторий из bundle (PHASE 0) и закоммитила имплементацию 86ed863; dev :3100
healthy. Миссия: аудит → гейты → docs/коммит → bundle → корневые артефакты.

## 1. Итог блока

Имплементация 86ed863 принята аудитом по всем 8 пунктам спеки; найдено и
исправлено 4 дефекта кода (fix 0baca96) и 2 дефекта гейт-скриптов (agent-ctx).
Дифф scripts/verify-ledger.ts (незакоммиченный) — ЛЕГИТНЫЙ гард (lesson
recreate-2 №1: внешняя DATABASE_URL file:… игнорируется, только postgres:// из
env/.env.local) — оставлен, вошёл в docs-коммит d15ed8c. Все гейты зелёные:
lint 0 / tsc 0 / vitest 39/39 / db:push sync / матрица PASS=47 FAIL=0 /
browser PASS=28 FAIL=0 / verify-ledger 3/3 OK ×2. Docs + worklog + bundle +
корневые артефакты — готовы.

## 2. Денежная модель v2 (как работает)

### 2.1. Ledger — единственное ядро (D10)

- Единственная точка записи balance_ledger: src/lib/payments/ledger.ts
  ledgerEntry(tx, {userId, amount(копейки, знаковые), kind, reason, refType,
  refId}) — ВНУТРИ tx вызывающего. Grep-аудит: tx.balanceLedger.create ровно
  один в src; записи сидов — оговорённое исключение (демо-данные).
- Истина баланса — balanceAfter ПОСЛЕДНЕЙ проводки (createdAt DESC, id DESC);
  у Profile денежного поля нет. calcBalanceAfter (ledger-core): balance + sum;
  списывающие kind (payment/payout/hold/bonus−) при минусе → LedgerBalanceError
  → откат tx (race-safe без TOCTOU).
- kinds: topup/payment/bonus/refund/payout/hold/release. Mock-оплата — пара
  topup +total, payment −total (S4B2, сохранена).
- Инвариант: verify-ledger.ts — per-user цепочка (balanceAfter[n] =
  balanceAfter[n−1] + amount[n]) + Σ amount == последний balanceAfter.
  Только чтение; гард DATABASE_URL; значение URL не печатается.

### 2.2. Эскроу

- Группировка: позиции заказа по product.confectionerId → ОДНА строка Escrow
  на пару (orderId, confectionerId) (@unique), groupSum = Σ price×qty группы.
  Кабинет без Profile-привязки → EscrowConfectionerError (fail-closed).
- hold: центральный денежный хук transitionOrder(to=CONFIRMED) — вызывается
  в tx УСПЕШНОЙ ОПЛАТЫ (mock-pay и webhook succeeded оба идут через
  transitionOrder → хук). Проводка кондитера hold −groupSum + Escrow held +
  снапшот tariffa в orders.commissionRateSnapshot (если пуст). Идемпотентно.
- release: хук to=COMPLETED (админ-переход + cron автозавершение): проводка
  release +net (net = groupSum − commission), комиссия — FinancialLedgerEntry
  (adjustment, РУБЛИ строкой, idempotencyKey commission-<orderId>-<confId>),
  Escrow released (platformAmount=commission), orders.escrowReleasedAt.
- refund: хук to=CANCELLED|REFUNDED: проводка refund +groupSum (анти-hold) +
  Escrow refunded. Деньги покупателю — контур S4B2 (refund-роут), разделение
  зафиксировано в докблоках.

### 2.3. Комиссия №10

- Тариф: commission_rates kind=ORDER active → resolveCommissionRate;
  отсутствует → DEFAULT_COMMISSION_RATE_PERCENT = 10 (дробь 0.10). Хранится
  ПРОЦЕНТОМ (seed ORDER=10).
- splitEscrowAmount: commission = round(groupSum × rate / 100), net =
  groupSum − commission (пара сходится в groupSum); rate вне 0..100 →
  EscrowRateError. Снапшот защищает от смены ставки между hold и release.
- Матрица-пруф: заказ 340000 → commission 34000 (escrow.platformAmount),
  net 306000, financial_ledger "340.00" RUB adjustment.

### 2.4. Бонусы (1 балл = 1 ₽ = 100 коп)

- Решение M5: бонусы — проводки журнала kind=bonus (единый баланс), НЕ
  отдельная таблица; BonusTransaction (№9: welcome/birthday/referral/promo/
  manual) для заказных начислений сознательно НЕ используется — enum не
  содержит заказного вида, детали полно в balance_ledger (дубль не создаём).
- Начисление: to=COMPLETED → +round(itemsTotal × bonus_percent / 100) —
  5% от 340000 = 17000. Идемпотентность guard-ом (заказная + проводка без
  служебного описания возврата).
- Списание (checkout): redeemBonusPoints → валидация bonus-core (целое > 0;
  points×100 ≤ floor(itemsTotal × 50% / 100) cap; points×100 ≤ баланс);
  discountTotal = points×100, total пересчитан, Order.bonusPointsRedeemed +
  bonusDiscountRub в ТОЙ ЖЕ tx, проводка −points×100 после создания заказа.
  Ошибка → 400 invalid_bonus_points.
- Возврат: to=CANCELLED|REFUNDED → +bonusPointsRedeemed×100 ОДИН РАЗ (guard
  по служебному описанию «Возврат бонусных баллов по заказу…»).
- Истечение: cron /api/cron/expiring-bonuses — FIFO по пользователю
  (limitation v2: журнал не хранит per-entry срок; зафиксировано в docs §3.6).

### 2.5. Выплаты (решение: Payout, НЕ PayoutRequest)

- Выбрана модель Payout (D9/SD-10): ledgerId NOT NULL (деньги только
  проводкой), completedTfaAt, статус pending→approved→completed /
  pending→rejected. PayoutRequest (миграция 0038) — «заявочная витрина» без
  обязательной проводки → дублировала бы Payout, сознательно не используется
  (таблица остаётся в схеме legacy-миграций).
- Проводки: request → hold −amount (резерв; balance check в tx: ≥ payout_min
  50000 коп из site_settings, ≤ readBalance); approve → без проводок;
  reject → release +amount (payout-reject); complete → ПАРА release +amount +
  payout −amount (девиация от дословной спеки «payout −amount»: без release-
  пары резерв и перевод списали бы баланс дважды; симметрия hold/release в
  аудите сохранена) + CAS UPDATE where status=approved (гонка с reject).
- 2FA complete: 403 tfa_required (нет кода) → TOTP-фактор админа через GoTrue
  mfa.challenge+verify (либа S2B1) → иначе dev-mock код из DEV_TFA_MOCK_CODE
  ТОЛЬКО вне production, сравнение sha256+timingSafeEqual; неверный → 403
  tfa_invalid; в production без фактора — честный запрет. Значение кода не
  логируется; в admin_actions пишется tfaVia (totp|dev-mock). Rate 5/мин/IP
  consume ДО проверок → burst 429 + Retry-After.
- writeAdminAction на всех админ-денежных операциях (approve/reject/complete/
  order.transition).

### 2.6. Переходы и автозавершение

- POST /api/admin/orders/[id]/transition: withPermission(orders.read.all) +
  CSRF + admin-mutation rate + операционный whitelist (строже state-machine):
  PENDING→CANCELLED, CONFIRMED→{PREPARING,CANCELLED}, PREPARING→READY,
  READY→{IN_DELIVERY,DELIVERED}, IN_DELIVERY→DELIVERED, DELIVERED→COMPLETED;
  REFUNDED — только через refund-роут S4B2; админ-CONFIRMED неоплаченного —
  запрещён. transitionOrder (FOR UPDATE + OrderEvent + money hook) +
  writeAdminAction.
- cron /api/cron/auto-complete: X-Cron-Secret (нет секрета → 503 fail-closed;
  не совпал → 403 timingSafeEqual); DELIVERED старше auto_complete_days (7)
  → transitionOrder SYSTEM → хук сам release+bonus. Ответ {checked, completed,
  failed, failures[]}.

## 3. Дефекты аудита и правки

Код (fix 0baca96, 5 файлов, +29/−7):
1. bonus.ts resolveRedeemForCheckout: условие `!validation.ok ||
   !validation.error` — на успехе error undefined → бросок всегда; любое
   списание бонусов отдавало 400 invalid_bonus_points (матрица: order#2
   FAIL на первом прогоне). Фикс: `if (!validation.ok)`.
2. Admin transition route: whitelist без PENDING→CANCELLED — неоплаченный
   заказ со списанными бонусами нельзя закрыть (возврат бонусов недостижим).
   Фикс: PENDING: ["CANCELLED"] (CONFIRMED админом по-прежнему нет).
3. /account/payouts + /account/balance: анон-редирект на /login?next=… —
   страницы /login НЕТ → 404. Фикс: redirect /cart?auth=1 (паттерн
   /account/orders); render-check: /account/balance анон 307.
4. seed.ts: товар→кондитер по `confectioners[(i%2+2)%2]` от findMany() БЕЗ
   orderBy — недетерминированный порядок; в загруженной БД prod-demo-03
   фактически принадлежал demo.confectioner2@conditera.local, что ломало
   матрицу (escrow ожидал confectioner@demo.ru). Фикс: разрешение по slug
   (чётные → uezdny-konditer = confectioner@demo.ru).

Гейт-скрипты (agent-ctx, спека не ослаблялась):
5. s4b3-matrix.sh: financial_ledger запрашивался snake_case колонками
   (entry_type/idempotency_key/order_id) — факт camelCase без @map → 42703.
   Фикс: кавыченные camelCase.
6. s4b3-r3-browser.sh (новый): cookie-инжект ДО первого open попадал в
   about:blank-домен — сессия не поднималась (страница редиректила на
   /login → 404); dark-секция шла под cookie кондитера. Фиксы: open $BASE/ →
   cookies set → target; dark под админ-cookie.

## 4. Гейты (числа)

- lint 0; tsc --noEmit 0; vitest 39/39 (2 файла, pure: ledger-core,
  escrow-core, bonus-core валидаторы); prisma db push — "already in sync".
- Подготовка: БД была загрязнена ручными тестами прошлой сессии (19 проводок
  кондитера, 8 payouts, escrow held, устаревшая привязка товара) → TRUNCATE
  balance_ledger/payouts/financial_ledger/escrow_accounts/payments/
  order_events/order_items/orders/bonus_transactions + seed (балансы:
  кондитер 351000, покупатель 1000000).
- verify-ledger.ts: 3/3 пользователей OK (confectioner 351000; customer
  1000000; demo.customer 610000) — до и после матрицы.
- Матрица s4b3-matrix.sh: PASS=47 FAIL=0 ALL GREEN. Покрытие: health; логины
  ×3; order#1 → mock pay CONFIRMED; escrow held 340000 confectioner@demo.ru +
  hold −340000 + снапшот 10; переходы ×5; released platformAmount 34000 +
  release +306000 + комиссия "340.00" + бонус +17000; verify-ledger; order#2
  redeem 1700 → 201, discount 170000/total 170000, проводка −170000; кап
  1701 → 400 invalid_bonus_points; CANCELLED → возврат +170000 ровно один
  (count=1); RBAC: customer→/api/payouts 403, confectioner→approve 403, anon
  401; payout#1: 201 pending + hold −50000 → approve → 403 tfa_required →
  403 tfa_invalid → dev-код 200 completed + completedTfaAt + payout −50000
  (баланс 317000→267000); payout#2 60000 → reject → +60000 возврат;
  verify-ledger; burst complete ×6 → 429 Retry-After 59; cron без секрета
  403 ×2 / с секретом 200 ×2.
- agent-browser s4b3-r3-browser.sh: PASS=28 FAIL=0. Кондитер: форма
  «Запросить выплату» 500 ₽ → тост + бейдж «Ожидает»; админ: Одобрить →
  «Одобрена» → диалог 2FA («Dev-код задан в env», значение не отображается)
  → «Выплачена» + «2FA: …»; /account/balance: карточка, RU-виды проводок,
  селектор фильтра → kind=payout в URL, список только выплаты; console/page
  errors 0; mobile 390 scrollWidth=390 на /account/payouts, /admin/payouts,
  /account/balance; dark /admin/payouts. Скриншоты agent-ctx:
  s4b3-r3-payouts-confectioner.png, s4b3-r3-payouts-admin.png,
  s4b3-r3-balance.png, s4b3-r3-mobile-390.png, s4b3-r3-dark.png.
- Render-check после docs-коммита: / 200, /catalog 200, /account/balance 307
  (анон), health ok; md исключены из Tailwind-сканирования (@source not —
  урок c4c90d5), ESCROW-PAYOUTS.md/worklog prose-only.

## 5. Коммиты, bundle

- 86ed863 — имплементация (прошлая сессия, PHASE 0 recovery).
- 0baca96 — [S4B3] fix: 4 дефекта кода (bonus gate, PENDING→CANCELLED,
  анон-редиректы, детерминированный seed).
- d15ed8c — [S4B3] docs: worklog (recreate-3-S4B3) + ESCROW-PAYOUTS.md +
  verify-ledger гард.
- Bundle: /home/z/my-project/backups/conditera-v2-S4B3-0baca96.bundle —
  1 122 563 байт, git bundle verify OK, complete history, main=d15ed8c,
  sha1. Git-tracked в my-project отдельным коммитом (только файл бандла).

## 6. Девиации от дословной спеки (задокументированы)

1. complete = ПАРА release+payout вместо одиночного payout −amount — иначе
   баланс уменьшался бы дважды (резерв + перевод). Аудит сохраняет
   hold/release симметрию.
2. BonusTransaction не пишется для заказных начислений — enum без заказного
   вида; вся детализация в balance_ledger (дубль не создаём).
3. Истечение бонусов — FIFO по пользователю (per-entry expiry требует
   расширения схемы — S8B1).
4. Админ transition whitelist дополнительно ЗАПРЕЩАЕТ REFUNDED и
   админ-CONFIRMED неоплаченного (строже state-machine) — деньги/оплата
   только через платёжный контур.
5. Операционное право transition — orders.read.all (SUPPORT им тоже владеет);
   ДЕНЕЖНЫЕ возвраты закрыты payments.manage (решение из докблока 86ed863,
   сохранено).

## 7. Готовность к S5B1 (customer cabinet)

- Демо-состояние после матрицы: заказы CD-2026-0001 (COMPLETED, эскроу
  released, бонус начислен), CD-2026-0002 (CANCELLED, бонусы возвращены),
  payout#1 completed / #2 rejected / #3 completed (burst-гейт). Для
  S5B1-гейтов рекомендуется TRUNCATE+seed (процедура в уроке №12 v2-worklog).
- Гварды /account/* единообразны: getCurrentUser → redirect /cart?auth=1
  (анон), роль → redirect /.
- Точки расширения S5B1: /account (обзор), настройки профиля, витринная
  история заказов (GET /api/orders уже есть, 20/стр), уведомления/рефералки —
  по карте этапов S5; редактирование настроек bonus_* — S5B3.
- Инфра: dev :3100 (env -u DATABASE_URL; фоновый процесс не переживает
  границу tool-вызовов — поднимать в том же вызове), shim :3040, PG :54330;
  секреты в .env.local (DEV_TFA_MOCK_CODE, CRON_SECRET — никогда не печатать).
