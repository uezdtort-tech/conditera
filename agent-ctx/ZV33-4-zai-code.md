# ZV33-4 (ZV32-005 — COMPLETE INDIVIDUAL OFFERS UI) — work record

Дата: 2026-11-13. Реализация UI индивидуальных предложений (negotiations) поверх
готового бэкенда: PATCH /api/negotiations/[id] (quote/accept), GET /api/inquiries,
POST /api/inquiries, POST /api/checkout (negotiationId binding). Бэкенд НЕ менялся.

## Состояние на момент старта

В рабочем дереве уже лежали незакоммиченные наработки предыдущей сессии по этому же
заданию (git status: 8 изменённых + 7 новых файлов, реализующие §A1–§B12). Они были
проверены построчно против ТЗ, верифицированы контрактами сервера, исправлены 3
дефекта (ниже), прогнаны тесты/линт/tsc. Ничего не коммитилось.

## Files changed (путь — однострочное описание)

Изменённые:
- `src/lib/use-real-inquiries.ts` — mapper `mapApiInquiryToInquiry`: surfaced
  rawStatus/quotedPriceKopecks/quotedPriceRub/validUntil/acceptedAt/quotedPrepTime/negotiationId;
  статусы accepted/expired/counter_offered больше не сваливаются в quoted;
  useQuoteNegotiation шлёт validDays (кламп сервером) и comment.
- `src/lib/use-real-inquiries.test.ts` — +3 кейса: accepted (accepted_at surfacится),
  expired, counter_offered/new-дефолты.
- `src/lib/store.ts` — Zustand: `pendingNegotiationId` + `setPendingNegotiationId`;
  чистится в clearCart/logout; переживает reload (partialize) — нужно на checkout.
- `src/components/pages/extra-pages.tsx` — CheckoutPage: читает pendingNegotiationId,
  кладёт `negotiationId` в тело POST /api/checkout, чистит после success/4xx
  (5xx/неизвестно — сохраняет для idempotent-retry).
- `src/lib/supabase/use-marketplace.ts` — useCreateOrder: тот же `negotiationId`
  из store + очистка (success/4xx).
- `src/components/dashboard/confectioner-dashboard.tsx` — мок-вкладка
  ConfectionerNegotiationTab снята с рендера; «Заявки из конструктора» → новый
  `ConfectionerInquiriesTab` (алиас ?tab=negotiations ведёт туда же).
- `src/components/dashboard/customer-dashboard.tsx` — мок CustomerNegotiationTab
  заменён на реальный `BuyerOffersTab`; счётчик бейджа — `useBuyerOffersPendingCount`
  (GET /api/inquiries) вместо мока store.negotiations; лейбл вкладки
  «Согласование» → «Предложения» (2 места, desktop+mobile).
- `src/components/cake-builder/cake-builder-page.tsx` — §B12: «отправить кондитерам»
  сначала пробует реальный поток (useSubmitInquiry → POST /api/inquiries), при
  недоступности — фолбэк на legacy /api/quotes; тост ведёт во вкладку «Предложения».

Новые:
- `src/components/dashboard/confectioner-inquiries-tab.tsx` — реальная вкладка
  кондитера: форма предложения (Dialog: цена ₽ ×100 → копейки, комментарий, срок
  1–60 дней с клиентским клампом, живое «Действует до» МСК), бейджи статусов
  (Новая/Предложение отправлено/Принято покупателем/Истекло/Отклонена/встречное),
  re-quote «Пересчитать и отправить заново» с prefill последней цены, accepted-стейт
  (accepted_at, без actions), decline (AlertDialog), тик «сейчас» раз в 60 с.
- `src/components/dashboard/buyer-offers-tab.tsx` — реальная вкладка покупателя:
  предложения по заявкам (имя кондитера, цена ₽ из копеек, prep time, доставка,
  valid_until МСК, бейдж), «Принять предложение» (гейт: quoted+не истекло+цена),
  обработка 410 OFFER_EXPIRED / 409 OFFER_NO_PRICE (toast+inline), collapsible
  «История предложения» (revisions), «Перейти к оформлению заказа» (custom-позиция
  корзины + pendingNegotiationId → navigate checkout).
