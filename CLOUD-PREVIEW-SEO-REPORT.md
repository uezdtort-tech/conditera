# CLOUD-PREVIEW-SEO-REPORT.md

**Проект:** Conditera («Уездный кондитер») · `https://preview-chat-b8b5eea7-38dd-4df5-a6f3-a4af36a0d367.space-z.ai/`
**Дата:** 2026-10-18 · **Ветка:** `main` · **Метод:** последовательные этапы 0–8 с gate-проверками
**Отчёт подготовлен:** агентом Z.ai Code по заданию «Cloud Preview Recovery & Production Readiness»

---

## A. Итоговый статус

| Параметр | Значение |
|---|---|
| Итоговый статус | **READY FOR OWNER REVIEW** |
| PRODUCTION-READY | **NO** (см. G — требуются решения владельца и production-окружение) |
| HTTP 200 в облачном preview | **ПОДТВЕРЖДЁН** — `GET /` → 200, `text/html; charset=utf-8`, 300 016 B, 0.19–0.42 s (повторные прогоны, в т.ч. с UA Googlebot и через внешний URL) |
| Проверка «не пустая оболочка» | HTML приложения: h1, 44 `<img>` после гидрации, 2× JSON-LD, критические CSS/JS → 200; body.innerText > 500 символов в браузере |

## B. Первопричина 502

**Фактическая причина:** процесс `next dev` в preview-sandbox **уничтожался kernel OOM-killer'ом** → upstream на :3000 переставал принимать соединения → reverse-proxy отдавал 502 Bad Gateway на запросы документа.

**Доказательства (воспроизводимо, не догадки):**
1. Kernel log: `oom-kill: ... task=next-server (v1, pid=14612)` · `Out of memory: Killed process 14612 (next-server (v1)) total-vm:23598140kB, anon-rss:2915044kB` (~2.9 GB RSS).
2. cgroup: `/sys/fs/cgroup/memory.events` → `oom_kill 1` (счётчик увеличивался по мере повторов).
3. **5 независимых воспроизведений** за сессию: при старте диагностики, во время браузерного прогона, после logout, во время E2E-набора — каждый раз `curl localhost:3000` → `HTTP 000` (connection refused) при живом обёрточном процессе.
4. Foreground-запуск `next dev` непосредственно после каждого падения: `✓ Ready in 341ms`, `GET / 200` — приложение само по себе исправно.

**Классификация по чек-листу этапа 1:** пункты 2+3 (процесс Next.js завершается; proxy не может подключиться к upstream). Пункт 8 (ограничение доступа) отклонён: GET под UA Googlebot и обычным UA → идентичный 200. Отдельно зафиксировано: **`HEAD /` → 403 на edge провайдера** (`X-Fc-Error-Type: FCCommonError`, request-id сохранён) — ограничение preview-шлюза, не приложения; redirect-цепочка по GET → 0 редиректов, финал 200.

**Изменённые файлы/конфигурация:**
- Перезапуск dev-сервера (`bun run dev`, порт 3000, `-H 0.0.0.0`) — операционное восстановление.
- `bun run db:setup` (штатный скрипт проекта): инициализация embedded PostgreSQL, миграции (59), сиды, env-ключи → `.env.local` (gitignored, только добавление).
- `.env` / `.env.local`: `NEXT_PUBLIC_APP_URL` и `NEXT_PUBLIC_SUPABASE_URL` выровнены на preview-origin (исправление `localhost`-каноникла; значения не секретные).
- `src/app/sitemap.ts` — коммит `61b9a24` (см. D).
- Поднят штатный `mini-services/chat-server` (socket.io :3030) — real-time чат восстановлен.

**Почему фикс корректен:** причина — средовая (память sandbox), не кодовая; регрессионный тест на OOM в коде неприменим. Все изменения — env/ops/точечный SEO-фикс; upload-маршруты, финансовая логика и защитные механизмы не затронуты (drift-guard 2/2 hash match, секрет-скан 0 совпадений). Прогрев повторных компиляций в dev-режиме — известный источник роста RSS; долгосрочное устранение нестабильности = production-сборка на хостинге с достаточной памятью (G).

## C. Функциональность

Проверено в браузере (agent-browser, 1280×800 и 375×812) + API-прогоны. Данные — реальные из БД (не моки, после `db:setup`).

| Сценарий | Результат |
|---|---|
| Вход (UI, демо-аккаунт из `db:setup`) | ✅ 200, тост «Вы вошли как Демо Покупатель», аватар в хедере |
| Сессия после reload и после рестарта сервера | ✅ (JWT cookie персистентна) |
| Выход | ✅ `POST /api/auth/logout` + сброс session |
| Регистрация (API `/api/auth/register`) | ✅ 201, пользователь CUSTOMER/BRONZE создан (обязательны name+phone) |
| Главная | ✅ hero, категории, рекомендации, 0 ошибок консоли |
| Каталог `/catalog` | ✅ 200, товары/цены/рейтинги/фото из БД, фильтры категорий работают |
| Карточка товара | ✅ фото, рейтинг+отзывы, характеристики (вес/порции), хлебные крошки |
| Добавление в корзину → корзина | ✅ позиция с фото, счётчик количества, промокод, итого/доставка |
| Checkout (рендер, без отправки) | ✅ «Оформление заказа», получатель/оплата — форма рендерится |
| Конструктор тортов `/cake-builder` | ✅ Шаг 1/9, типы изделий, оценка ~1 500 ₽ |
| Чат поддержки | ✅ панель, каналы, ввод; real-time через socket.io :3030 (поднят) |
| Кабинет покупателя `/dashboard` | ✅ профиль, статистика, программа лояльности, разделы |
| Профили кондитеров `/confectioners/<slug>` | ✅ 200 (реальные маршруты) |
| Мобильный вид 375px | ✅ без горизонтального скролла, 0 ошибок консоли |
| Сетевые ошибки | ✅ 0 критических failed requests (кроме socket.io до поднятия chat-server — устранено) |

**Известные ограничения:**
- **Платежи/возвраты/выплаты/webhooks не тестировались** — по запрету задания (нет отдельного разрешения; sandbox-провайдеры в проекте не конфигурированы). Форма возврата в активном UI не обнаружена → помечена как «не проверялось», не объявляется рабочей.
- Дашборды кондитера/поставщика не прогонялись целиком (риск OOM в dev-режиме; клиентская роль проверена полностью).
- **OOM-нестабильность dev-режима** — preview может отдать 502 под тяжёлой нагрузкой до переноса на production-сборку (см. B/G).

## D. SEO

**HTTP/HTML:** doctype ✅, `<html lang="ru">` ✅, `<meta charset>` ✅, viewport ✅, 200 на всех публичных маршрутах, ошибок HTML/консоли нет.

**Метаданные (SSR-документ):** уникальный описательный `<title>`, `meta description`, один `<h1>`; per-view title/canonical/OG обновляются клиентски (`useSeoMetadata`) — проверено: `/catalog?category=cakes` → title «Каталог тортов и десертов», canonical `…/catalog`, OG обновлён.

**Известное архитектурное ограничение (не блокер для Googlebot, который рендерит JS):** SSR-документ — единый SPA-shell, поэтому без JS все URL отдают title/description/canonical главной. Рекомендация на production: построчные маршруты с серверным `generateMetadata` (не выполнялось — не минимальное изменение).

**Canonical:** самоссылающийся на preview-origin ✅. **Решение владельца:** preview не должен становиться канониклом production — при назначении домена обновить `NEXT_PUBLIC_APP_URL` (одно значение в `.env`); индексацию preview при необходимости закрыть `noindex`/авторизацией — **без разрешения владельца не включалось**.

**robots.txt:** 200; разрешает публичное, Disallow: /dashboard, /api, /checkout, /admin, /profile, /orders; `Sitemap:` + `Host` на preview-origin.

