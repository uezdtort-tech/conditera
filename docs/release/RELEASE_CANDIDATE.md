# RELEASE CANDIDATE — Z-v33 (финальный gate цикла)

**Дата:** 2026-11-13 (UTC). **Статус:** RELEASE CANDIDATE.
**Вердикт:** OWNER ACTION REQUIRED — **код готов к публикации** (machine-гейт зелёный); production build + прод-конфигурация + push — действия владельца вне песочницы.

## 1. Идентификация

| Параметр | Значение |
|---|---|
| HEAD | `9d58cbf14a7331fd2d6206be80d9881248e3fa62` (`9d58cbf`) |
| Ветка | `main` |
| Remote | `origin` → `https://github.com/uezdtort-tech/conditera.git` |
| origin/main | `8a31081` (является предком HEAD — публикация fast-forward) |
| Опережение | на момент gate: 280 коммитов впереди origin/main, 0 позади; после коммитов release-документации этого цикла — 283 впереди |
| Environment | bun 1.3.14, Node v24.22.2, 2 CPU, RAM 3.9 GiB, без swap; embedded PostgreSQL 18 `127.0.0.1:54329/conditera` |
| Артефакт gate | `docs/operations/checks/Z-V33_FINAL_GATE.md` (+ ADDENDUM ZV33-9b от 2026-11-13) |

## 2. Финальный gate — матрица 15 строк (итог после ADDENDUM ZV33-9b: PASS 13 / FAIL 0 / NOT RUN 2)

| # | Пункт | Вердикт | Счётчики / команда |
|---|---|---|---|
| 1 | TypeScript | **PASS** | exit 0, 4.5s — `node --max-old-space-size=2560 node_modules/typescript/bin/tsc --noEmit` |
| 2 | ESLint | **PASS** | exit 0, 46.3s, 0 проблем — `bunx eslint --no-warn-ignored .` |
| 3 | Full Vitest | **PASS** | **146 файлов / 1922 теста — 0 failed, 0 skipped**, 142.88s — `bunx vitest run` |
| 4 | Route error coverage | **PASS** | exit 0, checked=**47/48** (48-й — script-documented exempt/protected perimeter) — `node scripts/verify/route-error-coverage.mjs` |
| 5 | Secrets scan (release-гейт = full) | **PASS** | **0 findings / 1801 файлов**, exit 0 — `scripts/regression/secrets-scan.mjs --mode=full`. Аномалия quick-режима (8 false-positives) исправлена ZV33-9b — см. §3 |
| 6 | Protected-paths redline | **PASS** | `bash scripts/protected-paths.sh status` → H×4, exit 0; redline-тест **9/9**; `core.hooksPath=scripts/hooks`; 0 защищённых путей в статусе |
| 7 | Migration consistency | **PASS** | `ls supabase/migrations \| wc -l` = **85** = `SELECT count(*) FROM public.schema_migrations` = **85**; filename-diff пуст; пропуски 0056/0073 и суффиксы 0016b/0017b — норма |
| 8 | PostgreSQL integration | **PASS** (committed equivalents) | **39/39** = inventory-concurrency **8/8** + checkout-idempotency **15/15** + diagnostics **16/16** на живом PG; точный 11-сценарный harness Z-v32 C-2 — NOT RUN (эфемерный, в репо не сохранён) — `node scripts/verify/{inventory-concurrency,checkout-idempotency,diagnostics}-verify.mjs` |
| 9 | Production build | **NOT RUN — OWNER ACTION REQUIRED** | песочница: запрет запуска + 3.9 GiB RAM/no swap (OOM-прецедент exit 137 на фазе TypeScript, Z-v26/Z-v32) → `bun run build` выполняет владелец |
| 10 | Production build smoke | **NOT RUN — OWNER ACTION REQUIRED** | строго зависит от строки 9 (`bun run start` + `/`, `/api/products`, `/api/auth/login`) |
| 11 | Key API smoke (live) | **PASS** | 5/5 endpoints 200 анонимно: `/`, `/api/products`, `/api/cms/settings`, `/api/video-feed`, `/api/recipes/…/acceptances` (честно пусто); 0 логинов из лимита |
| 12 | Три роли (покупатель/кондитер/админ) | **PASS** — цикловые доказательства | покупатель: регистрация 201 + автологин, покупка UK-2026-943071 с `order_items.price_version_id NOT NULL` (живой снимок цены), серверная доставка, чат, отмена по правилам, негативные 403/400; кондитер: товар с фото через защищённый upload (201), Acceptance Gate GREEN (`/api/orders/availability`), панель истории цен, PENDING→CONFIRMED с order_status_history, чат; админ: block/unblock с эффектом login-403, 6 UI-секций, матрица прав 8 роутов × 4 роли — все PASS; machine-корреляция: `api-auth-matrix.test.ts`, `upload-role-guard.test.ts`, route-тесты сессии/refresh/заявок/отмены — в 1922 зелёных (исправлено ADDENDUM ZV33-9b) |
| 13 | Catalog & orders | **PASS** | products 200 (13 published, live); vitest зелёные: vitrine-products, catalog-page, checkout/negotiation-rebind, orders/[id]/cancel, price-version-bind; ZV33-8a/8b — цикловые записи |
| 14 | Prices & offers | **PASS** | миграции 0083–0086 применены (85/85); ZV33-5 проверки 1–9: active accept PASS, expired 410 OFFER_EXPIRED, repeat-accept 409 OFFER_ALREADY_ACCEPTED, подмена цены невозможна, checkout по серверной цене 15 000 ₽, фиксация переживает изменение цены товара, revisions, TZ Europe/Moscow; D1 → 409 OFFER_ALREADY_ORDERED; vitest зелёные: offer-format, negotiation-binding, use-real-inquiries, product-price-panel, price-display |
| 15 | No mock data в публичном каталоге | **PASS** | rg: 0 live-достижимых MOCK_ в `src/app/api` (только *.test.ts); demo-hatch `NEXT_PUBLIC_DEMO_MODE` default OFF; каталог — живые строки БД |

