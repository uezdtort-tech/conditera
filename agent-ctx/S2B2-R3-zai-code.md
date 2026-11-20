# S2B2-R3-B — zai-code — RBAC CONDITERA v2: верификация прерванного рогона, доисправление, гейты, артефакты (recreate-3)

Дата: 2026-11-20. Статус: ЗАВЕРШЕНО — все гейты пройдены (curl-matrix 28/28 + agent-browser), коммит + docs-коммит + bundle созданы, дерево чистое.

## Контекст
Предыдущий исполнитель S2B2-R был ПРЕРВАН по таймауту ПОСЛЕ имплементации, ДО
верификации и артефактов. Задача R3-B: ПРОВЕРИТЬ готовый код, ДОИСПРАВИТЬ
дефекты, прогнать все гейты, создать артефакты (НЕ переимплементировать).
Спека: docs/rebuild/prompts/S2B2-rbac.md (§6 запреты, §7 критерии, §8
верификация). Ground truth: agent-ctx/S2B2-R-zai-code.md (отклонения 1–5,
уроки 1–4). База: S2B1-R3 (95057b8 + docs 6825160). Корень
/home/z/my-project/conditera-v2, dev :3100, shim :3040, embedded PG :54330,
все команды `cd conditera-v2 && env -u DATABASE_URL`. Старый проект — только
чтение (:3000/:54329 не тронуты).

## Артефакты
- Коммит кода: **3d4a04a**
  `[S2B2] rbac: 13 permissions x 27 roles, admin-roles UI, claims self-healing,
  register-roles (recreate-3)` — 23 файла, +2336/−21, поверх 6825160,
  дерево чистое; .env.local и scripts/db/.auth-shim-users.json — gitignored
  (проверено check-ignore, в коммит не попали).
- Docs-коммит: **82310c7** `[S2B2] docs: worklog S2B2-R3-B (sha/bundle pinned)`
  (worklog.md +202 строки — структура, дефекты 1–5, отклонения, гейты, уроки).
- Bundle: /home/z/my-project/backups/conditera-v2-S2B2-3d4a04a.bundle
  (**658 055 bytes**), `git bundle verify`: ref refs/heads/main = 82310c7,
  complete history — OK (содержит S1B1→S2B2; docs-коммит поверх, как в
  паттерне S1B3/S2B1).
- Скриншоты (agent-ctx): s2b2-r3-admin-roles.png (таблица с назначенным
  Модератором + тост), s2b2-r3-matrix-tab.png (вкладка «Матрица прав», 13
  прав), s2b2-r3-register-roles.png (модалка на вкладке «Регистрация», чип
  «Кондитер» предвыбран), s2b2-r3-mobile-390.png (390, модалка, без overflow).
- worklog.md v2 — полная запись S2B2 (12 пунктов «что готово», 5 дефектов,
  отклонения, гейты, 5 новых уроков).

## Что чинилось при верификации (найденные дефекты)
1. **КРИТИЧНО — isLastActiveAdmin пропускал демоцию последнего реального
   админа (ghost-профили)**: seed-справочник содержит
   demo.admin@conditera.local с role=ADMIN БЕЗ auth-учётки в GoTrue. Счётчик
   «other active admins» (isBlocked/deletedAt) давал ≥1 → 409 last_admin НЕ
   срабатывал → POST {admin@demo.ru, role:"SUPPORT"} возвращал 200 и
   ДЕМОЦИРОВАЛ единственного носителя roles.assign (платформа теряла
   управление ролями; именно поэтому прерванный рогон оставил admin@demo.ru
   в role=SUPPORT — подтверждено его audit-строкой role.assign
   SUPPORT←ADMIN). ФИКС: «активный админ» = профиль, чей userId существует в
   GoTrue — новый helper filterExistingAuthUserIds (claims.ts, admin.listUsers
   с пагинацией, fail-closed [] при сбое) в isLastActiveAdmin. Гейт (e) →
   409 last_admin PASS.
2. **Шим не реализовал GET /auth/v1/admin/users/:id** (GoTrue
   admin.getUserById): GET /api/admin/roles/[userId] всегда 503
   claims_unavailable → гейт (h) divergent:false падал. ФИКС в
   mini-services/auth-shim/index.ts: GET-ветка → publicUser(user) 200 (шим
   остаётся верным GoTrue — урок №7 S2B1-R3). PASS.
3. **HeaderRolesLink ломал mobile 390 при входе админом** (scrollWidth=418):
   ссылка «Роли» не скрывалась на узких экранах. ФИКС: `hidden
   sm:inline-block` (консистентно с «Роли регистрации»). scrollWidth=390=
   clientWidth, переполняющих элементов 0. PASS.
4. **ROLE_MATRIX.md**: строка orders.read.own не упоминала ADMIN/SUPER_ADMIN
   (инвариант «админы имеют все 13 прав») — зеркало поправлено; правило №6
   дополнено семантикой «активный = реальный пользователь GoTrue».