**sitemap.xml:** 200; **исправлена гигиена** — удалены query-дубли (`/catalog?category=…` ×24, `/recipes?id=…` ×19), чей каноникл указывает на базовые маршруты: **71 → 28 канонических URL** (24 статических + 5 slug-кондитеров, маршруты реальны, HTTP 200). Коммит `61b9a24`.

**Open Graph:** og:title/description/image/type/site_name ✅. **JSON-LD:** 2 валидных блока — `Organization` (name/alternateName/url/logo) + `WebSite` c `SearchAction`; соответствуют видимому контенту. `Product`-разметка не добавлялась (рекомендация: добавить на карточки реальных товаров с фактическими ценами; `BreadcrumbList` — после SSR-маршрутов). Rich results не обещаются.

**Lighthouse 13.5 (лабораторный, mobile, localhost):** SEO **100**, Accessibility **90**, Best Practices **88**, Performance **48**.
- CLS **0**, FCP 1.3 s, TTFB 210 ms — значимы и в dev.
- LCP 4.7 s / TBT 14 480 ms / TBT→INP оговорка: **dev-режим** (unminified JS −636 KiB, HMR, devtools) — **не является** field-data и не экстраполируется на production; INP недоступен (нет RUM), TBT приведён как лабораторный диагностический показатель.
- A11y-находки (реальны): кнопки без доступного имени (иконочные), цветовой контраст, порядок заголовков, label/name mismatch.
- BP: image-aspect-ratio, source maps (dev), console-noise.

## E. Тесты

| Проверка | Команда | Exit | Результат |
|---|---|---|---|
| Typecheck | `bun run typecheck` | 0 | PASS, 0 ошибок |
| Lint | `bun run lint` | 0 | PASS, 0 находок |
| Vitest | `bun run test` | 0 | **55 файлов / 1065 тестов passed, 0 failed, 0 skipped** (49.9 s) |
| E2E (Playwright) | `bun run test:e2e` | 1 | **Средовый FAIL**: 32 passed / 298 total; причины: (а) OOM-kill next-server mid-run (4-й инцидент), (б) бинарный mismatch Playwright (нужен chromium 1234, в кэше 1200), (в) 2 упавших assertions auth-flow — downstream от смерти сервера. Не является вердиктом по коду; требуется перезапуск после `bunx playwright install chromium` |
| Production build | — | — | **Не выполнялся: запрещён правилами sandbox** (конфликтует с активным dev-сервером на .next); локальный production smoke — соответственно N/A. Задокументировано как невыполненное, не имитировано |
| Секрет-скан | rg по 6 классам паттернов | — | 0 совпадений в изменённых файлах; `.env`/`.env.local` не трекаются git |
| Drift guard | git status + hash-object | — | Upload-маршруты 2/2 hash match с HEAD; финансовые файлы не изменены |
| CI/Docker | наличие | — | `ci.yml`, `deploy.yml`, `e2e.yml`, `Dockerfile`, compose-файлы существуют; **выполнение CI невозможно в sandbox** |

## F. Git

| Параметр | Значение |
|---|---|
| Ветка | `main` |
| HEAD до | `295283ecb8c7eefdbacd96c7542669e5fbce6c10` (дерево чистое, ahead 98 / behind 0) |
| Коммиты сессии | `61b9a24` — seo(sitemap): canonical-only URLs (единственный кодовый коммит) |
| HEAD после | см. `git log` — дополнен docs-коммитом отчёта |
| `git status` | чистое после коммитов (кроме намеренно обновлённого worklog) |
| Секрет-скан | 0 находок; `.env`/`.env.local` untracked+ignored |
| Push/deploy | **НЕ выполнялись** — только локальные коммиты, как разрешено заданием |

## G. Блокеры владельца

1. **Production-домен + политика индексации preview.** Нужно: решение владельца о каноническом домене и закрытии preview из индекса (noindex/авторизация). Снимается: обновлением `NEXT_PUBLIC_APP_URL` (одно значение) + при необходимости robots-правила.
2. **Стабильность preview (OOM).** Нужно: hosting с production-сборкой (`next build && next start` или Docker-образ — конфиги в репозитории готовы) ≥4 GB RAM либо гарантия рестарта. Снимается: любая production-сборка вне sandbox; до того — preview остаётся dev-режимом с известным риском 502 под нагрузкой.
3. **Реальные контакты организации.** В футере/JSON-LD телефон-заглушка `8 (800) 000-00-00`. Нужно: фактические реквизиты для Organization и футера.
4. **E2E-инфраструктура.** Нужно: `bunx playwright install chromium` (выравнивание бинарника 1200→1234) и стабильный сервер; затем перезапуск E2E-набора для честного вердикта.
5. **A11y-проход.** Нужно: решение по 4 классам находок Lighthouse (иконные кнопки, контраст, порядок заголовков, label/name).

## H. Следующие шаги

**1. Обязательные для восстановления preview (выполнено в этой сессии):**
- [x] Диагностика и подтверждение OOM-первопричины (логи ядра + cgroup)
- [x] Восстановление dev-сервера и локального Supabase-стека (`db:setup`)
- [x] Выравнивание `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SUPABASE_URL`
- [x] Поднятие chat-server (:3030)
- [x] Повторная верификация HTTP 200 + SEO-поверхностей через внешний URL

**2. Обязательные для безопасного пилота:**
- [ ] Production-сборка на хостинге (устраняет OOM-нестабильность)
- [ ] Решения владельца по блокерам G1–G3
- [ ] Перезапуск E2E после `bunx playwright install chromium`
- [ ] Смоук платежного контура на sandbox-провайдере (с отдельного разрешения)

**3. SEO и маркетинговые улучшения:**
- [ ] SSR-маршруты с уникальным серверным metadata для категорий/товаров/рецептов
- [ ] `Product` JSON-LD на карточках реальных товаров (+ `BreadcrumbList`)
- [ ] Возврат категорий/рецептов в sitemap после появления canonical-маршрутов `<slug>`
- [ ] A11y-фиксы по находкам Lighthouse; сжатие hero-изображения под LCP

**4. Требуют владельца / production-доступа:**
- [ ] Назначение production-домена, DNS, реальных контактов
- [ ] Push опубликованных коммитов (ветка ahead 98+2) — только по явному разрешению
- [ ] CI-прогон на GitHub (runner недоступен из sandbox)
- [ ] Включение/выключение индексации preview

---
*Evidence-логи: worklog.md (Task ID: seo-audit-fix, 6-a, cloud-preview-recovery); kernel OOM-лог и cgroup-счётчик зафиксированы в тексте этапа B.*

---
---

# ДОПОЛНЕНИЕ — ЭТАП 9: устранение блокеров, стабилизация, Production Readiness

**Дата:** 2026-10-18 (продолжение того же дня) · **Старт:** HEAD `13ba90f`, дерево чистое · **Метод:** Gate 9.0–9.5, первопричины → минимальный diff → тесты → доказательство

## A. Итоговые gates этапа 9

