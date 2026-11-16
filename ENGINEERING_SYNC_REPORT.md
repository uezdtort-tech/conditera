# ENGINEERING_SYNC_REPORT.md

Отчёт о синхронизации инженерного контекста Conditera. Дата: 2026-11-16. Исполнитель: Z (ведущий разработчик). Объём: этапы A–G задания владельца. Изменения кода: только одно минимальное исправление (см. §3); прод не затрагивался.

## 1. Фактический HEAD и состояние Git

- **HEAD**: `e7da599` (fix(test): удалить сироту cart-sync.test.ts), ветка `main`, рабочее дерево чистое, незавершённых операций/stash нет.
- Всего 488 коммитов. **`main...origin/main` = 299 вперёд / 0 позади** (origin/main `8a31081` — только dependabot-мержи CI). Вся разработка — локально, не опубликована.
- Remote: `https://github.com/uezdtort-tech/conditera.git` — репозиторий совпадает с заданием; следов qwentopt в коде не обнаружено (grep).
- Якоря `98c0ddc` (Z-v15, 08.11), `26947c5` (Z-v16, 08.11) существуют в истории — только ориентиры, HEAD ушёл далеко вперёд.
- UUID-коммиты снапшоттера: `7bb22dd` — пустой маркер; `8aefa18` — массовое добавление (`_quarantine/*`, RELEASE-* отчёты, `mobile-app/`, воскрешение старого `cart-sync.test.ts`).
- **Защищённые пути**: в начале сессии 4 файла upload-роутов были удалены процессом песочницы (рецидив инцидентов #13–#17). Восстановлены из последнего хорошего коммита, `skip-worktree` включён, pre-commit hook-guard активен (`core.hooksPath=scripts/hooks`). Проверка: `bash scripts/protected-paths.sh status` → `S` × 4.

## 2. Что изменилось с последней подтверждённой точки

От Z-v16 (`26947c5`, 08.11) до `e7da599`: ~460 коммитов, включая: v4.x release-gate-серии (документированы в RELEASE-GATE-* отчётах), крупный refactor корзины (`d5489f7`), фикс регистрации `cb42589` (fallback `auth.users` stub), deploy-журнал `40392b5` (Части VI–VII worklog), сессия JWT-ротации на проде (откат), мониторинг-агенты.

## 3. Минимальные изменения, выполненные в этой сессии (код: 1 коммит)

| Действие | Обоснование |
|---|---|
| `git restore` защищённых upload-роутов + `skip-worktree` | Рецидив drift-инцидента; штатный `scripts/protected-paths.sh repair/skip-on` |
| **`e7da599`** — удаление `src/lib/cart-sync.test.ts` | Файл восстановлен снапшоттером (`8aefa18`) и импортирует удалённый API (`mergeServerCart` и др.); актуальный контракт подтверждает `cart-sync-adoption.test.ts:6` («эти экспорты НЕ существовали»). Эффект: typecheck 6 ошибок → 0, vitest 16 FAIL → 1922/1922 PASS |
| Создание 6 инженерных документов | Задание §11 |

Ничего больше не изменялось; production, секреты, схема БД, защищённые роуты — не затронуты. Push/deploy не выполнялись.

## 4. Какие прежние сведения оказались устаревшими/неверными

1. **«Логин через Argon2id» — НЕВЕРНО**: фактически `bcryptjs` cost 10 (`src/lib/auth.ts:128-140`); «Argon2id» остался только в комментариях auth-роутов. Мой предыдущий отчёт это повторял — ошибка, исправлена (R4).
2. **«Z-v15/Z-v16 — текущий HEAD»** — давно не так (488 коммитов).
3. **«cart-sync.test.ts покрывает merge-стратегию»** — тест-сирота против удалённого API; актуальный контракт — `cart-sync-adoption.test.ts`.
4. **«Playwright E2E доступен»** — скрипт `test:e2e` есть, зависимость `playwright` в package.json отсутствует → E2E в этой среде не выполнялись.
5. **«Ошибок typecheck нет»** — до `e7da599` было 6 (cart-sync.test).

## 5. Фактическая архитектура (кратко, детали в ENGINEERING_CURRENT_STATE.md)

Next 16.3.5 App Router + SPA-слой RouteFallback; dual-auth (app-JWT jose HS256 + GoTrue best-effort; bcrypt в `profiles.password_hash`); данные — PostgREST через supabase-js (admin, RLS-шим `postgrest/execute.ts`) + pg-пул (max 10); CSRF double-submit в `proxy.ts` (+CSP, security headers, upload-гвард); rate-limit sliding-window (Redis опц.) + DB-backed anti-fraud; checkout с идемпотентностью и серверным пересчётом цен; YooKassa webhook с IP-allowlist и сверкой с провайдером; realtime — socket.io мини-сервис :3030.

## 6. Модули: работают / частично / сломаны

**Работают (проверено кодом+тестами)**: каталог→карточка→корзина→checkout→оплата→эскроу; ЛК кондитера (35 вкладок); рецепты+маркетплейс+склад (идемпотентный write-off); поставщики/закупки; чаты (БД+socket.io)+CRM-тикеты; CRM/админ/модерация; курьеры; уведомления; venues; CMS; seed реалистичен (12 товаров, 5 кондитеров, 28 категорий).
**Частично**: витрины декора/услуг (mock-first + live-hydrator; API реальны), серверная zod-валидация (12/333), `next/image` (3 файла), a11y.
**Заглушки/сломаны**: подарочные сертификаты (только zustand), корпоративные заказы (только mock), `/en` (layout без контента), Supabase Realtime (мёртв; заменён socket.io), Playwright E2E (нет зависимости).
**Не интегрировано**: Conditera Cake Studio — отдельный продукт (forensic-аудит: архив V2 не найден; известные потери данных V2 задокументированы).

## 7. Результаты тестов и сборок (Этап E)

| Проверка | Результат |
|---|---|
| `tsc --noEmit` | **0 ошибок** (после `e7da599`; до — 6) |
| `vitest run` | **1922/1922 passed, 146/146 файлов** (~147 c) |
| `eslint .` | 3 ошибки + 14 warnings — **все в чужеродном `mobile-app/`**; веб-`src/` чист |
| `check:secrets` | **CLEAN** (findings=0) |
| `check:quick` | **PASSED** (typecheck+secrets) |
| `npm run build` / `next build` | не выполнялся — запрещён правилами среды (dev на :3000) |
| Playwright E2E | не выполнялся — зависимость не установлена |
| Проверено на Production | только read-only GET (health/5 API/TLS) — см. PRODUCTION_COMPATIBILITY.md; mutating-сценарии на проде НЕ проверялись |

Тесты содержательные: покрывают идемпотентность write-off (409), Courier-assignments, payment-webhook, auth-suite (fallback, blacklist, роли), CSRF — не мок-пустышки (выборочно верифицировано).

## 8. Уязвимости и риски (полностью — ENGINEERING_RISKS.md)

- **P0**: stored-XSS в админке — `admin-email-tab.tsx:303` рендерит нерасчищенный HTML входящих писем (`api/email/inbound`). Минимальный фикс предложен, не применялся (сначала описание владельцу — по заданию §12).
- **P1**: 299 неопубликованных коммитов; fail-open blocked-check (`auth.ts:293-296`); bcrypt vs заявленный Argon2id; не-timing-safe `X-Cron-Secret`.
- **P2**: `mobile-app/`-артефакт; zod 12/333; in-memory rate-limit; sandbox-drift.
- Ложных маскировок Auth не найдено: dev-fallback ограждён `NODE_ENV`+SERVICE_ROLE (`dev-auth.ts:118`), фиктивных сессий при отказе Auth нет; SERVICE_ROLE в клиентском бандле отсутствует (grep; promo-codes — ленивый импорт, задокументирован).

## 9. Совместимость кода с текущей Production-архитектурой

Код совместим с целевой архитектурой (две БД, PostgREST+RLS, GoTrue) и корректно деградирует: fail-closed секреты в prod; register на проде (без cb42589) — 500 при `auth=unreachable` (зафиксировано в `/api/health` details); YooKassa/n8n/SMTP — env отсутствуют, фичи деактивированы, а не эмулированы. Блокеры лежат в инфраструктуре (PostgREST→DB search_path; Caddy↔Supabase таймауты) — не в коде репозитория. Задачи, требующие прод: P1-5 (деплой `cb42589+`, верификация auth), JWT-ротация (владелец).

## 10. Задачи независимо от Pi vs заблокированные

**Независимо**: P0-1 XSS; P1-1 Argon2id; P1-2 fail-closed; P1-3 timing-safe; P1-4 zod-auth; P2-1…P2-6 (image, сертификаты, корпоративные, SEO, zod-расширение); P3.
**Заблокированы продом**: проверка регистрации/входа на conditera.ru (ждать PostgREST/Caddy + деплой cb42589); верификация RLS/`auth.uid()` в облаке; JWT-ротация (разрешение владельца); push (разрешение владельца, но не зависит от Pi).

## 11. Три наиболее важных следующих шага

1. **P0-1**: устранить stored-XSS входящих писем (минимальный sandbox-iframe/текст-режим) + тест-фикстура.
2. **P1-2 + P1-3**: fail-closed blocked-check и timing-safe сравнения секретов — малые диффы, большой эффект безопасности; затем `check:quick`+vitest.
3. **P0-2 (после разрешения владельца)**: `push origin main` 299 коммитов + `ops:backup` — устранение единственной копии истории; параллельно — решение по `mobile-app/`.
