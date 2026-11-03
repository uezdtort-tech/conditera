# CONDITERA — Реестр дефектов (Pre-Change Gate + сеанс ремонта)

**Дата:** 2026-11-02 · Метод: каждый пункт — код + живое воспроизведение, без доверия отчётам.

Статусы: **CONFIRMED+FIXED** (воспроизведён, исправлен, проверен) · **ALREADY-FIXED** (исправлен в ранних коммитах, живьём подтверждён в этом сеансе) · **NOT-REPRODUCED** (не подтвердился по текущему коду) · **OPEN**.

## Сеанс 2026-11-02 (этот отчёт)

### D-01 · Смена аккаунта открывала кабинет чужой роли · CONFIRMED+FIXED
- **Симптом (живое воспроизведение, agent-browser):** logout customer → login `courier@demo.ru` → `/dashboard` рендерит **покупательский** кабинет («Обзор», «Мои заказы») при store `roles=["CUSTOMER","COURIER"]`. Дополнительно `activeRole` был `CUSTOMER`.
- **Root cause (2 независимые причины):**
  1. `store.setSupabaseUser` ставил `activeRole: user.roles[0]` — у мультит-рольных аккаунтов первая роль CUSTOMER (курьер: `["CUSTOMER","COURIER"]`).
  2. ~~`nav.view` персистится (zustand persist).~~ **ИСПРАВЛЕНО 2026-11-02 (A-4, приёмка 7392403): nav НЕ входит в `partialize` (store.ts) — после reload view всегда «home» и пересчитывается по activeRole (он персистится). Старая формулировка неверна; фактический механизм фикса — пересчёт activeRole + lastUserIdRef на маунте.** Изначальная формулировка: `nav.view` персистится; эффект в `/dashboard/page.tsx` пересчитывал view только когда view ещё не `dashboard-*`.
- **Фикс:**
  - `src/lib/primary-role.ts` (новый) — client-safe `ROLE_PRIORITY` + `pickPrimaryRole` + `dashboardViewByRole` (единый источник иерархии).
  - `src/lib/store.ts` `setSupabaseUser` — `activeRole = pickPrimaryRole(roles)`; при смене `user.id` ТЕКУЩИЙ (SPA, в памяти) `dashboard-*` view пересчитывается по роли. **Уточнение A-4: не «персистенный» — nav не персистится.**
  - `src/app/dashboard/page.tsx` — `lastUserIdRef`, при новом `user.id` view выставляется по роли, даже если view уже `dashboard-*`; маппинг импортирован (дубль удалён).
  - `src/lib/types.ts` — `Role` дополнен ролями v2.0 (`RECIPE_DEVELOPER`, `LOYALTY_PARTNER`, `AI_ASSISTANT`), которые сервер уже отдавал.
  - `src/lib/role-guards.ts` — `getPrimaryRole` импортирует `ROLE_PRIORITY` (устранение дублированной иерархии).
- **Тесты:** `src/lib/primary-role.test.ts` — 9 новых (курьер→COURIER, иерархия, GUEST, маппинг кабинетов).
- **Живая проверка:** logout → login курьером → `activeRole:"COURIER"` → «Кабинет курьера», KPI 0/1/350₽, «Заказ DEMO-2001», скриншот. Полный Vitest 1239/1239 после фикса.

## Унаследованные дефекты (ALREADY-FIXED, живьём подтверждены 2026-11-02)