| Gate | Статус | Доказательство |
|---|---|---|
| 9.0 Checkpoint | **PASS** | HEAD `13ba90f`, `main`, дерево чистое, 100 ahead/0 behind; коммиты `61b9a24`+`13ba90f` подтверждены; upload-маршруты hash 2/2 (`cb23e5dd`, `f6c52a42`), тесты 2/2 (`ec9f8efc`, `06b49c3c`) = drift #11 записи; git-мутирующих watcher'ов нет |
| 9.1 OOM и стабильность | **PASS** (безопасный режим в пределах лимита) | Первопричина доказана и устранена: Turbopack FS-кэш (1.1–1.37 GB/сессия) при старте гидратировался в **2.4 GB RSS до первого запроса**; плюс сама запись кэша расходовала память. После `turbopackFileSystemCacheForDev=false` + гигиены в `ensure-dev.sh`: старт 240 MB (было 2410), пик полной поверхности маршрутов **2.3–2.6 GB** (было 3.1–3.3), 0 новых OOM за контрольный протокол (smoke 15×4 раундов + браузерный golden path + 3 reload-цикла). OOM-счётчик ядра: 7 → 13 за сессию (все инциденты документированы, новые — только во время фаз без гигиены/под нагрузкой E2E до принятия раннера) |
| 9.2 E2E | **PASS** (chromium project) / mobile-chrome — BLOCKED (память sandbox) | Playwright-бинарник выровнен штатно (chromium 1234 установлен, lockfile не тронут). chromium project, workers=1: **148 passed + 1 designed skip / 149** — все 9 спеков зелёные (per-spec runner с рестартами: smoke 8+3, full-flow 7+3+20+6, auth 14, integration-auth 17, api-v2 37, regional-pricing 13, payment-webhook 12, recipe-purchase 7, onboarding 1+1skip). Браузерный golden path (agent-browser): логин (тост+аватар) → каталог → карточка (реальный товар, цена, рейтинг) → добавить в корзину → drawer с товаром/суммой/промокодами → «Оформить заказ» → «Оформление заказа» форма (без платежа). 404-маршруты: `/cart`, `/products/<slug>` — таких маршрутов нет в приложении (корзина — drawer, товар — `/product?id=`) |
| 9.3 База и конфигурация | **PASS** | `.pgdata` жива (PID, порт 54329); миграций **59**; сиды **идемпотентны** (повторный прогон: profiles 21, products 12, confectioners 5 — без изменений); реальные строки в БД; `/rest/v1/*` 200, `/api/auth/*` 200/201; сессия переживает рестарты сервера (JWT cookie); chat-server :3030 поднят; секреты (JWT_SECRET, JWT_REFRESH_SECRET, BOT_SECRET, CRON_SECRET, SERVICE_ROLE_KEY) — полновalue-скан: client bundles / server src / logs = **CLEAN**; `.env*` не в git. NEXT_PUBLIC_APP_URL/`SUPABASE_URL` = preview-origin (осознанно, см. G1) |
| 9.4 SEO | **PASS** | sitemap.xml: **28 URL, 0 query-дублей** (сверено фактически, не по пересказу); 5 slug-кондитеров 200; robots.txt для preview → `Disallow: /`; `X-Robots-Tag: noindex, nofollow` на всех маршрутах preview; **индексация preview закрыта** до решения владельца (G1); SSR `/` содержит h1+контент (не пустая оболочка); title/canonical/og на preview-origin; SSR-shell архитектура документирована (этап 0–8) и не переписывалась |
| 9.5 Accessibility и мобильная пригодность | **PASS** | 4 класса находок проработаны: (1) безымянные иконочные кнопки 3+→**0**; (2) порядок заголовков H1→H2→H4×12 → **H1→H2→H3×12**; (3) подписи полей: поиск получил aria-label; клавиатура: 20/20 фокусируемых, фокус доходит до labeled-целей; (4) контраст: точный WCAG-расчёт токенов (lab→sRGB, в браузере было искажение двойной гаммой): **16.47 / 5.71 / 8.26 / 8.18 / 6.34 — все ≥AA**, дизайн-токены не менялись. Мобильный 375px: без горизонтального скролла, вёрстка и направление дизайна сохранены (скриншот-проверка) |
| Production build | **BLOCKED** (средовая политика, задокументировано честно) | Команда `next build` в текущей sandbox запрещена правилами рантайма (dev-only preview). Историческое доказательство реализуемости: `next build` **проходил exit 0** в этой же среде на `8db8a4d3` (v4.6, standalone) — при остановленном dev-сервере; первая попытка была убита OOM при живом dev (1.56 GB). Воспроизводимая команда: `next build && next start` в CI/на хостинге (см. E.3) |

**Итоговый статус этапа 9: READY FOR OWNER REVIEW** (PRODUCTION-READY: **NO** — production build и целевое окружение не подтверждены в этой сессии, см. C).

## B. Исправленные дефекты

| # | Дефект | Первопричина | Файлы | Коммит | Подтверждение |
|---|---|---|---|---|---|
| 1 | OOM-kill next-server (7 kernel-инцидентов до сессии) | Turbopack FS-кэш: 1.1–1.37 GB записи/сессию + 2.4 GB RSS гидрации при старте | `next.config.ts`, `scripts/ensure-dev.sh` | `a1bec00` | Старт 240 MB; пик маршрутов 2.3–2.6 GB; 0 OOM в контрольном протоколе; Vitest 1065/1065 |
| 2 | E2E FAIL (32/298) | (а) бинарник 1200≠1234; (б) OOM mid-run; (в) downстрим-ошибки | `~/.cache/ms-playwright` (штатный install), `scripts/e2e-per-spec.sh` | `5347a63` | 148+1skip/149 PASS (chromium), golden path браузером |
| 3 | Весь граф приложения компилировался в `/` и в каждом stub-маршруте | статические импорты ~25 страниц + `require()`-в-рендере | `src/app/page.tsx`, `src/components/route-fallback.tsx`, `src/components/pages/legal-page.tsx` | `bd9bd12` | typecheck/lint/Vitest/E2E PASS; SSR сохранён (проверено curl: h1+контент); честная метрика: dev-память не улучшило, prod-bundle — да |
| 4 | Preview открыт для индексации | robots.txt публиковал Sitemap+Host preview и Allow | `src/app/robots.txt/route.ts`, `next.config.ts` | `a05506a` | `GET /robots.txt` → Disallow: /; `GET /` → X-Robots-Tag noindex; production-ветка кода не изменена |
| 5 | A11y: иконочные кнопки без имени (3+), h4 после h2, поиск без подписи | отсутствовали aria-label/уровни | header.tsx, confectioners-marquee.tsx, enhanced-components.tsx, visual-search-button.tsx, video-feed.tsx | `cb4bed8` | Повторный аудит: 0 безымянных, H1→H2→H3; клавиатура 20/20 |

**Что НЕ стало фиксом (честно отклонено):** код-сплит заявлялся как OOM-фикс — замер опроверг (Turbopack компилирует все чанки маршрута и в dev); оставлен только как prod-benefit с явной пометкой. V8 heap cap (`--max-old-space-size=2048`) — эксперимент показал нулевой эффект (1864≈1854 MB), не применён.

## C. Оставшиеся блокеры

**Блокирует production:**
1. Production build не выполнен в этой сессии (политика sandbox). Требуется прогон в CI/на хостинге + smoke.
2. Целевое production-окружение неизвестно (домен, хостинг, env).

**Блокирует только текущую sandbox-среду:**
3. Dev-режим в 4 GB: долгоживущий сервер при интенсивном браузерном тестировании всё ещё может OOM (13 инцидентов за сессию; после фиксов — только при многочасовых сессиях без рестартов). Митигируется `scripts/e2e-per-spec.sh`-паттерном (рестарты). Полное устранение = production-сборка.
4. mobile-chrome E2E-проект (149 тестов) не прогонялся — та же память; мобильность подтверждена mobile-responsive тестами chromium-проекта + ручной 375px проверкой.

**Требует решения владельца:**
5. Production-домен → обновить `NEXT_PUBLIC_APP_URL` (одно значение): это включит обычный robots.txt, снимет noindex и переключит canonical. После этого вернуть sitemap-стратегию (28 URL актуальны).
6. Реальные контакты организации (телефон-заглушка в футере/JSON-LD).
7. Пуш 100+ локальных коммитов / CI-прогон — по явному разрешению.

**Улучшение после релиза:**
8. SSR-маршруты с серверным `generateMetadata` для категорий/товаров (текущая SPA-shell — известное ограничение, не блокер для Googlebot).
9. Product JSON-LD + BreadcrumbList; A11y: полный Lighthouse-проход на production-сборке (dev-шум); сжатие hero-изображений (LCP).

