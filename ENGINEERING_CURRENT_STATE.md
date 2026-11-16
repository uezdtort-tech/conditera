# ENGINEERING_CURRENT_STATE.md

Реальное состояние архитектуры и модулей Conditera. Обновлено: 2026-11-16, синхронизация Z (коммит `e7da599`).
Дополняет, но не дублирует: `docs/AUTH.md`, `docs/DATABASE.md`, `docs/ROLE_MATRIX.md`, `docs/KNOWN_LIMITATIONS.md`, `worklog.md`.

## 1. Git

- HEAD: `e7da599` (fix(test): удалить сироту cart-sync.test.ts), ветка `main`.
- Всего коммитов: 488. **Локальный main = origin/main + 299 коммитов, 0 позади** (origin/main: `8a31081`, dependabot-мержи). Вся разработка не опубликована.
- Исторические якоря: `98c0ddc` (Z-v15), `26947c5` (Z-v16) — только ориентиры, не HEAD.
- UUID-коммиты (`7bb22dd`, `8aefa18`, …) — артефакты снапшоттера песочницы: пустые маркеры или массовые добавления (`_quarantine/`, отчёты RELEASE-*, `mobile-app/`).
- Защищённые upload-роуты: механизм `scripts/protected-paths.sh` (3 уровня: repair / skip-worktree / pre-commit hook-guard, `core.hooksPath=scripts/hooks`). В этой сессии файлы были удалены процессом песочницы — восстановлены из последнего хорошего коммита, skip-worktree включён (`git ls-files -v` → `S`).

## 2. Стек (package.json, фактически)

| Компонент | Версия | Примечание |
|---|---|---|
| Next.js | 16.3.5 (App Router, Turbopack dev) | `src/proxy.ts` = middleware (паттерн Next 16) |
| React / TS | 19 / 5 | строгая типизация, `tsc --noEmit` = 0 ошибок |
| Tailwind | v4 (`@theme inline`, oklch-токены) | globals.css 1348 стр., дизайн-токены полные |
| shadcn/ui | ~50 компонентов в `src/components/ui` | New York, Lucide |
| Zustand / TanStack Query | 5 / 5 | store.ts 2291 стр., persist `conditera-storage` |
| zod | 4 | сервер: 12/333 роутов; клиент — не используется |
| Supabase | supabase-js 2.112, ssr 0.5.2 | admin-клиент server-only |
| Крипто | `jose` 6 (HS256), **`bcryptjs` 3 (cost 10)** | Argon2id НЕ используется — комментарии в auth-роутах устарели |
| Тесты | vitest 4 | 147 файлов; playwright-скрипт есть, зависимость не установлена |

## 3. Архитектура (подтверждено кодом)

- **Аутентификация dual**: собственный app-JWT (`src/lib/auth.ts`: access 7d, refresh 30d отдельным секретом, 2FA-temp 5m) + Supabase GoTrue best-effort. Cookies `cd_session`/`cd_refresh` (httpOnly, SameSite=Lax, Secure в prod) — `src/lib/session-cookies.ts`.
- **`getUserFromRequest`** (266 route-файлов): Bearer → `cd_session` → `sb-*-auth-token`; кэш blocked-статуса 60с; **fail-open при ошибке БД** (`auth.ts:293-296`).
- **register** (`api/auth/register`): anti-fraud 3/ч с IP, whitelist 17 ролей, DaData для юрлиц, GoTrue `createUser` → **fallback `auth.users` stub** через pg-пул (cb42589, `route.ts:281-293`), `profiles.password_hash` (bcrypt), `user_roles`, компенсирующие откаты.
- **login**: bcrypt-verify по `profiles.password_hash`; для GoTrue-only юзеров — `signInWithPassword`; dev-fallback (`src/lib/dev-auth.ts`, пароль `demo123`) только при `NODE_ENV!=="production"` и `!isAdminConfigured()`.
- **Данные**: PostgREST через supabase-js (supabaseAdmin доминирует) + шим RLS-семантики `src/lib/postgrest/execute.ts` (BEGIN → set_config jwt.claims → SET LOCAL ROLE) + прямой `pg` пул (max 10, `src/lib/postgrest/pool.ts`, 46 роутов). Prisma удалена (v2.0), артефакты в `prisma/` остались.
- **proxy.ts**: correlation-id, ролевой гвард uploads, CSRF double-submit (timing-safe, сравнение header↔cookie), security headers + CSP (страница/API), no-store для auth/payment/profile/admin.
- **Rate limiting**: sliding window (`src/lib/rate-limit.ts`), Redis при `REDIS_URL`, иначе in-memory per-instance; DB-backed anti-fraud (`src/lib/anti-fraud.ts`, salted IP-hash). В proxy rate-limit отсутствует — только в роутах (~39 файлов).
- **Checkout**: идемпотентность (Idempotency-Key 15 мин + unique index 0060 + 23505-requery), zod CheckoutSchema, серверный пересчёт цен (price-versions), YooKassa с детерминированным Idempotence-Key; единой DB-транзакции order+items нет.
- **payment/webhook**: IP-allowlist + сверка события с провайдером (re-fetch), mock_* fail-closed в prod.

