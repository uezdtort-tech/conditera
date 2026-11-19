# S1B1-R — zai-code — пересоздание каркаса CONDITERA v2 (recreate-2)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены, коммит + bundle созданы.

## Контекст
Второе пересоздание блока S1B1 после инцидента D13 №4 (boot-restore 2026-11-19
уничтожил предыдущий v2-репо с 7 коммитами S1B1–S2B4). Исполнено по промпту
docs/rebuild/prompts/S1B1-scaffold.md + DECISIONS.md (13+Mailpit №14) + отчёту
S1B1-R предыдущего исполнения (все критические уроки применены).

## Артефакты
- Корень: /home/z/my-project/conditera-v2 (вложен в my-project — переживает recycle).
- Коммит: eb49d6f, ветка main, дерево чистое (39 файлов).
- Bundle: /home/z/my-project/backups/conditera-v2-S1B1-eb49d6f.bundle (87796 B, verify OK).
- worklog.md в корне v2 — полная запись (10 отклонений + переносы + 7 уроков).
- Скриншоты: agent-ctx/s1b1-v2-desktop-1440.png, agent-ctx/s1b1-v2-mobile-390.png.

## Стек (пины версии — не менять без надобности)
next@16.4.6, react@19.3.0, typescript@5.9.3 (strict+noImplicitOverride+
noUncheckedIndexedAccess), tailwindcss@4.3.5, eslint@9.39.5 (+config-next 16,
БЕЗ FlatCompat), vitest@5.1.1, prisma+client@6.19.3, zustand@5.1.0,
@supabase/supabase-js@2.119.2, @supabase/ssr@0.12.7, lucide-react, cva,
@radix-ui/react-slot.

## Что готово для следующих блоков
- S1B2 (БД): src/lib/db.ts — контракт PrismaLike + pingDatabase
  ("ok"|"unavailable"|"not-configured"); scripts db:setup/db:push — эхо-заглушки;
  prisma/ пуст. Embedded PG :54330 (CONDITERA_PG_PORT).
- S1B3 (дизайн-система): globals.css перенесён ЦЕЛИКОМ (1347 строк);
  shadcn New York (button, card); шрифты Geist (+Geist Mono); бренд-шрифты
  старого проекта (Brokgauz/TriodPostnaja/Neucha) НЕ перенесены — решение
  на S1B3.
- S2B1 (auth): src/lib/supabase/{browser,server,admin}.ts — заглушки (null
  без env); DEV_AUTH_SHIM=1 → health auth:"ok".
- S3B* (маршруты): (public)/(dashboard) группы готовы, header/footer — заглушки.

## Health-контракт (зафиксирован)
- 200 + degraded при database:"not-configured" (dev-каркас, не ошибка).
- 503 + degraded ТОЛЬКО при database:"unavailable" (SELECT 1 не прошёл).
- auth: DEV_AUTH_SHIM=1 → "ok"; иначе живая проба GoTrue 2s → ok/unreachable.
- storage: STORAGE_MODE=local → "local"; иначе проба → ok/unreachable.
- n8n: fail-open "unavailable".

## Гейты (результат этого исполнения)
- lint: 0 ошибок; tsc --noEmit: 0 ошибок.
- boot :3100 → Ready 368ms; GET /api/health 200 (degraded, подписанные notes);
  GET / 200.
- agent-browser: рендер ок; тема click→dark, reload→dark (persist);
  localStorage conditera-storage = {"state":{"theme":"dark"},"version":0};
  mobile 390px — footerBottom == docH (1293, прижат), scrollH > vh (push
  естественный); page errors — пусто.

## Критические уроки (добавились к S1B1-R №1–6)
7. Cron-хилы (runtime-watch) могут рестартовать СТАРЫЙ проект с cwd текущей
   сессии → его stdout уходит в conditera-v2/dev.log. Строки с 54329/proxy.ts
   в нашем логе = чужой процесс; сверять по собственным строкам (Ready,
   порты, absence of proxy.ts).
8. eslint-config-next 16 — нативные flat-конфиги, FlatCompat ломается
   (circular structure); подключать напрямую import ... from "eslint-config-next/...".
