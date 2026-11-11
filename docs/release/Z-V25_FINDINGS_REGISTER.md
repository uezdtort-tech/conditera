# Z-v25 — FINDINGS REGISTER

Дата: 2026-11-11 · HEAD на момент аудита: `3c10708` · Ветка: `main` · 236 ahead (без fetch)
Метод: каждое утверждение подтверждено командой/логом (см. Z-V25_TEST_EVIDENCE.md).

Классификация: **P0** критический (компрометация/потеря данных) · **P1** блокер запуска · **P2** major · **P3** minor · **INFO** замечание.

---

## Сводка

| ID | Severity | Объект | Статус | Исправление |
|----|----------|--------|--------|-------------|
| Z-v25-F1 | **P1** (data-readiness, owner action) | Демо-данные товаров / acceptance-gate | OPEN — действие владельца | Не кодовое: конфигурация данных |
| Z-v25-F2 | **P2** (код, вне активных путей) | `scripts/apply-migrations.ts` | OPEN — рекомендация | Не исправлялся (см. §F2) |
| Z-v25-F3 | **P3** (CI) | `.github/workflows/staging-deploy.yml` | OPEN | Не исправлялся (не блокер) |
| Z-v25-F4 | **P3** (robustness) | `scripts/db/setup.mjs` | OPEN | Не исправлялся (локальный инструмент) |
| Z-v25-F5 | **INFO** (среда) | Mini-services супервизия | Наблюдение | — |
| Z-v25-F6 | **INFO** (env drift) | chat-server JWT_SECRET | Разрешено перезапуском | — |
| Z-v25-F7 | **INFO** (defense-in-depth) | RLS-каталог | Наблюдение | — |
| Z-v25-F8 | **P3** (UX) | Прямой URL `/login` | OPEN | Не блокер |
| Z-v25-F9 | **INFO** (тест-поллюция) | Checkout UI console error | Не воспроизведён в чистых условиях | — |

Открытых P0: **0**. Открытых P1-дефектов кода: **0** (F1 — не дефект кода, см. ниже).

---

## Z-v25-F1 — Acceptance-gate блокирует checkout товарных позиций на текущих демо-данных

- **Severity**: P1 (data-readiness; владелец), не дефект кода.
- **Объект**: `public.products` (12 published) + `checkAcceptance` (src/lib/ops/acceptance.ts, P0.5 §29).
- **Сценарий**: POST /api/checkout с любой товарной позицией → 422 `availability: unavailable`.
- **Доказательство**:
  - HTTP: checkout товара `aaaaaaaa-…-0002` → 422 RECIPE_MISSING; товара `aaaaaaaa-…-0001` (с рецептом) → 422 MISSING_PRODUCT_DATA + LOW_STOCK «Ягоды» (−250 г) + PURCHASE_ETA_MISSING (agent-ctx/zv25/checkout-scenarios.mjs, логи).
  - Каталог: 12 published-товаров; `production_time_hours` задан у 3 (все без recipe_id → RECIPE_MISSING блокирует); `recipe_id` задан у 1 (без production_time_hours → MISSING_PRODUCT_DATA блокирует).
  - Гейт работает корректно (fail-closed, задокументирован Z-v12/Z-v20): блокирует приёмку без расчёта потребности ингредиентов.
- **Root cause**: незаполненная производственная конфигурация демо-данных (production_time_hours, привязка рецептов, остатки/закупки).
- **Влияние**: клиент не может оформить заказ товарной позиции ни на одном из 12 товаров до конфигурации данных. Custom-позиции конструктора проходят (гейт не применяется — по контракту).
- **Контрольная проверка работоспособности кода**: после временной обратимой конфигурации (сток «Ягоды» 1000 г + production_time_hours=6, откат выполнен и проверен) checkout товар+custom прошёл: заказ UK-2026-275910, total 22940 = 18500 + 2×2220, идемпотентность по Idempotency-Key, snapshot цен — 10/10 (см. Test Evidence §4).
- **Исправление (владелец)**: для каждого товарного card — заполнить production_time_hours, привязать рецепт, обеспечить остатки/закупку с ETA. Повторно прогнать `scripts/verify/p11-hardening-verify.mjs` (5 из его 17 проверок каскадно падают из-за F1) и checkout-сценарий.
- **Критерий закрытия**: checkout товарной позиции на реальных данных возвращает 200/201 без правки кода.

