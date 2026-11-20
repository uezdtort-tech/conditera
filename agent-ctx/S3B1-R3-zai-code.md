# S3B1-R3 — zai-code — Маршруты и навигация публичного сайта: верификация прерванного рогона, доисправление, гейты, артефакты (recreate-3)

Task ID: S3B1-R3-CONT (в отчётной цепочке — S3B1-R3). Дата: 2026-11-20.
Статус: ЗАВЕРШЕНО — все гейты пройдены (lint/tsc 0/0; boot OK; curl-батарея
34/34; agent-browser 27/27), коммит кода 5e3be47 + docs-коммит 246811b +
bundle conditera-v2-S3B1-5e3be47.bundle созданы, дерево чистое.

## Контекст

Первое исполнение S3B1 в recreate-3. Прерванный прогон успел
ИМПЛЕМЕНТИРОВАТЬ весь каркас маршрутов (незакоммичено: 8 новых страниц
app/(public)/, robots.ts, sitemap.ts, 5 layout-компонентов, views
каталога/кондитеров/рецептов/листингов, legal-тексты, правки
root/(public)/(dashboard) layouts, header/footer, safe-image/shop-card,
csrf-shared, utils — поверх 2b5bf17; удалён /api/diag/seed-check), но НЕ
успел: гейты, коммиты, worklog, bundle, отчёт. Задача R3-CONT: ПРОВЕРИТЬ
готовый код, ДОИСПРАВИТЬ дефекты, прогнать все гейты, создать артефакты
(НЕ переимплементировать). Спека: docs/rebuild/prompts/S3B1-routes.md
(§6 запреты, §7 критерии, §8 верификация). Хэндоффы S2B2/S2B3/S2B4
(agent-ctx/{S2B2,S2B3,S2B4}-R3-zai-code.md, секции «Что готово для
следующих блоков») — все контракты соблюдены: SafeHtml-only UI,
safeFetch-only исходящие, /api/diag/* удалён + префикс снят с
CSRF_WHITELIST_PREFIXES (остались /api/webhooks/ и /api/cron/),
SECURITY_BASELINE.md whitelist-таблица обновлена (пометка «УДАЛЕНО в
S3B1», §3). База: S2B4-R3 (код 712126c + docs 2b5bf17). Корень
/home/z/my-project/conditera-v2, ветка main, dev :3100, шим :3040,
embedded PG :54330, все команды `cd conditera-v2 && env -u DATABASE_URL`.
Старый проект — только чтение (:3000/:54329/:3030 не тронуты; pkill-
шаблоны строго "next dev -H 0.0.0.0 -p 3100" и
"bun --hot mini-services/auth-shim").

Проверка входного состояния: полный аудит новых/изменённых файлов.
ДЕФЕКТОВ В КОДЕ ПРИЛОЖЕНИЯ НЕ НАЙДЕНО — единственный подозрительный
«битый» класс футера pb-ax(...) опровергнут побайтовой проверкой od -c
(фактические байты корректны: pb-[max(1rem,env(safe-area-inset-bottom))];
mangling текстового вывода cat/rg, НЕ дефект — см. Уроки №1). Две
точечные правки: комментарий csrf-shared.ts (литеральная строка префикса
убрана из JSDoc — гейт требует отсутствия строки в файле) и label футера
«Политика ПДн (152-ФЗ)» → «Политика конфиденциальности» (конвенциональная
формулировка гейта; href прежний). Удаление /api/diag/seed-check
прерванным рогоном подтверждено (каталог api/diag отсутствует; GET → 404).

## Артефакты

- Коммит кода: `[S3B1] routes: public skeleton — 8 pages, nav+aria-current,
  breadcrumbs, legal P0, sitemap/robots, diag removal (recreate-3)` —
  **5e3be47** (5e3be474ccf2a47e7a452dd4af5a1c767dcb3313), 46 файлов,
  +2336/−231, дерево чистое (0 записей). Pre-commit проверка: .env.local/
  .pgdata/.storage-data/ — gitignored, в коммит не попали.
- Docs-коммит: `[S3B1] docs: worklog S3B1-R3 (sha/bundle pinned)` —
  **246811b** (246811be32e36cc80eeaafa54156b367e44cee04).
- Bundle: **/home/z/my-project/backups/conditera-v2-S3B1-5e3be47.bundle**,
  804 560 байт (~786 KB); `git bundle verify` — OK, «The bundle records a
  complete history» (полная история main, sha1).