## D. Изменённые файлы и коммиты

| SHA | Назначение |
|---|---|
| `bd9bd12` | perf(code-split): П.18 — SPA-view ленивыми чанками; тип LegalPage экспортирован |
| `a1bec00` | fix(oom): turbopackFileSystemCacheForDev=false + гигиена .next/dev в ensure-dev.sh |
| `5347a63` | test(e2e): per-spec runner для 4GB sandbox (новый скрипт) |
| `a05506a` | feat(seo): preview закрыт от индексации (robots + X-Robots-Tag) |
| `cb4bed8` | fix(a11y): доступные имена/подписи/заголовки (5 компонентов) |

Проверки перед каждым коммитом: `git diff --check` чисто; секрет-скан изменённых файлов — 0 реальных находок; после всех коммитов: upload-маршруты hash-object 2/2 MATCH (`cb23e5dd`, `f6c52a42`), финансовые файлы не изменены, drift-guard/secret-scan не отключались. **Push/PR/deploy не выполнялись.** `.env.local` не коммитился.

## E. Следующий шаг (владельцу, по приоритету)

1. **Назначить production-домен** → одна правка `NEXT_PUBLIC_APP_URL` (+ при необходимости `NEXT_PUBLIC_SUPABASE_URL`) — robots/noindex/canonical переключатся автоматически.
2. **Прогнать `next build` + smoke в CI** (GitHub Actions готов: ci.yml; runner вне sandbox). Команда: `bun install && bun run build && bun run start` при `DATABASE_URL` production.
3. **Хостинг-требования:** ≥4 GB RAM (prod-сборка обычно 1.5–2 GB + запас), Node/Bun runtime проекта, PostgreSQL (или embedded-режим только для dev — в prod внешний PG), env из `.env.production.example`, миграции (`schema_migrations` уже 59), chat-service :3030 за reverse-proxy (конфиг Caddy в репо), health-check `/api/health`, рестарт-политика (systemd/docker `restart: unless-stopped`).
4. **Реальные контакты** для футера/JSON-LD.
5. После CI-прогона: полный E2E (оба проекта) на CI-раннере с ≥8 GB — без per-spec рестартов.
6. Решение по пушу опубликованных коммитов.


---

# ЭТАП 10 — Завершение разработки продукта (Gate 10.0–10.4)

**Дата:** 2026-10-18 · **Ветка:** `main` · **HEAD на старте:** `d8efcb4` · **Метод:** карта готовности → P0-фиксы → доказательства (браузер + API + тесты)

## A. Gates

| Gate | Проверка | Результат |
|---|---|---|
| **10.0 Checkpoint** | HEAD/ветка/статус; 6 коммитов этапа 9 после `13ba90f`; отчёт+worklog; blob-SHA защищённых маршрутов (`cb23e5dd`, `f6c52a42`) — 2/2 MATCH; watcher-процессов нет; noindex живой (robots `Disallow: /` + `X-Robots-Tag` на preview) | **PASS** |
| **10.1 Карта готовности** | 3 параллельных исследования (возвраты / кондитер-кабинет / checkout-цепочка) + склад | **PASS** (матрица в worklog) |
| **10.2 P0-фиксы** | auth ×8 маршрутов, отказ заказа, аудит-история, имя покупателя, списание по заказу, per-user промокоды, реальные заявки, честные состояния | **PASS** (все верифицированы) |
| **10.3 Сквозные сценарии** | чат 2 стороны+персистентность+reload; конструктор (UI шаги 1–3 + серверный пересчёт кастом-конфига); возврат 201/дубликат/403; golden-path API-цепочка | **PASS** (частичные ограничения — см. C) |
| **10.4 E2E-регрессия** | 148 passed + 1 designed skip / 149 (все 9 спеков, серийно, 0 OOM в финальной партии); Vitest **1079/1079** (+14 новых); typecheck 0; lint 0 | **PASS** |
| **Production build** | Политика sandbox: `next build` запрещён правилами среды (не ресурсы — запрет оператора) | **BLOCKED** (см. C.1) |

## B. Исправленные дефекты (этап 10)

| # | Дефект | Причина → файлы → решение → тест |
|---|---|---|
| 1 | **8 API-маршрутов отвечали 401 с валидной сессией** (заявки, переговоры, CRM, CMS ×3, admin payouts) | `getCurrentUser` (GoTrue `getUser` → auth/v1 501-стаб локального runtime) → 8 файлов в `src/app/api/{inquiries,negotiations,crm/leads,cms,admin/payouts}` → паттерн orders/[id]: `getUserFromRequest` (Bearer + cookie) → live: 401→200 обоими сессиями; единица измерения ролей эквивалентна (JWT при login из DB user_roles) |
| 2 | Кондитер не мог отклонить PENDING-заказ (переход разрешён матрицей, кнопки не было) | `confectioner-dashboard.tsx` → AlertDialog-подтверждение → PATCH `PENDING→CANCELLED` с комментарием → браузер-цикл: кнопка→диалог→«Отменён»→история в БД с `changed_by`+`comment` |
| 3 | PATCH /api/orders/[id] не писал `order_status_history` (аудит-паритет с движком P0.5) | `orders/[id]/route.ts` → вставка после успешного UPDATE (не откатывает переход при ошибке журнала; триггер 0006 пишет вторую строку с NULL-актёром — как у движка) → 4 unit-теста |
| 4 | Имя покупателя пустое в заказах кондитера и экране «Сегодня» | `orders/route.ts` (enrich profiles.name, только имя — без контактов) + `confectioner-today` JOIN по `COALESCE(customer_id, user_id)` (customer_id при checkout не заполняется) → браузер: «Фреш Тестовый • …» в карточке заказа |
| 5 | Списание по заказу: API готов (идемпотентность 0049, RPC 0048), UI не подключён | `order-breakdown-dialog.tsx` → кнопка «Списать по заказу» → `useWriteOffInventory` → **конверсия единиц** (breakdown.required в единицах рецепта × warehouse_quantity/stock; раньше списало бы ×1000) → live: 201 (мука 25→24.1 кг и др.), повтор → `idempotent:true` без двойного списания, реестр 1 строка, журнал movements полон |
| 6 | Промокоды: per-user повторное применение ничем не ограничено (таблица usages существовала, кодом не читалась/не писалась); `applies_to='first_order'` игнорировался | `promo-codes.ts` + `checkout` (userId) → валидация по журналу + first_order по прошлым заказам; запись использования (копейки по схеме 0005); 23505 — не ошибка → live: 422 «только на первый заказ» для покупателя с историей; свежий пользователь 201+скидка 69₽; повтор 422 «уже был использован»; usage-строка 6900 коп.; used_count 0→1 → 7 unit-тестов |
| 7 | Вкладка «Заявки» кондитера читала zustand-мок; «Откликнуться» работал только локально; «Отклонить» без обработчика | `use-real-inquiries.ts` (новый) + GET enrich customer_name + negotiations API (quote в копейках, decline) → браузер: реальная заявка отрисована, quote → status=quoted, quoted_price=450000 коп. → системное сообщение «Предложение: 4500₽», бейдж «Отвечена», кнопки честно заблокированы; фолбэк-мок помечен и заблокирован |
| 8 | Чат: комната, созданная из карточки заказа, не появлялась в списке виджета → «Выберите чат» при выбранной комнате | `chat-widget.tsx` → эффект перезагрузки списка при отсутствии активной комнаты → браузер: комната «Заказ №DEMO-1048» появилась и выбрана |
| 9 | Мёртвые кнопки «Вывести средства», «Сформировать чеки НПД/декларацию» | финансовый контур не подключён (решение владельца) → честно `disabled` + tooltip вместо молчаливого ничего-не-делания |
| 10 | Гант: зашитая дата `new Date("2026-06-30")` | реальная текущая дата |

## C. Оставшиеся блокеры

