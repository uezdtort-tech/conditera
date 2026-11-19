# S1B3-R — zai-code — дизайн-система 2025 + полный shadcn + /styleguide (recreate-2)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Пересоздание №2. Исполнено поверх S1B1 (eb49d6f) + S1B2 (e5ab8ba, health
database:"ok" — не задет). Спек: docs/rebuild/prompts/S1B3-design-system.md.
Референсы прошлого исполнения: agent-ctx/S1B3-R-zai-code.md (recovery) и
agent-ctx/2-S1B3-design-system-zai-code.md (первое) — оба уцелели и были
использованы для точного воспроизведения решений.
Корень: /home/z/my-project/conditera-v2; dev-порт 3100; все команды
`env -u DATABASE_URL`.

## Артефакты
- Коммит: **224f514** `[S1B3] design-system: full shadcn set, wrappers,
  /styleguide, radix-anim, allowedDevOrigins (recreate-2)`, ветка main.
- Docs-коммит: 840e38e (worklog — sha/bundle запинены).
- Bundle: /home/z/my-project/backups/conditera-v2-S1B3-224f514.bundle
  (444162 B, verify OK — полная история main; содержит [S1B1]+[S1B2]+[S1B3]).
- Скриншоты: agent-ctx/s1b3-v2-styleguide-{light,dark}-1440.png,
  agent-ctx/s1b3-v2-styleguide-mobile-390.png.

## Что готово для S3–S7
- **UI-набор полон** (@/components/ui): button, card, badge, label,
  input, textarea, select, checkbox, switch, tabs, table, dialog, sheet,
  dropdown-menu, tooltip, avatar, separator, skeleton, toast+toaster,
  sonner (адаптирован: тема из useAppStore; next-themes УДАЛЁН).
  Radix-пины — как в старом проекте; sonner 2.0.8.
- **Обёртки** (@/components/shared): PageHeader (fade-up h1 + eyebrow +
  actions), SectionHeading, ShopCard (card-hover, SafeImage 4/3
  hover-scale, бейджи, цена/oldPrice, author, leadTime, actions-слот),
  EmptyState (пунктир + иконка + CTA), StatCard (tabular-nums, 3 tone),
  SafeImage (client; mesh-gradient + CakeSlice fallback, alt сохранён).
  Цены/даты — ГОТОВЫЕ строки (форматирование у S4B/S5B).
- **Style guide** /styleguide: 11 секций (токены, типографика, кнопки,
  бейджи, карточки, формы, оверлеи, табы/данные, обратная связь, тема,
  motion). robots noindex+nofollow; notFound() в production; dev-ссылка
  в футере (NODE_ENV !== "production"). Демо-фото: public/images/
  styleguide/demo-{honey-cake,berry-tart}.png (AI, коммитятся).
- **globals.css**: .dark — те же 31 переопределение, что в старом
  (программный diff: NONE); theme-agnostic токены (spacing/типографика/
  радиусы) намеренно общие; ручной блок анимаций дополнен slide-2 и
  полноэкранными slide-in/out (Sheet, toast-viewport); reduced-motion
  гварды (глобальные + локальные) на месте.
- **Toaster-ы смонтированы** в root layout: radix + sonner (top-right,
  richColors). Канал уведомлений готов к вызовам из S3–S7.
- **allowedDevOrigins** ["127.0.0.1","localhost"] в next.config.ts —
  урок S1B3-R №1 перенесён в каркас recreate-2.

## Гейты (результат, 2026-11-19)
1. lint 0 ошибок; tsc --noEmit 0 (env -u DATABASE_URL).
2. Boot+verify одним батчем: PG:54330 setup идемпотентен; /api/health
   200 {"status":"ok","database":"ok"} (S1B2 не задет); /styleguide 200
   + meta noindex; / 200.
3. agent-browser (спека §8): hover .card-hover → transform
   matrix(1,0,0,1,0,-3) (lift −3px) — подтверждено computed style;
   ThemeToggle → html.dark + localStorage
   {"state":{"theme":"dark"},"version":0}; reload → dark восстановлен;
   Dialog/Sheet/DropdownMenu/Tooltip/sonner-toast — открытие и контент
   подтверждены (tooltip — только реальным pointermove); mobile 390:
   scrollWidth=390 (без overflow), карточки в 1 колонку; футер: длинная
   страница — низ контента, короткая — прижат к 844±3px.
4. Тёмная тема: контраст пар текст/фон — визуальная проверка
   light/dark скриншотов (малиновый primary читаем на обоих режимах).
5. git: 224f514 + 840e38e; bundle verify OK; дерево чистое.

## Ключевые решения (для наследующих блоков)
1. Обёртки в src/components/shared/ (выбор первого исполнения; recovery
   клал их в components/pages — семантически хуже для общих компонентов).
2. ShopCard: ссылка-заголовок растягивается after:inset-0 (stretched-
   link), actions-слот z-10 — кликабельны кнопки. Мин. паттерн для
   grid-детей: [&>*]:min-w-0 (урок recovery №5 сохранён).
3. SafeImage без useEffect: битый src хранится по значению (failedSrc) —
   react-hooks/set-state-in-effect (новое правило lint React 19)
   запрещает setState внутри effect-тела.
4. use-toast.ts: actionTypes-const удалён (no-unused-vars: used-only-as-
   type); Action определён литеральными union-типами — поведение прежнее.
5. Checkbox добавлен сверх спеки (секция «Формы» styleguide); radio-group
   не вводился — по мере нужды в S5B1/S5B2.
6. Типографика h1/h2 — брендовая антиква (Brokgauz italic, fallback
   Georgia) — из globals.css 2025; это НАМЕРЕННО, не баг рендера.

## Критические уроки (обязательны к учёту)
1. СТАРАЯ СЕССИЯ agent-browser переживает смерть dev-сервера: после
   перезапуска сервера на её странице гидрация НЕ проходит (fiber=0 на
   всех узлах, localStorage пуст), хотя HMR «connected» и сервер отдаёт
   валидный HTML. Лечение: agent-browser close + повторный open —
   гидрация мгновенно работает. Правило: после рестарта dev-сервера
   пересоздавать сессию браузера. (Первично диагностировалось как
   allowedDevOrigins — ложный след.)
2. Урок «asterisk slash внутри block-комментария» повторился ТРИЖДЫ в
   истории: stat-card «S4B*/S5B*» → Parsing error. Правило: в
   комментариях НЕ писать звёздочку перед слэшем; перечислять блоки
   через «, ».
3. networkidle в dev недостижим (HMR) — ждать --load load + sleep.
4. Persistent-shell cwd сбрасывается при смерти сессии: относительные
   git-команды могут уйти в ЧУЖОЙ репо (/home/z/my-project — его git log
   содержит UUID-коммиты, что похоже на ложный D13-инцидент). Правило:
   ВСЕГДА `cd /home/z/my-project/conditera-v2 &&` в той же команде.
5. Уроки S1B2 (гард порта 54330, чужой stdout в dev.log) подтверждены
   — при boot-батче setup поднялся штатно на :54330.

## Дальше по карте
S2B1 (Supabase Auth: GoTrue-учётки Demo123! через Admin API; auth-шим
:3040 по решению владельца), затем S2B2 (RBAC), S2B3 (security),
S2B4 (Storage), S3B1 (навигация; удалить /api/diag/seed-check —
TODO-remove помечен в коде).
