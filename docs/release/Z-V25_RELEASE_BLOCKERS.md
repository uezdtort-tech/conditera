# Z-v25 — RELEASE BLOCKERS

Дата: 2026-11-11 · HEAD `3c10708` · Вердикт Z-v25: **READY FOR RELEASE PREPARATION** (подробности — Z-V25_INDEPENDENT_RELEASE_READINESS_REPORT.md §Вердикт)

Этот документ — минимальный исчерпывающий список того, что отделяет проект от controlled staging. Публичный релиз (push/deploy) остаётся запрещён без отдельного разрешения владельца.

---

## БЛОКЕР 1 — Конфигурация товарных данных для checkout (P1, владелец)

**Что**: ни один из 12 published-товаров не проходит acceptance-gate (P0.5 §29): checkout любой товарной позиции → 422.

**Детали**: у 1 товара есть рецепт, но не задано production_time_hours; у 3 задано время, но нет привязки рецепта (RECIPE_MISSING — блокирующий код); у остальных нет ни того, ни другого; у рецепта «Ягодный бархат» — дефицит ингредиента «Ягоды» (250 г) без закупки/ETA.

**Код корректен**: гейт fail-closed по дизайну (Z-v12/Z-v20); при временной настройке данных (в рамках аудита, с последующим откатом) checkout товар+custom прошёл полностью: заказ создан, цены серверные, идемпотентность, snapshot — 10/10.

**Что сделать владельцу** (для каждого товарного card в каталоге):
1. production_time_hours (карточка товара) ИЛИ prep/cook minutes (рецепт);
2. привязка рецепта (recipe_id) для товаров с расчётом ингредиентов;
3. остатки ингредиентов ≥ потребности рецепта ИЛИ закупка с валидной ETA (иначе LOW_STOCK/PURCHASE_ETA_MISSING блокируют);
4. свободные capacity-окна кондитера на дату доставки.

**Проверка закрытия**: `node scripts/verify/p11-hardening-verify.mjs` → 17/17 (сейчас 12/17 из-за каскада) + ручной checkout товарной позиции → 200/201.

## БЛОКЕР 2 — YooKassa credentials (внешний, владелец)

**Что**: платёжный провайдер не сконфигурирован → checkout создаёт заказ в stub-режиме (`isStub:true`, payment/create → stub paymentUrl). В production-режиме без конфигурации checkout возвращает 503 (safe config error — код защищает от неоплачиваемых заказов, это корректно).

**Код готов**: адаптер, create/confirm/webhook (IP-allowlist IPv4+IPv6), refund, сверка refund.succeeded, идемпотентность webhook — покрыты unit-тестами (payment/webhook route.test.ts 15/15 в vitest).

**Что сделать владельцу**: YOOKASSA_SHOP_ID + YOOKASSA_SECRET_KEY (sandbox), затем проверка sandbox-платежа (реальные платежи в рамках Z-v25 не выполнялись — запрещены).

## БЛОКЕР 3 — OAuth credentials (внешний, владелец; опционально для запуска)

**Что**: Yandex ID / Google / VK — 501 fail-closed без credentials. Email/SMTP (SMTP_HOST), Telegram (TELEGRAM_BOT_TOKEN) — не настроены.

**Что сделать владельцу**: зарегистрировать OAuth-приложения, задать YANDEX_CLIENT_ID/SECRET (VK ID не реализован на main — отдельная задача, честно сообщается false в integrations-status), SMTP-параметры почты.

## БЛОКЕР 4 — Инфраструктурные действия запуска (владелец/ops)

1. **chat-server**: поднять персистентно супервизором среды (в аудите инцидент env-drift разрешён, но персистентный экземпляр требует перезапуска средой — см. FINDINGS F5/F6). Для деплоя — стандартный процесс (Docker/супервизор подхватит актуальный .env).
2. **Meilisearch** (опционально): поиск работает и без него (server-fallback), smoke-тест NOT RUN.
3. **n8n**: локально работает только webhook-receiver (5678); настоящий workflow-engine отсутствует → статус интеграции NOT OPERATIONAL (не блокер запуска витрины; automation-флоу будут недоступны).
4. **staging**: secrets не настроены (STAGING_HOST и др.) + CI-опечатка `branches: ain]` (F3) — auto-staging не сработает; настроить при необходимости.

---

## НЕ блокеры (проверены, закрыты в Z-v25)

- Конфликт миграций 0062 / зомби-CHECK — устранён Z-v24, независимо подтверждён Z-v25 (Сценарии A 18/18, B 24/24, C 6/6; HTTP custom item 200).
- Migration runner integrity — setup.mjs/CI fail-fast, леджер честный.
- Корзина/checkout/промокоды/идемпотентность — HTTP+DB подтверждено.
- Lifecycle заказов 81/81, инвентарь 8/8, диагностика 16/16, ops-center 37/37, route-coverage 47/48, backup/restore PASSED.
- TypeScript 0, ESLint 0, Vitest 1571/1571, production build PASS (с heap cap 2048 — см. отчёт §7.3).
- Secrets scan чист, CSRF/SQLi/XSS/ownership пробы чисты, RLS-изоляция подтверждена.
- Защищённые upload-файлы — нетронуты (метаданные до/после).

## Открытые рекомендации (не блокеры)

| ID | Что | Где |
|----|-----|-----|
| F2 | Legacy apply-migrations.ts: exit 1 при failed>0 или удалить | scripts/apply-migrations.ts |
| F3 | branches: [main] | .github/workflows/staging-deploy.yml:37 |
| F4 | pg_advisory_lock в setup.mjs | scripts/db/setup.mjs |
| F7 | RLS для 89 таблиц при Supabase-деплое | prod-конфигурация |
| F8 | /login — авто-открытие модалки | UX |
