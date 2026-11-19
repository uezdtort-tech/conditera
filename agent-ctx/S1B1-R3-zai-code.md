# S1B1-R3 — zai-code — пересоздание каркаса CONDITERA v2 (recreate-3)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Третье пересоздание блока S1B1 после инцидента D13 №5 (recycle песочницы
уничтожил v2-репозиторий). Цепочка recreate-3 перед целевым блоком S2B1.
Каталог /home/z/my-project/conditera-v2 перед работами ПУСТ (проверено, чужого
контента нет). Исполнено по prompts/S1B1-scaffold.md + DECISIONS.md
(№2/№4/№11/№14) + отчёту S1B1-R-zai-code-recreate2.md (ground truth) —
решения recreate-2 воспроизведены 1:1. Старый проект /home/z/my-project —
только чтение (globals.css, components.json, паттерны store/theme-toggle/
health/proxy); его процессы не тронуты (dev :3000 и PG :54329 работают).

## Артефакты
- Корень: /home/z/my-project/conditera-v2, ветка main.
- Коммит: 1040b86cc09b6f162936ab13b9b5028ee2bce774 (short 1040b86), 43 файла,
  дерево чистое (git status — 0 записей).
  Сообщение: "[S1B1] scaffold: Next 16 + TS strict + Tailwind 4 + shadcn
  (button/card), globals 2025, health-матрица, тема Zustand, env-соглашение
  (recreate-3)".
- Bundle: /home/z/my-project/backups/conditera-v2-S1B1-1040b86.bundle
  (97 586 bytes) — `git bundle verify`: "is okay", complete history, ref
  refs/heads/main = 1040b86.
- worklog.md в корне v2: полная запись блока (13 пунктов сделано,
  10 отклонений, гейты, уроки).
- Скриншоты: agent-ctx/s1b1-r3-desktop-1440.png (1440x900),
  agent-ctx/s1b1-r3-mobile-390.png (390x844).

## Стек-пины (воспроизведены с recreate-2, exact — не менять)
next@16.4.6, react@19.3.0 (+react-dom), typescript@5.9.3 (strict +
noImplicitOverride + noUncheckedIndexedAccess), tailwindcss@4.3.5 +
@tailwindcss/postcss@4.3.5, eslint@9.39.5 + eslint-config-next@16.4.6
(нативные flat-конфиги: import from "eslint-config-next/core-web-vitals" и
".../typescript"; FlatCompat НЕ используется), vitest@5.1.1 (раннер
passWithNoTests, тестов нет), prisma@6.19.3 + @prisma/client@6.19.3,
zustand@5.1.0, @supabase/supabase-js@2.119.2, @supabase/ssr@0.12.7,
lucide-react, class-variance-authority, @radix-ui/react-slot, clsx,
tailwind-merge, geist@1.9.2 (шрифты локальным пакетом — без сетевых загрузок
на билде). bun.lock закоммичен.

## Что готово для следующих блоков
- S1B2 (БД): prisma/ пуст (schema.prisma появится здесь); src/lib/db.ts —
  контракт PrismaLike + pingDatabase ("ok"|"unavailable"|"not-configured"),
  динамический импорт клиента с деградацией без генерации; scripts
  db:setup/db:push — эхо-заглушки (заменить реализацией); embedded PG :54330
  (CONDITERA_PG_PORT; compose-каркас под профилем supabase). После подключения
  DATABASE_URL health обязан дать database:"ok" → status:"ok".
- S1B3 (дизайн-система): globals.css 2025 перенесён ЦЕЛИКОМ (1347 строк,
  diff/md5 идентичны старому; токены, card-hover, fade-up,
  btn-primary-gradient, mesh-gradient, .dark 31 переопределение); shadcn
  New York (button, card) на месте, components.json как в старом проекте;
  шрифты Geist/Geist Mono подключены (пакет geist), бренд-шрифты
  Brokgauz/TriodPostnaja/Neucha НЕ перенесены — решение этого блока.
- S2B1 (auth): src/lib/supabase/{browser,server,admin}.ts — тонкие клиенты-
  заглушки (null без env, fail-closed; admin — ТОЛЬКО серверный код,
  isAdminConfigured()); DEV_AUTH_SHIM=1 уже в .env.local → health auth:"ok";
  cookie-адаптер @supabase/ssr (getAll/setAll) готов к наполнению; точка
  refresh-сессии — src/proxy.ts.
- S3B1/S3B* (маршруты): группы (public)/(dashboard) готовы с header/footer-
  заглушками; sticky-footer-скелет (body flex-col, main flex-1, footer
  mt-auto + safe-area) проверен браузером; home-заглушка показывает
  дизайн-систему.