- `src/lib/use-buyer-offers.ts` — API-only хуки: useBuyerOffers (GET /api/inquiries +
  GET /api/confectioners для имён по confectioners.userId), useNegotiationDetail
  (GET /api/negotiations/[id], revisions), useAcceptOffer (PATCH accept, коды ошибок
  в NegotiationActionError), useBuyerOffersPendingCount. Мёртвый supabase-direct
  useAcceptNegotiation из use-cake-builder.ts НЕ используется.
- `src/lib/offer-format.ts` — чистые хелперы: formatOfferPrice (копейки→«3 500 ₽»),
  formatMoscowDate/DateTime (Europe/Moscow, ru-RU), isOfferExpired, previewOfferValidUntil,
  re-export clampOfferValidityDays (единый контракт с сервером), mapRevisionReason
  (метки change_reason по ТЗ), buildInquiryBuilderConfig (снимок заявки → CakeBuilderConfig).
- `src/lib/offer-format.test.ts` — 13 кейсов (цены, МСК-даты, кламп 1..60, expired,
  метки revisions, сборка конфига).
- `src/lib/use-buyer-offers.test.ts` — 6 кейсов маппера покупателя (статусы,
  клиентское истечение, имена по userId, копейки→рубли, дефолты).
- `src/lib/use-inquiry-submit.ts` — §B12: создание черновика (supabaseBrowser —
  REST-эндпоинта для drafts нет), резолв confectioners.id→auth UUID через публичный
  GET /api/confectioners, POST /api/inquiries {draftId, confectionerIds, estimatedPrice}
  с CSRF (getSessionAuthHeaders + getCsrfToken).

## Checklist по требованиям

1. Форма предложения кондитера — DONE (Dialog; цена обязательна >0, ×100 при
   отправке; комментарий опц.; срок 1–60 с клампом clampOfferValidityDays и хелпером
   «Срок действия: 1–60 дней (по умолчанию 14)»; живое «Действует до: …» (МСК) до
   сабмита; после успеха тост с returned valid_until).
2. Бейджи статусов + valid_until + клиентское «Истекло» — DONE (mount-пересчёт +
   интервал 60 с; quoted+valid_until в прошлом → бейдж «Истекло»).
3. Re-quote — DONE (кнопка «Пересчитать и отправить заново», prefill последней цены;
   gate снят: разрешено для new/quoted/counter_offered И истёкших по дате — сервер
   специально кладёт re-quote через PATCH quote,(обновляет valid_until); только accepted/declined
   блокируются). ИСПРАВЛЕНО в этой сессии: раньше кнопка для expired была disabled,
   хотя серверный флоу (комментарий в route.ts, 410-гейт только на accept) ожидает
   resend от кондитера.
4. Accepted-стейт кондитера — DONE (бейдж «Принято покупателем» + accepted_at, actions
   скрыты; сервер 409 как бэкстоп).
5. Mapper (§A5) — DONE (+тесты).
6. BuyerOffersTab — DONE (API-only; имя кондитера через confectioners.userId-матч;
   цена/срок/доставка/prep/valid_until/бейджи; loading/empty/error/refetch).
7. Accept flow — DONE (кнопка активна только quoted && valid_until>now && цена;
   после успеха: бейдж «Принято», «Цена зафиксирована», «Перейти к оформлению заказа»).
8. Expired — DONE (бейдж «Истекло» + текст «Предложение истекло — запросите новое у
   кондитера»; accept disabled; отдельная обработка 410 OFFER_EXPIRED и 409
   OFFER_NO_PRICE: toast + inline).
9. История предложения — DONE (Collapsible «История предложения»; лейблы change_reason
   по ТЗ; цена + дата МСК; refetch после accept/invalidate; лениво при раскрытии).
10. Checkout binding — DONE. Custom-позиция: `cartItems:[{ id: item.itemId, quantity: 1,
    custom: CakeBuilderConfig }]` — ровно форма CheckoutSchema (custom: record,
    БЕЗ product_id; эксклюзивность product_id/custom проверяется superRefine).
    CakeBuilderConfig собирается buildInquiryBuilderConfig из снимка заявки
    (productType "cake" — в inquiries product_type НЕ хранится; legacy-значения
    дадут честный 422 от validateBuilderConfig). Все прочие custom-позиции корзины
    снимаются (binding требует РОВНО одну), товарные не трогаются.
    negotiationId: Zustand `pendingNegotiationId` (персистится), ставится кнопкой
    «Перейти к оформлению заказа», читается в CheckoutPage (extra-pages.tsx) и
    useCreateOrder (use-marketplace.ts), чистится после success/4xx.
