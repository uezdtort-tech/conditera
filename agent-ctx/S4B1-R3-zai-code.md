# S4B1 — Корзина и checkout (recreate-3, R3-CONT) — отчёт континуации

Дата: 2026-11-20 UTC. Репозиторий: `/home/z/my-project/conditera-v2`, ветка main.
Статус: **DONE** (аудит готовой реализации → 1 дефект исправлен → все гейты
green → коммиты → bundle → артефакты).

## Коммиты и артефакты

| # | Sha | Содержание |
|---|-----|------------|
| 1 | `9844eb5` | [S4B1] cart+checkout: guest/user cart merge, 3-step checkout, orders API with state machine (recreate-3) — весь код (24 файла: 5 модифицированных, 19 новых; +3635 строк) |
| 2 | `1d9698b` | [S4B1] docs: worklog S4B1-R3 (sha/bundle pinned) — только worklog.md |

- Bundle: `/home/z/my-project/backups/conditera-v2-S4B1-9844eb5.bundle`
  — **1 006 543 bytes**, `git bundle verify` OK (complete history, main → 1d9698b),
  git-tracked в my-project отдельным коммитом `0439bc3` («backup: conditera-v2
  S4B1 bundle»; `git add -f` — backups в .gitignore, прецедент S3B3).
- Скриншоты: agent-ctx/s4b1-r3-cart.png, s4b1-r3-checkout.png,
  s4b1-r3-account-orders.png, s4b1-r3-account-orders-dark.png (dark-режим),
  s4b1-r3-mobile-390.png.

## Scope (что проверено и принято без правок)

1. **Схема**: enum OrderStatus +DRAFT; Order +itemsTotal/discountTotal
   (@default(0)) + снапшот контактов checkout (contactName/contactPhone/
   contactEmail); модель OrderEvent (order_events: orderId FK Cascade, from
   OrderStatus?, to, actorId?, actorRole?, meta Json?, createdAt,
   @@index([orderId, createdAt])). `db:push` подтверждён в embedded PG:
   таблица order_events существует, enum-значение DRAFT присутствует
   (bun-скрипт с DATABASE_URL из .env.local, URL не печатался).
2. **Машина статусов** `src/lib/orders/state-machine.ts` — карта переходов
   (см. ниже), transitionOrder — единственная точка смены статуса:
   SELECT … FOR UPDATE строки заказа + update + OrderEvent (actorId/
   actorRole/meta), опциональный tx-клиент для вызова внутри
   checkout-транзакции; InvalidTransitionError/OrderNotFoundError;
   ORDER_STATUS_LABELS_RU для бейджей.
3. **Доставка** `src/lib/orders/delivery.ts`: pickup=0 / courier=30000 коп.,
   TIME_SLOTS 4 интервала, validateDeliveryDate (строгий YYYY-MM-DD,
   реальность даты, ≥ завтра по UTC-календарю); getDeliveryCost —
   единственное место расчёта, доставка из тела запроса игнорируется.
4. **Номер** `src/lib/orders/number.ts`: CD-YYYY-NNNN (count+1 внутри tx,
   zero-pad 4), ретрай P2002 до 5 попыток (ORDER_NUMBER_ATTEMPTS).
5. **Пересчёт** `src/lib/cart/recalc.ts`: unitPrice любой строки =
   Product.price из БД; issue not_found/unavailable/bad_quantity — строки не
   выбрасываются молча; itemsTotal — только валидные строки; дубли схлопны
   (сумма, cap 99); лимиты 50 строк / qty 1..99.
6. **Клиент**: cart-store (zustand persist, ключ ровно `conditera-cart`,
   partialize lines {productId, quantity} + promoCode — ЦЕНЫ НЕ
   персистятся; SSR-safe storage — паттерн store.ts); cart-client
   (csrfFetch везде, loadCartForSession: merge→GET fallback / guest-validate);
   cart-icon-button (бейдж, mounted через useSyncExternalStore-метку,
   перечит при CART_UPDATED_EVENT/смене сессии); /cart; /checkout; 
   /account/orders; метрика begin_checkout на монтировании checkout и
   add_to_cart при добавлении (env-гейт внутри lib).

## Карта API

Порядок guard мутирующих: **CSRF → rate-limit → auth → RBAC** (центральный
withRole, S2B3); роли корзины/заказов = все, кроме GUEST.