| ID | Дефект | Исправлен | Доказательство |
|---|---|---|---|
| D-02 | Курьер без серверных pickup/complete; deliveries навсегда `assigned`; завершение чужого заказа 403 (базовая CUSTOMER-роль в токене) | `22eff00` | полный цикл в БД (CURRENT_STATE §3) |
| D-03 | Chat «Написать» 400 (клиентский peer из mock-store) | `a2cc953` | UI-сценарий PASS |
| D-04 | Дубль сообщения при retry+socket-буфер | `a2cc953` | повтор POST → `duplicate:true` |
| D-05 | Мёртвый клик «Написать» на slug-странице (SSR-монтирование) | `f0398f1` | не воспроизводится |
| D-06 | `/api/holidays` фантомная схема (`user_holidays.user_id does not exist`), cron молча заглушен | `d71b96f` | CRUD + БД (CURRENT_STATE §2) |
| D-07 | Admin dev-stub фальшивые KPI с бейджем LIVE анониму/не-админу | `d71b96f` | 401/403/200 stub:false |
| D-08 | Кабинеты покупателя/поставщика/курьера «Не авторизован» (мёртвый GoTrue-гейт) | `8c3b5c6`, `0a8de5d` | все кабинеты открываются |
| D-09 | UUID доставки вместо номера заказа | `22eff00` | «Заказ DEMO-2001» |
| D-10 | Chat после reload: сомнение из отчёта 0644854 | (не потребовало отдельного коммита: persist+дедуп+retry уже закрыли сценарий в `a2cc953`/`381f96c`) | golden path PASS (CURRENT_STATE §3) |

## Проверка перечня F2–F26 (`PROMPT-fix-all-bugs.md` НЕ существует ни в дереве, ни в истории)

| Пункт | Статус по коду 2026-11-02 |
|---|---|
| TOTP/2FA | PRESENT — `tfa-settings.tsx`, `input-otp` (глубокий аудит вне объёма сеанса) |
| JWT/refresh/ротация | PRESENT — `/api/auth/refresh`, `createAccessToken` HS256, `setSessionCookies` |
| Rate limits | **CONFIRMED живьём** — 429 при 20-й попытке login/час (`anti-fraud.ts`: login 20/час, 100/день) |
| Webhook идемпотентность | PRESENT — `payment/webhook/route.ts` + 15 unit-тестов |
| Конкурентные возвраты | PRESENT — `payment/refund/route.ts`, `payout-complete-race.test.ts` (4) |
| CSRF | CONFIRMED живьём — 403 без x-csrf-token (anon POST holidays) |
| CSP | PRESENT — `next.config.ts:149` |
| Proxy-trust | PRESENT — `ingress-trust.test.ts` (14), `TRUSTED_PROXY_HOPS` |
| useSocketIO | PRESENT + подключён (`chat-widget.tsx`) |
| IDOR ai-dialogue | PRESENT — `ai-dialogue-access.test.ts` (7, fail-closed) |
| CSV-экспорт, split-payments | NOT FOUND в runtime-коде — трактовать как deferred/продуктовые решения, не регрессии (были перечнем рекомендаций, не реализацией) |
| VK OAuth callback | **УТОЧНЕНО 2026-11-02 (A-4):** generic OAuth callback существует (`/api/auth/callback`, Supabase createServerClient, provider-agnostic) — отсутствует не callback как класс, а VK-специфичный flow/конфиг провайдера |
| Аудит-лог | **ИСПРАВЛЕНО 2026-11-02 (A-4):** формулировка «NOT FOUND» была результатом поиска по символу без проверки вызовов. Таблица `audit_log` ИСПОЛЬЗУЕТСЯ в `src/app/api/franchise-exchange/{listings,agreements,transfer}/route.ts` (записи при transfer/buy/изменении листингов). Корректная формулировка: единой подсистемы аудита безопасности (auth/payments/admin) НЕТ; точечные записи в franchise-exchange ЕСТЬ |

## Открытые дефекты

| ID | Описание | Критичность | Следующий шаг |
|---|---|---|---|
| D-11 | OOM-kill next-server (Turbopack, RSS ~2.5ГБ) при длительном dev + тяжёлых прогонках | среда, не код | держать Vitest вне параллели с dev; чистить `.next/dev`; production-build в отдельной среде |
| D-12 | Toast «Вы вошли как …» после logout/login может показывать имя предыдущей сессии (стейл-наблюдение при ручном сценарии; не влияло на логику, логин/данные корректны) | низкая | зафиксировать точку перерисовки toast при следующем UX-проходе |
