# ENGINEERING_DECISIONS.md

Принятые архитектурные решения и ограничения Conditera. Зафиксировано по фактическому коду, 2026-11-16.

## D1. Две отдельные PostgreSQL (не менять)

`conditera-db` — бизнес-данные; `supabase-db` — инфраструктура Supabase (включая Auth). Не объединять, не переносить бизнес-таблицы, не менять без отдельного согласования владельца. PostgREST обязан указывать на целевую БД с JWT-проверкой и RLS. Источник: задание владельца §1.1; код: `src/lib/postgrest/pool.ts` (DATABASE_URL → conditera), `supabaseAdmin` (GoTrue/admin).

## D2. Dual-аутентификация: app-JWT — основной источник истины

Собственный JWT (`jose`, HS256; access `JWT_SECRET` 7d, refresh `JWT_REFRESH_SECRET` 30d, 2FA-temp 5m) + GoTrue best-effort. Единая точка проверки — `getUserFromRequest` (`src/lib/auth.ts`), контракт: Bearer → `cd_session` → `sb-*-auth-token`. Cookies httpOnly/SameSite=Lax/Secure(prod).

## D3. Fallback регистрации «auth.users stub» (cb42589)

При недоступности GoTrue регистрация не падает 500: прямой INSERT в `auth.users` через pg-пул (`api/auth/register/route.ts:281-293`) с пустым `encrypted_password`, далее `profiles.password_hash` + `user_roles`, компенсирующие откаты. Это решение для локальной среды и деградации; на проде без передеплоя регистрация остаётся fail-closed 500 (старый код).

## D4. Пароли: bcryptjs(10) сейчас; Argon2id — целевое состояние

Комментарии «Argon2id» в `auth/login/route.ts` и `auth/register/route.ts` не соответствуют коду (`src/lib/auth.ts:128-140` — bcrypt.hash/compare, bcryptjs 3.0.3). Миграция на Argon2id — задача роадмапа (совместимый verify: по префиксу хэша). Нельзя менять формат хэша без миграционного пути для существующих `profiles.password_hash`.

## D5. Защита защищённых путей (3 уровня)

`scripts/protected-paths.sh`: `repair` (восстановление), `skip-on` (skip-worktree), `hook-guard` (pre-commit через `core.hooksPath=scripts/hooks`). MANDATORY_PATHS: `src/app/api/upload/route.ts(+test)`, `src/app/api/services/upload/route.ts(+test)`. Класс инцидента: процессы песочницы удаляют файлы, UUID-снапшоттер фиксирует удаление (371e975, eadd7d3, cd85b3e, fa3ca7e; рецидив 2026-11-16 — восстановлено, skip-worktree включён). После любого `git`-конфликта: `bash scripts/protected-paths.sh repair && skip-on`.

## D6. Клиентская безопасность SERVICE_ROLE

`SUPABASE_SERVICE_ROLE_KEY` — только server-only. Клиентский бандл: только `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/lib/supabase/browser.ts`). `src/lib/promo-codes.ts` импортируется клиентом (`store.ts`) сознательно: `supabaseAdmin` — ленивый импорт внутри функций (комментарий L12-13). Проверено grep: 10 файлов с SERVICE_ROLE — все server/test.

## D7. CSRF: double-submit + whitelist исключений с обязательной альтернативной защитой

`GET /api/csrf-token` (httpOnly cookie + заголовок `x-csrf-token`), проверка в `proxy.ts` (timing-safe). Исключения (`CSRF_EXEMPT_PATHS`): auth, payment/webhook, webhooks/n8n, cron, health, telegram/email inbound, diagnostics — каждое исключение обязано иметь собственную защиту (YooKassa: IP-allowlist + сверка с провайдером; n8n: `X-N8N-Secret`; cron: `X-Cron-Secret`).

## D8. Идемпотентность checkout/платежей

Idempotency-Key (окно 15 мин) + unique index 0060 + обработка 23505 (re-query); YooKassa — детерминированный Idempotence-Key (`lib/yookassa.ts:60,130-132`). Возвраты refund.succeeded обрабатываются. Атомарность жизненного цикла заказов — FOR UPDATE + CAS (`lib/ops/lifecycle.ts:372-497`).

## D9. SPA-поверх-App-Router (RouteFallback) — осознанное решение

~22 «stub»-маршрута — не пустышки: `RouteFallback` монтирует app-shell + реальные view через `store.navigate(view)`. Новые витрины допустимо добавлять по этому паттерну; серверные страницы — для SEO-объектов (как `/confectioners/[slug]`).

## D10. Dev-fallback ограждён

`src/lib/dev-auth.ts`: демо-пользователи с настоящим JWT только при `NODE_ENV!=="production"` && `!SUPABASE_SERVICE_ROLE_KEY`; каждый случай логируется. Запрещено ослаблять условия или распространять на prod.

## D11. Mock-first витрины + live-hydrator

Декор/услуги стартуют с mock-данных и гидрируются live-данными (`live-decor-hydrator.tsx`); пустой ответ БД не обнуляет витрину. Dual-mode в store: это осознанный UX-компромисс, не подмена интеграции — API реальны.

## D12. Неиспользуемые/ограниченные механизмы

- `react-hook-form` — установлен, потребителей вне shadcn `ui/form.tsx` нет (клиентская валидация ручная).
- zod — сервер, 12/333 роутов; auth-роуты — ручная валидация (`validation-schemas.ts` декларирует, но auth не использует).
- Realtime: Supabase Realtime недоступен (нет `/realtime/v1` в контуре) — realtime-каналы на socket.io мини-сервисе (:3030, `mini-services/chat-server`).

## D13. Ограничения владельца (действуют)

До отдельного разрешения: без JWT-ротации, без смены `JWT_SECRET`/`ANON_KEY`/`SERVICE_ROLE_KEY`, без смены версий Supabase, без удаления volumes / `docker compose down -v`, без смены схемы/RLS, без отключения JWT/RLS/TLS-verification, без вмешательства в Production-инфраструктуру, без push/deploy. Полный список: задание владельца §1.4.