| Эндпоинт | Контракт | Коды |
|----------|----------|------|
| `POST /api/cart/guest-validate` | PUBLIC; CSRF вручную (403 `{"error":"csrf"}` без токена); rate 30/мин/IP (consume на каждой попытке, до CSRF); body {items ≤50 [{productId, quantity 1..99}]} | 200 {items:[… issue not_found/unavailable], itemsTotal = Σ валидных, цены из БД}; 400 (пусто/структура); 403 csrf; 429; 503 |
| `GET /api/cart` | auth; строки профиля + recalc из БД (снапшот CartItem при not_found) | 200 {items, itemsTotal}; 401; 403 GUEST |
| `POST /api/cart` | auth+CSRF; 30/мин/IP; {productId, quantity?} — qty передан → set, нет → +1 (cap 99); cap 50 уникальных товаров | 200 (полная корзина); 400 (bad_request/cart_full); 401; 403 csrf/GUEST; 404 (товар не найден/снят) |
| `PATCH /api/cart/[id]` | auth+CSRF; {quantity 0..99}, 0 = удалить; ownership profile.id, чужой id → 404 (не раскрываем) | 200; 400; 401; 403 csrf; 404 |
| `DELETE /api/cart/[id]` | auth+CSRF; удаление строки | 200; 401; 403 csrf; 404 |
| `POST /api/cart/merge` | auth+CSRF; 5/мин/IP; гостевые строки → сумма quantity (cap 99); невалидные → {skipped:[{productId, reason}]}, не теряются молча | 200 {items, itemsTotal, skipped}; 400; 401; 403 csrf |
| `POST /api/orders` | auth+CSRF; rate ДО валидации: ORDER_IP_RULE 10/мин/IP + ORDER_USER_RULE 5/мин/Profile.id (429 + Retry-After); валидация: items 1..50, qty 1..99, name 2..80, phone 7..20, email (опц., формат), courier→address 5..200, дата ≥ завтра (сервер), slot из TIME_SLOTS, promoCode — существует+активен+в окне; `$transaction`: recalc из БД (isAvailable) → itemsTotal/deliveryCost/discountTotal=0/total, confectionerId (single-or-null), номер, Order(status DRAFT, customerId=profile.id) + OrderItem-снапшоты + transitionOrder DRAFT→PENDING внутри tx (OrderEvent) + deleteMany купленных CartItem; ретрай P2002 ×5 | 201 {orderId, number, status:"PENDING", total, itemsTotal, deliveryCost, discountTotal, promoCode, payment: null}; 400 (bad_request/items_unavailable/invalid_promo); 401; 403 csrf; 429 (+Retry-After); 500 |
| `GET /api/orders` | auth; свои (customerId=profile.id), createdAt desc, ?page= (20/стр), firstItems ≤ 3 (+itemCount) | 200 {orders, page, totalPages, total}; 401; 403 GUEST |

- promoCodeId на заказе НЕ пишется в S4B1 (уникальный слот не сжигается до
  реального применения скидки в S4B2); проверка — gate на существование
  (400 invalid_promo).
- Гостевой/клиентский код НИГДЕ не читает клиентские цены: trackAddToCart
  шлёт price: 0 (эхо-событие), корзина/checkout рендерят только серверные
  значения; тампер-пруф (см. гейты) доказывает tamper-proofliness.

## Машина статусов (карта переходов)

```
DRAFT → [PENDING]                      (технический: живёт внутри checkout-транзакции)
PENDING → [CONFIRMED, CANCELLED]
CONFIRMED → [PREPARING, CANCELLED]
PREPARING → [READY, CANCELLED]
READY → [IN_DELIVERY, DELIVERED, CANCELLED]
IN_DELIVERY → [DELIVERED, CANCELLED]
DELIVERED → [COMPLETED]
COMPLETED → [REFUNDED]
CANCELLED → []      REFUNDED → []      (терминальные)
NEGOTIATING → []   (вне S4B1-маршрута checkout; enum-значение сохранено)
```

Каждый переход пишет OrderEvent (from, to, actorId=Profile.id|null,
actorRole, meta JSON; у checkout-заказов meta {via:"checkout"}).
В БД проверено: у каждого checkout-заказа ровно 1 событие DRAFT→PENDING.

## S4B2-prepared hooks (заделы)

- `payment: null` в 201-ответе POST /api/orders — точка возврата платёжного
  объекта (YooKassa/STUB по решению №1); Order.paymentMode=STUB,
  paymentStatus=pending уже пишутся.
- transitionOrder PENDING→CONFIRMED — маршрут зарезервирован в карте
  переходов (вход для payment-webhook: paymentStatus=succeeded + переход).
- Промокод: promoCode сохраняется в persist-store корзины, POST /api/orders
  валидирует существование и возвращает promoCode эхом; применение скидки —
  точка в $transaction после recalc (discountTotal += скидка, promoCodeId =
  id справочника; уникальный слот не сожжён).
- n8n server-цели payment_succeeded/refund_processed — в S4B2 (сейчас
  подписан только user_registered).

## Гейты (числа)

- `bun run lint` → **0**; `bunx tsc --noEmit` → **0**.
- curl-матрица `agent-ctx/s4b1-matrix.sh` (после чистого рестарта dev,
  in-memory limiter reset): **PASS=34 / FAIL=0 / SKIP=1** (SKIP — GUEST-
  аккаунт не посеян; role-фильтр покрыт гвард-кодом и 401-гейтами; матрица
  документирует это явно). 429-burst — последний шаг матрицы: 5-я попытка
  201, 6-я → **429 + retry-after: 60**.