## 3. ADDENDUM ZV33-9b (2026-11-13) — уже в дереве

Пост-гейт-фикс честности сканера: quick-режим secrets-scan исключает gitignored-файлы (`.env*` — не могут быть закоммичены по построению → находки в них структурные ложные позитивы) + токен-фикстура в `src/app/api/auth/refresh/route.test.ts` переименована. Результат:

- `bun run check:quick` → **exit 0** (было exit 1 с 8 false-positive findings);
- `bun run check:full` → exit 0 (без изменений, 0/1801);
- строка 12 матрицы переведена в PASS (цикловые доказательства ролей), итоговые счётчики матрицы: **PASS 13 / FAIL 0 / NOT RUN 2** (NOT RUN = строки 9, 10).

## 4. Что проверено (сводка с указателями на артефакты)

- **Роли (строка 12):** живые сессии ZV33-5/8a/8b/8c — покупатель (UI-регистрация, покупка каталогом **UK-2026-943071**: `order_items.price_version_id NOT NULL` = доказательство живого снимка цены; доставка сервером; чат; отмена по правилам без возврата остатков; негативные 403/400), кондитер (товар с фото через защищённый `/api/upload` 201; Acceptance Gate GREEN; UI истории цен с версиями; PENDING→CONFIRMED + order_status_history), админ (block/unblock → login 403; 6 секций; матрица прав 8×4). Machine-подтверждение — route-тесты этого цикла в full-suite (1922/1922).
- **Индивидуальные предложения ZV32-005 → CLOSED:** 9 проверок ZV33-5 (§2 строка 14) + фикс D1 «один заказ на переговоры» → 409 OFFER_ALREADY_ORDERED + условная ссылка order_id; D3 «Принято покупателем» виден кондитеру; D4 checkout показывает согласованную цену; навигация cart-drawer/buyer-offers/cake-builder → checkout починена. Таргет-сьюты 116/116 и 77/77, полный 1922/1922. Запись реализации: `agent-ctx/ZV33-4-zai-code.md`.
- **Цены:** история цен с версиями (0083–0086), future-цена не показывается раньше срока (409 PRICE_PERIOD_CONFLICT на same-instant), клиент не управляет доставкой (`calculateDelivery` серверный), идемпотентность вебхука YooKassa (final-status gate, CAS-эскроу, ledger-ключ `pay-succeeded:<providerId>`), разделение cost/sale (cost-поля не выходят в публичный API). Эталон — OS-документ, блок «Z-v32 ADDENDUM: система цен с историей».
- **CMS:** регрессия draft→preview→publish→409 CMS_CONFLICT→rollback→banners→audit — ALL PASS (ZV33-6 Part A); вкладка «Главная» остаётся Zustand-моком админ-UI — ZV32-002, OPEN P3, метка DEMO/NOT IMPLEMENTED.
- **Честные данные:** удалены live-мок-фолбэки `/api/recipes/[id]/acceptances` (возвращал выдуманных кондитеров при пустом результате) и `/api/video-feed` (маскировал ошибку БД → теперь 503); seed-бэкфилл `scripts/db/setup.mjs` — начальные строки `product_price_history` для всех 12 товаров (идемпотентно); прицельный секрет-скан quick исправлен (ZV33-9b).
- **Backlog:** дельты применены в `docs/operations/PRODUCT_BACKLOG.md` (ZV32-005 → CLOSED, ZV32-003 → CLOSED «не воспроизводится», ZV31-016 — примечание о рецидиве 2026-11-13, новые ZV33-001/002; открытые строки — P3/P4, не блокеры).

