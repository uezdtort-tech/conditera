# S1B3-R — zai-code — дизайн-система 2025 + полный shadcn-набор + /styleguide (recovery)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Ре-исполнение блока S1B3 после recycle песочницы, поверх S1B1-R (f4038b6) + S1B2-R (7fcf60b).
Спек: docs/rebuild/prompts/S1B3-design-system.md; приоритет: docs/rebuild/DECISIONS.md.
Корень: /home/z/my-project/conditera-v2; dev-порт 3100; все команды `env -u DATABASE_URL`.

## Что готово для следующих блоков (S3–S7)
- Коммит: **3e43022** (`[S1B3] design-system: tokens, wrappers, full shadcn set, /styleguide
  (recovery)`), ветка main, дерево чистое.
- Bundle: /home/z/my-project/backups/conditera-v2-S1B3-3e43022.bundle (187419 bytes, verify OK,
  полная история).
- **UI-набор полон**: @/components/ui — button, card, badge, label, input, textarea, select,
  checkbox, switch, tabs, table, dialog, sheet, dropdown-menu, tooltip, avatar, separator,
  skeleton, sonner (Toaster смонтирован в root layout). Нов York, скопированы из старого
  проекта (read-only) без next-themes/indigo-blue.
- **Обёртки**: @/components/pages — PageHeader (fade-up h1 + actions), ShopCard (card-hover,
  бейджи, цена, meta/footer-слоты), SectionHeading, EmptyState (иконка + CTA), StatCard,
  SafeImage (fallback на битые URL). Плюс styleguide-demo.tsx.
- **Style guide**: /styleguide (src/app/(public)/styleguide/page.tsx) — 11 секций: токены,
  типографика, кнопки, бейджи, карточки, формы, оверлеи, табы/таблица/длинный список,
  состояния, тёмная тема, motion. Dev-only ссылка в футере (NODE_ENV !== "production").
- **globals.css**: проверен целиком (30+ утилит на месте: card-hover, fade-up,
  btn-primary-gradient, mesh-gradient, tile-tint-1..8, glass-card, text-gradient,
  scrollbar-thin…), .dark покрывает все 21 семантическую переменную; ДОБАВЛЕНЫ только
  анимации для radix-оверлеев (slide-in-from-top/left-2, sheet-in/out-* — tw-animate-css в v2
  нет, замена hand-rolled по паттерну старого проекта).
- **Тема проверена браузером**: ThemeToggle → html.dark; localStorage
  `{"state":{"theme":"dark"},"version":0}`; restore после reload — работает.

## Ключевые решения (для наследующих блоков)
1. **allowedDevOrigins в next.config.ts** (глоб-фикс каркаса): Next 16 dev блокировал
   dev-ресурсы (/_next/hmr, /__nextjs_font) для origin 127.0.0.1 → hydration не проходила,
   ВСЕ клиентские обработчики были мертвы (включая тему S1B1). Вайтлист
   ["127.0.0.1","localhost"] обязателен; dev-only, prod не затрагивает. Диагностика:
   пустой localStorage + отсутствие __reactFiber$ на кнопках = hydration не прошел.
2. label/separator — hand-written версии S1B1 заменены на radix (отклонение S1B1 закрыто);
   checkbox добавлен сверх набора (нужен секции «Формы» style guide).
3. sonner.tsx: тема из useAppStore (zustand), НЕ next-themes — паттерн для любых
   theme-aware клиентских компонентов.
4. ShopCard рисует фото <img> + SafeImage-паттерн fallback: next/image ждёт remotePatterns
   от S2B4 (Storage). Для внутренних фото next/image доступен через SafeImage.
5. Мобильный overflow: grid-элементы с длинным nowrap-текстом раздували Card (min-width:auto
   grid item). Правило для S3+: min-w-0 на grid-детях / truncate-тексты; в демо решено
   [&>*]:min-w-0 + block truncate.
6. Форматирование цен/дат НЕ в обёртках: ShopCard/StatCard принимают готовые строки —
   money/date-утилиты приходят с блоками-владельцами (S4B*/S5B*).

## Критические уроки (обязательны к учёту)
1. **127.0.0.1 ≠ localhost для Next 16 dev** — см. п.1 решений; это был латентный баг
   каркаса S1B1, а не регрессия S1B3.
2. Урок S1B1 №4 повторился: `sheet-in-*/sheet-out-*` внутри block-комментария обрывал
   комментарий (eslint Parsing error). НЕ сажать `*/` в комментарии — переписывать текст.
3. Radix-анимации без tw-animate-css: каждый класс data-[state=*]:fade/zoom/slide-* должен
   быть определён в globals.css руками; порядок классов в CSS (не в HTML) решает, какая
   animation-name победит — принято как в старом проекте.
4. Health/db S1B2 не задет: {"status":"ok","database":"ok"} до и после всех правок.

## Гейты (все пройдены 2026-11-19)
1. bun add: @radix-ui/react-{dialog,dropdown-menu,select,tabs,switch,tooltip,avatar,
   separator,label,checkbox} + sonner@2.0.8 — 48 installed.
2. lint 0, tsc --noEmit 0.
3. Boot+verify одним вызовом: health 200 (database:"ok"); /styleguide 200 (холодный и
   тёплый); / 200; dev.log без compile errors.
4. agent-browser (спек §8): скриншоты light/dark/mobile (390px); toggle → dark + persist
   после reload; hover .card-hover → translateY(-3px); Dialog/Sheet/Select/Tooltip/toast
   открытие-закрытие-выбор работают; мобильная ширина — 1 колонка, без overflow, футер
   прижат.
5. git: коммит 3e43022; bundle verify OK.

## Артефакты
- Коммит: 3e4302257481a72bed58116e48eeab0668fe6d8f, ветка main, дерево чистое.
- Bundle: /home/z/my-project/backups/conditera-v2-S1B3-3e43022.bundle (187419 B, verify OK).
- worklog.md — полная запись S1B3-R (верификация globals.css, переносы, отклонения ×9,
  уроки ×4, гейты ×5, инструкция применения в S3–S7).

## Дальше
S2B1 (Supabase Auth: GoTrue-учётки Demo123! через Admin API), S3B1 (публичный каркас:
remove /api/diag/seed-check, легальные страницы — реш. №13), S3B2 (каталог: Meilisearch,
категории admin-managed — реш. №2/№12).
