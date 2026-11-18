# ПРОМПТ S1B1 — Каркас проекта и гейты качества

Этап 1 «Фундамент» | Блок 1. Зависимости: S0B2 (spec-registry.md).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — senior fullstack-разработчик, разворачиваешь чистый каркас проекта
CONDITERA v2 в `/home/z/conditera-v2`.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict. bun — пакетный менеджер и
  раннер: `bun run dev` (порт 3000), `bun run lint`, `bunx tsc --noEmit`.
- Tailwind CSS 4 + shadcn/ui (стиль New York, иконки Lucide). Запрещены
  indigo/blue оттенки вне явного запроса владельца.
- Данные: Prisma ORM — единственный контур записи app-данных
  (prisma/schema.prisma). Локальная БД: embedded PostgreSQL :54329
  (скрипты — блок S1B2, здесь не нужен). Server actions запрещены —
  только Route Handlers.
- Supabase (указание владельца): Auth + Storage через
  @supabase/supabase-js и @supabase/ssr; клиенты подключаются
  в этом блоке (наполнение — S2B1/S2B4).
- UI: дизайн-система 2025 (токены в globals.css, `card-hover`, `fade-up`,
  `btn-primary-gradient`); mobile-first; sticky footer: корневой wrapper
  `min-h-screen flex flex-col`, футеру `mt-auto` + safe-area inset; длинные
  списки `max-h-96 overflow-y-auto`; семантические теги + ARIA.
- Тема: Zustand persist (ключ `conditera-storage`, поле `state.theme`).
- Процесс: один блок = один коммит `[S1B1] ...`; верификация: tsc → vitest →
  agent-browser; запись в worklog.md; тесты не писать.
- Безопасность: секреты только через env; не печатать содержимое .env*.
- Запреты: не трогать production/Docker-секреты; не пушить/не деплоить;
  старый проект /home/z/my-project — только чтение.

## 3. ЦЕЛЬ БЛОКА
Рабочий пустой каркас: инициализация, структура каталогов, env-соглашения,
гейты качества (lint/tsc), health-эндпоинт, базовая обёртка layout с темой и
sticky-footer, CI-ready скрипты.

## 4. ШАГИ
1. Инициализировать Next.js 16 проект в /home/z/conditera-v2 (bun create
   next-app, TypeScript, App Router, Tailwind CSS 4, ESLint, src/ каталог).
   Добавить shadcn/ui (New York), Lucide; поставить @supabase/supabase-js
   и @supabase/ssr; создать src/lib/supabase/{browser,server,admin}.ts —
   тонкие клиенты-заглушки (наполняются в S2B1/S2B4).
2. Структура каталогов (создать с .gitkeep, где пусто):
   - src/app/(public)/ — публичные маршруты (наполнят S3B*);
   - src/app/(dashboard)/ — кабинеты (S5B*);
   - src/app/api/ — Route Handlers;
   - src/components/{ui,pages,dashboard,layout,ai};
   - src/lib/{db,auth,ai,validation,utils}.ts (заглушки-экспорты);
   - scripts/db/ (заглушки под S1B2);
   - docs/, logs/agent/, prisma/.
3. env-соглашение: создать `.env.example` (только имена ключей с
   комментариями): DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
   NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
   SUPABASE_JWT_SECRET, DEV_AUTH_SHIM, STORAGE_MODE, CRON_SECRET,
   N8N_WEBHOOK_BASE_URL, OLLAMA_BASE_URL, OLLAMA_MODEL,
   AI_PROVIDER_ORDER, AI_ZAI_MODEL, AI_TEMPERATURE, AI_MAX_TOKENS,
   NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_YANDEX_METRIKA_ID,
   YANDEX_METRIKA_OAUTH_TOKEN, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY,
   TELEGRAM_BOT_TOKEN. Проверить, что .env* в .gitignore.
4. Health-эндпоинт `src/app/api/health/route.ts`: GET → JSON
   {status: "ok"|"degraded", app, database, auth, storage, n8n, version,
   timestamp, environment}. Логика: db=true → ok; иначе 503+degraded
   (когерентность кода и тела — урок старого проекта). auth/storage —
   probe Supabase с таймаутом 2s; если ключи не заданы/сервис недоступен
   → "unreachable" (допустимое dev-состояние, явно подписанное в ответе;
   при DEV_AUTH_SHIM=1/STORAGE_MODE=local — проверяется шим/adapter).
   Проверка БД — SELECT 1 через prisma (заглушка: если DATABASE_URL нет →
   "not-configured").
5. Корневой layout: `<html lang="ru">`, ThemeProvider (Zustand persist,
   ключ `conditera-storage`, поле state.theme, class на <html>), шапка и
   футер-заглушки, корневой wrapper `min-h-screen flex flex-col`, футер
   `mt-auto pb-safe` (safe-area). Строгий запрет next-themes.
6. Скрипты package.json: dev (next dev -H 0.0.0.0 -p 3000), build, start,
   lint, typecheck (tsc --noEmit), test (vitest run), db:setup/db:push
   (заглушки под S1B2). Vitest — настроить (без тест-файлов, просто раннер).
7. ESLint: включить строгие правила Next; исключить из гейта только
   future-experiments каталоги. Убедиться: `bun run lint` — 0 ошибок.
8. worklog.md в корне v2: первая запись (Task ID: S1B1, дата, что сделано).
9. Первый коммит `[S1B1] scaffold: Next16+TS+Tailwind4+shadcn, health,
   theme-shell, gates`.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА (только чтение)
- `src/app/api/health/route.ts` — паттерн матрицы зависимостей и
  когерентности 503↔degraded (сокращённую версию);
- `src/components/layout/theme-toggle.tsx` + `src/lib/store.ts` — паттерн
  темы (Zustand persist, conditera-storage);
- `src/app/globals.css` — ПОЛНЫЙ блок токенов и утилит дизайн-системы 2025
  (card-hover, fade-up, btn-primary-gradient, mesh-gradient) — скопировать
  как есть, это переносимая ценность;
- README старого проекта — список портов/соглашений.

## 6. ЗАПРЕТЫ
- Не подключать БД-схему и сиды (это S1B2).
- Не создавать страницы-маршруты контента (S3B*).
- Не писать тест-код.
- Не использовать indigo/blue, next-themes, server actions.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] `bun run dev` поднимается на :3000 без ошибок в логе;
- [ ] GET /api/health → 200 {"status":"ok",...} с компонентами
      app/database/auth/storage/n8n (503 degraded до БД — когерентно;
      auth/storage "unreachable" в dev — подписанное состояние);
- [ ] Тема переключается (светлая/тёмная), ключ localStorage —
      conditera-storage;
- [ ] Футер прижат к низу при короткой странице;
- [ ] `bunx tsc --noEmit` — 0 ошибок; `bun run lint` — 0 ошибок;
- [ ] Коммит [S1B1] создан, worklog.md дополнен.

## 8. ВЕРИФИКАЦИЯ (agent-browser)
- Открыть / — страница рендерится, консоль без ошибок;
- Переключить тему → класс на html меняется, перезагрузка сохраняет;
- Проверить mobile-ширину 390px — вёрстка не ломается, футер прижат.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S1B1], запись в worklog.md (что перенесено из старого: список).
- Отчёт владельцу: структура каталогов, как проверить, что каркас жив.