- S2B3 (security): src/proxy.ts — минимальный pass-through (Next 16
  proxy-конвенция), CSRF/security headers навесить здесь.

## Health-контракт (зафиксирован, воспроизведён с recreate-2)
- Top-level решает ТОЛЬКО БД: database ok → 200 {"status":"ok"};
  not-configured (нет DATABASE_URL) → 200 + degraded (dev-каркас,
  подписанные notes); unavailable (SELECT 1 fail, гард 3s) → 503 + degraded.
  Когерентность 503↔degraded гарантирована конструкцией (один источник —
  pingDatabase в src/lib/db.ts).
- auth: DEV_AUTH_SHIM=1 → "ok"; иначе живая проба GoTrue
  GET {URL}/auth/v1/health 2s → ok/unreachable.
- storage: STORAGE_MODE=local → "local"; иначе проба
  GET {URL}/storage/v1/status 2s → ok/unreachable.
- n8n: проба N8N_BASE_URL или :5678, 1.5s, fail-open "unavailable"
  (любой HTTP-ответ = жив).
- Тело: status, app, database, auth, storage, n8n, version (0.1.0-s1b1),
  timestamp, environment, notes[] (подписанные dev-состояния).

## Гейты (результаты recreate-3)
1. lint/tsc: `env -u DATABASE_URL bun run lint` → exit 0 (0 ошибок);
   `env -u DATABASE_URL bunx tsc --noEmit` → exit 0. Повторно прогнано и
   после коммита — чисто. PASS.
2. Boot одним батчем: `env -u DATABASE_URL bun run dev` (фон, :3100) —
   Ready in 279ms, в dev.log только собственные строки (Local: 3100, чужих
   54329 нет). GET /api/health → 200 {"status":"degraded",
   "database":"not-configured","auth":"ok" (shim),"storage":"local" (adapter),
   "n8n":"ok" (слушатель :5678), notes подписаны}. GET / → 200 (38723 B).
   GET /dashboard → 200. PASS.
3. agent-browser (сессия закрыта/открыта заново после boot): home рендер,
   page errors — ПУСТО, консоль чиста (только React DevTools info + HMR);
   ThemeToggle click → html.dark=true; localStorage conditera-storage =
   {"state":{"theme":"dark"},"version":0}; reload → dark сохранён; mobile
   390px: home scrollWidth=390 (=innerWidth, overflow нет), docHeight 1666 >
   vh 844, footerBottom 1663 ≈ docHeight (push естественный); /dashboard
   (короткая): docHeight 844 == vh, footerBottom 844 — футер прижат;
   скриншоты сохранены (см. Артефакты). PASS.
4. Тесты НЕ писались; пуш/деплой НЕ выполнялся. PASS (по правилам блока).

## Критические уроки (новые к 1–8 recreate-1/2)
Новых критических НЕТ — все 8 предыдущих сработали как профилактика:
env -u DATABASE_URL на каждой команде; flat-конфиги eslint напрямую;
никаких "звёздочка-слэш" в комментариях; boot одним батчем bash;
браузерная сессия reopen после рестарта dev-сервера; turbopack.root
зафиксирован в next.config.ts; порты 3100/54330, 3000/54329 не трогаем;
пины exact.

Наблюдения (не критические):
9. Порт :5678 в песочнице занят слушателем bun (dev-хил старого проекта) —
   health n8n-проба честно отдаёт "ok" (проба отличает только
   «отвечает/не отвечает»). Для S8B2: при необходимости различать настоящий
   n8n от заглушки — усилить пробу (например, GET /healthz n8n с проверкой
   тела), сейчас контракт recreate-2 сохранён.
10. `bun install` с exact-пинами прошёл с первого раза (8s, 435 пакетов),
    версии совпали с recreate-2 вплоть до micro-версий — пин-лист
    воспроизводим.
11. Скрипт init-fullstack среды сознательно НЕ запускался (нацелен на
    read-only старый проект); v2 собирается как независимый bun-проект.
    Зафиксировано в worklog.md (отклонение №10).

## Дальше по карте
- Следующий блок: S1B2 «Единая схема данных (Prisma)» — prompts/
  S1B2-database.md; зависимости закрыты (S1B1 готов: контракт db.ts,
  health-переход на "ok", порты/соглашения зафиксированы).
- Параллельно возможен S1B3 «Дизайн-система 2025 + тема» (зависит только от
  S1B1): расширение shadcn-набора, решение по бренд-шрифтам.
- После S1B2 → S2B1 (Supabase Auth/GoTrue): наполнять клиенты
  src/lib/supabase/*, refresh-сессию в proxy.ts, dev-шим по DEV_AUTH_SHIM.
- Перед каждым блоком читать DECISIONS.md и worklog.md корня v2.