**C.1 Блокирует production (владелец/CI):**
1. **Production build не проверен** — запрет `next build` правилами sandbox-среды (не признак дефекта кода; typecheck/lint/149 E2E/1079 unit на текущем SHA зелёные). CI-проход: `bun install && bun run typecheck && bun run lint && bun run test && bun run build && bun run start` + smoke `/api/health`, `/`, `/catalog`, auth, checkout при production `DATABASE_URL`; runner ≥4 GB.
2. Целевой production-домен и `NEXT_PUBLIC_APP_URL` (noindex/canonical переключатся автоматически).
3. Пуш 112 локальных коммитов (`main` ahead 112/0 behind) — стратегия публикации.

**C.2 Только sandbox (не код):**
4. Глобальный OOM-killer: за этап зафиксированы OOM при компиляции непрогретых маршрутов с открытым браузером (пик next-server 2.5–2.7 GB + Chromium ~0.6 GB). Финальная E2E-партия — 0 OOM (per-spec гигиена работает). E2E-запуски одним прогоном heavy-спеков (full-flow одним куском) в этой среде дают OOM-каскад → ложные ECONNREFUSED-падения; по чанкам — 36/36 зелёные.
5. Мобильный chromium-проект — не запускался (память; как и в этапе 9), мобильность покрыта 375px-проверками и responsive-тестами full-flow.

**C.3 Требует решения владельца (не блокирует текущий MVP):**
6. Модерация `requested`-возвратов: admin-UI/endpoint approve/reject отсутствует (статус `rejected` и `rejection_reason` недостижимы); любой endpoint = изменение правил возврата → дифф-план по запросу.
7. Финансовый контур: «Вывести средства», фискализация (кнопки честно disabled), YooKassa-ключи.
8. Статические коды WELCOME10/SWEET15 и др. (fallback вне БД) не персонализируются — per-user только для DB-кодов. Оставить как есть или мигрировать в БД.
9. Входит ли в MVP: декор/аниматоры/услуги — код существует (`decor`, `events`, `venues`, API), но вертикали не достроены; не мешают основному маркетплейсу тортов.
10. Тестовые данные этапа 10 в dev-БД (заказы UK-2026-*, платеж `test-e10-payment-1`, возврат requested, заявка) — вычистить перед показом владельцу или пересоздать через `bun run db:setup`.

**C.4 Улучшения после релиза:** SSR-метаданные категорий/товаров; unit-покрытие store-действий корзины; синхронизация zustand-корзины ↔ `cart_items` (сейчас dead code + no-op очистка в checkout); e2e «кондитер меняет статус из UI» одним спеком.

## D. Изменённые файлы и коммиты (этап 10)

| SHA | Назначение |
|---|---|
| `ff6eaac` | fix(orders): аудит-история PATCH, имя покупателя, today-JOIN (+4 теста) |
| `975c142` | fix(auth): getUserFromRequest ×8 маршрутов (401-починка) |
| `8ae5114` | feat(promo): per-user + first_order (+7 тестов) |
| `6a85667` | feat(confectioner): отказ заказа, реальные заявки, списание в UI, честные состояния (+3 теста) |
| `8c5e821` | fix(chat,builder): список комнат чата, конверсия единиц списания |

Проверки: перед каждым коммитом diff+секрет-скан (0); после всех коммитов upload-маршруты 2/2 MATCH (`cb23e5dd`, `f6c52a42`); финансовые файлы (payments/webhooks/escrow/payouts-логика) **не изменялись** — admin/payouts тронут только в auth-строке импорта; drift-guard/secret-scan не отключались; push/PR/deploy не выполнялись.

## E. Следующий шаг (владельцу)

1. CI-прогон production build (команда в C.1) — единственный незакрытый технический пункт production-readiness.
2. Назначить домен → снять noindex.
3. Решить п.6 (модерация возвратов) и п.7 (финансовый контур) — по готовности.

**Статус этапа 10: READY FOR OWNER REVIEW** — вся доступная в среде разработка завершена и доказана; PRODUCTION-READY остаётся недостижимым без CI-build и решения владельца по среде/домену.

## ЭТАП 10-RV — Независимая повторная верификация (второй прогон)

**Дата:** сессия после 236299e · **Коммит:** 20fce1c (только test-tooling) · **Цель:** подтвердить «действительно сделано» ≠ «отчитано»

### Результаты независимой перепроверки

| Область (порядок владельца) | Метод | Результат |
|---|---|---|
| Gate 10.0 (git/хэши/noindex) | git + curl | HEAD 236299e, main, дерево чистое, 112→113 ahead; upload-маршруты `cb23e5dd`/`f6c52a42` MATCH; robots `Disallow:/` + `X-Robots-Tag noindex,nofollow` — живые |
| 1. Покупательский путь | браузер + E2E | UI-логин `customer@demo.ru` → /dashboard; каталог с реальными товарами; корзина drawer; E2E full-flow **36/36** чанками |
| 2. Кондитер/чат/конструктор/остатки | E2E + health | api-v2 **39/39**, Cake-builder 1/1; chat-server :3030 health 200 (gateway 200); остатки — RPC 0048/0049 подтверждены этапом 10 |
| 3. Возвраты (в рамках текущей логики) | E2E | payment-webhook-idempotency **12/12** (запрос возврата 201, дубликаты, 403 на чужой платёж) |
| 4. Production build | — | **BLOCKED** — запрет `next build` политикой среды (см. C.1, без изменений) |
| 5. Финальная регрессия | все 9 спеков | **152 passed + 1 designed skip, 0 провалов**; typecheck 0; lint 0; Vitest **1079/1079** |

### Находки сессии
1. **Док-гэп (не дефект):** аккаунты `scripts/seed-test-users.ts` (`customer@test.ru`…) не засеяны в dev-БД; штатные демо-креды — `scripts/db/setup.mjs` (`customer@demo.ru` / `Demo123!`). Куратору на заметку; код не менялся.
2. **OOM-потолок sandbox ужесточился:** one-shot спек теперь получает OOM-kill (6 инцидентов за сессию, все — холодная компиляция next-server 2.7-2.8GB). Создан `scripts/e2e-chunked-verify.sh` (describe-чанки + ensure-dev) — финальные 15 чанков подряд: 0 OOM. Метод воспроизводим.
3. Product-дефектов не найдено; финансовые файлы, upload-маршруты, auth/CSRF/rate-limit — не тронуты; push/PR/deploy не выполнялись.

**Статус после повторной верификации: READY FOR OWNER REVIEW (подтверждён вторым прогоном).**

---

# GATE 15 — FINAL CI VERIFICATION AND PROJECT RELEASE CLOSURE

**Дата:** сессия после 979aefb/371e975 · **RELEASE_VALIDATION_SHA:** 2cb877c · **Цель:** доказать production build на точном SHA и завершить release readiness assessment.

## 15.0 — Checkpoint и критическое расхождение с входными данными

Зафиксировано (read-only):

```text
CURRENT HEAD (на входе сессии): 371e975 (UUID-watcher коммит)
CURRENT BRANCH: main
ORIGIN MAIN: 8454b3a (ls-remote подтверждён)
AHEAD/BEHIND: 115 ahead / 0 behind
WORKTREE: чистый
RELEASE-CANDIDATE REMOTE SHA: отсутствует (release-candidate/gate-13 и gate-15 не существуют на remote)
PROTECTED FILES: на входе сессии — 0/4 (УДАЛЕНЫ, см. drift #13); после восстановления — 4/4 baseline
```

**Расхождение с входными сведениями Gate 15:** заявленные SHA `d345a28` (кандидат Gate 13/14) и `48bf831` (отчёт Gate 14), а также `0d8a9ea`, `45e1095`, `c603494` — **не существуют в этом репозитории** (`git cat-file -t` → fatal). Фактическая история: v4.5–v4.8 + Этапы 0–10 + 10-RV; последние верифицированные SHA — `20fce1c` (код) и `979aefb` (документы 10-RV, E2E 152+1skip, Vitest 1079). Вывод: входное описание соответствовало другому состоянию/сессии и было отклонено в пользу фактически проверенного (инструкция Gate 15 §2: «перепроверь фактический HEAD»).

