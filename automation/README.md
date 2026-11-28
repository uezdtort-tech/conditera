# Автоматизация «Уездный кондитер» — n8n

**Production-статус:** n8n включён в Compose как локальный сервис на `127.0.0.1:5678`; публичный прокси к его UI/API отключён. Историческая песочница `/home/z/n8n` не является источником состояния production.

JSON-файлы в `n8n-workflows/` — исходники workflows. Автоматический импорт и активация этих файлов в production пока не настроены; не считать таблицу ниже доказательством работающих production cron-задач.

## Workflow'и (импортированы и активны)

| Файл | Workflow | Триггер | Действие |
|---|---|---|---|
| `n8n-cron-auto-approve.json` | Cron: auto-approve | Каждые 30 мин | `GET /api/cron/auto-approve` — авто-подтверждение кондитеров (DaData) |
| `n8n-cron-daily-digest.json` | Ежедневный дайджест | Cron `0 9 * * *` (Europe/Moscow) | `GET /api/cron/weekly-digest` → запись прогона в `/api/cron/status` |
| `n8n-webhook-order-telegram.json` | Новый заказ → Telegram | Webhook `POST /webhook/new-order` | `POST api.telegram.org/bot<token>/sendMessage` в канал/чат |

## Переменные окружения n8n (`/home/z/n8n/.env-n8n`, не в репо)

- `N8N_ENCRYPTION_KEY` — шифрование кредов (уже сгенерирован)
- `CONDITERA_CRON_SECRET` — общий секрет с `.env.local` приложения (заполнен)
- `CONDITERA_TG_BOT_TOKEN` — токен бота Telegram (**пустой** — заполните, и
  уведомления о заказах пойдут в канал `@conditera` автоматически)
- `CONDITERA_TG_CHAT_ID` — получатель (`@conditera`)

## Как добавить новый cron-workflow

1. Скопируйте JSON любого файла, поменяйте `id`, `name`, URL эндпоинта.
2. Импорт: `N8N_USER_FOLDER=/home/z/n8n node node_modules/n8n/bin/n8n import:workflow --input=файл.json`
   (выполнять из `/home/z/n8n`).
3. Активация: `... update:workflow --id=<id> --active=true` и рестарт n8n
   (`pkill -f "n8n start"` → демон `start-n8n.sh`).

## Конвенции

- Мутации/cron требуют заголовок `X-Cron-Secret` (см. `src/lib/cron-auth.ts`).
- История прогонов: `POST /api/cron/status` → видна в админ-дашборде.
- Тест webhook: `curl -X POST -d '{"order_number":"T-1","total":"1500","customer_name":"Тест"}' http://localhost:5678/webhook/new-order`

## Доступ к UI

- Локально на production-хосте: http://127.0.0.1:5678
- При первом запуске создать owner account через штатный n8n setup wizard.
- Не использовать общие/дефолтные пароли и не сохранять credentials в репозитории.