- Worklog: conditera-v2/worklog.md, раздел `## S3B1 — Маршруты и навигация
  публичного сайта (recreate-3)` (карта маршрутов, гейты, дефекты,
  отклонения, уроки).
- Скриншоты: agent-ctx/s3b1-r3-home-light.png (599 091 B),
  s3b1-r3-catalog.png (298 022 B), s3b1-r3-home-dark.png (451 809 B),
  s3b1-r3-mobile-390.png (54 169 B).
- Отчёт: agent-ctx/S3B1-R3-zai-code.md (этот файл).

## Карта маршрутов

| Маршрут | Что рендерится | Данные |
|---|---|---|
| / | hero на mesh-gradient + 3 панч-карточки (каталог/кондитеры/рецепты, stretched-link) + лента «свежее» | Лента — **EmptyState** (по спеке §4.1); остальное — статика/тексты |
| /catalog | Breadcrumbs + PageHeader (fade-up) + FilterSidebar (8 категорий со счётчиками) + сетка ShopCard (фото/badges/цена/город) | **БД (Prisma)**: products 20 (isAvailable) + categories 8 — «Торт «Красный бархат»», «Медовик семейный» и др.; изображения — resolve через таблицу files (width/height, батч без N+1) либо mesh-заглушка с инициалом категории |
| /confectioners | карточки кондитеров: рейтинг, verified-бейдж, город, специализация, честная метка «от … ₽» (groupBy _min) | **БД (Prisma)**: confectionerProfile 2 — «Пекарня «Уездный кондитер»», «Сладкая мастерская» |
| /recipes | сетка рецептов (coverImage через files/заглушку, prep/cook, сложность) | **БД (Prisma)**: recipe published 3 — «Медовик по бабушкиному рецепту» и др. |
| /promotions | ListingShell: крошки + PageHeader + FilterSidebar-заготовка | Prisma: promotion (status=active); сид пуст → честный **EmptyState** + CTA в каталог |
| /venues | ListingShell | Prisma: venue (isActive); сид пуст → **EmptyState** |
| /services-shop | ListingShell | Prisma: service (isActive); сид пуст → **EmptyState** |
| /decor-shop | ListingShell | Prisma: decorProduct; сид пуст → **EmptyState** |
| /legal/privacy | LegalLayout: оглавление sticky (max-h-96 + scroll), секции с якорями, дата обновления | P0-текст (решение №13): категории ПДн, цели, основания **152-ФЗ**, права субъекта, cookies |
| /legal/terms | LegalLayout | P0-текст: пользовательское соглашение |
| /legal/offer | LegalLayout (+ таблица тарифов) | P0-текст: публичная оферта |
| /register-roles | без структурных правок; metadata под title-шаблон | S2B2 (19 ролей) |
| /styleguide | без изменений, dev-only (в footer виден только вне production) | S1B3 |
| /sitemap.xml | MetadataRoute: 12 URL (8 витрин + register-roles + 3 юр.), priority/changeFrequency/lastModified | base — getAppUrl() (NEXT_PUBLIC_APP_URL) |
| /robots.txt | MetadataRoute: allow /, Disallow /dashboard, /admin, /api, /styleguide + sitemap-ссылка | — |
| /api/diag/seed-check | **УДАЛЁН** (спека §4.5) | GET → 404 подтверждён гейтом |