## 5. ДЕЙСТВИЯ ВЛАДЕЛЬЦА

1. **Production build** на машине ≥8 GB RAM (рекомендуется 12–16) или CI runner — точная команда `bun run build`, затем smoke `bun run start` и проверка `/`, `/api/products`, `/api/auth/login`; зафиксировать exit code (критерий PASS ⇔ exit 0).
2. **Заполнить production env** по `docs/release/PRODUCTION_ENVIRONMENT_REQUIREMENTS.md` (ключи списком, без значений в документах). Обязательные: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `TFA_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Условные: `YOOKASSA_*`, `YANDEX_*`, `VK_*`, `GOOGLE_*`, `SMTP/MAILGUN_*`, `TELEGRAM_*`, `BOT_SECRET`. **ВАЖНО:** при ротации `JWT_SECRET` перегенерировать `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` той же схемой HS256 (iss=local, role claim) — иначе PostgREST-шим деградирует их до anon-прав (урок ZV33-3b).
3. **Подтвердить fast-forward push:** origin/main `8a31081` — предок HEAD; `git push origin main` (без force) публикует 283 коммита; push — отдельный согласованный этап (§7 OS-документа).
4. **Production deploy — только после отдельного подтверждения** владельцем (вне этой сессии; см. UPDATE_RUNBOOK §3–5).
5. **После deploy:** проверить webhook YooKassa (повторная доставка не задваивает суммы), cron-эндпоинты с `CRON_SECRET` (fail-closed без него), backup PostgreSQL + тест восстановления (`ops:backup` → `ops:restore-verify` на disposable БД — бэкап без доказанного восстановления не считается бэкапом).

## 6. Чего НЕ сделано

- **Автоматический rollback БД не реализован:** миграции forward-only (ledger `schema_migrations`), механизма понижения нет; откат = восстановление из бэкапа по `docs/operations/ROLLBACK_RUNBOOK.md` (§4) и `BACKUP_RECOVERY.md` (§5).
- **Production build не выполнен в песочнице** (строки 9–10 матрицы: NOT RUN — OWNER ACTION REQUIRED; причина — запрет запуска + 3.9 GiB RAM/no swap, OOM-прецедент exit 137).
- Бэкапы: расписание/офсайт-хранитель — `READY FOR OWNER APPROVAL` (`BACKUP_RECOVERY.md` §2, D-EXT-3/D-EXT-5).
- Точный 11-сценарный интеграционный harness Z-v32 C-2 не сохранён в репо (эфемерный); тематические эквиваленты закоммичены и зелёные (39/39).
