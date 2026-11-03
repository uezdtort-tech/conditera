# НЕЗАВИСИМАЯ ПРИЁМКА CONDITERA — COMMIT 7392403

**Аудитор:** независимый (не автор изменений). **Дата аудита:** 2026-11-02.
**Метод:** самостоятельная проверка кода, БД, API и UI. Результаты исполнителя не принимались на веру; каждый ключевой факт получен собственными командами.

---

## 1. SHA и точный diff

| Параметр | Значение |
|---|---|
| Репозиторий | `https://github.com/uezdtort-tech/conditera.git` (origin) |
| Ветка | `main` |
| HEAD | `7392403b5cf504045253e0c9b769ffb679fc311d` — совпадает с заданием |
| Родитель `7392403` | `48e4331dd8867012abec5ca668466fafd8b155c1` — совпадает с заданием |
| Diff | `git diff 48e4331..7392403` — единственный коммит D-01 |
| Рабочее дерево | чистое (0 записей `git status --porcelain`), stash пуст |
| Push | **не выполнялся**: `git rev-list --count origin/main..main` = **166** |

**Состав diff** (`git diff --numstat 48e4331..7392403`):

```
69 +   0 -  docs/audit/CONDITERA_CURRENT_STATE.md
58 +   0 -  docs/audit/CONDITERA_DEFECT_REGISTER.md
97 +   0 -  docs/audit/CONDITERA_DEPENDENCY_MAP.md
29 +   0 -  docs/audit/CONDITERA_REGRESSION_RISKS.md
32 +   0 -  docs/audit/CONDITERA_REPAIR_PLAN.md
18 +  39 -  src/app/dashboard/page.tsx
60 +   0 -  src/lib/primary-role.test.ts
108 +  0 -  src/lib/primary-role.ts
4 +  35 -  src/lib/role-guards.ts
18 +   1 -  src/lib/store.ts
7 +   1 -  src/lib/types.ts
```

**Git hooks:** `core.hooksPath=scripts/hooks`, `pre-commit` → `scripts/protected-paths.sh hook-guard` (существует, исполняем).
**Защищённые upload-файлы:** `git diff c8cc0bc..HEAD -- src/app/api/upload/ src/app/api/services/upload/` = пусто → содержимое bit-for-bit относительно `c8cc0bc`. Примечание: в ходе аудита sandbox-снапшотер снова захватил удаления 2 защищённых файлов; repair-guard (`ensure-dev.sh`) восстановил их автоматически, но **флаги skip-worktree были сброшены** — аудитором восстановлены (`git update-index --skip-worktree`, 4 файла). Средовое событие, не часть коммита.

---

## 2. Проверенные файлы

- `src/lib/primary-role.ts` — новый модуль: `ROLE_PRIORITY` (30 ролей, порядок идентичен удалённому из role-guards), `pickPrimaryRole`, `dashboardViewByRole`; серверных импортов нет (client-safe).
- `src/lib/role-guards.ts` — дублированный массив удалён, иерархия импортируется → рассинхрон клиент/сервер невозможен по построению.
- `src/lib/store.ts` — `setSupabaseUser`: `activeRole = pickPrimaryRole(user.roles)`; при смене `user.id` персист-состояние `dashboard-*` view пересчитывается.
- `src/app/dashboard/page.tsx` — `lastUserIdRef`; локальный маппинг удалён (единый импорт).
- `src/lib/types.ts` — `Role` дополнен `RECIPE_DEVELOPER | LOYALTY_PARTNER | AI_ASSISTANT`; сверено с `src/lib/supabase/types.ts` (`user_role`) — составы union идентичны.
- `src/lib/primary-role.test.ts` — 9 тестов (см. §3).
- `docs/audit/*` (5) — сверены с кодом; найдены 2 неточности (см. §6).

---

## 3. Собственные результаты тестов (команды и exit codes)

| Команда | Результат | Exit code |
|---|---|---|
| `bun run test` (vitest run) | **Test Files 78 passed (78), Tests 1239 passed (1239)** | 0 |
| `bun run typecheck` (tsc --noEmit) | ошибок нет | 0 |
| `bun run lint` (eslint .) | ошибок нет | 0 |
| production build (`next build`) | **NOT TESTED** — выполнение production-build запрещено ограничениями sandbox-среды; оснований объявлять его успешным или упавшим нет | — |