5. Baseline-ремонт наследия рогона (операторский шаг, вне API, идемпотентный
   скрипт /home/z/gates/rbac-repair.mjs): admin@demo.ru → ADMIN + customer
   unblock + confectioner/support к baseline; затем re-heal claims через
   db:setup (auth-users self-heal: списокUsers → сравнение → PUT). Прямой SQL
   — санкционированный ремонтный путь (аналог «SUPER_ADMIN вручную в БД»,
   §6); прикладной код роли через прямой INSERT не назначает.

## Что готово для следующих блоков
- **S2B3 (security)**: rate-limit auth/admin (admin-роуты все за гвардами с
  Request — точка врезки есть); rewrite-семантика healing в session/login
  (сейчас ПЕРЕЗАПИСЬ только в гвардах S2B2, S2B1-роуты делают merge-семантику
  — перенос решения №1 ground truth); CSRF для admin-мутаций; filterExisting
  AuthUserIds — готовый паттерн дешёвых GoTrue-проверок.
- **S3B1 (навигация)**: /register-roles готова для sitemap; ссылка «Роли
  регистрации» уже в шапке; удалить /api/diag/seed-check (TODO-remove из S1B2).
- **S5B3 (dashboard-shell, админ-кабинет)**: /admin/roles ждёт каркас
  (сейчас самостоятельная страница с SiteHeader/Footer); аудит
  admin_actions пишется (16+ строк role.assign/role.unassign/user.block/
  user.unblock) — страница просмотра готова к подключению; admin-UI категорий
  (решение №12) — отдельная работа.
- **S4B2/S4B3 (платежи/выплаты)**: payments.manage/payouts.approve/
  ledger.read в матрице — обёртки withPermission готовы.
- STAFF_ROLES/группы — для кабинетов персонала (S5Bx).

## Отклонения (унаследованы от ground truth, подтверждены)
1. guard.ts/healClaimsToDbTruth — ПЕРЕЗАПИСЬ claims ровно на [profileRole];
   session/login сознательно не тронуты (перенос rewrite-семантики — S2B3).
2. Блокировка — withPermission("users.ban") с MODERATOR (старая матрица
   «модерация пользователей»); roles.assign ≡ ADMIN/SUPER_ADMIN.
3. Снятие роли = восстановление previousRole из аудита (profiles.role —
   скаляр); role.unassign пишет meta {role, previousRole, restoredRole}.
4. GUEST в списке назначения (служебная read-only); VENDOR_GROUP сверх §4.1.
5. Baseline-шаг гейтов: rbac-repair.mjs перед матрицей (идемпотентность
   повторных прогонов; ремонт наследия рогонов).

## Гейты (результаты по пунктам a–j, 2026-11-20)
1. lint 0 / tsc --noEmit 0 (финально, после каждого фикса). PASS.
2. Boot одним батчем: shim :3040 → dev :3100 Ready; db:setup идемпотентно
   (миграция 20261119234605_add_admin_actions применена; profiles=12 = 11
   seed + demo.oauth.yandex; auth-users ×4 Demo123!); health
   {status:ok, database:ok, auth:ok}; / 200, styleguide 200. PASS
   (S1B1/S1B2/S1B3/S2B1 не сломаны).
3. **curl-matrix 28/28 PASS** (bash /home/z/gates/s2b2-r3-matrix.sh; boot +
   вся матрица в ОДНОМ вызове bash — см. урок №1):
   - a) login admin@demo.ru/Demo123! (jar A) → 200, roles=["ADMIN"]. PASS.
   - b) GET /api/admin/users?page=1&pageSize=20 (jar A) → 200, total=12;
     userIds customer/confectioner/admin извлечены. PASS.
   - c) POST /api/admin/roles {confectioner, MODERATOR} → 200
     {previousRole:"CONFECTIONER", claimsSynced:true, auditLogged:true} →
     свежий login confectioner (jar B) → GET /api/auth/session →
     roles=["MODERATOR"] → декод JWT из куки jar B (префикс "base64-",
     чанки sb-127-auth-token.N, base64url payload) →
     app_metadata.roles=["MODERATOR"]. PASS.
   - d) DELETE /api/admin/roles {confectioner, MODERATOR} → 200
     {restoredRole:"CONFECTIONER"} → свежий login (jar B перезаписан) →
     session roles=["CONFECTIONER"], JWT claims=["CONFECTIONER"]. PASS.
   - e) POST {admin@demo.ru userId, role:"SUPPORT"} → **409
     {"error":"last_admin"}** (после фикса №1; до фикса — 200 и демоция,
     чинилось). PASS.
   - f) anon GET /api/admin/users → 401; login customer (jar C) → GET users
     403, POST roles 403. PASS.
   - g) GET /register-roles → 200; GET /admin/roles anon → 307 (redirect);
     jar A → 200. PASS.
   - h) POST {confectioner, CONFECTIONER} → 400 already_assigned;
     {customer, SUPER_ADMIN} → 403 super_admin_manual; {customer, "HACKER"} →
     400 unknown_role; GET /api/admin/roles/[confectioner] (jar A) → 200
     divergent:false (после фикса №2). PASS.
   - i) POST block customer {"reason":"test"} → 200 → его login → 403
     «Аккаунт заблокирован» → POST unblock → 200 → login → 200 → session 200;
     admin сам себя → 400 self_block. PASS.
   - j) аудит: raw SQL через node/pg (/home/z/gates/audit-check.mjs,
     camelCase-колонки в двойных кавычках — урок №3 ground truth): 14 строк
     role.assign/role.unassign/user.block/user.unblock; meta содержит
     role/previousRole/restoredRole/claimsSynced/reason/bannedInGoTrue;
     meta — JSON-объект у всех. PASS (≥10 требование выполнено; строки
     половинных прогонов рогонов — валидная append-only история).
