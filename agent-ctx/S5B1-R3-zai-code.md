# S5B1 — Кабинет покупателя (customer cabinet) — отчёт recreate-3, финализация S5B1-R3-FINAL

Дата: 2026-11-20/21 UTC. Репо: /home/z/my-project/conditera-v2 (main).
Коммиты: `6622617` (код, 35 файлов, +3969/−37) → `93a534a` (fix: мобильная навигация кабинета, 4 файла, +135/−50) → `79feae4` (docs: worklog, sha/bundle pinned).

## Скоуп

- Единый layout route-group для всех страниц /account/*: сайдбар навигации + мобильный переключатель разделов (общий источник пунктов — nav-items.ts; fix 93a534a связал мобильную кнопку с меню).
- /account — обзор: карточки «Заказы всего», «Бонусный баланс», «Сумма покупок» (агрегаты из БД, owner-scoped).
- /account/orders — история заказов со статус-табами (фильтр ?status=) и клиентскими действиями «Подтвердить»/«Отменить».
- /account/favorites — сетка избранного с удалением (сердца также в каталоге и карточке товара).
- /account/profile — профиль (имя/телефон/город) + смена пароля отдельной формой.
- Адресная книга (модель Address): CRUD + адрес по умолчанию, источник автозаполнения checkout.
- Аноним на любой странице кабинета → 307 /cart?auth=1.

## Эндпоинты

| Метод/путь | Назначение | Негативные ветки |
|---|---|---|
| POST /api/orders/[id]/confirm | Покупатель подтверждает доставку: DELIVERED → COMPLETED; эскроу released по строкам заказа; бонус начислен (журнал баланса); OrderEvent actor CUSTOMER, meta via customer-confirm | чужой заказ 404 not_found; не-DELIVERED 409 invalid_state; всплеск >10/мин/user → 429 + Retry-After |
| POST /api/orders/[id]/cancel | Отмена: неоплаченный PENDING → CANCELLED, списанные бонусы возвращаются ровно один раз (описание начинается с «Возврат бонусных баллов») | оплаченный CONFIRMED → 409 paid_contact_support; чужой → 404 |
| GET /api/orders?status= | Витринная история с фильтром статуса | мусорное значение статуса → 400 |
| GET/POST/DELETE /api/favorites | Toggle избранного (POST идемпотентен по unique-констрейнту userId+productId); GET — список с total | аноним GET 401; аноним POST 403 (csrf-first, порядок guard'ов S2B3) |
| PATCH /api/account/profile | Имя/телефон/город | без CSRF-токена → 403 |
| POST /api/auth/password | Смена пароля: verify текущего + новый | неверный текущий → 400 wrong_password; успех → 200, повторный вход новым паролем 200 |
| GET/POST /api/account/addresses, PATCH/DELETE /[id] | Адресная книга: label/recipient/phone/city/street/house/flat/entrance/floor/comment + isDefault | 11-й адрес → 400 limit; чужой адрес → 404; isDefault эксклюзивен (tx «снять прочие, выставить выбранный»); rate 20/мин/user (отдельный ключ) |

## Дизайн синхронизации избранного

- Клиентский стор: zustand persist, ключ `conditera-favorites` (соглашение как `conditera-cart`); хранится ТОЛЬКО массив id товаров — снапшоты (title/price) не хранятся, списки рендерит сервер (страница /account/favorites — db-запрос owner-scoped).
- Гость: сердце в каталоге — toast «Войдите, чтобы добавить в избранное» + auth-modal; local-toggle НЕ выполняется (после входа серверная истина остаётся чистой).
- Авторизованный: optimistic local toggle + POST/DELETE /api/favorites через csrfFetch; сбой сети → откат toggle + toast.
- FavoritesSync: клиентский компонент, смонтирован ВНУТРИ AuthMenu (шапка на всех страницах). При появлении сессии/смене userId перечитывает GET /api/favorites и ЗАМЕНЯЕТ локальный список серверным (syncFromServer); выход → clear(). Сервер (wishlist_items, @@unique([userId, productId])) — истина.
- Hydration-safe: mounted-флаг в useEffect, до него сердце рендерится незаполненным (нет расхождения SSR/CSR); на сервере persist-заглушка (паттерн cart-store).

## Решения

- Layout кабинета в route-group (dashboard): общий shell с существующими кабинетами (баланс/выплаты кондитера), пункты меню — один источник (nav-items.ts) для сайдбара и мобильной навигации.
- Отмена разрешена только НЕоплаченным заказам; оплаченные — 409 paid_contact_support (маршрут в поддержку), т.к. деньги уже в escrow-контуре S4.
- Чужие ресурсы (заказ, адрес) → 404, не 403: не раскрываем существование чужой сущности.
- Возврат бонусов при отмене — ровно один раз (guard по журналу), bonusPointsRedeemed в заказе сохраняется для аудита.
- Rate-limit подтверждения 10/мин/user с заголовком Retry-After; адреса — свой бакет 20/мин/user (платформенный общий бакет мутаций не ослаблялся).

## Гейты (числа)

- lint: 0 ошибок; tsc --noEmit: 0 ошибок (подтверждено финализацией S5B1-R3-FINAL, дерево чистое).
- curl-матрица: agent-ctx/s5b1-matrix.sh — сценарий A–R: анон-редиректы ×5 (307 → /cart?auth=1), login, обзор-статистики, фильтр статуса (только PENDING / 400 на мусор), создание заказа, foreign confirm 404, не-Delivered confirm 409, pay → CONFIRMED + эскроу held, admin-переходы до DELIVERED, customer confirm → COMPLETED + эскроу released + бонус + OrderEvent CUSTOMER, verify-ledger OK, cancel неоплаченного → CANCELLED, cancel с бонусами → возврат ровно 1, cancel оплаченного → 409, favorites (2 add, idempotent, GET 2, anon 401/403), profile (403/200 + db), password (400/200/re-login/откат), addresses CRUD + isDefault=1 + 11-й → 400 + чужой → 404, burst confirm → 429 + Retry-After.
- Браузер-гейт: agent-ctx/s5b1-r3-browser.sh — статистика на обзоре, мобильный Sheet (закрытие при выборе), табы заказов, confirm DELIVERED → toast + рост баланса, favorites 2 сердца → удалить 1 → grid 1, profile PATCH + адреса, console errors 0, dark-режим.
- Render-check после docs-коммита: / 200, /catalog 200, /account 307 → /cart?auth=1 (анон), /api/health 200.

## Скриншоты (agent-ctx)

- s5b1-r3-overview.png — обзор кабинета (карточки статистики).
- s5b1-r3-orders.png — история заказов, статус-табы.
- s5b1-r3-favorites.png — сетка избранного.
- s5b1-r3-profile.png — профиль + адресная книга.

## Девиации / известные пробелы

- Скриншоты mobile-390 и dark НЕ сохранились в agent-ctx (скрипт s5b1-r3-browser.sh их предусмотрел, файлов s5b1-r3-mobile-390.png / s5b1-r3-dark.png нет) — сами проверки в скрипте покрыты, но артефактов нет. Восполнить при первой сессии S5B2 (прогон browser-гейта с фиксацией этих двух снимков).
- Root my-project содержит незакоммиченный хвост прошлых блоков (правка worklog.md со входами S4B3/S5B1, untracked артефакты s4b3-*/s5b1-* в agent-ctx) — по инструкции НЕ добавлялись: в my-project закоммичен ТОЛЬКО файл бандла (f649f1c).
- Каталог-прайс «Сумма покупок» считается по оплаченным/завершённым заказам — при откате тестовых данных матрицей цифры на скриншоте могут отличаться от живого прогона (косметика демо-данных, не дефект логики).

## Следующий блок

S5B2 — кабинет кондитера (confectioner cabinet): витрина заказов кондитера, составы заказов, управление доступностью товаров, статусы приготовления.