**Качество тестов D-01:** 9 тестов покрывают `pickPrimaryRole` (курьер→COURIER, иерархия, GUEST, пустые наборы, уникальность массива) и `dashboardViewByRole`. **Пробел покрытия:** логика `store.setSupabaseUser` (смена `user.id` → пересчёт view) и эффект `page.tsx` (lastUserIdRef) **юнит-тестами не покрыты** — ни один тест не вызывает `setSupabaseUser`. Проверено поиском: `pickPrimaryRole` в тестах встречается только в `primary-role.test.ts`.

---

## 4. Сквозные сценарии (независимо, живьём)

Среда: dev-сервер (порт 3000), embedded PostgreSQL 54329 (поднят `scripts/ensure-dev.sh` — штатный dev-поток; `.env.local` восстановлен штатной процедурой). Тест-данные создавались аудитором (куроеры `courier-audit@test.local`, `courier-b@test.local` с ролями, доставки, заказ AUDIT-2101, праздники, комната чата) и **полностью удалены после проверки** (остаточная сверка в БД: 0 записей).

### 4.1 Смена роли и кабинета (D-01) — PASS
Живой UI (agent-browser), login через модалку:
1. logout(customer) → login `courier-audit@test.local` (roles=`["CUSTOMER","COURIER"]`) → `/dashboard` → **«Кабинет курьера»**, store: `activeRole=COURIER`, `view=dashboard-courier`. До фикса здесь был покупательский кабинет (roles[0]=CUSTOMER).
2. Reload → кабинет курьера сохраняется; KPI-заголовки рендерятся.
3. Ручная смена роли в header («Сменить роль» → Покупатель) → `activeRole=CUSTOMER` → goToDashboard → `dashboard-customer`. PASS.
4. Reload после ручной смены → возврат в кабинет **главной** роли (courier). Осознанный дизайн «primary role wins», задокументирован исполнителем — поведение ожидаемое.

### 4.2 Курьерский цикл — PASS (с 1 finding'ом хрупкости)
- `PATCH /api/courier/deliveries/{id} {action:"pickup"}` → 200, `status=picked_up`, `pickup_at` заполнен (БД сверена).
- Повторный pickup → **409** (CAS: строка уже не `assigned`).
- Pickup **чужой** доставки (курьер B) → **403** «Можно менять только назначенные вам доставки».
- Pickup с CUSTOMER-сессией → **403** «Требуется роль: COURIER».
- Полный цикл на чистой фикстуре: READY→IN_DELIVERY→DELIVERED (курьером) → в БД: `orders.status=DELIVERED`, `deliveries.status=delivered`, `delivered_at` заполнен, `courier_earnings=350`, `order_status_history` = 2 записи с `changed_by=<курьер>`.
- Повторный `DELIVERED` → 400 «Запрещённый переход» (переход DELIVERED→DELIVERED вне карты переходов).
- **НО:** первая попытка на фикстуре с **двумя** активными deliveries одного заказа — синхронизация **молча не выполнилась** (см. дефект A-2 §6).

### 4.3 Чат: reload-цикл и изоляция — PASS
- find-or-create direct-комнаты (customer↔confectioner) → создана; повторный вызов → `created:false`, тот же room id.
- Отправка сообщения (idempotencyKey) → строка в БД; **retry с тем же ключом → тот же message id, дубля нет** (БД: 2 сообщения, 2 distinct id).
- Reload-симуляция: свежий GET истории → оба сообщения, без дублей.
- Чужой доступ к комнате (курьер) → **403**; аноним → **401**.

### 4.4 Holidays API — PASS
- GET аноним → 200 системные + пустой `user` (ошибки схемы `user_id does not exist` нет — реальная таблица `holiday_reminders.user_id`).
- POST (auth) → 201; GET (owner) → праздник виден; DELETE чужим пользователем → **404** (ownership-фильтр, без утечки существования); DELETE своим → 200; POST аноним → 403 CSRF-гейт.

### 4.5 Admin dashboard — PASS
- Аноним → **401**; customer → **403** «Требуется одна из ролей: ADMIN, SUPER_ADMIN»; admin → **200**, `stub:false`, реальные цифры (21 пользователь, 1 заказ). Dev-stub отсутствует — подтверждено.

### 4.6 Смена аккаунта — PASS
logout чистит сессию (редирект на /, повторный вход на /dashboard открывает модалку), повторный вход курьером — корректный кабинет (см. 4.1).

---

## 5. Безопасность и побочные эффекты

