# S1B3-R3 — zai-code — дизайн-система 2025 + полный shadcn + /styleguide (recreate-3)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Recreate-3 цепочки перед целевым блоком S2B1 (после инцидента D13 №5).
Исполнено поверх S1B1-R3 (1040b86) + S1B2-R3 (23b0c98, health
{"status":"ok","database":"ok"} — не задет). Спека:
docs/rebuild/prompts/S1B3-design-system.md. Ground truth — отчёт
S1B3-R-zai-code-recreate2.md (полный UI-набор, обёртки, styleguide
11 секций, решения 1–6, уроки 1–5) — решения воспроизведены.
Корень: /home/z/my-project/conditera-v2; dev-порт 3100; все команды
`cd /home/z/my-project/conditera-v2 && env -u DATABASE_URL`. Старый проект —
только чтение; из него СКОПИРОВАНЫ 18 shadcn ui-компонентов (прямое
разрешение промпта) + файлы шрифтов.

## Артефакты
- Коммит: **9879fe4** (9879fe44e5a82a9a13da3f2557160add299262d2)
  `[S1B3] design-system: full shadcn set, wrappers, /styleguide, radix-anim,
  allowedDevOrigins (recreate-3)`, ветка main, поверх 23b0c98, дерево чистое.
- Docs-коммит: **b16b5f8** `[S1B3] docs: worklog S1B3-R3 (sha/bundle pinned)`
  (worklog; sha/bundle запинены).
- Bundle: /home/z/my-project/backups/conditera-v2-S1B3-9879fe4.bundle
  (**561 875 bytes**), `git bundle verify`: ref refs/heads/main = 9879fe4,
  complete history — OK (содержит S1B1+S1B2+S1B3).
- worklog.md v2 — полная запись S1B3 (что сделано 8 пунктов, решения 3,
  гейты, артефакты).
- Скриншоты: agent-ctx/s1b3-r3-styleguide-light-1440.png,
  agent-ctx/s1b3-r3-styleguide-dark-1440.png,
  agent-ctx/s1b3-r3-styleguide-mobile-390.png (все — full-page, VLM-проверка
  читаемости малинового primary на обоих режимах пройдена).

## Что готово для следующих блоков
- **S2B1 (auth)** — целевой блок recreate-3: auth-modal строится на Dialog
  из набора (@/components/ui/dialog — fade+zoom, sm:max-w паттерн в
  styleguide §7); ThemeToggle готов для шапки после входа; sonner
  (richColors, top-right) и radix-toast — каналы уведомлений об
  успехе/ошибке входа; useAppStore (conditera-storage) — точка расширения
  сессии. Setup.mjs seedAuthUsers готов к GoTrue Admin API.
- **S3B1 (навигация)** — PageHeader/SectionHeading/EmptyState для
  контентных страниц; dev-ссылка /styleguide в футере уже смонтирована
  (NODE_ENV !== "production"); удалить /api/diag/seed-check (TODO-remove
  помечен в коде S1B2).
- **S3B2 (витрина/каталог)** — ShopCard ГОТОВ: href, imageSrc, imageAlt,
  title, description, badges (5 тонов), price/oldPrice — ГОТОВЫЕ строки
  (форматирование у S4B, S5B), author (avatar+verified), leadTime,
  actions-слот; grid-родитель — паттерн [&>*]:min-w-0. SafeImage —
  единая точка загрузки фото (next/image; remotePatterns внешних хостов —
  добавить при подключении Supabase Storage, S2B4).
- **S4B, S5B, дашборды** — StatCard (tabular-nums, тоны default/success/
  destructive), Tabs+Table с max-h-96 overflow-y-auto и overflow-x-auto
  паттернами, Skeleton, Dialog/Sheet/DropdownMenu/Tooltip для кабинетов.