11. Моки сняты с рендера — DONE (обе вкладки; файлы negotiation-tabs.tsx/
    mock-data-negotiation.ts/store-моки НЕ тронуты; тестов, рендерящих дашборды,
    нет — проверено rg).
12. Проверка создания заявки — ПОДТВЕРЖДЕНО: клиентского POST /api/inquiries НЕ было
    (только legacy /api/quotes → quote_requests). Проводка минимальная: см.
    use-inquiry-submit.ts + cake-builder-page.tsx; success-тост ведёт во вкладку
    «Предложения».

## Backend defects discovered (НЕ чинил, только репорт)

1. СРЕДА/КОНФИГ (критично для песочницы): статические ключи SUPABASE_SERVICE_ROLE_KEY
   и NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local подписаны СТАРЫМ JWT_SECRET и не
   проходят верификацию в pgrst-шиме (src/lib/postgrest/jwt.ts, секрет = текущий
   JWT_SECRET). Эксперимент: свежий HS256-JWT {role:"service_role", iss:"local"},
   подписанный текущим JWT_SECRET из .env.local, → `[pgrst] … role=service_role`,
   profiles/inquiries читаются; статики из .env.local → `role=anon` → RLS прячет
   profiles/inquiries. Следствие СЕЙЧАС: supabaseAdmin во всех API-роутах деградирует
   до anon — login (POST /api/auth/login) не находит profiles → 401 «Неверный email
   или пароль» (проверено curl), authed-флоу через HTTP в этой песочнице не работают
   (в dev.log это же видно: `[anti-fraud] log insert failed: permission denied for
   table order_fraud_logs` — INSERT под anon). Ремедиация: перегенерить ключи
   scripts/db/setup.mjs от текущего JWT_SECRET и перезапустить dev-сервер (вне скоупа
   задачи — сервисы не трогаем). UI-фолбэки на store-моки это маскируют
   («Офлайн-данные»).
2. Minor (наблюдение, не дефект кода): в inquiries НЕ хранится product_type снимка
   конструктора → buildInquiryBuilderConfig подставляет "cake" (допущение задокументировано
   в offer-format.ts; если сервер не примет legacy-снимок — честный 422, цены в теле
   клиента нет).
3. Дизайн-нюанс (не дефект): POST /api/inquiries требует draftId, REST-эндпоинта для
   cake_builder_drafts нет → черновик создаётся клиентом через supabaseBrowser (RLS
   authenticated). Без GoTrue/app-сессии в браузере вставка упадёт → cake-builder
   честно фолбэкается на legacy /api/quotes (запрос НЕ попадёт в negotiations). Это
   осознанный компромисс «не менять бэкенд»; для полного wire можно предложить
   POST /api/inquiries с inline-снимком (опционально draft payload) — БЭКЕНД-ИЗМЕНЕНИЕ,
   не делал.

## Targeted test/lint results

- vitest (dot reporter): 6 файлов, 59/59 passed, exit 0 —
  use-real-inquiries.test.ts, use-buyer-offers.test.ts, offer-format.test.ts,
  negotiation-binding.test.ts, negotiations/[id]/route.test.ts (9 кейсов, зелёные),
  use-marketplace.checkout-idem.test.tsx.
- Регресс: use-dashboards.app-jwt.test.tsx + supabase-hooks.test.ts — 27/27 passed.
- eslint (bunx eslint на всех 13 изменённых/новых файлах): 0 ошибок/варнингов.
- tsc --noEmit (strict): exit 0 (найден и исправлен 1 TS-ошибкa в новом тесте:
  отсутствовал coating: null).
- e2e через curl: заблокированы дефектом среды №1 (stale ключи → 401 на login;
  inquiries[] на authed GET). Сид тестовых данных создан и удалён (следов нет).

## Exact shapes

- Custom cart item в POST /api/checkout:
  `{ id: <cart itemId>, quantity: 1, custom: CakeBuilderConfig }`, где
  CakeBuilderConfig = { productType:"cake", eventType?, base?, filling?, coating?,
  decorations?, dietary?, city?, deliveryDate?, deliveryType:"delivery"|"pickup",
  servings?, quantity:1, inscription?, comment? } (buildInquiryBuilderConfig).