| Проверка | Результат |
|---|---|
| Серверная проверка ролей не обходится клиентом | PASS — 403 на admin/courier-эндпоинтах с чужими сессиями (проверено 4 способами) |
| Чужие ресурсы | PASS — чужая доставка 403, чужой праздник 404, чужая комната 403 |
| Повторные мутации | PASS — повторный pickup 409; чат-дедуп по idempotency-key; повторный DELIVERED 400. Реальные платёжные операции не воспроизводились (по требованию) |
| CSRF | PASS — живьём: мутации без `x-csrf-token` → 403; с чужим/устаревшим токеном → 403 «Неверный CSRF-токен» |
| Тестовые данные не оставлены | PASS — все фиксеры удалены, остаточная сверка 0 |
| Защищённые upload-маршруты | PASS — bit-for-bit vs c8cc0bc; repair-guard сработал в ходе аудита |
| Секреты в логах | PASS — grep по dev.log (JWT `eyJhbGci`, пароли, DSN) → 0 совпадений |

---

## 6. Найденные дефекты и неточности (с воспроизведением)

Все — **низкой/средней критичности, не блокирующие**. В коде коммита 7392403 блокирующего дефекта не найдено.

**A-1 · Рассинхрон activeRole ↔ view после ручной смены роли (edge нового поведения).**
Repro: login курьером → в header «Сменить роль» → Покупатель → goToDashboard (customer-кабинет) → уйти на другую страницу → вернуться на /dashboard. Наблюдено: `view=dashboard-customer` (кабинет покупателя рендерится), но `activeRole=COURIER` (меню/лейблы показывают «Кабинет курьера»). Причина: при первом effect-прогоне activeRole ещё CUSTOMER (сессия не синхронизирована), а повторный setSupabaseUser того же пользователя не пересчитывает view (`isUserSwitch=false`). Влияние: косметико-навигационное, до reload.

**A-2 · Синхронизация deliveries при DELIVERED молча проглатывает ошибку БД.**
`src/app/api/orders/[id]/route.ts:~212`: `const { data: dRow } = await supabaseAdmin.from("deliveries").select(...).eq("order_id",...).in("status",...).maybeSingle()` — объект `error` **не деструктурируется и не логируется** (вопреки собственному комментарию «логируем»). Repro: две активные deliveries одного заказа → `.maybeSingle()` возвращает ошибку «multiple rows» → sync пропущен без единой записи в логе; deliveries навсегда `picked_up`, earnings=0. Нормальный поток (одна доставка) работает — проверено чистым циклом. Требование: деструктурировать error, логировать; рассмотреть уникальный индекс активной доставки на заказ.

**A-3 · Двойной источник заработка курьера.**
KPI (`/api/courier/dashboard`, `/api/courier/earnings`) суммирует **`orders.delivery_cost`**, а DELIVERED-sync пишет **`deliveries.courier_earnings`** (из `deliveries.cost`). В штатном потоке `courier/assign` копирует cost из заказа — источники совпадают; расхождение возникает при изменении `delivery_cost` после назначения или ручной правке (воспроизведено фикстурой: в ledger 350 ₽, в KPI 0 ₽). Требуется продуктовое решение: единый источник истины.

**A-4 · Неточности в docs/audit (поставляются в самом коммите).**
1. `CONDITERA_DEFECT_REGISTER.md`: «аудит-лог … NOT FOUND в runtime-коде» — **неточно**: таблица `audit_log` используется во `src/app/api/franchise-exchange/{buy,transfer}/route.ts` (записи при transfer/buy). Корректная формулировка: глобальной подсистемы аудита (auth/payments/admin) нет; точечные записи в franchise-exchange есть.
2. Root cause D-01 (коммит-месседж, register, комментарии кода): «nav.view персистится (zustand persist)» — **не соответствует коду**: `partialize` (`store.ts:2154`) не включает `nav` → после reload view всегда сбрасывается в `home`. Фикс работает через другой механизм (пересчёт `activeRole` + `lastUserIdRef` на маунте), но описанная механика неверна — вводит в заблуждение будущую отладку.

**A-5 · Латентная рассинхронизация маппингов кабинетов.**
`DASHBOARD_MAP` (header.tsx:132) не синхронизирован с `dashboardViewByRole`: v2.0-роли (RECIPE_DEVELOPER, LOYALTY_PARTNER, AI_ASSISTANT) в нём отсутствуют → `goToDashboard` для них ведёт в `home`; MODERATOR/SUPPORT/BLOGGER ведут в индивидуальные view вместо `dashboard-extra`. Пре-существующая проблема, коммит её не расширил (но добавил роли в клиентский тип — путь стал достижимее).

