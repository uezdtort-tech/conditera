# supabaseAdmin — политика использования

> Статус: сентябрь 2026. Инвентаризация: 201 route.ts из `src/app/api` импортируют `supabaseAdmin`.
> Правило действует для НОВОГО кода; существующие роуты мигрируются постепенно (см. «План миграции»).

## Что такое `supabaseAdmin`

`@/lib/supabase/admin` — Supabase-клиент с `SUPABASE_SERVICE_ROLE_KEY`:
**обходит все RLS-политики**. Любая ошибка в логике такого роута = полный доступ к БД.

## Allowed (оправданное применение)

| Категория | Примеры | Почему |
|-----------|---------|--------|
| Admin/moderator approve/reject | `admin/confectioners/*`, `moderation/*`, `moderator/*` | Проверка роли уже в коде; запись идёт в чужие строки |
| Cron jobs | `cron/*` | Нет user-сессии по определению (auth через `verifyCronSecret`) |
| Webhooks внешних систем | `payment/webhook`, `webhooks/n8n`, `email/inbound`, `simplex/incoming`, `telegram/webhook` | Обновление строк без end-user JWT |
| Auth flow | `auth/login`, `auth/register`, `auth/refresh`, `auth/2fa/*` | Чтение profiles/user_roles до наличия валидной сессии |
| Публичные витрины read-only | `confectioners` (GET), `map/confectioners`, `promotions`, `products` | Таблицы с RLS для anon; admin-клиент используется как быстрый путь. Кандидаты на перевод на anon/SSR-клиент (см. Forbidden) |
| Onboarding / storage bootstrap | `confectioner/onboarding` | Запись в buckets/строки до готовности пользовательской сессии — предпочитать user-client, где возможно |

## Forbidden для нового кода

- **Публичные GET каталога** — использовать anon/SSR-клиент + RLS (defense in depth: если RLS настроен неверно, admin-клиент это маскирует).
- **User-scoped CRUD** (`профиль читает/пишет свои строки`) — использовать user-scoped SSR-клиент (`@/lib/supabase/server`, `getCurrentUser`), чтобы RLS была единственной линией проверки прав.
- **Записи, чей владелец известен из сессии** — писать от имени пользователя, не service_role (иначе в `created_by` попадают неверные/NULL значения).

## Инвентаризация (baseline, сентябрь 2026)

Команда:

```bash
rg -l "supabaseAdmin" src/app/api --type ts | wc -l   # 201
```

Категории (по префиксам): `admin/*`, `moderation/*`, `moderator/*`, `cron/*` — ожидаемо;
`auth/*`, `payment/*`, `webhooks/*`, `email/*`, `simplex/*`, `telegram/*` — ожидаемо;
остальные (~120) — кандидат на аудит: user-scoped роуты (`orders/[id]`, `venues/[id]/bookings/*`,
`profile/*`, `confectioner/*`, `dashboard`-роуты) следует переводить на
`getCurrentUser()` + user-scoped клиент, оставляя admin-клиент только там, где
route легитимно пишет чужие строки после проверки роли.

## План миграции (постепенно, без «вырезать всё сразу»)

1. Пилот: перевести 1–2 user-scoped роута на SSR-клиент + RLS, проверить E2E.
2. Новый код — только по настоящей политике (review-gate).
3. Постепенно: `profile/*`, `venues/bookings`, `stories/*` → user-scoped.
4. Публичные GET → anon-клиент, когда RLS покрыта тестами.

## CI-контроль (report-only на этапе C4)

```bash
scripts/check-admin-usage.sh   # выводит число route.ts с supabaseAdmin
```

Рост числа сверх baseline 201 в PR, не связанном с новыми фичами, — повод
объяснить в review, почему нельзя user-scoped.