Шапка: CONDITERA-логотип, MainNav (7 маршрутов, aria-current="page" по
usePathname с prefix-матчем вложенных), поиск-иконка-заготовка (честный
тост «появится в S3B2»), HeaderRolesLink (S2B2), «Кабинеты», AuthMenu
(S2B1), ThemeToggle; MobileMenu — Sheet ниже lg. Футер: 4 колонки ссылок
(Витрина / Ещё разделы / Юридическое / Платформа) + копирайт + dev-ссылка
styleguide; sticky-footer-контракт (body min-h-screen flex flex-col,
main flex-1, footer mt-auto + safe-area inset). Root layout: skip-link
«Перейти к содержимому» → main#content (в обоих контурах (public) и
(dashboard)), FOUC-bootstrap темы, title-шаблон «%s — CONDITERA».

## Что готово для следующих блоков

- **S3B2 (фильтры/поиск/пагинация каталога)**: FilterSidebar-заготовка уже
  на всех 8 витринах (принимает categories с счётчиками — сейчас только у
  /catalog); SearchStubButton — точка подключения реального поиска (тост
  убрать); ShopCard.href опционален — детальные маршруты карточек
  добавляются без правок карточки; каталог читает Prisma напрямую —
  заменить на queries-слой с фильтрами/пагинацией; ListingShell готов
  принимать items.
- **S3B3 (полная SEO-генерация/OG)**: каркас I1 готов — src/lib/app-url.ts
  (getAppUrl, фоллбэк :3100), sitemap.ts/robots.ts как MetadataRoute,
  metadata/generateMetadata на каждой странице, title-шаблон
  «%s — CONDITERA» в root layout; расширять OG/canonical поверх
  getAppUrl().
- **S5 (кабинеты)**: (dashboard)-оболочка переведена на единые
  SiteHeader/SiteFooter + main#content (skip-link работает в обоих
  контурах); списки кабинетов — переиспользовать паттерн ListingShell/
  ShopCard.
- **SafeHtml/safeFetch-точки применения**: нового user-HTML в S3B1 НЕТ —
  все тексты статические или из Prisma и рендерятся React-экранированием;
  исходящих fetch в каркасе нет. Точки БУДУЩЕГО применения: описания
  товаров/рецептов/акций из БД (если станут rich-text — только SafeHtml),
  внешние интеграции (DaData/Mailpit — только safeFetch).
- **S2B4-контур изображений**: resolveStorageImages (src/lib/data/
  storage-image.ts) — пакетный резолв через files, готов для всех будущих
  витрин; внешний домен в remotePatterns не добавлялся (контракт хэндоффа
  соблюдён).

## Отклонения от спеки (обоснованные)

1. Спека §4 «сетка ShopCard из seed-данных» для 7 страниц: из них сид есть
   только у 3 (products/confectionerProfiles/recipes) — они рендерят
   реальные данные из БД; promotions/venues/services-shop/decor-shop
   читаются из своих таблиц Prisma, но сид этих таблиц пуст → честный
   EmptyState (запрет §6 «не вставлять mock» соблюдён; при появлении
   записей разделы начнут рендерить карточки без правок кода).
2. Страница /register-roles (54 строки) и auth-modal.tsx (399) —
   артефакты S2B2/S2B1; S3B1 менял в register-roles только metadata-title
   (под шаблон). Приведение к SD-3 ≤50 — вне блока (не переимплементировать
   чужие блоки); все НОВЫЕ страницы S3B1 — 18–30 строк.
3. generateMetadata как async-функция — на /recipes (с force-dynamic,
   данные серверные); на остальных страницах — статический export const
   metadata (эквивалентно критерию title/description на каждой странице).
4. Sitemap содержит 12 URL, включая /register-roles и 3 юрстраницы (спека
   §4.6 требовала SEO-минимум; включение точек конверсии и P0-документов —
   улучшение I1, согласовано с решением №13).

## Гейты (все пройдены 2026-11-20)

