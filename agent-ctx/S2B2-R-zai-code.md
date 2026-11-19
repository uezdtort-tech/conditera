# S2B2-R — zai-code — RBAC: 13 прав × 27 ролей, admin-назначения, /admin/roles, /register-roles (recovery)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены (curl-matrix 28/28 + agent-browser), коммит + bundle созданы.

## Контекст
Ре-исполнение S2B2 (спек: docs/rebuild/prompts/S2B2-rbac.md) поверх S1B1-R (f4038b6) + S1B2-R (7fcf60b) + S1B3-R (3e43022) + S2B1-R (9eb3a77, worklog 7f242cd). Решения владельца №8 (RECIPE_DEVELOPER admin-assigned) учтены; №12 (admin-категории) — вне блока. Корень /home/z/my-project/conditera-v2, dev :3100, shim :3040, `env -u DATABASE_URL`.

## Что готово для следующих блоков
- **src/lib/auth/permissions.ts** — ЕДИНСТВЕННЫЙ источник политики: 13 permission (products.write, products.moderate, orders.read.own, orders.read.all, payments.manage, payouts.approve, users.ban, roles.assign, tickets.reply, content.moderate, ai.use, automation.view, ledger.read) × 27 ролей (26 легаси + RECIPE_DEVELOPER). Helpers: rolesWithPermission/hasPermission/permissionsForRole + PERMISSION_LABELS_RU. Fail-fast самотест при импорте; незнакомая роль = 0 прав (fail-closed).
- **src/lib/auth/roles.ts** (расширен, экспорты S2B1 не тронуты): ALL_ROLES (27), STAFF_ROLES (7), SUPPLIER_GROUP (2), SERVICE_GROUP (6), VENDOR_GROUP (4), type AllRoles, isKnownRole, isStaffRole.
- **src/lib/auth/guard.ts** — гвард-обёртки Route Handlers: withRole(roles, handler), withPermission(permission, handler), withAdmin(handler); requireAccess/requirePermission для страниц. ОТЛИЧИЕ от guards.ts (S2B1): оценивает БД-ИСТИНУ profiles.role; расхождение claims → healClaimsToDbTruth — перезапись app_metadata.roles ровно на [profileRole] (снятая роль умирает немедленно). Fail-closed: 401 без сессии/профиля/при блокировке, 403 без роли/права.
- **src/lib/auth/claims.ts** — replicateRolesToClaims (ПОЛНАЯ ЗАМЕНА массива, user_metadata.role дубль), healClaimsToDbTruth (приоритет БД даже при сбое репликации), syncGoTrueBan (best-effort, shim is_blocked), readClaimsRoles (admin.getUserById).
- **src/lib/auth/admin-rbac.ts** — getRbacTarget, isActiveAdminRole, canActOnTarget (ADMIN не трогает SUPER_ADMIN), isLastActiveAdmin (активные ADMIN/SUPER_ADMIN ≤1), resolveRestoredRole (meta.previousRole последнего role.assign из аудита → fallback CUSTOMER), writeAdminAction (append-only).
- **Admin API** (runtime nodejs, force-dynamic):
  - GET /api/admin/users?page&pageSize&query&role — withAdmin; пагинация/поиск email+name insensitive/фильтр роли; profiles = справочник (БД, не mock); БД-сбой → 503.
  - POST /api/admin/roles — withPermission("roles.assign"); 403 super_admin_manual (SUPER_ADMIN только вручную, спек §6), 403 insufficient_hierarchy, 400 already_assigned (дубль), 409 last_admin; update profiles.role → claims-репликация → audit admin_actions.
  - DELETE /api/admin/roles — снятие → восстановление previousRole из аудита (гейт «unassign → roles back»); role-фильтр → 400 role_not_assigned; restoredRole=SUPER_ADMIN → 403; last_admin 409.
  - GET /api/admin/roles/[userId] — {role, claimsRoles, divergent, isBlocked} — самодиагностика репликации.
  - POST /api/admin/users/[userId]/block {reason?} и /unblock — withPermission("users.ban") (ADMIN/SUPER_ADMIN/MODERATOR); истина profiles.isBlocked (сессии гасятся fail-closed) + best-effort GoTrue ban; 400 self_block/already_blocked/not_blocked, 409 last_admin (нельзя заблокировать последнего админа), 403 иерархия.
- **Audit**: prisma-модель AdminAction → таблица admin_actions (actorId/action/targetId/meta Json/createdAt; append-only, индексы targetId+createdAt, actorId+createdAt, action); миграция prisma/migrations/20261119175632_add_admin_actions (migrate dev, env -u DATABASE_URL). Все admin-мутации пишут записи с meta {role, previousRole, email, claimsSynced, reason…}.
- **UI /admin/roles** (src/app/(dashboard)/admin/roles): серверный гвард requireAccess([ADMIN,SUPER_ADMIN]) → redirect("/") для анонима; клиент — shadcn Tabs/Table/Dialog/DropdownMenu/Select/Badge + sonner: поиск (debounce 350мс), фильтр роли, пагинация, строка-меню (Сменить роль/Снять роль/Заблокировать/Разблокировать), Dialog смены роли (Select, SUPER_ADMIN отсутствует), confirm-Dialog снятия/блока (reason ≤200), тосты с кодом ошибки, skeleton/retry; вкладка «Матрица прав» (13 прав бейджами + права штата; max-h-96 overflow-y-auto scrollbar-thin).
- **UI /register-roles** (src/app/(public)/register-roles): публичная, 19 self-register ролей группами (свежие тексты), кнопка роли → auth-modal на вкладке «Регистрация» с предвыбором; блок «Служебные роли». auth-modal: новый проп initialRole (эффект при open → setTab("register")+setRegRole) — обратно совместим.
- **docs/ROLE_MATRIX.md v2** — человеческое зеркало матрицы (13 прав таблицей × 27 ролей, группы, how-to админа, правила fail-closed).

