# ПРОМПТ S2B2 — RBAC: 26 ролей, матрица прав, admin-назначения

Этап 2 «Auth/RBAC» | Блок 2. Зависимости: S2B1 (auth), S1B2 (схема).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер. Ты строишь RBAC-слой v2: единая матрица прав для
26 ролей, admin-назначение ролей, защита всех будущих Route Handlers.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui (New York, Lucide); без indigo/blue.
- Данные: только Prisma. Backend: только Route Handlers.
- Безопасность: fail-closed; все гварды — через src/lib/auth/current.ts
  (S2B1); никаких проверок «на честном слове» в компонентах.
- Процесс: коммит `[S2B2] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/секреты/.env*; старый проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
Матрица ролей v2 (26 ролей), admin-эндпоинты управления ролями,
гвард-обёртки для роутов, справочная страница матрицы для админа.

## 4. ШАГИ
1. src/lib/auth/roles.ts: константы ролей (26 значений enum из S1B2:
   19 self-register + ADMIN, SUPER_ADMIN, MODERATOR, SUPPORT,
   QUALITY_INSPECTOR, CERTIFICATION_AGENT, GUEST) + сгруппированные
   константы (STAFF_ROLES, SUPPLIER_GROUP, SERVICE_GROUP).
2. Матрица прав src/lib/auth/permissions.ts: Map<permission, role[]>.
   Правила — по реестру фич (spec-registry, домены). Минимальный набор
   permission'ов: products.write, products.moderate, orders.read.own,
   orders.read.all, payments.manage, payouts.approve, users.ban,
   roles.assign, tickets.reply, content.moderate, ai.use,
   automation.view, ledger.read. Составить таблицу «роль × permission»
   и зафиксировать её в docs/ROLE_MATRIX.md v2.
3. Гвард-обёртка src/lib/auth/guard.ts:
   `withRole(handler, ...roles)` — обёртка Route Handler: 401 без
   сессии, 403 без роли, иначе передаёт user в handler. Роли — из
   claims app_metadata.roles (сессия Supabase, S2B1) с проверкой
   profiles; БД — истина при расхождении (перезаписать claims через
   Admin API). Поддержка permission-гвардов:
   `withPermission("payouts.approve")`.
4. Admin-эндпоинты (все за guardAdmin):
   - GET /api/admin/roles/:userId — роли пользователя;
   - POST /api/admin/roles — назначить роль: обновить profiles +
     реплицировать claims через Supabase Admin API
     (auth.admin.updateUserById, app_metadata.roles); audit-лог в
     admin_actions: actorId, action, targetId, meta, createdAt;
   - DELETE /api/admin/roles — снять роль;
   - GET /api/admin/users?query= — поиск по email/имени (пагинация).
5. Дашборд-страница «Пользователи и роли» (dashboard админа, S5B3
   получит каркас — здесь минимальная страница (dashboard)/admin/roles:
   поиск, список, назначение/снятие роли, подтверждение через Dialog,
   тосты; каждый рендер данных — из БД, не из mock).
6. Audit-лог: все admin-действия пишутся в admin_actions (S1B2 —
   убедиться, что модель есть; если нет — добавить миграцией).
7. Регистрация landing-страницы ролей: страница /register-roles
   (публичная, описывает 19 self-register ролей — содержимое из
   старого ROLE_MATRIX.md, текст переписать без копипаста-легаси).

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- docs/API_AUTH_MATRIX.md и docs/ROLE_MATRIX.md — сопоставление прав;
- src/lib/supabase/auth.ts + src/lib/role-guards.ts — паттерн
  requireRole (адаптировать под сессию Supabase S2B1);
- src/components/dashboard/* роли-табы — как референс поверхности.

## 6. ЗАПРЕТЫ
- Не назначать роли через прямой INSERT в обход admin-эндпоинта.
- Не отдавать в UI права клиента как источник истины (UI-скрытие —
  только удобство, проверка — на сервере).
- SUPER_ADMIN назначается только вручную в БД/скриптом — эндпоинта нет.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] permissions.ts + ROLE_MATRIX.md v2 покрывают все 26 ролей;
- [ ] withRole/withPermission работают: 401/403/200 кейсы (curl);
- [ ] admin-назначение роли пишет admin_actions, обновляет profiles
      и app_metadata.roles (после refresh/login JWT содержит роль);
- [ ] страница ролей работает на demo-данных (admin@demo.ru);
- [ ] tsc 0, lint 0; коммит [S2B2]; worklog дополнен.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl: login admin → POST /api/admin/roles (назначить CONFECTIONER
  customer-юзеру) → повторный login этого юзера → session.roles
  содержит CONFECTIONER;
- agent-browser: страница ролей — поиск, назначение, тост, откат.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S2B2]; docs/ROLE_MATRIX.md v2; worklog.
- Отчёт: сводная матрица (сокращённая), как администратор назначает роли.