## Z-v25-F2 — Legacy runner `scripts/apply-migrations.ts`: fake-success при SQL-ошибке

- **Severity**: P2 (код), вне активных путей применения миграций.
- **Объект**: `scripts/apply-migrations.ts` (строки 119–138, 205–206).
- **Сценарий**: не-идемпотентная ошибка стейтмента → только `console.warn`, в конце всегда «✅ All migrations applied successfully!», exit 0.
- **Доказательство**: эмпирически (Сценарий C4, agent-ctx/zv25/c4.log): файл с `CREATE TABLE` + `SELECT * FROM nonexistent` → «1 ok, 1 failed» → «✅ All migrations applied successfully!» → exit 0.
- **Root cause**: счётчик failed не влияет на exit code/итоговое сообщение; леджера нет; per-file транзакций нет.
- **Reachability**: НЕ подключён — отсутствует в package.json, CI-воркфлоу, Dockerfile; упоминается только в текстах подсказок (`verify-money-path.ts`, `apply-seed-staging.sh`). Активные раннеры: `scripts/db/setup.mjs` (локальный), `supabase/init-scripts/01-apply-migrations.sh` (CI/Docker), `scripts/init-db.sh` (Docker dev) — все с fail-fast (Этап 2.2).
- **Исправление**: НЕ выполнялось (§8.1: исправлять P2 только если без него запуск небезопасен/невозможен — не тот случай; не «исправлять всё подряд»). Рекомендация: либо добавить `process.exit(1) if failed>0`, либо удалить скрипт с заменой упоминаний на setup.mjs.
- **Критерий закрытия**: exit code = 1 при failed>0 или файл удалён.

## Z-v25-F3 — staging-deploy.yml: опечатка `branches: ain]`

- **Severity**: P3 (CI-конфигурация).
- **Объект**: `.github/workflows/staging-deploy.yml`, строка 37.
- **Сценарий**: `workflow_run.branches: ain]` — YAML-скаляр «ain]» вместо `[main]`; фильтр ветки никогда не совпадёт → автотриггер staging после CI не срабатывает.
- **Доказательство**: `sed -n '34,40p'` (cat -A) — literal `branches: ain]$`; python yaml.safe_load парсит как скаляр.
- **Влияние**: staging-деплой по workflow_run не запускается автоматически. Смягчение: деплой требует secrets (STAGING_HOST и др.), которые владельцем не настроены — автоматический деплой и так невозможен; ручной workflow_dispatch работает.
- **Исправление**: НЕ выполнялось (не блокер запуска; изменение CI — решение владельца). Рекомендация: `branches: [main]`.

## Z-v25-F4 — setup.mjs без advisory lock (параллельный запуск)

- **Severity**: P3 (robustness, локальный инструмент).
- **Сценарий**: два одновременных `npm run db:setup` на одну БД могут применить миграции гонкой (леджер смягчает: файл применён один раз, но окно между проверкой леджера и INSERT есть).
- **Доказательство**: код-аудит (setup.mjs:578–674 — нет pg_advisory_lock); CI-путь (01-apply-migrations.sh) — также без advisory lock, но CI — сериальный.
- **Влияние**: теоретический риск только при ручном параллельном запуске в dev. Production-путь — CI/entrypoint сериален.
- **Рекомендация**: `SELECT pg_advisory_lock(hashtext('conditera_migrations'))` на старте setup.mjs.

## Z-v25-F5 — INFO: супервизия mini-services (дубликаты экземпляров)

Наблюдение среды: на 12:51 супервизор запустил по 2 экземпляра n8n-receiver (pid 1254/1316) и simplex-bridge (1266/1319) и 2 chat-server (1265/1307); вторые экземпляры не держат портов (zombie без bind). Также: detached-процессы, запущенные агентом вне дерева супервизора (PPID 1 → tini), могут репаться песочницей — надёжный способ — bash-wrapper с перезапуском (применён: chat-server под wrapper-циклом жив >40 мин, health ok) либо запуск через окружение (supervisor/dev-start).

