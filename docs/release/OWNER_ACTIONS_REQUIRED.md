# OWNER_ACTIONS_REQUIRED — что нужно от владельца (Z-v21)

**Дата:** 2026-11-10. Список отсортирован по влиянию на релиз. Секреты в чат не присылать — настраиваются в env/GitHub Secrets.

## A-1. Разрешение на публикацию локальной истории (push)

- **Что:** разрешить `git push origin main` (сейчас ~229 локальных коммитов ahead; fast-forward, force не нужен).
- **Зачем:** единственный способ запустить GitHub Actions (build/docker-гейты физически не выполняются в песочнице — OOM), синхронизировать origin.
- **Где:** выполнить push владельцем (или дать разовую команду агенту).
- **После:** фактический прогон 5 workflows; зелёный CI — условие STAGING DEPLOYED.
- **Обязательно:** для staging и release. **Риски:** публикация всей локальной истории (включая служебные verify-коммиты).

## A-2. Разрешение на staging-развёртывание

- **Что:** выделить staging-хост/БД и разрешить Этапы 1–3 RUNBOOK (миграции только на staging-БД).
- **Зачем:** переход READY FOR STAGING → STAGING DEPLOYED, приёмка интеграций.
- **Обязательно:** для STAGING DEPLOYED. **Риски:** минимальные при изоляции (STAGING_ENVIRONMENT.md §1).

## A-3. GitHub Actions secrets (опционально для CI, нужно для e2e/maintenance)

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (e2e notify), `MAINTENANCE_APP_URL`/`MAINTENANCE_CRON_SECRET`/`STAGING_HOST`/`STAGING_SSH_KEY` (maintenance).
- Обязательно: только для соответствующих workflows; основной ci.yml автономен.

## A-4. Yandex OAuth credentials

- **Что:** создать OAuth-приложение (https://oauth.yandex.ru/client/new), redirect `https://<host>/api/auth/oauth/yandex/callback`, заполнить `YANDEX_CLIENT_ID` (+`YANDEX_CLIENT_SECRET`, либо public client), `YANDEX_OAUTH_REDIRECT`.
- **Зачем:** живая проверка цепочки (сейчас вся цепочка реализована и локально тестируема до границы провайдера; без credentials — честный 501).
- **Обязательно:** для release (если OAuth входит в MVP-логин).

## A-5. Решение по VK ID (продуктовое — владелец)

- **Вариант A:** реализовать VK ID полностью (готовая реализация есть в незасмерженной ветке `release-candidate/gate-20` + нужны VK-креды).
- **Вариант B:** официально исключить из MVP. Текущее состояние — fail-closed (501) + честный тост «не настроен» + `integrations-status.vk=false` + пометка в env-шаблонах; misleading-риска нет.
- **Обязательно:** да (выбор scope). Без выбора статус останется «VK: не реализован, исключён de-facto».

## A-6. YooKassa sandbox credentials

- **Что:** тестовый магазин `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY` + регистрация webhook-URL staging.
- **Зачем:** живой sandbox-цикл (PAYMENT_ACCEPTANCE.md §5) — условие payment PASS.
- **Обязательно:** для release, если платежи в MVP.

## A-7. n8n: запуск движка и credentials

- **Что:** `docker compose up -d n8n` (или активация установки в /home/z/n8n), заполнить `N8N_WEBHOOK_SECRET`, Telegram-токен для workflow.
- **Зачем:** фактическое выполнение workflows (N8N_ACCEPTANCE.md) — сейчас только stub-receiver.
- **Обязательно:** для release, если n8n входит в релизный объём; иначе официально исключить.

## A-8. SMTP/SMS credentials (опционально)

- Email деградирует честно без SMTP (записи failed: "SMTP not configured"); SMS выключен по умолчанию. Нужны только если email-уведомления входят в MVP-релиз.

## A-9. supabase/functions (Дрейф-риск)

- **Решение:** не деплоить `supabase/functions/*` (в т.ч. слабый дублирующий yookassa-webhook с verify_jwt=false) либо удалить из проекта. В Next.js-рантайм они не входят.

## Уже сделано агентом (владельцу повторять НЕ нужно)

- Baseline, полный локальный тест-прогон (1571/1571), миграции на чистой PG18, RLS-изоляция, lifecycle 81/81, inventory 8/8, checkout-idem 15/15, diagnostics 16/16, ops 37/37, backup→restore PASSED, браузерная приёмка ключевых путей, 3 дефект-фикса (cms/media role-gate+MIME, integrations-status VK, env-шаблоны YANDEX/VK), 12 релизных документов.