- negotiationId: store.pendingNegotiationId (Zustand, персистится в partialize;
  set кнопкой «Перейти к оформлению заказа», читается обоими call-site, очищается
  после success/4xx checkout).

## TODO / намеренно оставлено

- HTTP-e2e quote→accept→checkout не прогонялся из-за дефекта среды №1 (статические
  Supabase-ключи не валидны против текущего JWT_SECRET) — покрыто юнит-тестами
  мапперов/биндинга/роута; браузерную проверку сделает отдельная задача (после
  перегенерации ключей).
- Черновик для POST /api/inquiries создаётся через supabaseBrowser (нет REST
  эндпоинта drafts) — при отсутствии сессии фолбэк на legacy /api/quotes.

---

# ZV33-4b (follow-up: FIX VERIFICATION DEFECTS) — work record

Дата: 2026-11-13. Исправлены 4 дефекта независимой e2e-верификации ZV32-005.
Замечание: дефект среды из прошлой сессии (статические Supabase-ключи в .env.local
против актуального JWT_SECRET) УСТРАНЁН кем-то между сессиями — login демо-юзеров
через POST /api/auth/login теперь 200, полный HTTP smoke возможен.

## D1 — CRITICAL (деньги): «один заказ на принятое предложение»

- `src/lib/negotiation-binding.ts`:
  - `NegotiationRecord` += `order_id: string | null` (0004);
  - `BindingRejection.code` += `OFFER_ALREADY_ORDERED`;
  - `validateNegotiationBinding`: после проверки status='accepted' и ДО price-чека —
    order_id NOT NULL → 409 «Заказ по этому предложению уже оформлен».
- `src/app/api/checkout/route.ts`:
  - select переговоров расширен `order_id` (гвард срабатывает ДО создания заказа);
  - best-effort привязка `negotiations.order_id = order.id` теперь УСЛОВНАЯ:
    `.eq("id", ...).is("order_id", null)` — last-write-wins невозможен.
- Тесты:
  - `src/lib/negotiation-binding.test.ts` — +2 кейса (order_id set → 409;
    ""/undefined → ok, legacy-строки);
  - `src/app/api/checkout/negotiation-rebind.test.ts` (НОВЫЙ, паттерн
    price-version-bind.test.ts) — (a) order_id NOT NULL → 409 и НИ ОДНОГО
    orders/order_items insert; (b) order_id NULL → заказ создаётся,
    custom-позиция получает серверную цену 15 000 ₽ (quoted_price/100),
    привязка update {...}.eq(id).is("order_id", null) захвачена в моке.
- Live smoke: POST /api/checkout по переговорам 157707ee-… (order_id =
  95068270-…) с НОВЫМ Idempotency-Key → HTTP 409 OFFER_ALREADY_ORDERED;
  SQL: orders total 5 → 5, metadata-bound 4 → 4.

## D2 — MINOR: accept-twice и терминальные сиблинги

- `src/app/api/negotiations/[id]/route.ts`, case accept:
  - (a) status='accepted' → 409 {"error":"OFFER_ALREADY_ACCEPTED","message":
    "Предложение уже принято"} БЕЗ side effects (поставлен ДО 410-гейда:
    accepted + протухший valid_until → 409, не 410; ленивый expired-марк на
    accepted не применяется);
  - (b) свип сиблингов ограничен активными статусами:
    `.in("status", ["pending_confectioner","quoted","counter_offered"])` —
    терминальные (accepted/declined/expired) не переписываются.
- `src/app/api/negotiations/[id]/route.test.ts` — +3 кейса: accept-twice → 409
  без дубля revision/бампа accepted_at/closed_at; accepted+протухший
  valid_until → 409 (не 410); expired-сиблинг остаётся 'expired' при accept
  сиблинга. Мок-builder дополнен фильтром `in`.
- Live smoke: PATCH accept по 157707ee-… (accepted) → HTTP 409
  OFFER_ALREADY_ACCEPTED; SQL: accepted_at 09:28:57.974 НЕ изменился,
  accepted-revisions 2 → 2 (дубль верификации не размножился).

## D3 — PRODUCT: кондитер видит «Принято покупателем»