---

## 7. Статусы

| Пункт | Статус |
|---|---|
| Фиксация состояния (SHA, parent, diff, hooks, защищённые файлы) | **PASS** |
| D-01: выбор главной роли и кабинета (статика + живой UI) | **PASS** |
| Иерархия клиент/сервер (единый источник) | **PASS** |
| Восстановление после reload; logout; смена аккаунта | **PASS** |
| Витесt 1239/1239; tsc 0; eslint 0 | **PASS** |
| Качество тестов D-01 (покрытие store-поведения) | **FAIL** (частичное — только чистая функция) |
| Курьерский цикл (pickup/повтор/чужое/завершение/история/earnings) | **PASS** |
| Синхронизация deliveries при DELIVERED (устойчивость к аномалиям) | **FAIL** (молчаливый проглат ошибок — A-2) |
| Чат: reload-цикл, дедуп, изоляция | **PASS** |
| Holidays API: CRUD + ownership | **PASS** |
| Admin dashboard: anon/customer/admin | **PASS** |
| Безопасность (CSRF, guards, чужие ресурсы, секреты) | **PASS** |
| Production build | **NOT TESTED** (запрет среды) |
| Эксплуатация dev-среды (OOM) | **FAIL** (2×OOM-kill next-server, ~3.3GB RSS — подтверждён D-11 как средовой) |
| Блокеры F2–F26 (реестр) | см. §8 |

---

## 8. Блокеры/отложенные пункты (по коду, независимо)

- `PROMPT-fix-all-bugs.md` — **отсутствует** во всём дереве и всей истории (`git log --all --name-only`) → F2–F26 проверялись по реестру/коду.
- Подтверждено наличие: rate-limit login 20/час+100/день (`anti-fraud.ts:41`); CSRF-gate (живьём); CSP (`next.config.ts`); webhook (`payment/webhook/route.ts` + route.test + route.http.test); конкурентные возвраты (`payout-complete-race.test.ts`, 4 теста); proxy-trust (`ingress-trust.test.ts`); TOTP-файлы. JWT-ротация/refresh — эндпоинт присутствует.
- Отсутствует (подтверждено поиском): CSV-экспорт, VK OAuth callback, split-payments; глобальный аудит-лог (при частичном `audit_log` во franchise-exchange — см. A-4.1).
- 166 коммитов не отправлены в origin; публикация — вне объёма приёмки.

---

## 9. Решение

## **ACCEPT WITH CONDITIONS**

Коммит `7392403` проверен независимо: D-01 подтверждён живым воспроизведением, регрессий в проверенных зонах не найдено, полный тестовый прогон/типы/линт зелёные (собственный прогон), сквозные сценарии проходят с серверными проверками доступа.

**Условия (для отдельного задания Z, не меняют принятый коммит):**
1. A-2 — деструктурировать/логировать ошибку `.maybeSingle()` в DELIVERED-sync; рассмотреть уникальность активной доставки на заказ.
2. A-3 — продуктовое решение по единому источнику заработка курьера.
3. A-1 — при смене activeRole синхронизировать view/activeRole (или осознанно задокументировать).
4. A-4 — исправить 2 неточности в docs/audit (audit_log; механизм персиста nav.view).
5. Добавить юнит-тест store-поведения `setSupabaseUser` (смена user.id → пересчёт view) — закрыть пробел покрытия.
6. A-5 — синхронизировать `DASHBOARD_MAP` с `dashboardViewByRole`.

**Ограничения аудита:** production build не выполнялся (запрет среды); JWT revocation, OAuth-флоу, платёжные webhook'и проверены только статически (наличие/контракт кода и тестов), динамически не воспроизводились; прогнозируемое поведение production-инфраструктуры не проверялось.

*Отчёт не изменяет код; дефекты переданы Z для корневого ремонта отдельным заданием.*

---

## 10. Последующий этап (дополнение 2026-11-02)

Дефекты A-1…A-5 из §6 устранены следующим заданием Z. Ход ремонта, первопричины, тесты и остаточные риски — в `docs/audit/FIX_A1_A5_REPORT.md`. Пункт «Условия» §9 закрыт там же.
