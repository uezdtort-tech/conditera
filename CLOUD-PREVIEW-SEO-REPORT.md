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