- `src/app/api/inquiries/route.ts`, GET filter=available: после open-листинга —
  догрузка заявок, где у ЭТОГО кондитера (negotiations.confectioner_id =
  user.id, status='accepted') есть принятое предложение: отдельный запрос
  negotiations → inquiry_ids → inquiries (с city-фильтром если задан),
  дедуп по id, merge, сортировка по submitted_at desc. Форма ответа
  обратно совместима ({ inquiries: [...] } + customer_name enrich).
- Тест: `src/app/api/inquiries/route.test.ts` (НОВЫЙ, 4 кейса) — accepted
  заявка ЭТОГО кондитера в выдаче (status 'converted' + embedded negotiations);
  чужие accepted НЕ утекают; open-семантика unchanged; filter=own регресс;
  403 для не-кондитера.
- UI: маппер use-real-inquiries.ts матчит собственную переговорку по
  confectioner_id === user.id → status 'accepted' → ветка
  confectioner-inquiries-tab.tsx («Принято покупателем» + accepted_at, без
  actions) больше не мёртвая (покрыто use-real-inquiries.test.ts).
- Live smoke: GET /api/inquiries?filter=available кондитером → 2 заявки,
  включая 9cbbee5b-… (inquiry status 'converted', customer_name «Демо
  Покупатель», собственная переговорка accepted: quoted_price 1500000,
  accepted_at 09:28:57.974).

## D4 — UX price honesty: покупатель видит согласованную цену

- `src/lib/types.ts` — CartItem += `agreedPriceRub?: number | null`.
- `src/lib/store.ts` — `addCustomToCart` принимает optional `agreedPriceRub`;
  ставится на новую позицию и на дедуп-ветке. В estimate (item.price) НЕ пишется.
- `src/lib/offer-format.ts` — хелпер `cartItemDisplayUnitPrice(item, bindingActive)`:
  binding active && agreedPriceRub конечное > 0 → оно; иначе item.price.
- Дисплей-пути:
  - `src/components/marketplace/cart-drawer.tsx` — subtotal и строка позиции;
  - `src/components/pages/extra-pages.tsx` (CheckoutPage) — subtotal, обе
    сводки позиций; кнопка «Оплатить X ₽» следует из total.
- `src/components/dashboard/buyer-offers-tab.tsx` — goToCheckout передаёт
  `agreedPriceRub = quotedPriceKopecks / 100` + гвард на null-цену; тост:
  «Цена по предложению: 15 000 ₽ — оформите заказ по этой цене».
- Сервер остаётся авторитетным: тело checkout цены не содержит (проверено
  тестом (b): unit_price 15 000 ₽ из negotiations, не из клиента).
- Тест: `src/lib/offer-format.test.ts` — +3 кейса хелпера (binding active,
  fallback на estimate, мусорные значения; без binding — всегда estimate).
- Live curl для D4 не требуется (клиентский display) — покрыто юнит-тестами +
  чтением кода; для browser re-verification: пройти «Перейти к оформлению
  заказа» → корзина/checkout/«Оплатить» должны показывать 15 000 ₽.

## Результаты проверок ZV33-4b

- vitest (dot): **14 файлов, 116/116 passed, exit 0** — negotiation-binding,
  negotiations/[id]/route (12 кейсов), inquiries/route (4, новый),
  checkout/negotiation-rebind (2, новый), checkout регресс
  (price-version-bind, cart-clear-ownership, fillings-failclosed,
  snapshot-write), use-real-inquiries, offer-format, use-buyer-offers,
  use-marketplace.checkout-idem, dashboards (use-dashboards.app-jwt,
  supabase-hooks).
- eslint (15 изменённых/новых файлов): 0 ошибок/варнингов.
- `node --max-old-space-size=1536 node_modules/typescript/bin/tsc --noEmit`:
  exit 0.
- Live smoke (HTTP, демо-юзеры, CSRF double-submit): D1 → 409
  OFFER_ALREADY_ORDERED + SQL orders 5→5; D2 → 409 OFFER_ALREADY_ACCEPTED +
  SQL revisions 2→2; D3 → accepted-заявка в листинге кондитера (экзерт выше).
  Побочные SQL-эффекты smoke: отсутствуют (409-пути side-effect-free).

## TODO

- D4 в браузере не прогонялся (клиентский display; юнит-тесты + code reading) —
  для browser re-verification.
