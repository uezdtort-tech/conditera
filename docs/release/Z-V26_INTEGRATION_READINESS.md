# Z-v26 — INTEGRATION READINESS

Дата: 2026-11-11 · HEAD `b69ff88` · проверено локально; секреты не выводились (только наличие ключей)

| Интеграция | Код | Локальная проверка | Sandbox | Credentials | Реальный статус | Действие владельца |
|---|---|---|---|---|---|---|
| **Yandex ID (OAuth)** | кнопка в AuthModal; `/api/auth/oauth/yandex` | endpoint отвечает **501 fail-closed** без credentials (curl подтверждён); фолбэк на email/password не ломается | NOT RUN (нет sandbox-приложения) | `YANDEX_CLIENT_ID`/`YANDEX_CLIENT_SECRET` **отсутствуют** | **BLOCKED BY OWNER** | Зарегистрировать OAuth-приложение Яндекса; внести ключи в .env (см. REMAINING_OWNER_ACTIONS) |
| **VK ID** | кнопка «ВКонтакте» в модалке | **501** — честно не реализован на main (integrations-status возвращает false) | — | отсутствуют | **NOT IMPLEMENTED** (заявлено честно) | Отдельная задача (или скрыть кнопку до реализации — решение владельца) |
| **YooKassa** | lib/yookassa: create/confirm/webhook (IP-allowlist IPv4+IPv6)/refund/идемпотентность; unit 15/15 | checkout работает в **stub-режиме** (isStub=true — подтверждено HTTP-сценарием Z-v26); в production-режиме без конфигурации — 503 fail-closed (корректно) | NOT RUN | `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY` **отсутствуют** | **BLOCKED BY OWNER** (код готов) | Внести sandbox-ключи; прогнать sandbox-платёж (реальные платежи запрещены) |
| **n8n** | webhook-receiver (5678) жив (HTTP 200) | receiver принимает события; **настоящий workflow-engine отсутствует** — automation-флоу не исполняются; приложение деградирует безопасно | — | n/a | **NOT OPERATIONAL** (не блокер витрины) | Развернуть n8n и импортировать минимальные workflow (order.created → уведомление) — отдельная настройка |
| **Email/SMTP** | верификация/уведомления | fail-closed без SMTP | NOT RUN | `SMTP_HOST` **отсутствует** | **BLOCKED BY OWNER** (не блокер: заказы создаются без email) | Предоставить SMTP-параметры |
| **Telegram** | уведомления | fail-closed | NOT RUN | `TELEGRAM_BOT_TOKEN` **отсутствует** | **BLOCKED BY OWNER** | Токен бота |
| **PostgreSQL** | embedded 18.4, порт 54329 | setup.mjs/migrations 79, advisory lock (F4), дубликат-гейт (Z-v24), backup/restore PASSED | n/a (локальный) | локальный | **OPERATIONAL (local)** | Для прод — внешний PG (решение владельца) |
| **Supabase (GoTrue/REST)** | локальный pgrst-шим | getSession 501-стаб учтён единым auth-контрактом (cd_session); RLS-изоляция подтверждена Z-v25 | — | service-ключи локальные | **OPERATIONAL (local shim)** | Для облачного Supabase — RLS-каталог F7 (владелец/ops) |
| **Chat (realtime)** | mini-services/chat-server (socket.io, порт 3030) | **ЖИВ**: /health {status:ok, uptime>4700s}; секрет совпадает с Next (F6 разрешён в Z-v25) | n/a | JWT_SECRET локальный | **OPERATIONAL (local)** | Для деплоя — супервизор/Docker (стандартный процесс) |
| **Meilisearch** | опциональный поиск | server-fallback работает без него | NOT RUN | отсутствует | **OPTIONAL / NOT RUN** | Опционально |
| **Storage (upload)** | защищённые 4 файла + MIME-siff | protected paths нетронуты (метаданные до/после); guard scripts/hooks/pre-commit на месте | — | локальный | **OPERATIONAL (local)** | Для облака — S3/Supabase Storage ключи (владелец) |

## Итог

- Локально операционны: PostgreSQL, chat, корзина/checkout (stub-платёж), upload, поиск (fallback).
- Fail-closed подтверждён: OAuth 501, YooKassa 503 в прод-режиме, email/telegram без отправки — приложение не имитирует работоспособность.
- Ничто из внешнего не блокирует контролируемый staging технологически — блокируют отсутствующие у владельца ключи/инфраструктура (см. Z-V26_REMAINING_OWNER_ACTIONS.md).