- Независимая спот-верификация (свежая кука, реальный товар из БД):
  - guest-validate unitPrice **340000 == DB price** (Торт «Морко́вный с
    орехами», prod-demo-03);
  - login customer@demo.ru → 200;
  - ТАМПЕР-ПРУФ: POST /api/orders с клиентскими полями `"price":999999999,
    "unitPrice":999999999, "total":999999999, "deliveryCost":999999999,
    "discountTotal":-999999999` → **201**, сервер пересчитал
    **itemsTotal 680000 / deliveryCost 30000 / discountTotal 0 /
    total 710000** (клиентские поля полностью проигнорированы);
  - второй заказ: номер инкремент **CD-2026-0013 → CD-2026-0014**;
  - БД: у обоих заказов ровно 1 OrderEvent **DRAFT→PENDING** (actorRole
    CUSTOMER, meta {via:"checkout"}); снапшот заказа (контакты, адрес,
    status PENDING, paymentMode STUB) корректен;
  - GET /api/orders содержит оба; **anon GET /api/orders → 401**
    («Требуется аутентификация»);
  - **anon /checkout → 307 → /cart?auth=1**; **anon /account/orders → 307
    → /cart?auth=1**; authed → 200/200;
  - burst: 6 заказов подряд в минуту → 1–5 = 201, **6-й → 429 +
    retry-after: 60**.
- agent-browser (реальный UI-флоу, http://127.0.0.1:3100, desktop 1440×900
  light + dark, mobile 390×844): каталог → карточка товара → «Добавить в
  корзину» (тост + бейдж «Корзина, товаров: 1») → /cart (серверная цена
  «3 400 ₽ за шт.», степпер +1 → «6 800 ₽») → «Оформить заказ» (гость →
  редирект /cart?auth=1 + авто-модалка входа — проверка и клиентского
  редиректа) → вход customer@demo.ru/Demo123! → merge гостевой корзины
  («Ваш заказ сохраняется в аккаунте») → /checkout шаг 1 предзаполнен
  (имя «Демо-покупатель», email customer@demo.ru из профиля) → шаг 2
  курьер + «Москва, Тверская 1» + дата 2026-11-21 (= завтра, min по
  умолчанию) + слот 13:00–16:00 → шаг 3: Товары 6 800 + Доставка 300 =
  **Итого 7 100 ₽** → чекбокс согласия (оферта/ПДн — ссылки /legal/offer,
  /legal/privacy) → «Подтвердить заказ» → тост успеха →
  **/account/orders?created=CD-2026-0020** (баннер «Заказ … создан», бейдж
  «Ожидает оплаты», разбивка «Товары 6 800 ₽ · доставка 300 ₽», 7 100 ₽).
  Mobile 390×844: /cart, /checkout, /account/orders — scrollWidth == 390
  (горизонтального overflow нет). **Ошибки консоли/страницы: 0** (только
  React DevTools info + HMR-логи). Логин в модалке — реальный UI-флоу
  (fallback-инъекция кук не понадобилась).

## Дефекты аудита и фиксы

| # | Дефект | Фикс | Верификация |
|---|--------|------|-------------|
| 1 | /checkout для анонима рендерил клиентскую карточку-гейт (HTTP 200, компонент checkout-auth-gate) — противоречие контракту («server auth gate … redirect anon to /cart», паттерн /account/orders) и ожиданию «anon /checkout → redirect 30x» | серверный `redirect("/cart?auth=1")` в page.tsx; неиспользуемый CheckoutAuthGate удалён | curl: 307 → /cart?auth=1 (anon), 200 (authed); браузер: редирект + авто-модалка входа |

Остальное по спеке — без правок (перечень см. Scope).

## Отклонения / примечания

- Матрица-скрипт не правился: ожидания совпали со спекой (проверено
  построчно перед прогоном).
- SKIP в матрице (GUEST-роль) — по решению матрицы, не дефект: гвард
  CART_ROLES/ORDER_ROLES = ALL_ROLES minus GUEST покрывает фильтр, 401-гейты
  анонима проверены и матрицей, и спот-прогоном.
- Перезапуски dev-сервера между прогонами — обязательны: процессы, стартованные
  из вызова шелла, умирают между вызовами (проверено контрольным `sleep` с
  setsid); это же сбрасывает in-memory rate-limiter перед матрицей/бёрстом.
- История заказов в БД до блока (CD-2026-0001…0009 от seed/предыдущих блоков)
  — не тронута; номера продолжились инкрементом.

## Остаток для S4B2 (не гэпы S4B1)

- Платёжный контур: YooKassa/STUB-эмуляция, webhook → paymentStatus=
  succeeded + transitionOrder PENDING→CONFIRMED; заполнить `payment` в 201.
- Применение промокода (скидка → discountTotal, promoCodeId, списание
  @unique-слота) — точка описана выше.
- GUEST-роль: посев аккаунта + явный 403-гейт в матрице (сейчас SKIP).
- n8n server-цели payment_succeeded/refund_processed.