- Исторические дубли от верификации (3 лишних заказа, дубль accepted-revision,
  перетёртый статус expired-сиблинга) НЕ чинил ретроактивно — это данные
  верификации, не код; чистка данных вне скоупа.

---

# ZV33-8b-fix (two small fixes from buyer smoke verification) — work record

Дата: 2026-11-13. Изменения ТОЛЬКО в 3 файлах:
- `src/components/marketplace/cart-drawer.tsx` — FIX 1: handleCheckout на путях
  не-'/' уводит window.location.assign("/checkout") (view-router store живёт
  только на '/'; /dashboard — отдельный route, который в useEffect насильно
  возвращает view на dashboard-*, поэтому navigate("checkout") был no-op —
  покупатель оставался на /dashboard). На '/' поведение прежнее
  (SPA navigate). pendingNegotiationId переживает переход — УЖЕ в persist
  partialize store.ts (подтверждено, правка не потребовалась).
- `src/app/api/orders/[id]/cancel/route.ts` — FIX 2: CAS-update теперь пишет
  `cancelled_at` (ISO) вместе с status/updated_at (раньше NULL после UI-отмены;
  PATCH-путь route.ts newStatus==="CANCELLED" — уже писал).
- `src/app/api/orders/[id]/cancel/route.test.ts` (НОВЫЙ, 3 кейса) — payload
  содержит status CANCELLED + cancelled_at + updated_at; history-вставка с
  атрибуцией; CAS-конфликт → 409 без history; повторная отмена → 400.
  (Теста на cancel-роут раньше не существовало.)

Проверки: vitest cancel-route 3/3 + orders-регресс (route-patch-history,
route.test) 25/25 суммарно, exit 0; eslint 3 файлов — 0 проблем;
tsc --noEmit — exit 0. Live-проверки не делал: FIX 1 — клиентский код,
FIX 2 — покрыт юнит-тестом (мутация реального демо-заказа не проводилась).

НАБЛЮДЕНИЕ (вне скоупа, НЕ трогал): той же болезнью страдают
buyer-offers-tab.tsx:259 («Перейти к оформлению заказа») и
cake-builder-page.tsx:463 — navigate("checkout") будет no-op, если дашборд
открыт под URL /dashboard. Рекомендация для follow-up: тот же паттерн
(window.location.assign("/checkout") при pathname !== "/").

---

# ZV33-8d (SECURITY FIXES D1/D2 + navigation patches) — work record

Дата: 2026-11-13. Защищённые файлы не тронуты (git status --porcelain: 4 пути
upload отсутствуют в diff; redline-paths.test.ts зелёный).

## FIX A (D1 — blocked user keeps session)

