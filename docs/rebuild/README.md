# CONDITERA — план пересоздания проекта (rebuild v2)

> Дата: 2026-11-18. Автор: дежурный агент (сессия web-dd1ef6d6).
> Статус: одобрено владельцем («давай пересоздадим проект!»).
> Каждый блок = отдельный самодостаточный промпт в `docs/rebuild/prompts/`.

---

## 1. Оценка пройденного (аудит 2026-11-18)

### 1.1 Масштаб старого проекта (/home/z/my-project)
| Метрика | Значение |
|---|---|
| Строк кода в src/ | 253 867 (ts+tsx) |
| API-группы (src/app/api/*) | 83 |
| Страничные компоненты | 23 файла, 13 880 строк |
| Dashboard-компоненты | 88 файлов |
| Lib-модули | 192 |
| SQL-миграции | 86 |
| Unit-тесты | 147 файлов / 1922 теста (PASS) |
| E2E Playwright | 149 тестов: 88 pass / 46 data-зависимых fail |
| Cron-эндпоинты /api/cron/* | 20 |
| n8n workflow-JSON | 25 (13 покрывают cron) |
| Роли | 19 self-register + 7 admin-assigned |

### 1.2 Сильные стороны (переносим в v2 как требования)
1. Единая дизайн-система 2025 (токены, `card-hover`, `fade-up`, `btn-primary-gradient`, mesh-gradient) на 7 публичных страницах, checkout, кабинетах.
2. Health-эндпоинт с матрицей зависимостей (db/n8n/auth/env-ключи) и когерентностью 503↔degraded.
3. Cron-гейт `X-Cron-Secret` + история запусков (site_settings.cron_runs).
4. RBAC `requireRole/requireAdmin` + матрица API_AUTH_MATRIX.md.
5. CSRF-прокси (src/proxy.ts), sanitize-модули, masking-тесты.
6. AI-слой: провайдер-цепочка Ollama→ZAI, конфигурация вынесена в env (`AI_*`, коммит e5dd2d8), `/api/ai/config` (admin-only, probe).
7. Самолечебка: n8n-receiver dev-keeper (probe :3000/15s → respawn), runtime-watch журнал, рецепты восстановления после recycle песочницы.
8. Тема light/dark (Zustand persist, ключ `conditera-storage`), sticky-footer, a11y-правила.

### 1.3 Системные дефекты (причины пересоздания)
| # | Дефект | Где | Как закрывается в v2 |
|---|---|---|---|
| D1 | Тройная персистентность: Prisma-схема + supabase-js + 86 SQL-миграций + «Prisma shim» | весь src/lib/supabase | S1B2: одна Prisma-схема |
| D2 | Dual-auth: jose HS256 (cd_session) + GoTrue + fallback-INSERT в auth.users | src/lib/auth.ts (375), api/auth/* | S2B1: одна схема сессий, fail-closed |
| D3 | Fail-open при session-resolve | auth.ts:293–296 | S2B1: fail-closed |
| D4 | Stored-XSS через dangerouslySetInnerHTML | admin-email-tab.tsx:303, email/inbound | S2B3 + S5B3: санитизация по умолчанию |
| D5 | Timing-unsafe сравнения секретов | proxy.ts:128–149 | S2B3: crypto.timingSafeEqual |
| D6 | Монолиты UI (SPA-роутинг в page.tsx 294 стр.; extra-pages 2480+) | page.tsx, pages/* | S3B1: App Router маршруты |
| D7 | Прод отстаёт на ~300 коммитов; ручной деплой; prod 502 18.11 | деплой | S9B1: CI-конвейер |
| D8 | Docker на npm вместо bun; migrator не валидирует схему | Dockerfile | S9B1 |
| D9 | Легаси колонки 2FA (tfa_* vs two_factor_*), легаси payouts-роут | миграции | S4B3: чистая схема |
| D10 | Ledger-журнал баланса не влит (0038), выплаты без 2FA | KNOWN_LIMITATIONS 1–4 | S4B2/S4B3 |
| D11 | Продуктовые дыры: состав/аллергены, category_id, список отзывов | KNOWN_LIMITATIONS 10–12 | S3B2 |
| D12 | AI: вызовы без таймаута в 8 роутах; общий rate-limit | api/ai* | S7B1 |
| D13 | Sandbox recycle стирает .pgdata/.env.local/logs | среда | S9B2: runtime-рецепты + бэкапы |

### 1.4 Вывод
Проект накопил 254k LOC с тремя источниками истины по данным, двумя контурами
аутентификации и недеплоенным хвостом в ~300 коммитов. Пересоздание «с нуля по
блокам» дешевле и надёжнее, чем рефакторинг in-place: каждая ошибка D1–D13
становится требованием соответствующего блока v2.

---

## 2. Решение по архитектуре v2

- **Корень нового проекта**: `/home/z/conditera-v2` (чистый репозиторий git).
  Старый `/home/z/my-project` — только чтение (референс). Переключение порта
  3000 и замена прод-деплоя — финальный шаг S9B1, отдельным поручением.
- **Персистентность**: Prisma ORM + PostgreSQL — единственный источник
  истины. 86 старых миграций консолидируются в одну начальную схему
  (блок S1B2 по инвентаризации S0B2).
- **Auth**: одна схема — httpOnly-куки `cd_session`/`cd_refresh` (jose HS256),
  refresh-ротация, TOTP 2FA, fail-closed. Без GoTrue и fallback-INSERT.
- **UI**: Next App Router маршруты вместо SPA-компонентов в page.tsx;
  дизайн-система 2025 переносится как токены + компоненты.
- **AI**: как в e5dd2d8 (env-конфиг, таймауты, rate-limit per-action).
- **Автоматизация**: единый cron-реестр + n8n-приёмник (порт 5678) —
  покрываются все 20 эндпоинтов.

---

## 3. Карта этапов и блоков

| Этап | Блок | Промпт | Зависит от |
|---|---|---|---|
| S0 Аудит и ТЗ | S0B1 Аудит-отчёт и инвентаризация | prompts/S0B1-audit.md | — |
| S0 | S0B2 Реестр фич и solution decisions | prompts/S0B2-spec-registry.md | S0B1 |
| S1 Фундамент | S1B1 Каркас проекта и гейты | prompts/S1B1-scaffold.md | S0B2 |
| S1 | S1B2 Единая схема данных (Prisma) | prompts/S1B2-database.md | S1B1 |
| S1 | S1B3 Дизайн-система 2025 + тема | prompts/S1B3-design-system.md | S1B1 |
| S2 Auth/RBAC | S2B1 Single-auth сессии | prompts/S2B1-auth.md | S1B2 |
| S2 | S2B2 RBAC и роли | prompts/S2B2-rbac.md | S2B1 |
| S2 | S2B3 Security-фундамент | prompts/S2B3-security.md | S2B1 |
| S3 Публичный сайт | S3B1 Маршруты и навигация | prompts/S3B1-routes.md | S1B3 |
| S3 | S3B2 Каталог и карточки | prompts/S3B2-catalog.md | S3B1, S1B2 |
| S3 | S3B3 SEO + Метрика + PWA | prompts/S3B3-seo-metrika.md | S3B1 |
| S4 Деньги | S4B1 Корзина и checkout | prompts/S4B1-checkout.md | S3B2, S2B1 |
| S4 | S4B2 YooKassa + ledger | prompts/S4B2-payments.md | S4B1 |
| S4 | S4B3 Эскроу, бонусы, выплаты | prompts/S4B3-escrow.md | S4B2 |
| S5 Кабинеты | S5B1 Кабинет покупателя | prompts/S5B1-customer.md | S4B1 |
| S5 | S5B2 Кабинет кондитера/поставщика | prompts/S5B2-confectioner.md | S4B1 |
| S5 | S5B3 Админ и поддержка | prompts/S5B3-admin.md | S2B2, S2B3 |
| S6 Коммуникации | S6B1 Чаты (websocket) | prompts/S6B1-chats.md | S2B1 |
| S6 | S6B2 Уведомления и тикеты | prompts/S6B2-notifications.md | S6B1 |
| S7 AI | S7B1 LLM-ядро | prompts/S7B1-llm-core.md | S1B1 |
| S7 | S7B2 AI-функции продукта | prompts/S7B2-ai-features.md | S7B1, S3B2 |
| S8 Автоматизация | S8B1 Cron-ядро | prompts/S8B1-cron.md | S1B2 |
| S8 | S8B2 n8n-интеграция | prompts/S8B2-n8n.md | S8B1 |
| S9 Эксплуатация | S9B1 Деплой-конвейер | prompts/S9B1-deploy.md | все |
| S9 | S9B2 Мониторинг и бэкапы | prompts/S9B2-ops.md | S9B1 |

Порядок запуска: строго по возрастанию внутри этапа; этапы S1→S2→S3
последовательны; S6/S7/S8 можно параллелить после S4B1 (у каждого свои
корневые файлы). S9 — последним.

---

## 4. Как использовать промпты

1. **Один блок = одна сессия агента.** Не смешивать блоки в одном диалоге —
   так промпт не урезается и агент не «плывёт».
2. Перед запуском блока убедитесь, что выполнены критерии приёмки
   блоков-зависимостей (колонка «Зависит от»).
3. Промпт самодостаточен: в каждом есть «СТЕК И ПРАВИЛА» — не удаляйте его,
   даже если кажется повтором (это защита от урезания контекста).
4. Выход блока: коммит с префиксом `[S*B*]` + запись в worklog.md нового
   проекта + краткий отчёт в чат владельцу.
5. Если агент отклоняется от промпта — останавливайте и перезапускайте блок
   заново, не «дожимайте» в той же сессии.
6. Возврат к референсу: старый код в `/home/z/my-project` читается, но не
   копируется целиком — только паттерны, помеченные в блоке «ЧТО ВЗЯТЬ».

---

## 5. Базовый контекст (дублируется в каждом промпте, не редактировать)

### СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict. bun — пакетный менеджер и
  раннер: `bun run dev` (порт 3000), `bun run lint`, `bunx tsc --noEmit`.
- Tailwind CSS 4 + shadcn/ui (стиль New York, иконки Lucide). Запрещены
  indigo/blue оттенки вне явного запроса владельца.
- Данные: Prisma ORM — единственный источник истины (prisma/schema.prisma,
  `prisma migrate`). Локальная БД: embedded PostgreSQL :54329
  (`node scripts/db/runtime.mjs start|status`). Сид — `scripts/db/seed.ts`.
- Backend: только Route Handlers `src/app/api/**/route.ts`. Server actions
  запрещены. z-ai-web-dev-sdk — только в backend-коде.
- UI: дизайн-система 2025 — токены в globals.css, классы `card-hover`,
  `fade-up`, `btn-primary-gradient`; mobile-first (`sm: md: lg:`); sticky
  footer: корневой wrapper `min-h-screen flex flex-col`, футеру `mt-auto` и
  safe-area inset; длинные списки `max-h-96 overflow-y-auto` со стилизованным
  скроллом; семантические теги main/header/nav/section + ARIA.
- Тема: Zustand persist (ключ `conditera-storage`, поле `state.theme`),
  next-themes НЕ использовать.
- Процесс: сначала фронтенд-каркас, затем бэкенд; один блок = один коммит
  `[S*B*] message`; верификация каждого блока: `bunx tsc --noEmit` →
  `bunx vitest run` → agent-browser по золотому пути блока → запись в
  worklog.md; тесты НЕ писать (кроме блоков, где тесты — цель).
- Безопасность по умолчанию: fail-closed на всех auth/секрет-путях;
  секреты только через env (имена фиксируются в блоке, значения не печатаются);
  любой HTML от пользователя — только после sanitize; сравнение секретов —
  crypto.timingSafeEqual; CORS/CSRF — через proxy.ts-паттерн.
- Запреты: не трогать production, Docker-секреты, upload-маршруты старого
  проекта; не пушить/не мержить/не деплоить без явного поручения владельца;
  не печатать содержимое .env*.