## 4. Frontend

- SPA-поверх-App-Router: ~22 «stub»-маршрута монтируют `RouteFallback` (`src/components/route-fallback.tsx`, 245 стр.) с полным app-shell и реальными view из `src/components/pages/*` через `store.navigate(view)`.
- Полноценные серверные страницы: `/dashboard` (role-based dynamic import 6 дашбордов), `/confectioners/[slug]` (SEO, supabaseAdmin, notFound()), `/login`, `/checkout/success`, `/auth/reset-password`, `/oauth/finish`, `/telegram`.
- Реальные API-потоки: каталог (`useLiveProducts`→`/api/products`), товар, cart-sync (`lib/cart-sync.ts`→`/api/cart`), checkout (`POST /api/checkout`), cake-builder (`/api/builder/config`, `/api/fillings`), чат, уведомления (поллинг 60с).
- Слабые места: `/en` — только layout (i18n-заглушка), `product` только `?id=` (нет `/product/[id]`), `next/image` в 3 файлах (каталог — голые `<img>`), rhf/zod на клиенте не задействованы, Supabase Realtime мёртв (нет `/realtime/v1`; realtime — socket.io мини-сервис :3030).

## 5. Статус модулей (Этап B/F, доказательства в отчёте синхронизации)

| Модуль | Статус | Ключевое доказательство |
|---|---|---|
| Каталог→корзина→checkout→оплата→эскроу | ПОЛНОСТЬЮ | `checkout/route.ts` 1021 стр., `payment/webhook` 820 стр., e2e `tests/e2e/full-flow.spec.ts` |
| ЛК кондитера (35 вкладок) | ПОЛНОСТЬЮ | `confectioner-dashboard.tsx`, `useRealOrders/Inquiries/Inventory` |
| Рецепты + склад (write-off, идемпотентность) | ПОЛНОСТЬЮ | миграции 0046–0049/0071/0081, `inventory-write-off.idempotency.test.ts` |
| Поставщики/закупки | ПОЛНОСТЬЮ (витрина декора — mock-first + live-hydrator) | `purchase-orders`, `supplier/dashboard` |
| Чаты/поддержка | ПОЛНОСТЬЮ | `chat_channels/chat_messages` + socket.io :3030 + CRM-тикеты |
| CRM/админ/модерация | ПОЛНОСТЬЮ | `/api/crm/*`, `/api/admin/*`, `/api/moderator/queue` |
| Курьеры | ПОЛНОСТЬЮ | `courier-dashboard`, тесты assignments |
| Уведомления | ПОЛНОСТЬЮ | таблица `notifications`, 9 API-роутов |
| Аниматоры/услуги | ЧАСТИЧНО (витрина mock-first) | `service_products` (0029) реальны |
| Площадки (venues) | ПОЛНОСТЬЮ | `venue_bookings` (0033) |
| Подарочные сертификаты | ЗАГЛУШКА | только zustand, API/БД нет |
| Корпоративные заказы | ЗАГЛУШКА | только mock-data |
| i18n `/en` | ЗАГЛУШКА | только layout.tsx |
| Cake Studio | НЕ ИНТЕГРИРОВАНА | `docs/integration/CAKE_STUDIO_INTEGRATION_GROUND_TRUTH.md`: архив V2 не найден, интеграция — отдельное решение владельца |

## 6. Seed-данные

`scripts/db/setup.mjs`: embedded PG (:54329) → compat → 85 миграций → 11 seed-файлов: 28 категорий, 12 товаров витрины, 5 кондитеров (c0–c4), рецепты marketplace, начинки, декор, инвентарь, отзывы, CMS/CRM, 6 демо-аккаунтов (`Demo123!`). Данные реалистичны, не заглушки.

## 7. Артефакт `mobile-app/`

React Native/Expo приложение «Уездный кондитер» появилось в репозитории через UUID-снапшот `8aefa18` без утверждённой задачи; в `src/` веб-приложения не импортируется. Содержит 3 из 3 ошибок ESLint репозитория. К удалению/переносу — только по решению владельца (п. 2 задания: не смешивать рабочие деревья).
