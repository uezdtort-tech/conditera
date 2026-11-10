# FINAL QA REPORT — Z-v20

Все команды выполнены на актуальном коде Z-v20. Ни один тест не удалялся и не ослаблялся ради зелёного результата.

## Сводка прогонов

| Набор | Команда | Результат |
|---|---|---|
| Typecheck | `bun run typecheck` | **PASS** (0 ошибок) |
| Lint (изменённые файлы Z-v20) | `bunx eslint <files>` | **PASS** (0 warnings) |
| Unit/Integration (Vitest) | `bunx vitest run --no-file-parallelism` | **108 файлов / 1567 тестов — PASS** |
| Order lifecycle E2E | `bun scripts/verify/order-lifecycle-verify.mjs` | **81/81 PASS** (было 65/81 — см. «Найдено и исправлено») |
| Checkout idempotency E2E | `bun scripts/verify/checkout-idempotency-verify.mjs` | **15/15 PASS** |
| Diagnostics E2E | `bun scripts/verify/diagnostics-verify.mjs` | **16/16 PASS** |
| Route error coverage | `node scripts/verify/route-error-coverage.mjs` | **47/47 критичного периметра PASS** |
| Inventory concurrency | `bun scripts/verify/inventory-concurrency-verify.mjs` | **8/8 PASS** |
| Product media | `bun scripts/verify/product-media-verify.mjs` | **63/63 PASS** |
| Ops center | `bun scripts/verify/ops-center-verify.mjs` | **37/37 PASS** |
| Upload oversize | `bun scripts/verify/upload-oversize-verify.mjs` | **8/8 PASS** |
| U06 three-state | `bun scripts/verify/u06-three-state-live.mjs` | **21/21 PASS** |
| E2E tally contract | `bun scripts/verify/e2e-tally-contract.mjs` | **PASS** |
| P11 hardening | `bun scripts/verify/p11-hardening-verify.mjs` | **PASS** |
| Migration harness (PG18, disposable) | `node scripts/verify/prodpath-release03-verify.mjs` | **SUCCESS** (79 миграций) |
| Backup → restore → verify | `bun scripts/ops/backup-verify-restore.mjs` | **PASSED** (519 записей, 33 таблицы, сверка 17/17) |
| Playwright E2E — mobile-chrome | `bunx playwright test --project=mobile-chrome` | **244/244 PASS** |
| Playwright E2E — chromium (API-спеки) | `--project=chromium` пофайлово | **83/83 PASS** (payment-webhook 12, recipe-purchase+regional 20, api-v2 37, auth-flow 14) |
| Playwright E2E — chromium (UI-вьюпорт) | `--project=chromium` | **Ограничение среды** — см. ниже |
| Production build | `bun run build` | **PASS** (полный маршрут-лист; standalone) |

## Chromium UI-вьюпорт: ограничение среды

Контейнер песочницы — 4 GB. `next dev` (Turbopack) при компиляции страниц достигает
2.6–2.9 GB RSS → kernel OOM-kill (8 событий в dmesg, известная проблема проекта —
см. комментарий в `next.config.ts`). Каждый рестарт компилирует заново
(persistent FS-cache отключён осознанно — повторение его включения вызывало OOM
гидрации, там же задокументировано).

- Идентичные спеки на профиле mobile-chrome: **244/244 PASS** (тот же набор тестов).
- Chromium API-спеки (без загрузки страниц): **83/83 PASS**.
- Chromium UI-спеки падают с `ERR_EMPTY_RESPONSE`/`ECONNREFUSED` (сервер убит ядром),
  а не ассертами. На машине ≥8 GB прогон должен повториться без изменений кода.

## Найдено и исправлено в Z-v20 (QA-контур)

1. **order-lifecycle-verify 65/81 → 81/81.** Корневые причины:
   - в fixture отсутствовал складской остаток «Ягоды» (рецепт требует 250 г) →
     Acceptance Engine корректно блокировал `accept` → каскад запретов переходов.
     Добавлена изолированная idempotent-фикстура склада (INSERT/RESTORE в cleanup);
   - ожидания оценки времени 240/`category` устарели: у товара конфигурировано
     `production_time_hours=6` → 360/`product`/`approximate=false` (честно по ТЗ §10);
   - сценарий E2E №4 (at-risk) выпадал из окна сканирования `computeRiskSnapshotsBulk(3)`
     (дата +4 дня) и конфликтовал по capacity — перенесён на +2 дня;
   - **движок**: ТЗ §20 `CAN_ACCEPT_WITH_PURCHASE` был мёртвым кодом — LOW_STOCK
     оставался блокирующим даже при успевающей закупке. Исправлено
     (`src/lib/ops/acceptance.ts`): при валидной ETA нехватка → предупреждение,
     не блокер. Юнит-набор после фикса: 1567/1567.
2. **Vitest** первый прогон обрывался без summary (OOM при параллелизме файлов) —
   повтор `--no-file-parallelism`: 1567/1567. Это ограничение среды, не тестов.
3. **Playwright**: 54 падения chromium — отсутствие бинарника браузера в окружении
   (`playwright install chromium`); 197 падений против prod-standalone — E2E-набор
   спроектирован под dev-режим (dev-auth, mock-платежи; в prod fail-closed по дизайну).

## FAIL/SKIP реестр

| Что | Причина | Тип |
|---|---|---|
| Chromium UI-спеки (полный прогон) | kernel OOM в 4 GB песочнице | environment |
| Боевой YooKassa (создание/возврат) | нет credentials владельца | external |
| OAuth Yandex/VK реальные провайдеры | нет credentials; VK — честный fail-closed 501 | external |
| GitHub Actions runs | push запрещён без разрешения владельца | external |
| staging deployment | не выполнялся (запрещено) | external |