4. agent-browser (всё в одном вызове после рестарта dev; тост-паузы ~5с):
   /admin/roles анонимом → redirect «/»; вход admin@demo.ru через модалку →
   /admin/roles; поиск «confectioner» → 1 строка; строка-меню → Сменить роль
   → «Модератор» (radix-typeahead: press м,о,д → highlight; клик по option в
   Dialog ненадёжен — урок №3) → Назначить → тост «Роль назначена: Модератор
   (была: Кондитер)», таблица обновилась; Снять роль → confirm-Dialog →
   «Модератор → восстановлена: Кондитер»; вкладка «Матрица прав» —
   "13 of 13 permissions visible"; /register-roles → клик «Кондитер» →
   auth-modal на вкладке «Регистрация», checkedChip=«Кондитер»;
   mobile 390 (вход админом): scrollWidth=390=clientWidth, переполняющих
   элементов 0, модалка dialogOpen=true. PASS (4 скриншота сохранены).
5. git: 3d4a04a (код) + 82310c7 (docs), дерево чистое (0 записей); bundle
   658 055 B, verify OK. PASS.

## Критические уроки (новые R3-B, обязательны к учёту)
1. **Процессы песочницы умирают между вызовами bash ВСЕГДА** (проверено: `&` +
   disown, nohup, setsid — не переживают; выжившие pid — наследие системного
   супервизора, не bash). Следствие: boot + вся curl-матрица + весь
   agent-browser — КАЖДЫЙ этап в ОДНОМ вызове bash (timeout до 600000);
   defensive pkill в начале каждого такого вызова.
2. **Ghost-профили в справочнике**: «активный админ» обязан проверяться на
   существование auth-учётки (GoTrue listUsers), иначе last_admin-гвоздь
   молча пропускает демоцию последнего РЕАЛЬНОГО админа → платформа теряет
   управление ролями; восстановление — только ручной SQL (базовый сценарий
   отказоустойчивости ролей не должен зависеть от содержимого справочника).
3. **Radix Select внутри Dialog в agent-browser**: клик по option ненадёжен
   (covered-by portal-спанов, «Element is covered by span#radix-*») —
   использовать typeahead (press «м», «о», «д») или self-correcting цикл
   ArrowDown по [role=option][data-highlighted] + Enter; вывод eval обрамлён
   кавычками — снимать перед сравнением (`tr -d '"'`), иначе цикл
   проскакивает условие и уезжает мимо цели (ловилось на прогоне).
4. **Aria-имена кнопок шапки**: «Войти в аккаунт»/«Зарегистрироваться»/
   «Выйти из аккаунта» (не «Вход»/«Выход») — в снапшотах искать по полным
   именам; HeaderRolesLink скрывать ниже sm, иначе вход админом даёт
   scrollWidth=418 на 390.
5. Прерванный рогон оставляет ПОЛУРАЗОБРАННОЕ состояние БД (демоция админа,
   audit-строки половинных прогонов) — перед гейтами обязателен baseline-
   ремонт (идемпотентный скрипт), а счётчик аудита растёт между прогонами
   (append-only): гейт «≥10 строк» считать кумулятивно.

## Дальше по карте
- **S2B3 «Security»** — ЦЕЛЕВОЙ следующий блок: rate-limit auth/admin;
  rewrite-семантика healing в session/login (перенос решения №1 ground truth
  — сейчас перезапись только в гвардах S2B2); CSRF для admin-мутаций
  (guard-хендлеры принимают Request — место для проверки); security-headers/
  timing-safe (proxy.ts из S2B1).
- S3B1 (навигация): /register-roles в sitemap; удалить /api/diag/seed-check.
- S2B4 (Storage): httpOnly-куки → server-роуты аплоадов; STORAGE_MODE=local.
- S5B3: dashboard-shell вокруг /admin/roles; просмотр admin_actions
  (аудит уже пишется); admin-UI категорий (реш. №12).
- S4B2/S4B3: withPermission("payments.manage"/"payouts.approve"/"ledger.read")
  готовы.
- Перед каждым блоком: worklog.md корня v2 + отчёт agent-ctx; bundle в
  backups после КАЖДОГО коммита (урок S1B2 №7).