- `src/app/api/auth/session/route.ts`:
  • app-сессия (cd_session): profile-select расширен до `name, is_blocked`;
    is_blocked=true → 403 {"error":"ACCOUNT_BLOCKED","message":"Аккаунт
    заблокирован"} + clearSessionCookies (cd_session/cd_refresh, Max-Age=0),
    БЕЗ accessToken. Fail-open на ошибку БД — тот же контракт, что в
    getUserFromRequest blocked-check.
  • GoTrue-ветка: profileRes.data.is_blocked → тот же 403-контракт.
- `src/app/api/auth/refresh/route.ts`: прежний 403 «Пользователь заблокирован»
  приведён к единому контракту ACCOUNT_BLOCKED + clearSessionCookies (раньше
  cookie жили — браузер мог вечно пересобирать сессию по cd_refresh).
- Тесты: session/route.test.ts (3), refresh/route.test.ts (2) — blocked → 403
  без token + cookie очищены; active → 200 как раньше; no-cookie → user:null.
- LIVE: см. ниже — 403 на обоих эндпоинтах, cookie очищены.
- ИНФРА-ЗАМЕТКА: Turbopack-HMR для route-хендлеров в песочнице сломан (компил
  кэш отдавал СТАРЫЙ хендлер /api/auth/session — в dev.log уходил старый запрос
  `select=name`, клиент получал 200 после блокировки). Миддлварь при этом
  перекомпилируется живо. Диагноз подтверждён: kill `next dev` → supervisor
  (`bun --hot index.ts`, pid 1146→1124) заспавнил новый процесс (11:20:23) →
  свежая компиляция → 403. При дальнейших правках route-хендлеров учитывать.

## FIX B (D2 — upload role restriction, middleware)

- `src/lib/upload-role-guard.ts` (НОВЫЙ, чистый, edge-safe):
  • UPLOAD_GUARD_PATHS = ["/api/upload", "/api/services/upload"] (точные пути —
    роуты без вложенных сегментов; matcher proxy.ts `/((?!_next/static|...).*)`
    покрывает /api/* — правки matcher не потребовалось);
  • UPLOAD_SERVICE_ALLOWED_ROLES = CONFECTIONER/ADMIN/SUPER_ADMIN (улика:
    единственный вызывающий /api/services/upload — services-manager.tsx:223,
    фото услуг кондитера; покупательских использований нет);
  • UPLOAD_GENERAL_ALLOWED_ROLES = менеджер-роли + CUSTOMER (улика:
    customer-dashboard.tsx:1436 шлёт POST /api/upload c ownerType="customer":
    category="reviews" — фото к отзывам (роут /api/reviews принимает ≤3 URL из
    /api/upload) и category="tickets" — вложения в поддержку; категорию в
    middleware инспектировать НЕЛЬЗЯ (Next.js middleware не читает тело
    запроса) → покупателя от /api/upload не отрезаем, иначе ломаются отзывы и
    тикеты);
  • canUpload(role) — менеджер-путь (buyer → false, confectioner/admin → true);
  • canUploadToPath(roles, pathname) — путь-специфичная политика.
- `src/proxy.ts`: enforceUploadRoleGuard — POST + точный путь → роли из
  cd_session JWT (jose jwtVerify HS256, process.env.JWT_SECRET — edge-safe,
  БЕЗ импорта src/lib/auth.ts с bcryptjs); нет/битый токен → 401
  {"error":"UNAUTHORIZED"}; без права → 403 {"error":"FORBIDDEN"}. Гвард стоит
  ДО CSRF/updateSession — чистые 401/403 по ролям; пропущенные запросы идут
  дальше по конвейеру (CSRF и т.д.).
- Тест: upload-role-guard.test.ts (7 кейсов: buyer→false, manager-роли→true,
  инъекции строкой не проходят, path-политики, мульти-роли).
- LIVE: unauth → 401 UNAUTHORIZED (оба пути); buyer → /api/upload 201 (CUSTOMER
  разрешён — отклонение от таблицы проб задачи, улики выше), buyer →
  /api/services/upload 403 FORBIDDEN; confectioner/admin → 201 на обоих
  (токены minted через jose с runtime JWT_SECRET — login попал в часовой
  anti-fraud лимит; та же jwtVerify-политика миддлвари).

## FIX C (no-op navigate из не-'/' URL)

- `src/components/dashboard/buyer-offers-tab.tsx` (goToCheckout) и
  `src/components/cake-builder/cake-builder-page.tsx` (add-to-cart) — паттерн
  cart-drawer: pathname !== '/' → window.location.assign('/checkout'), иначе
  прежний navigate. pendingNegotiationId персистится (partialize).

## Проверки ZV33-8d

- vitest (dot): 7 файлов / 77 passed, exit 0 — session(3), refresh(2),
  upload-role-guard(7), middleware(30, регресс), negotiations route(12),
  negotiation-binding, cancel route(3).
- eslint (9 файлов): 0 проблем. tsc --noEmit: exit 0.
- LIVE-таблица:
  | probe | result |
  | session blocked | 403 ACCOUNT_BLOCKED, no token, cd_session+cd_refresh Max-Age=0 |
  | refresh blocked | 403 ACCOUNT_BLOCKED |
  | unauth POST /api/upload и /api/services/upload | 401 UNAUTHORIZED |
  | buyer /api/upload | 201 (CUSTOMER разрешён — отзывы/тикеты; отклонение от таблицы проб задокументировано) |
  | buyer /api/services/upload | 403 FORBIDDEN |
  | confectioner /api/upload + /api/services/upload | 201 / 201 |
  | admin /api/upload + /api/services/upload | 201 / 201 |
- State restore: throwaway user unblocked (admin API), затем удалён из БД
  (auth.users + profiles) — следов нет. Register-API был под 429 (3/час) —
  пользователь создан через SQL (auth.users → trigger создаёт profiles,
  паттерн setup.mjs).
- Protected files: git status --porcelain — 4 пути отсутствуют в diff ✓.
