# CONDITERA — Карта зависимостей (Pre-Change Gate)

**Дата:** 2026-11-02 · **SHA проверки:** `48e4331`

Каждая стрелка проверена чтением фактического кода (файл → функция → вызов). Указаны только цепочки, задействованные в пользовательских сценариях этого аудита.

## 1. Сессия и авторизация (двухканальная модель)

```
Браузер (Zustand persist: conditera-storage)
  │  getStoredAccessToken() — sessionStorage cd_access_token (app-JWT, HS256)
  │  getSessionAuthHeaders() — cookie cd_session (httpOnly) + x-csrf-token
  ▼
/api/auth/login  (src/app/api/auth/login/route.ts)
  ├─ anti-fraud: checkFraudLimit(action='login', 20/час, order_fraud_logs)  → 429 + Retry-After
  ├─ createAccessToken() app-JWT  (src/lib/auth.ts:143,151,346)
  └─ setSessionCookies() (src/lib/session-cookies.ts) — каноничный канал браузера
        │
        ├─► API-роуты: getUserFromRequest(request) (src/lib/auth.ts) — Bearer ИЛИ cookie
        ├─► Роли: requireRole/requireAnyRole (src/lib/role-guards.ts → user_roles через supabaseAdmin)
        └─► Клиентские кабинеты: pickPrimaryRole (src/lib/primary-role.ts) ← единая иерархия с getPrimaryRole
```

Ключевые связи фикса D-01:
- `store.setSupabaseUser` → `pickPrimaryRole(user.roles)` + пересчёт `nav.view` при смене `user.id`
- `/dashboard/page.tsx` → `lastUserIdRef` + `dashboardViewByRole` (импорт из primary-role.ts)
- `role-guards.getPrimaryRole` → импортирует `ROLE_PRIORITY` из того же модуля (рассинхрон невозможен)

## 2. Chat (золотой сценарий reload)

```
ChatWidget (src/components/chat/chat-widget.tsx)
  ├─ Zustand persist: activeChatRoom, chatMessages(≤500) — выживают reload
  ├─ historyLoadedRef (раз/комнату/монтирование) → fetchChatMessages(roomId)
  │     └─ GET /api/chat/rooms/:id/messages (membership → 403 чужому; 401 анониму)
  ├─ doSend: crypto.randomUUID() = idempotency-key
  │     ├─ socketSendMessage (socket.io → /?XTransformPort=3030 → mini-services/chat-server)
  │     └─ POST /api/chat/rooms/:id/messages (Idempotency-Key) — повтор → duplicate:true, одна строка
  ├─ retry: handleRetrySend переиспользует ТОТ ЖЕ ключ (a2cc953)
  ├─ polling-фолбэк 5с/15с по курсору created_at (381f96c)
  └─ дедуп: id + мягкое окно 15с (senderId+text) — socket-копии не удваиваются
        ▼
БД: chat_channels / chat_channel_members / chat_messages (channel_id UUID; room_id — legacy nullable, не используется)
```

## 3. Курьерский цикл доставки

```
CourierDashboard (src/components/dashboard/courier-dashboard.tsx; app-JWT — 8c3b5c6)
  ├─ «Забрать» (status=assigned) → PATCH /api/courier/deliveries/:id {action:"pickup"}
  │     auth → requireRole(COURIER) → принадлежность courier_id=me (403) →
  │     переход assigned→picked_up (409 при CAS-промахе) → pickup_at
  └─ «Завершить» (picked_up/on_the_way) → PATCH /api/orders/:id {status:"DELIVERED"}
        auth → role-guard перехода (COURIER) → владение через deliveries (первопричина 22eff00:
        базовая CUSTOMER-роль в токене ломала завершение чужого заказа) →
        orders.status=DELIVERED + delivered_at → fail-safe sync строки deliveries
        (status=delivered, delivered_at, courier_earnings=cost) → order_status_history(changed_by)
        ▼
БД: deliveries (0002 статусы: assigned|picked_up|on_the_way|delivered|failed), orders.number (DEMO-…)
```

## 4. Holidays

```
HolidayCalendar (UI) → /api/holidays
  GET  — публично: SYSTEM_HOLIDAYS; auth: holiday_reminders(user_id=me) → маппинг date→month/day
  POST — валидация name/month/day/remindDaysBefore → insert (date=ближайшая годовщина, клэмп 29.02→28.02)
  DELETE — .eq(id).eq(user_id) → 0 строк = 404 (чужое удалить нельзя)
  ── cron /api/cron/holiday-reminders читает те же колонки (d71b96f)
БД: holiday_reminders (0010); legacy user_holidays (0017) НЕ используется runtime-кодом
```

## 5. Admin dashboard

```
AdminDashboard (UI, ErrorState+«Повторить» при 503) → /api/admin/dashboard
  getUserFromRequest → 401; requireAnyRole(ADMIN, SUPER_ADMIN) → 403 (в любом окружении)
  → Promise.all(10 count/RPC) → stats + recentOrders + platformGrowth, stub:false
  RPC: revenue_today, revenue_month (SQL SUM)
БД: profiles, orders, support_tickets, payouts, fraud_alerts
```

## 6. Qwentoрt-зависимости (внешний ревью-репозиторий)

- `/home/z/qwentopt-review` — read-only клон (HEAD `c4ae0268`).
- Перенесённые ранее решения (история Conditera): интеграционная панель + /cart (`feat/convergence-integrations-panel`), живая доставка чата, реальная аналитика, mock-гейт (REJECT mock-first витрин).
- Текущие 8 модулей Qwen — mock-прототипы без backend (см. CONDITERA_CURRENT_STATE.md §qwentopt) — переносимых зависимостей нет.

## 7. Точки переключения/дубликаты (проверено)

| Точка | Статус |
|---|---|
| Легаси mock-чат r1/r2/r3 | только анонимный фолбэк (SUPPORT_ROOM_ID='r3'); залогиненные — реальная БД |
| `chat_messages.room_id` (text, nullable) | legacy-колонка, runtime использует `channel_id` — дубля схемы нет |
| `user_holidays` (0017) vs `holiday_reminders` (0010) | runtime — только `holiday_reminders` |
| demo-seed (`DEMO_SEED_ENABLED`) | 33 точки store; admin/dashboard от них чист (stub удалён) |
| socket.io vs polling | polling — управляемый фолбэк, не вторая система чата |