1. **Статика**: `env -u DATABASE_URL bun run lint` → 0; `bun run typecheck`
   → 0. page.tsx новых страниц 18–30 строк (SD-3 ≤50) — PASS; все страницы
   S3B1 ≤300 строк — PASS; строка «/api/diag/» отсутствует во всём src
   (python-проверка по байтам, DIAG_HITS: []) — PASS; CSRF_WHITELIST_PREFIXES
   = ["/api/webhooks/", "/api/cron/"] — PASS. Тесты по ограничению задачи
   не писались.
2. **Boot + curl-батарея (один вызов, 34/34 PASS, FAIL=0)**: pkill строго
   по 2 шаблонам (:3000/:54329/:3030 не тронуты) → шим :3040 health OK →
   `db:setup` exit=0 (push+seed) → dev :3100 /api/health 200 за 3с.
   - 8 маршрутов / /catalog /confectioners /recipes /promotions /venues
     /services-shop /decor-shop → все 200 (PASS×8);
   - контент из БД: /catalog «Красный бархат», /confectioners «Уездный
     кондитер», /recipes «Медовик по бабушкиному», /promotions EmptyState
     («Активных акций пока нет») (PASS×4);
   - /legal/privacy, /legal/terms, /legal/offer → 200; privacy содержит
     «152-ФЗ» (PASS×4);
   - /sitemap.xml → 200 + /catalog + /register-roles; /robots.txt → 200 +
     «Disallow: /dashboard» (PASS×5);
   - GET /api/diag/seed-check → 404 (PASS);
   - регрессия: /api/health 200 {status:ok}; /styleguide 200;
     /dashboard/files anon → 307; admin login 200; POST /api/admin/roles
     без X-CSRF-Token → 403 {"error":"csrf"} (whitelist-изменение admin-
     CSRF не сломало); GET /api/auth/session anon → 401; POST
     /api/cron/storage-cleanup с X-Cron-Secret из .env.local → 200
     (PASS×7).
3. **agent-browser (один вызов, sentinel-eval, 27/27 PASS)**: boot →
   desktop 1440×900, open / + settle 15с (Turbopack-HMR) → все 8 маршрутов
   отрисованы (main#content + h1 + title CONDITERA, не blank, без
   «Application error») (PASS×8); /catalog: активный пункт nav имеет
   aria-current="page" (PASS); крошки «Главная / Каталог» (PASS); мобильный
   390×844: карточки в 1 колонку (grid-cols=1, PASS), scrollWidth=390
   без переполнения (PASS), бургер открывает меню с пунктами nav (≥7,
   PASS) и закрывается (Escape, PASS); футер: ссылка «Политика
   конфиденциальности» → /legal/privacy, GET → 200 (PASS×2); ThemeToggle →
   html.dark применён (PASS); page errors 0, console errors 0 (PASS×2);
   4 скриншота сохранены.
4. **Артефакты**: pre-commit проверка forbidden-файлов — чисто; код-коммит
   5e3be47 (46 файлов, +2336/−231); worklog-запись S3B1; docs-коммит
   246811b; bundle conditera-v2-S3B1-5e3be47.bundle (804 560 B) —
   `git bundle verify` OK, complete history; дерево чистое.
5. Итог: ВСЕ ГЕЙТЫ ПРОЙДЕНЫ, дубль-фиксов не потребовалось (curl-батарея
   с первого прогона 34/34; agent-browser после фикса парсинга 27/27).

## Дефекты, найденные и починенные

Дефектов В КОДЕ приложения не найдено (однократный CONT-прогон — аудит
входного состояния до правок). Починено:

1. csrf-shared.ts: из JSDoc удалена литеральная строка префикса
   «/api/diag/» (сам whitelist был корректен с прерванного рогона; правка
   закрывает буквальную формулировку гейта «строки нет в файле»).
2. footer.tsx: label ссылки «Политика ПДн (152-ФЗ)» → «Политика
   конфиденциальности» (href /legal/privacy прежний; конвенциональная
   формулировка гейта).
3. Гейт-инструментарий: agent-browser eval оборачивает результат в кавычки
   с \-escaping внутренних — первый прогон дал 13 ложных FAIL; фикс —
   sentinel-строки в eval + tr -d '"\\', батарея перегнана ЗАНОВО одним
   вызовом (27/27). Подозрение на «битый» Tailwind-класс футера снято
   od -c (байты корректны) — правка НЕ вносилась (ложный дефект).

