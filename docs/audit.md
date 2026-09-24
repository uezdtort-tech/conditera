# Audit — «Уездный кондитер» v2.0

**Дата:** 19 августа 2026
**Аудитор:** Super Z (AI Principal Engineer)
**Версия кода:** v2.0 (после 7 этапов миграции на Supabase)

---

## 1. Архитектурный аудит

### Что работает хорошо
- Next.js 16 App Router с SSR/SSG — корректно настроен
- Supabase инфраструктура: docker-compose.supabase.yml с 10 сервисами
- 9 SQL миграций (0001-0009) — 55 таблиц, 140+ RLS, 50+ триггеров
- @supabase/supabase-js + @supabase/ssr — сохранены в package.json
- Prisma полностью удалена из package.json
- 10 Edge Functions (соответствует ТЗ)
- 96 React hooks (10 файлов) — supabase-js прямые запросы
- TanStack Query для кэширования, loading/error states
- Realtime на chat + negotiations + tickets (postgres_changes)
- CI/CD: deploy.yml + deploy.sh + health-check.sh

### Проблемы (legacy)
- **250 файлов с @ts-nocheck** — старые v1.0 API routes используют Prisma-стиль `db.model.findMany()` через compatibility shim
- **db.ts — compatibility shim** реэкспортирует supabaseAdmin, но старые routes вызывают `db.confectioner.findUnique()` (Prisma синтаксис, не работает на supabase)
- **Отсутствует composable architecture** (раздел 37) — монолитные компоненты, нет чётких границ модулей
- **Нет Design Tokens** (раздел 39) — значения hardcoded в Tailwind классах

### Рекомендации
1. Мигрировать 250 @ts-nocheck файлов на supabase-js (постепенно, по 10 в день)
2. Создать Design Tokens в globals.css
3. Разбить монолитные дашборды на composable modules

---

## 2. UX аудит

### Что работает хорошо
- Конструктор тортов (8 шагов, 3D-превью, скидки) — 95% готов
- AuthModal с email/pass, OAuth, Magic Link — 85% готов
- 5 дашбордов на supabase-js — 95% готов
- 29 публичных страниц — 90% готовы
- Loading states (LoadingState skeleton) + Error states (ErrorState с retry)
- EmptyState компонент существует

### Проблемы (UX)
- **Нет Discovery-first UX** (раздел 2) — главная страница не помогает "исследовать, вдохновляться"
- **Нет Intent-based search** (раздел 3) — только классический поиск
- **Нет AI Shopping Assistant** (раздел 5) — нет UI интеграции
- **Нет Visual Discovery** (раздел 7) — нет masonry, editorial collections, stories
- **Нет Shoppable Video** (раздел 8) — таблица есть, UI нет
- **Нет Sustainability/Eco** (раздел 22-25) — полностью отсутствует
- **Нет Zero-result Experience** (раздел 64) — показывается "Ничего не найдено"
- **Нет Optimistic UI** (раздел 75) — частично в ProfileSettings
- **Нет Offline/Degraded Mode** (раздел 67) — отсутствует

### Рекомендации
1. Переработать главную страницу (Discovery-first)
2. Добавить Intent Chips + AI Search Bar
3. Создать ZeroResult компонент
4. Добавить Eco Score / Sustainability Panel
5. Интегрировать @mdxeditor для CMS (WYSIWYG)

---

## 3. Security аудит

### Что работает хорошо
- RLS на всех 55 таблицах (140+ политик)
- CSRF protection (timing-safe, double-submit cookie)
- CSP, HSTS, X-Frame-Options, Permissions-Policy
- Rate limiting на auth endpoints
- Prisma safeSelect → Supabase RLS
- HttpOnly cookies для auth tokens
- Stub mode для dev (не падает без БД)

### Проблемы (Security)
- 250 @ts-nocheck файлов — TypeScript типы отключены, нет compile-time проверки
- Нет 2FA UI (TOTP setup flow) — GoTrue поддерживает, но UI не реализован
- Нет Rate limiting на payment endpoints (только auth)

### Рекомендации
1. Убрать @ts-nocheck → строже security через типы
2. Создать 2FA setup UI
3. Добавить rate limiting на /api/payment/*, /api/checkout

---

## 4. Performance аудит

### Что работает хорошо
- Build: ✓ Compiled successfully in 56s
- Code-splitting: дашборды через next/dynamic
- TanStack Query: staleTime 30s, кэширование
- Image optimization: next/image с qualities [70, 75, 80, 90]
- 176 static pages prerendered

### Проблемы (Performance)
- **OOM при next dev** — Turbopack потребляет 2.5GB RAM (контейнер 4GB)
- **Нет Performance Budget** (раздел 68) — не определены метрики
- **Нет Lazy-load video** (раздел 8) — product_videos не загружаются lazily
- **Нет prefers-reduced-motion** (раздел 40) — анимации не отключаются

### Рекомендации
1. Определить Performance Budget: LCP < 2.5s, FID < 100ms, CLS < 0.1
2. Добавить prefers-reduced-motion media query
3. Lazy-load video через Intersection Observer

---

## 5. Accessibility аудит

### Что работает хорошо
- shadcn/ui компоненты (Radix-based, accessible)
- ARIA labels в Dialog (DialogTitle sr-only)
- Семантический HTML (header, main, footer)
- alt-text на изображениях

### Проблемы (Accessibility)
- **Нет Accessibility Testing** (раздел 71) — axe-core не настроен
- **Нет keyboard navigation testing** — не проверено tab order
- **Нет screen reader testing** — не проверено с NVDA/VoiceOver
- **Нет focus management** в Cake Builder Dialog

### Рекомендации
1. Установить @axe-core/playwright
2. Добавить axe checks в e2e тесты
3. Проверить keyboard navigation на всех страницах

---

## 6. Список legacy/problematic решений

| # | Решение | Проблема | Решение |
|---|---|---|---|
| 1 | Prisma compatibility shim в db.ts | Старые routes не работают без Prisma | Мигрировать на supabaseAdmin |
| 2 | 250 файлов @ts-nocheck | Нет типизации | Убрать поэтапно |
| 3 | MOCK_ данные в старых компонентах | Фейковые данные в UI | Заменить на supabase-js |
| 4 | useAppStore (Zustand) | Локальный state вместо Supabase | Мигрировать на useAuth() |
| 5 | 119 старых dashboard файлов | @ts-nocheck, MOCK данные | Заменить на v2 |
| 6 | n8n dashboard (773 строки) | n8n удалён, dashboard остался | Заменить на scheduled_jobs |
| 7 | PGlite references в config | PGlite удалён | Очистить prisma.config.ts |

---

## 7. Список возможностей модернизации

| # | Возможность | Раздел МП | Приоритет |
|---|---|---|---|
| 1 | Discovery-first главная страница | 2 | HIGH |
| 2 | AI Shopping Assistant UI | 5 | HIGH |
| 3 | Intent-based search | 3 | MEDIUM |
| 4 | Visual Discovery (masonry, stories) | 7 | MEDIUM |
| 5 | Shoppable Video UI | 8 | MEDIUM |
| 6 | Sustainability/Eco Score | 22-25 | MEDIUM |
| 7 | Design Tokens | 39 | HIGH |
| 8 | Zero-result Experience | 64 | LOW |
| 9 | Optimistic UI везде | 75 | LOW |
| 10 | Performance Budget | 68 | MEDIUM |
| 11 | Accessibility testing | 71 | MEDIUM |
| 12 | Composable architecture | 37 | LOW |
