# OWNER ACTIONS REQUIRED — Conditera (Z-v20)

Только конкретные действия, которые может выполнить владелец. Всё, что можно было
сделать локально без разрешений, сделано.

## A. Разрешения (без этого ничего из ниже перечисленного не запускается)

1. **Разрешить `git push`** в `uezdtort-tech/conditera` (main). Сейчас локально 220+
   коммитов ahead; push выполняет владелец или даёт письменное разрешение агенту.

## B. GitHub (после push)

2. Убедиться, что CI (`ci.yml`) и E2E (`e2e.yml`) зелёные на HEAD — это первый
   реальный запуск Actions (локальные прогоны не заменяют их).
3. Настроить GitHub Environment **`staging`**: secrets `STAGING_HOST`, `STAGING_SSH_KEY`,
   `STAGING_APP_URL`; запустить `staging-deploy.yml` (workflow_dispatch).
4. Настроить GitHub Environment **`production`**: required reviewers (manual approval);
   secrets прод-окружения (см. PRODUCTION_ENVIRONMENT_REQUIREMENTS.md §2).
5. Настроить maintenance secrets (`MAINTENANCE_APP_URL`, `MAINTENANCE_CRON_SECRET`) —
   иначе maintenance.yml честно покажет SKIPPED.

## C. Внешние сервисы (credentials)

6. **YooKassa**: test-shop → production credentials (`YOOKASSA_SHOP_ID/SECRET_KEY`);
   в личном кабинете YooKassa — вебхук на `https://<домен>/api/payment/webhook`.
   До этого платежи работают только в mock-режиме и в production fail-closed.
7. **OAuth**: Yandex ID (+VK ID при необходимости) — создать приложения, redirect-URI
   `https://<домен>/api/auth/oauth/{provider}/callback`; заполнить `*_CLIENT_ID/SECRET`.
   VK-провайдер сейчас честно возвращает 501 (fail-closed), пока не настроен.
8. **Telegram-бот**: токен у @BotFather, `setWebhook` с `secret_token`;
   `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
9. **Email** (Mailgun/SMTP): credentials + домен отправителя.
10. **Backup storage**: внешнее хранилище (S3-совместимое) + секреты; включить выгрузку
    бэкапов (сейчас только локально — RPO ограничен жизнью машины).

## D. Юридическое и контент (§11 ТЗ)

11. Данные продавца для публичного сайта: ИП/ООО реквизиты, ИНН/ОГРНИП, политика
    конфиденциальности (152-ФЗ), условия использования, условия возврата, контакты.
    В коде страницы-заготовки есть (`/legal`), содержимое — от владельца.
    **Не придумывать реквизиты.**
12. Реальные фотографии продукции вместо demo-seed (витрина работает в dual-mode;
    решение о включении/отключении mock-fallback каталога — за владельцем,
    docs/KNOWN_LIMITATIONS.md №14).
13. Проверить/уточнить комиссии в UI (5% старт / 4% НПД отображаются как факты
    бизнес-модели) — если условия изменятся, поправить тексты на главной.

## E. Инфраструктура публикации

14. Production-хостинг и домен; DNS на хостинг; TLS.
15. `NEXT_PUBLIC_APP_URL=https://<домен>` в прод-секретах (sitemap/og/redirects).
16. Ресурсы машины: ≥ 2 GB RAM на инстанс Next.js; для стабильного полного
    chromium-E2E — машина с ≥ 8 GB (4 GB песочница упирается в kernel OOM).

## F. Решения, которые принимает владелец (не блокируют staging)

17. Включение нишевых модулей (франшиза — backend без UI; аниматоры — UI на моках;
    decor-checkout отсутствует): показывать «скоро» / скрыть / заказать доработку.
18. Включение реальных платежей после sandbox-проверки на боевых credentials.