- **Дизайн-контракт**: /styleguide — «живой» референс (11 секций,
  anchors #tokens … #motion); в production 404.

## Состав перенесённого (кратко)
- UI-набор (@/components/ui): button, card (из S1B1) + badge, label, input,
  textarea, select, checkbox, switch, tabs, table, dialog, sheet,
  dropdown-menu, tooltip, avatar, separator, skeleton, toast, toaster +
  @/hooks/use-toast + sonner (адаптирован: тема из useAppStore,
  next-themes УДАЛЁН). Radix-пины recreate-2 (dialog 1.1.14, dropdown-menu
  2.1.15, label 2.1.7, select 2.2.5, checkbox 1.3.2, switch 1.2.5, tabs
  1.1.12, tooltip 1.2.7, avatar 1.1.10, separator 1.1.7, toast 1.2.14);
  sonner 2.0.8.
- Обёртки (@/components/shared): page-header.tsx (PageHeader,
  SectionHeading, SectionLink), shop-card.tsx, empty-state.tsx,
  stat-card.tsx, safe-image.tsx.
- globals.css: .dark — программный diff со старым NONE (31 переопределение);
  анимации — @utility enter/exit через CSS-переменные --tw-* (fade+zoom+
  slide комбинируются; slide «-2» 10px; полноэкранные slide-in/out для
  Sheet; slide-*-full для toast-viewport); reduced-motion гварды
  (глобальный + локальные card-hover/fade-up) на месте; self-host Neucha
  (2 @font-face unicode-range cyrillic/latin) + :root --font-script.
- Шрифты: src/app/fonts/{Brokgauz_amp_Efron-Italic,TriodPostnaja-Medium}.ttf
  (next/font/local → --font-display/--font-brand, паттерн старого layout);
  public/fonts/neucha-{cyrillic,latin}.woff2. document.fonts: все 3 loaded.
- Демо-фото: public/images/styleguide/demo-{honey-cake,berry-tart}.png
  (AI, 1152x864, 89/171 KB — коммитятся); третий ShopCard показывает
  SafeImage fallback на битом src.

## Гейты (все пройдены 2026-11-19)
1. `env -u DATABASE_URL bun run lint` → 0 ошибок/0 предупреждений;
   `env -u DATABASE_URL bunx tsc --noEmit` → 0. PASS.
2. Boot одним батчем: PG :54330 (`env -u DATABASE_URL bun run db:setup` —
   идемпотентен, seed counts стабильны: profiles=7, products=20, …) +
   dev :3100 → /api/health 200 {"status":"ok","database":"ok","auth":"ok"
   (shim),"storage":"local","n8n":"ok","version":"0.1.0-s1b2"} (S1B2 не
   задет); /styleguide 200 + `<meta name="robots" content="noindex,
   nofollow">`; / 200 (40572 B). dev.log — только собственные строки.
   PASS.
3. agent-browser (свежая сессия после open): hover .card-hover → computed
   transform **matrix(1, 0, 0, 1, 0, -3)** (lift −3px) + малиновая обводка
   primary/0.3; stretched-link ::after absolute inset 0|0|0|0 на
   position:relative карточке; actions-слот z-index 10; ThemeToggle →
   html.dark=true + localStorage conditera-storage = {"state":{"theme":
   "dark"},"version":0}; reload → dark восстановлен (aria-pressed=true);
   Dialog/Sheet/DropdownMenu/Tooltip/radix-toast/sonner-toast — открытие
   и контент подтверждены (tooltip — реальным pointermove; Sheet —
   side right с 100% slide-анимацией); mobile 390: scrollWidth=390=
   clientWidth (без overflow), 3 ShopCard в 1 колонку; футер: длинная
   страница (/styleguide) — footerBottom=docHeight=9099 (низ контента),
   короткая (/dashboard) — прижат к 844px (pinned=true). PASS.
4. Тёмная тема: light/dark 1440 + mobile 390 full-page скриншоты;
   VLM-проверка: малиновый primary читаем на обоих режимах, тексты не
   теряют контраст (в dark — «серого-на-сером нет»), поломок рендера нет.
   PASS.
5. git: 9879fe4 + b16b5f8 (docs); bundle verify OK; дерево чистое.
   PASS.

## Ключевые решения (для наследующих блоков)
1. Анимации — @utility-директивы Tailwind 4 с ОДНОЙ парой keyframes
   enter/exit, управляемой CSS-переменными --tw-enter-*/--tw-exit-*:
   (а) variant-префиксы копируемых shadcn-компонентов
   (data-[state=open]:slide-in-from-right, data-[side=top]:
   slide-in-from-bottom-2, sm:slide-in-from-bottom-full) работают штатно —
   plain-CSS классы вариантов НЕ генерируют; (б) fade+zoom+slide
   комбинируются в одной анимации (у прежнего ручного блока S1B1
   animation-name перезаписывался — играл только один эффект);
   (в) семантика идентична tw-animate-css, чей @import несовместим с
   Turbopack (урок S1B1 сохранён). Длительности: 200ms вход / 150ms выход.
2. Брендовый шрифт демо — класс **.logo-text** (существующий контракт
   дизайн-системы), не несуществующий .font-brand: в старом проекте
   var(--font-brand) употребляется только через .logo-text (globals.css:
   548). Neucha — .font-script. h1/h2 получают Brokgauz автоматически
   через глобальный элементный селектор.
3. ShopCard: stretched-link (after:inset-0 у ссылки заголовка),
   actions-слот relative z-10; цена/oldPrice/leadTime — ГОТОВЫЕ строки
   (форматирование у S4B, S5B); grid-дети [&>*]:min-w-0 (урок recovery №5).
4. SafeImage без useEffect (recreate-2 решение №3 сохранено): failedSrc
   хранит ЗНАЧЕНИЕ битого src → смена src на другое значение даёт новую
   попытку, тот же битый URL не перезагружается; alt сохраняется на
   fallback (role=img aria-label).
5. Neucha self-host вместо next/font/google: woff2-сабсеты из кэша старого
   проекта (.next/dev/static/media) скопированы в public/fonts, подключены
   двумя @font-face с unicode-range — без сетевой зависимости на билде
   (следствие урока S1B1 «без сетевых загрузок шрифтов»).
6. Checkbox — сверх спеки (секция «Формы» styleguide); radio-group НЕ
   вводился — по мере нужды в S5B1/S5B2 (решение recreate-2 №5).

## Критические уроки (наследованные — сработали; НОВЫЕ)
1–5 recreate-2 (применены как профилактика): свежая сессия agent-browser
после открытия — гидрация прошла мгновенно (fiber-проблем не было — dev
не перезапускался); в комментариях блоки перечисляются через «, » (ни
одного Parsing error); networkidle не ждём (load + sleep); ВСЕ команды
`cd /home/z/my-project/conditera-v2 &&` + `env -u DATABASE_URL`; boot-проверки
одним батчем; чужой stdout в dev.log не диагностировать.
НОВЫЕ:
7. Tailwind 4: variant-префиксы (data-[state=*]:, sm:) НЕ работают с
   plain-CSS классами — только с @utility. Ручной «заменяющий» блок
   анимаций каркаса надо писать как @utility с общей парой keyframes
   enter/exit на CSS-переменных (иначе копируемые shadcn-компоненты
   молча теряют анимации оверлеев).
8. Не «додумывать» имена утилит дизайн-системы: класс .font-brand не
   существует (brand-шрифт живёт в .logo-text). Перед использованием
   утилиты из globals.css — проверять её наличие (rg) и факт применения
   (getComputedStyle через agent-browser; поймано: computed font-family
   оставался GeistSans).
9. Гладкий скролл (html scroll-behavior: smooth из дизайн-системы) ломает
   сценарии «scrollIntoView + мгновенный getBoundingClientRect» в
   agent-browser eval: координаты читать после sleep (~1.5s).
10. `find text` в agent-browser неточен при совпадении префикса («Radix-
    toast» vs «Radix-toast (ещё)»); надёжнее snapshot -i + клик по ref или
    find по уникальному тексту; selector для проверки radix-toast:
    [data-state=open][role=status] (у старых shadcn-компонентов нет
    data-slot=toast).

## Дальше по карте
- **S2B1 «Supabase Auth/GoTrue»** — ЦЕЛЕВОЙ блок recreate-3: Demo123! через
  Admin API (setup.mjs seedAuthUsers готов), привязка auth.users →
  profiles.userId, supabase-клиенты src/lib/supabase/*, auth-modal на
  Dialog из этого блока, refresh-сессия в proxy.ts, DEV_AUTH_SHIM=1 в
  .env.local.
- S2B2 (RBAC), S2B3 (security), S2B4 (Storage — remotePatterns для
  next/image).
- S3B1 (навигация): удалить /api/diag/seed-check (TODO-remove в коде).
- Перед каждым блоком: worklog.md корня v2 + отчёт agent-ctx; bundle в
  backups после КАЖДОГО коммита (урок S1B2 №7).