## Уроки (обязательны к учёту)

1. **cat/rg могут «показывать» несуществующие символы** (mangling на
   подстроках вида «[max(...)]»): сомнительные байты проверять ТОЛЬКО
   od -c / python, правку не вносить по «показаниям» текстового вывода —
   ложный дефект чуть не ушёл в фикс.
2. **agent-browser eval: JSON.stringify — ненадёжный транспорт** (внешние
   кавычки + \-escaping). Проверки — sentinel-строки
   (expr ? "X_OK" : "X_BAD") + tr -d '"\\'; булевы факты, не структуры.
3. CONT-прогон после прерывания до гейтов: ОБЕ батареи перегонять целиком
   одним вызовом после ЛЮБОГО чикла правки (правило «фикс → батарея
   ЗАНОВО»), включая правки комментариев.
4. Диагностика по слоям (dev.log → код → od -c для байтов) отсекла все
   ложные FAIL первого прогона без единой правки кода приложения.
5. Уроки предыдущих блоков подтверждены: settle 15с на первый заход в
   next dev (Turbopack-HMR); aria-DOM вместо innerText; кнопка входа —
   aria «Войти в аккаунт»; CRON_SECRET извлекается в переменную внутри
   вызова и не печатается; хелперы/логи в /tmp; pkill строго по целевым
   шаблонам.

## Дальше по карте

- **S3B2** — фильтры/поиск/пагинация каталога: FilterSidebar + SearchStub
  — точки подключения; детальные маршруты карточек (ShopCard href уже
  опционален); перевод каталога на queries-слой.
- **S3B3** — полная SEO-генерация/OG: расширить каркас I1 (app-url,
  sitemap/robots, metadata на страницах).
- **S5** — кабинеты: (dashboard)-оболочка уже на единых header/footer с
  main#content; паттерн ListingShell переиспользуем.
- **S4/S6B1/S8B1/S9B1** — переносы из S2B4 без изменений (заказы/чаты с
  chat-attachments; cron-реестр со storage-cleanup; prod-переключение
  STORAGE_MODE=supabase + RLS sql + сильный CRON_SECRET).

## Аддендум: независимая верификация владельца-агента (2026-11-20)
- Независимая спот-верификация ПОСЛЕ R3-CONT нашла блокер, пропущенный гейтами: docs-коммит 246811b внёс в v2-worklog цитату arbitrary-класса футера с литеральным env(...) — Tailwind 4 сканирует все негитигнорированные файлы репо (включая worklog.md в корне) и сгенерировал из цитаты невалидное CSS-правило → PostCSS parse error в globals.css → HTTP 500 на ВСЕХ маршрутах (гейты субагента прошли до записи worklog; после docs-коммита пересборку никто не проверял).
- Исправлено коммитом c4c90d5: (1) цитата в worklog развалена пробелом — кандидат больше не существует; (2) defense in depth — globals.css получил директиву source-not для всех md-файлов репо (worklog/docs/README исключены из скана Tailwind навсегда).
- Переверифицировано независимо: lint/tsc 0; свежий boot; 0 CSS-ошибок в dev.log; 11/11 маршрутов 200; каталог — реальные данные из БД; sitemap 12 URL; robots Disallow /dashboard; /api/diag/seed-check 404; регрессия auth/CSRF/session/files — PASS.
- Артефакт: /home/z/my-project/backups/conditera-v2-S3B1-fix-c4c90d5.bundle (verify OK, полная история). Итоговый HEAD v2: c4c90d5.
- Новый урок: любой коммит md-файлов рядом с исходниками требует пересборочной проверки (health + страница); цитаты классов в документации ломают сборку через tailwind-скан; пара «скобка+m» в плоском тексте теряется при транспорте — байты проверять od -c/python, а найденное «pb-ax» в терминале не является реальным содержимым файла.