## Гейты (все пройдены 2026-11-19)
1. lint 0, tsc --noEmit 0.
2. Boot ОДНИМ вызовом (bash /home/z/gates/s2b2-gate.sh): shim :3040 200 + app :3100 200 через 3с; health {status:ok, database:ok, auth:ok} — гейты S1B1/S1B2/S1B3/S2B1 живы (styleguide 200, home 200).
3. **curl-matrix 28/28 PASS**:
   - a) login admin@demo.ru/Demo123! (jar A) = 200;
   - b) GET /api/admin/users (jar A) = 200 (userId демо-юзеров извлечены из ответа);
   - c) POST /api/admin/roles {confectioner, MODERATOR} = 200 {previousRole:"CONFECTIONER", claimsSynced:true, auditLogged:true} → свежий login confectioner (jar B) 200 → GET /api/auth/session roles=["MODERATOR"] → **декод JWT из куки jar B: app_metadata.roles=["MODERATOR"]**;
   - d) DELETE /api/admin/roles {userId, role:"MODERATOR"} = 200 {restoredRole:"CONFECTIONER"} → свежий login → session roles=["CONFECTIONER"], JWT claims=["CONFECTIONER"];
   - e) **last_admin probe**: POST {admin@demo.ru на себя, role:"SUPPORT"} = **409 {"error":"last_admin"}**;
   - f) anon GET users = 401; customer login 200 → GET users = 403; customer POST roles = 403;
   - g) GET /register-roles = 200; GET /admin/roles anon = 307 (redirect); с jar A = 200;
   - h) дубль (CONFECTIONER кондитеру) = 400 already_assigned; SUPER_ADMIN = 403; role:"HACKER" = 400 unknown_role; GET roles/[userId] = 200 divergent:false;
   - i) block customer = 200 → его login = 403 «Аккаунт заблокирован» → unblock = 200 → login 200 → session 200; self_block = 400;
   - j) admin_actions: 10 строк role.assign/role.unassign/user.block/user.unblock с корректной meta (выборка сырым SQL с кавычками "actorId").
4. agent-browser: /admin/roles анонимом → redirect «/»; вход admin через модал; поиск «confectioner» → 1 строка; Сменить роль → «Модератор» → Назначить → тост, таблица обновилась; Снять роль → confirm-Dialog → роль «Кондитер» вернулась; /register-roles → кнопка роли открыла модал на вкладке Регистрация с предвыбранным чипом. Скриншоты /home/z/gates/s2b2-*.png (вне репо).
5. Коммит **96a18a6** (`[S2B2] rbac: 13 permissions x 27 roles, admin-roles UI, claims self-healing, register-roles (recovery)`) + docs-коммит; bundle /home/z/my-project/backups/conditera-v2-S2B2-96a18a6.bundle (265088 B, verify OK, полная история); дерево чистое.

## Отклонения (ключевые, полный список в worklog.md)
1. guard.ts/healClaimsToDbTruth — ПЕРЕЗАПИСЬ клеймов ровно на [profileRole] (S2B1 session/login делали merge — для снятых ролей это дыра); session/login сознательно не тронуты (перенос rewrite-семантики — S2B3).
2. Блокировка — withPermission("users.ban") с MODERATOR (старая матрица «модерация пользователей»), остальные admin-роуты — с ADMIN/SUPER_ADMIN; roles.assign ≡ guardAdmin.
3. Снятие роли = восстановление previousRole из аудита (profiles.role — скаляр; гейт d требует возврата к CONFECTIONER, не CUSTOMER).
4. GUEST присутствует в списке назначения (служебная read-only); VENDOR_GROUP добавлен сверх спеки §4.1.
5. Baseline-шаг гейт-скрипта: разблокировка customer перед матрицей (идемпотентность повторных прогонов).

## Уроки (обязательны к учёту)
1. curl без -X POST/-d шлёт GET → 405 на POST-only роуте (первый прогон гейта).
2. Куки @supabase/ssr в jar: значение с префиксом "base64-" + возможные чанки sb-127-auth-token.N — декод после снятия префикса, base64url.
3. Prisma Json-мета: cast as Prisma.InputJsonValue; camelCase-колонки в raw SQL — только в двойных кавычках.
4. Модульный самотест матрицы (throw при импорте) ловит опечатки ролей до первого запроса.

## Дальше
- S2B3: rate-limit auth/admin, rewrite-семантика healing в session/login, CSRF для мутирующих admin-роутов.
- S3B1: /register-roles в sitemap/навигацию; удалить /api/diag/seed-check.
- S5B3: dashboard-shell вокруг /admin/roles; страница просмотра admin_actions (аудит уже пишется); admin-UI категорий (реш. №12).
- S4B2/S4B3: payments.manage/payouts.approve/ledger.read уже в матрице — использовать withPermission.
