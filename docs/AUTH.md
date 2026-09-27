# Auth contract (сентябрь 2026)

## Текущее состояние (dual-stack, заморожен на расширение)

| Стек | Helper | Route.ts | Статус |
|------|--------|----------|--------|
| **Supabase (канон)** | `getCurrentUser()` из `@/lib/supabase/auth` | 13 | Растим |
| **Supabase SSR** | `getSession()` / `@/lib/supabase/server` | 1 | Растим |
| **Legacy JWT** | `getUserFromRequest()` из `@/lib/auth.ts` (jose + bcrypt) | 163 | **Не расширять** |
| Machine-to-machine | `verifyCronSecret` (`@/lib/cron-auth`), `X-N8N-Secret`, `X-Bot-Secret`, `X-Bridge-Api-Key`, Telegram `X-Telegram-Bot-Api-Secret-Token`, YooKassa `verifyWebhook` | cron/webhooks | Стабилен |

Два стека существуют исторически: JWT-модуль появился до полного перехода на
self-hosted Supabase. Оба валидируют пользователя против одной БД
(`profiles`/`user_roles`), поэтому параллельная работа корректна.

## Canonical (новый код)

- **Browser/SSR**: Supabase SSR cookies (`@/lib/supabase/server`) — `getCurrentUser()` / `getSession()`.
- **API user routes**: `getCurrentUser()` из `@/lib/supabase/auth`.
- **Cron/webhooks**: shared secrets (`verifyCronSecret`, N8N/Telegram/YooKassa/Bridge/Bot).
- **Проверка ролей**: через `user_roles` из Supabase (`requireRole`-хелперы / явный `in`-фильтр).

## Legacy (не расширять)

- `getUserFromRequest()` + jose JWT в `@/lib/auth.ts`.
- **Правило review**: новый route.ts НЕ импортирует `getUserFromRequest`,
  если он не чинит существующий JWT-only flow.
- Исключение — роуты, вызываемые только из server-side кода со служебными
  JWT (внутренняя автоматизация) — помечать комментарием `// legacy JWT: internal`.

## План cutover (отдельный эпик, PR C2b — не в этом PR)

1. Заменить вызовы `getUserFromRequest` на `getCurrentUser` группами по фичам
   (`orders` → `venues` → `profile` → …), каждый шаг — отдельный PR с E2E.
2. Когда импортеров `getUserFromRequest` не останется — удалить JWT issue/verify
   из `@/lib/auth.ts` (оставив bcrypt для паролей, если ещё нужен).
3. Инвалидировать все access/refresh токены (ротация JWT_SECRET/JWT_REFRESH_SECRET
   или полный отказ от них) — пользователи перелогинятся.

## Связанные документы

- `docs/SUPABASE_ADMIN_POLICY.md` — где допустим service_role-клиент.
- `docs/API_AUTH_MATRIX.md` — маршрут → метод → тип авторизации.
- `docs/ROLE_MATRIX.md` — роли и их дашборды.