**Пост-скриптум (15:45)**: chat-server ФАКТИЧЕСКИ ЖИВ и персистентен — wrapper-цикл перезапустил bun после гибелей, secret актуальный, health {status:ok, uptime>2300s}, браузерная сессия подключена. Опасение снято.

## Z-v25-F6 — INFO: env-drift chat-server (разрешено, сервис восстановлен)

`.env.local` перезаписан песочницей в 13:33 после старта chat-server (12:51) → работающий чат держал устаревший JWT_SECRET → все handshakes «auth: unauthorized» (fail-closed, доказано тестом: токен с текущим секретом отвергнут старым процессом; после перезапуска — принят). Код chat-server корректен (резолв секрета совпадает с Next, задокументирован). Инцидент разрешён: экземпляр перезапущен с актуальным окружением и персистентно жив (wrapper-цикл, health ok — см. F5 пост-скриптум).

## Z-v25-F7 — INFO: RLS-каталог (defense-in-depth)

- 89/248 таблиц public без RLS (в основном профильные/служебные: sessions, refresh_tokens, users, schema_migrations, cms_*, *_profiles).
- 28 голых `USING(true)`/`WITH CHECK(true)` политик: большинство — публичные SELECT справочников (product_images, holidays, permissions, capacity и т.п. — намеренно); financial_ledger.financial_ledger_service_only [ALL]=true — но отдельная схема без USAGE для anon/authenticated; 3 INSERT-only системных лога (fraud_alerts, fraud_log, abandoned_cart_logs) — риск спама только при прямой PostgREST-доступности.
- **Контекст**: локальный рантайм подключается к БД только через service-role/superuser (RLS не является линией защиты; гейт — API-слой getUserFromRequest + role-guards). Для Supabase-деплоя с PostgREST — пересмотреть (прод-конфигурация — решение владельца).
- Изоляция проверена практически: cart_items RLS (4 owner-only политики), orders (owner/confectioner/admin-условия), чужой доступ к корзине 404, ops/summary для CUSTOMER → 403 с перечнем требуемых ролей.

## Z-v25-F8 — P3: прямой URL /login рендерит пустую страницу

`/login` возвращает 200 с шапкой/футером без формы (модалка входа при этом открывается из шапки; вкладки Вход/Регистрация работают, поля валидируются). Не блокер (вход достижим с главной), рекомендация — авто-открытие модалки по роуту или редирект.

## Z-v25-F9 — INFO: console error в checkout UI при исчерпанных rate-limits

При тестировании с исчерпанным лимитом checkout (мой тестовый поллюшен) в консоли браузера единожды зафиксирован `TypeError: Failed to fetch at cartFetch` (гидрация корзины). В чистых условиях не воспроизводился; относится к корректному 429. Классификация: наблюдение, не дефект. Проверку повторить после снятия лимитов.

---

## Проверки, завершившиеся БЕЗ находок (выборка)

- Миграции: 79 файлов, дубликатов ID нет; зомби 0062 отсутствует; 0080 корректен (Этап 2.1: 14/14 вопросов).
- Migration runners: setup.mjs и CI-скрипт fail-fast, леджер честный (Сценарии A 18/18, B 24/24, C 6/6).
- Корзина HTTP: 28/31 (3 — каскад F1); checkout 10/10 с настроенными данными.
- Безопасность: secrets scan чист (дерево + 300 коммитов истории); SQLi/XSS пробы без успеха и без последствий; CSRF fail-closed; OAuth fail-closed 501 без credentials; многослойный rate limiting работает (задокументированные политики anti-fraud 3/час+10/день).
- Заказы: lifecycle 81/81; inventory-конкурентность 8/8; checkout-idempotency 15/15; diagnostics 16/16; ops-center 37/37; route-error-coverage 47/48 (базлайн); backup/restore PASSED; vitest 109/109 файлов, 1571/1571 тестов; tsc 0; eslint 0; production build PASS (см. Test Evidence §7 — с NODE_OPTIONS heap cap).
