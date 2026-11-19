# S1B1-R — zai-code — восстановление каркаса CONDITERA v2

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все 5 гейтов пройдены, коммит + bundle созданы.

## Контекст
Ре-исполнение блока S1B1 после recycle песочницы (старый v2-репозиторий утрачен).
Спек: docs/rebuild/prompts/S1B1-scaffold.md; приоритет: docs/rebuild/DECISIONS.md.
Корень: /home/z/my-project/conditera-v2 (вложен в my-project — переживает recycle).
Стек: Next.js 16.4.6 + TS 5.9.3 strict + Tailwind 4.3.5 + shadcn/ui (hand-written New York) + bun.

## Что готово для следующих блоков
- Каркас собран, гейты: lint=0, tsc=0, boot :3100, health 200, коммит f4038b6, bundle 94KB.
- Тема: zustand persist, ключ `conditera-storage`, поле `state.theme` (useAppStore в src/lib/store.ts; ThemeRegistry вешает класс dark на html; ThemeToggle в header). next-themes запрещён.
- Supabase: src/lib/supabase/{browser,server,admin}.ts — тонкие клиенты-заглушки, возвращают null без env. Наполнение — S2B1 (auth) / S2B4 (storage).
- БД: src/lib/db.ts — структурный контракт PrismaLike + pingDatabase() ("ok"|"unavailable"|"not-configured"); prisma@6.19.3 установлен, schema.prisma НЕТ — S1B2: создать схему, embedded PG :54330 (CONDITERA_PG_PORT), генерация клиента, реализовать scripts db:setup/db:push (сейчас эхо-заглушки).
- env-соглашение: .env.example — все ключи спека (+CONDITERA_PG_PORT, PAYMENT_MODE=STUB default). .env — только dev-дефолты, gitignored.
- docker-compose.local.yml — скелет (n8n :5678, supabase-стек, meilisearch :7700, профиль local-stack, без пуллов) — S8B2/S9B1.
- Дизайн-система 2025: globals.css скопирован из старого проекта ЦЕЛИКОМ (1347 строк: card-hover, fade-up, btn-primary-gradient, mesh-gradient, tile-tint-*, scroll-стили) — можно сразу использовать в S1B3/S3B*.

## Критические уроки (обязательны к учёту)
1. **turbopack.root зафиксирован** в next.config.ts = /home/z/my-project/conditera-v2. Без него Next 16 выводит workspace root = /home/z/my-project (чужие lockfiles родителя), подхватывает src/proxy.ts СТАРОГО проекта (proxy.ts в Next 16 = middleware) → 500 на ВСЕХ роутах. Не удалять.
2. **Отравленный DATABASE_URL** в shell-окружении песочницы: все install/dev/gate-команды запускать как `env -u DATABASE_URL ...`.
3. **Фоновые процессы умирают между tool-call'ами**: boot+poll+verify — ОДНИМ bash-вызовом (см. worklog, gate 4).
4. **Не сажать `*/` внутрь block-комментариев** (паттерны типа `S6B*/S7B*` обрывают комментарий — дважды ловили parsing error).
5. Порты: v2 — 3100 (dev/start), старый проект занимает 3000. Не менять.
6. Версии закреплены: typescript@^5 (bun add без пина тянул TS7), eslint@^9 (тянул ESLint 10), prisma@^6 (v7 = новая config-модель). vitest@5, react@19.3, next@16.4.6.

## Конвенции health (согласованы, документированы в route.ts и worklog.md)
- 200 + status:"degraded" при database:"not-configured" — dev-состояние каркаса («не подключено», не «упало»).
- 503 + degraded — только DATABASE_URL задан, но SELECT 1 не прошёл (readiness-гейт).
- auth/storage без env → "unreachable" (подписанное dev-состояние); STORAGE_MODE=local → storage:"local" (шим, решение владельца №4); n8n fail-open "unavailable".
- S1B2 после подключения БД должен увидеть database:"ok" → status:"ok".

## Артефакты
- Коммит: f4038b62f15319b94e3584ec1b1b29a3358014b0 (`[S1B1] scaffold: Next16+TS+Tailwind4+shadcn, health, theme-shell, gates (recovery)`), ветка main, дерево чистое.
- Bundle: /home/z/my-project/backups/conditera-v2-S1B1-f4038b6.bundle (94091 bytes, verify OK).
- worklog.md в корне v2 — полная запись с отклонениями (10 пунктов) и списком перенесённого.