## Drift #13 — восстановление защищённых файлов (коммит 772b8ec)

UUID-watcher коммит `371e975` (23:42:56) захватил удаление всех 4 защищённых upload-файлов из рабочего дерева — известный класс drift (#8/#10/#11/#12 → **#13**).

- **REPRODUCE:** `redline-paths.test.ts` на 371e975 — RED 8/8 (файлы отсутствуют на диске и в индексе)
- **ROOT CAUSE:** внешние авто-процессы среды удалили файлы; watcher закоммитил удаление
- **MINIMAL FIX:** точечный `git restore --source=979aefb --staged --worktree -- <4 пути>`; blobs bit-for-bit равны baseline: `cb23e5dd766b`, `06b49c3c3f22`, `f6c52a424b0d`, `ec9f8efcb663`
- **EVIDENCE:** патч удаления сохранён до восстановления — `docs/evidence/release-gate/v48-drift13-upload-deletions-371e975.patch` (sha256 `31119cceac8280dc`)
- **REGRESSION:** после восстановления drift-guard + оба upload-набора — GREEN 24/24
- **SECURITY NOTE:** секрет-скан восстановленных файлов — только синтетические маркеры (совпадает с ранее подтверждённым)

## Hygiene — real finding в v48-логе (коммит 2cb877c)

`scan-evidence.mjs` (запуск БЕЗ пайпа — ранее exit-код маскировался `tail`) обнаружил **real=1**: `db-conn-with-credentials` в `docs/evidence/release-gate/v48-full-vitest-1debf74.log:194` (строка попала в коммит 1debf74). Источник — синтетическая фикстура `postgres://user:pass@host` из `src/lib/http-helpers.test.ts:133` (не реальный секрет, ротация не требуется). Применено редактирование в стиле прецедентов 0c92b59/4db68da: `[REDACTED BY V48 HYGIENE] <redacted-conn-string>`. После фикса: scan exit 0, real findings 0, 481 synthetic markers. Изменён только evidence-лог — исходники не тронуты.

## 15.1 — Определение RELEASE_VALIDATION_SHA

```text
RELEASE_VALIDATION_SHA = 2cb877c
```

Обоснование: (1) исходное дерево `2cb877c` байт-в-байт совпадает с `979aefb` по `src/` (diff пуст), отличается только evidence-логом (1 строка) и восстановленными 4 файлами (содержимое = baseline 979aefb); (2) `371e975` дисквалифицирован — на нём red-line файлы отсутствуют (drift-guard и CI-step упадут); (3) на `2cb877c` все локальные обязательные gates зелёные (см. 15.5). История кандидата: `20fce1c` (последний кодовый коммит) → `979aefb` (док 10-RV) → `371e975` (drift, дисквалифицирован) → `772b8ec` (восстановление) → `2cb877c` (hygiene).

## 15.5 — Верификация на точном кандидате 2cb877c

| Проверка | Статус | SHA | Доказательство |
|---|---|---|---|
| TypeScript | PASS | 2cb877c | `tsc --noEmit` exit 0 |
| ESLint | PASS | 2cb877c | `eslint .` exit 0 |
| Vitest | PASS | 2cb877c | 1079/1079, 58 файлов (дважды: на 772b8ec и 2cb877c) |
| Production build | **BLOCKED** | — | запрет `next build` политикой среды (C.1, без изменений); CI-прогон недоступен без push |
| Docker build | **BLOCKED** | — | только CI (без push недоступен) |
| E2E (критическое подмножество) | PASS | 2cb877c | 95 passed / 0 failed, см. ниже |
| Secret scan | PASS | 2cb877c | scan-evidence exit 0, real=0 (после 2cb877c) |
| Protected-file guard | PASS | 2cb877c | drift-guard 9/9 + blobs 4/4 = baseline |
| Финансовые регрессии | PASS | 2cb877c | webhook idempotency E2E 12/12 + Vitest payout-race/checkout-idempotency в 1079 |
| Auth/authorization | PASS | 2cb877c | auth-flow 14/14, integration-auth 17/17, Security headers 7/7, Sensitive endpoints 1/1 |

Критические зоны Gate 15.5 (auth/authorization/payments/webhooks/refunds/inventory/orders/idempotency/chat/storage/upload/secrets): `git diff 979aefb..2cb877c` — **пусто**; baseline этапа 10-RV остаётся действительным без повторного полного прогона (инструкция §8 соблюдена: полное E2E 152+1skip уже доказано на идентичном дереве).

E2E-детализация (scripts/e2e-chunked-verify.sh, рестарт сервера на чанк):
- auth-flow 14/14 (register/login 5, 2FA 6, session&logout 2, health 1)
- payment-webhook-idempotency 12/12 (serial idempotency 11: escrow→повторы→refund→нет дублирования side-effects; edge cases 1)
- recipe-purchase-flow 7/7
- integration-auth-flow 17/17 (full auth flow 7, public API 10)
- full-flow 34/34 (Public pages 10, Security headers 7, Sensitive endpoints 1, API endpoints 7, SEO 2, Cake builder 1, Navigation 2, Login page 4)
- smoke 11/11

Инфраструктурные события (не продукт): (1) отсутствовал браузерный бинарь Playwright (1.62.1 → build 1234; в кэше был 1200) — установлен `bunx playwright install chromium`, все «падения» browser-тестов до установки были `browserType.launch` — не продукт; (2) OOM-kill next-server (anon-rss 2.84GB) посреди чанка Public pages — перепрогон contacts/checkout на свежем сервере 2/2 (dmesg-доказательство: `Out of memory: Killed process 10584`); (3) desync :3030 (stale unmanaged PID 1221) разрешён штатно по сообщению менеджера; (4) 2 «No tests found» — неэкранированные скобки в `--grep` (regex), перезапущены с безопасными подстроками.

## 15.2/15.3 — Публикация: БАРЬЕР

Явного разрешения владельца на push/PR в этой сессии **нет** → публикация не выполнялась, CI на SHA запустить невозможно (gh CLI отсутствует; push — единственный триггер). Подготовленная команда (НЕ ИСПОЛНЕНА):

```bash
# Шаг 1: публикация кандидата (ТОЛЬКО после явного разрешения владельца)
git push origin 2cb877c:refs/heads/release-candidate/gate-15
# Шаг 2: PR release-candidate/gate-15 → main (GitHub UI или gh pr create)
```

Ожидаемые CI-workflows на PR (HEAD SHA = 2cb877c):
- **ci.yml** (PR → main): jobs `lint-typecheck`, `test`, `build` (production build — ключевой недостающий gate), `docker-build`, `security-checks`, `validate-caddyfile`, `evidence-hygiene`
- **e2e.yml** (PR → main): jobs `setup`, `test`, `notify`
- `deploy.yml` — workflow_dispatch only, не запустится

Примечание: push ветки БЕЗ PR не триггерит ci.yml (branches: main, develop) — PR обязателен.

## 15.6 — Финальный вердикт

```text
GATE 15 — FINAL REPORT

RELEASE_VALIDATION_SHA: 2cb877c
ORIGIN MAIN: 8454b3a
RELEASE-CANDIDATE SHA: 2cb877c (remote-ветка НЕ создана — нет разрешения)
WORKTREE: чистый (main, 117 ahead / 0 behind после коммитов сессии)
PROTECTED FILES: 4/4 baseline (cb23e5dd766b, 06b49c3c3f22, f6c52a424b0d, ec9f8efcb663)

PRODUCTION BUILD: BLOCKED — не доказан на кандидате (запрет локального build политикой среды; CI недоступен без push)
CI: BLOCKED — не запускался на кандидате (публикация запрещена; точная команда подготовлена)
E2E: PASS — 95/0 на кандидате; полный прогон 152+1skip на идентичном дереве (979aefb)
SECURITY SCAN: PASS — exit 0, real findings 0 (после 2cb877c), 481 synthetic
FINANCIAL REGRESSION: PASS — webhook idempotency 12/12 E2E + payout-race/checkout в Vitest 1079; критические файлы не менялись
AUTHORIZATION: PASS — auth/integration/RBAC/headers/no-store E2E зелёные; защищённые файлы = baseline
FINAL VERDICT: NO-GO

GO / GO WITH CONDITIONS / NO-GO → NO-GO
```

По правилам Gate 15 §9 отсутствие доказанного production build на точном SHA = обязательный NO-GO; статус проверки публикации — BLOCKED (разрешение не выдано), общий вердикт остаётся NO-GO до прогона CI-гейта.

```text
BLOCKERS:
  1. Production build не доказан на 2cb877c (нужен CI-прогон: push + PR после разрешения владельца)
  2. CI не выполнялся на кандидате (зависит от блокера 1)
FIXES:
  - 772b8ec — drift #13: восстановление 4 защищённых upload-файлов (RED 8/8 → GREEN 24/24, evidence-патч сохранён)
  - 2cb877c — hygiene: редактирование синтетической db-conn фикстуры в v48-логе (scan real 1 → 0)
  - (окружение, без коммитов: playwright chromium 1234 установлен; stale chat PID 1221 устранён)
COMMITS CREATED: 772b8ec, 2cb877c, + docs-коммит отчёта Gate 15
PUSH: НЕ ВЫПОЛНЯЛСЯ (нет разрешения)
PR: НЕ СОЗДАН (нет разрешения)
MERGE: НЕ ВЫПОЛНЯЛСЯ
DEPLOY: НЕ ВЫПОЛНЯЛСЯ (deploy.yml — dispatch only)
```

**Рекомендация: NOT READY — RELEASE BLOCKER REMAINS** (единственный оставшийся путь: разрешение владельца → `git push origin 2cb877c:refs/heads/release-candidate/gate-15` → PR в main → зелёный ci.yml/e2e.yml на SHA 2cb877c → пересмотр вердикта).

---

# GATE 16 — СИСТЕМНОЕ ЗАВЕРШЕНИЕ ПРОЕКТА (FINAL)

**Дата:** сессия после 82e48e8 · **BASE SHA:** 82e48e8 · **FINAL SHA:** ed6099e · **Модель:** обнаружение → классификация → группировка по первопричине → пакет исправлений → повторные проверки → единый отчёт.

## 16.0 Checkpoint (факт, не отчётные данные)

```text
ACTUAL HEAD: 82e48e8 → ed6099e (после фиксов сессии)
ACTUAL BRANCH: main
ORIGIN MAIN: 8454b3a (ls-remote)
RELEASE CANDIDATE: отсутствует на remote (не публиковался — нет разрешения)
WORKTREE: чистый на всех шагах
PRE-EXISTING CHANGES: нет
PROTECTED FILES: 4/4 baseline (cb23e5dd766b, 06b49c3c3f22, f6c52a424b0d, ec9f8efcb663)
```

Коммиты Gate 15 (772b8ec, 2cb877c, 82e48e8) существуют в object database; утверждения Gate 15 перепроверены и подтверждены (Vitest 1079, scan exit 0, blobs).

## 16.1 Целостность и механизм drift (первопричина)

Найден источник UUID-коммитов: **снапшоттер платформы контейнера** (вне репозитория): author совпадает с системным (`Z User <z@container>`), нерегулярные интервалы (19:24/10:52/11:59/14:26/23:42), в репо — ни хуков (`core.hooksPath` пуст, hooks только *.sample), ни crontab, ни процессов-watcher, ни supervisor/pm2. Сценарий: между сессиями внешние процессы среды удаляют файлы → снапшоттер коммитит рабочее дерево как есть → deletion попадает в историю. Минимальное долговременное исправление — **drift self-heal в ensure-dev.sh** (шаг 1c): при старте любой сессии отсутствующий защищённый путь восстанавливается точечно из последнего коммита, где он существовал (deletion-коммиты пропускаются перебором `git rev-list` + `git cat-file -e`). Regression: живая симуляция (`git rm -f` без коммита) → восстановление из 772b8ec, blob = baseline, 16/16 тестов. Commit `848b228`.

## 16.2/16.3 Единая карта проблем (по всем evidence в репо)

| ID | Категория | Симптом → первопричина | Severity | Статус |
|---|---|---|---|---|
| P-01 | GIT/DRIFT | 5 повторов удаления защищённых файлов (#8/#10/#11/#12/#13) → снапшоттер платформы коммитит deletion | HIGH | FIXED (772b8ec) + превенция (848b228) |
| P-02 | ENVIRONMENT | hygiene-finding выжил: exit-код скана маскировался пайпом `\| tail` | MEDIUM | FIXED (2cb877c) + правило «scan без пайпа» |
| P-03 | ENVIRONMENT | Playwright 1.62.1 ↔ кэш браузеров 1200 → ложные падения browser-тестов | MEDIUM | ENVIRONMENTAL (chromium 1234 установлен) |
| P-04 | ENVIRONMENT | OOM-kill next-server (2.5–2.8 GB RSS) в 4 GB sandbox → ложные ECONNREFUSED | MEDIUM | ENVIRONMENTAL (чанковый раннер; полное устранение = production build) |
| P-05 | BUILD/CI | Production build не доказан на кандидате; локальный build запрещён политикой | HIGH | BLOCKED (разрешение владельца) |
| P-06 | RELEASE/PERMISSION | 120 коммитов ahead, release-candidate ветки нет | HIGH | BLOCKED (разрешение владельца) |
| P-07 | DOCUMENTATION | Отчёты Gate 12–14 ссылаются на несуществующие SHA (d345a28, 48bf831, 0d8a9ea, 45e1095, c603494) | MEDIUM | CONFIRMED — причина: другая рабочая копия/сброс sandbox (доказуемо только с доступом к той среде); к текущему репо неприменимы |
| P-08 | BUILD/CI | Harness-баги: `--grep` без экранирования → «No tests found»; `$spec` unbound → ложный exit=1 | MEDIUM | FIXED (954bdbb + ed6099e) |
| P-09 | GIT/DRIFT | Отсутствие самовосстановления при старте сессии | HIGH | FIXED (848b228) |
| P-10 | ENVIRONMENT | Stale unmanaged-процесс на :3030 (desync) | LOW | ENVIRONMENTAL (dev-only; менеджер даёт actionable-сообщение; устранён штатно) |
| P-11 | FINANCIAL | Модерация requested-возвратов (approve/reject UI/endpoint) отсутствует | MEDIUM | CONFIRMED — P1, требует решения владельца (изменение правил возврата) |
| P-12 | FINANCIAL | Выплаты/фискализация/YooKassa-ключи | HIGH | BLOCKED (owner scope) |
| P-13 | PRODUCT | Статические промо-коды вне БД (не per-user) | LOW | ACCEPTED RISK (P2) |
| P-14 | PRODUCT | Вертикали decor/аниматоры/venues недостроены | LOW | NOT APPLICABLE для MVP (owner decision) |
| P-15 | DATA | Тестовые данные этапа 10 в dev-БД (UK-2026-*, test-e10-payment-1) | LOW | CONFIRMED — P2 (пересоздать через db:setup перед demo) |
| P-16 | UX/MOBILE | mobile-chrome E2E-проект не прогонялся (память) | LOW | ENVIRONMENTAL (покрыто responsive-тестами + 375px) |
| P-17 | PRODUCT | Placeholder телефона в футере/JSON-LD | LOW | CONFIRMED — P1 owner data |
| P-18 | PRODUCT | SSR-метаданные категорий/товаров, zustand↔cart_items dead code | LOW | P2 backlog |

Сводка: подтверждено 18, исправлено 5 (P-01, P-02, P-08, P-09 + harness-надстройка ed6099e), инфраструктурных 4 (P-03, P-04, P-10, P-16), заблокировано разрешениями 3 (P-05, P-06, P-12), принято в backlog 6. **Production blockers: 2** (P-05 build-доказательство, P-06 публикация — оба закрываются одним разрешением владельца + зелёным CI).

## 16.4 Исправления (минимальное изменение, один дефект — один коммит)

1. **`848b228` fix(dev-infra): drift self-heal в ensure-dev.sh** — Problem/Root cause/Files/Regression: см. 16.1. Файлы: scripts/ensure-dev.sh. Regression: симуляция drift → blob baseline, 16/16.
2. **`954bdbb` fix(e2e-harness): экранирование regex в --grep + итоговый echo** — Files: scripts/e2e-chunked-verify.sh. Regression: чанк со скобками → 2 passed, exit 0.
3. **`ed6099e` fix(e2e-harness): '|' не экранируется** — OR-чанки работают. Regression: Public pages 5+5=10 passed.

## 16.5 Финальная регрессия (SHA ed6099e)

| Проверка | Результат | Доказательство |
|---|---|---|
| typecheck | PASS | tsc --noEmit exit 0 |
| lint | PASS | eslint . exit 0 |
| Vitest (unit+integration) | PASS | 1079/1079, 58 файлов |
| Protected-file drift guard | PASS | redline 9/9; blobs 4/4 baseline |
| Upload tests | PASS | 7+8 = 15/15 |
| Secret/evidence scan | PASS | exit 0, real findings 0 (без пайпа) |
| Chat/realtime runtime gate | PASS | **48/48** (socket, rooms, персистенция, bot, typing, reconnect, courier-трекинг) |
| E2E: smoke | PASS | 11/11 |
| E2E: auth register/login | PASS | 5/5 |
| E2E: payment webhook idempotency (финансы) | PASS | 11/11 (escrow→повторы→refund→без дублей side-effects) |
| E2E: Public pages (10 страниц) | PASS | 10/10 (2 OR-чанка) |
| bash -n обоих изменённых скриптов | PASS | синтаксис OK |
| Критические зоны vs baseline 979aefb | PASS | diff пуст (auth/payments/webhooks/orders/lib) |

Транзиентные события сессии: 1 OOM рестарта next-server между чанками (dmesg; чанк после ensure-dev зелёный — первоначальная причина зафиксирована, повторный результат PASS); 1 over-escaping дефект моего же фикса (найден регрессией, исправлен ed6099e — не замаскирован).

## 16.6 Production build и CI — план публикации (БАРЬЕР: разрешение владельца)

```text
VALIDATED SHA: ed6099e (src/ байт-в-байт = 2cb877c = 979aefb; изменены только harness-скрипты и документация)
BRANCH TO PUBLISH: release-candidate/gate-16
EXACT PUSH COMMAND: git push origin ed6099e:refs/heads/release-candidate/gate-16
PR SOURCE: release-candidate/gate-16
PR TARGET: main
EXPECTED WORKFLOWS: ci.yml (push/PR main), e2e.yml (PR main)
EXPECTED REQUIRED JOBS: ci.yml → lint-typecheck, test, build, docker-build, security-checks, validate-caddyfile, evidence-hygiene; e2e.yml → setup, test
EXPECTED EVIDENCE: headSHA каждого run == ed6099e; все required jobs conclusion=success; артефакты build/E2E
ROLLBACK/ABORT PLAN: закрыть PR и удалить release-candidate/gate-16 (deploy.yml — только workflow_dispatch, авто-деплоя нет; merge не выполняется → production не затрагивается)
```

Примечание: push ветки БЕЗ PR не триггерит ci.yml (branches: main, develop) — PR обязателен. Локальный `next build` не запускался (запрет политики среды, не нарушен).

## 16.7 Оценка завершённости по ролям

**Покупатель:** register/login PASS · catalog PASS · product detail PASS · whole cake + cutaway PASS · constructor PASS · quote PASS · cart PASS · checkout PASS · order PASS · payment PASS (sandbox-provider) · chat/support PASS · refund request PASS (создание; модерация = P-11).
**Кондитер:** login PASS · profile/onboarding PASS (1 skip designed) · portfolio PASS · inventory PASS (concurrency в Vitest + RPC) · recipe PASS · incoming order PASS · order status PASS · buyer chat PASS.
**Платформа:** auth/authorization PASS · database/migrations PASS (59 файлов, ledger) · payments/webhooks PASS (sandbox) · refunds PASS (request-контур) · inventory concurrency PASS · chat/realtime PASS (48/48) · storage/upload PASS (15/15 + drift-guard) · n8n/events PASS (health ok) · secrets PASS (scan real=0) · rate limiting PASS (ingress-trust) · error handling PASS · logging PASS · mobile/browser PASS (chromium; mobile-chrome = P-16) · clean setup PASS (db:setup восстанавливает env+seed) · **production build BLOCKED** · **CI BLOCKED**.

## 15.A Verdict

**NO-GO** — production build не доказан на точном SHA; публикация не разрешена. Оба оставшихся блокера закрываются одним действием владельца (см. 16.6) и зелёным CI.

## 15.H Git report

```text
BASE SHA: 82e48e8
FINAL SHA: ed6099e
WORKING BRANCH: main (120 ahead / 0 behind)
COMMITS CREATED: 848b228 (drift self-heal), 954bdbb (harness grep+echo), ed6099e (harness pipe), + docs-коммит отчёта Gate 16
PRE-EXISTING CHANGES: нет
PROTECTED FILES: 4/4 baseline
WORKTREE: чистый
PUSH: НЕ ВЫПОЛНЯЛСЯ · PR: НЕ СОЗДАН · MERGE: НЕ ВЫПОЛНЯЛСЯ · DEPLOY: НЕ ВЫПОЛНЯЛСЯ
```

## 15.G Предложения владельцу (5, по приоритету)

| Priority | Problem group | Evidence | Recommended action | Effort | Risk if deferred | Owner decision |
|---|---|---|---|---|---|---|
| P0 | Build/CI (P-05+P-06) | build-гейт не доказан ни на одном SHA из 120 ahead | Разрешить: `git push origin ed6099e:refs/heads/release-candidate/gate-16` + PR в main; проверить 7 jobs ci.yml + e2e.yml на headSHA ed6099e | ~0 (CI сам) | Продолжение NO-GO; риск накопления расхождений с origin/main | ДА — push+PR |
| P0 | Production env | домен/NEXT_PUBLIC_APP_URL неизвестны | Указать домен → включить robots/canonical/noindex-переключение (одно значение env) | минуты | noindex на проде = нет органики | ДА |
| P1 | FINANCIAL (P-11) | requested-возвраты не модерятся (rejected недостижим) | Дифф-план admin-модерации возвратов (по запросу; правила менять нельзя без владельца) | 1-2 дня | Ручная обработка возвратов через БД | ДА — скоуп |
| P1 | DATA (P-15) | Тестовые данные этапа 10 в dev-БД | Перед показом владельцу: `bun run db:setup` (чистый seed) | минуты | Путаница демо-данных | НЕТ (можно после запуска) |
| P2 | PRODUCT (P-13/P-14/P-17/P-18) | Статические промо, недостроенные вертикали, placeholder-телефон, SSR-метаданные | Backlog после запуска; приоритет по фактической аналитике | 1-5 дней каждый | Не блокируют MVP-маркетплейс | Частично |

**Однозначная рекомендация: NOT READY — P0 BLOCKERS REMAIN** (единственный путь к снятию: разрешение публикации → зелёный CI на ed6099e → пересмотр вердикта).
