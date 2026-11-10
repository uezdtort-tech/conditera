# N8N_ACCEPTANCE — фактическое состояние n8n-автоматизации (Z-v21)

**Дата:** 2026-11-10 · Метод: аудит кода + фактические прогоны verify-скриптов. Никаких выдуманных execution IDs.

## 1. Итоговый вердикт

**n8n workflows: NOT VERIFIED (частично BLOCKED).** Реальный движок n8n в песочнице не запущен (Docker недоступен; локальная установка `/home/z/n8n` неактивна). Единственный живой приёмник — dev-stub `mini-services/n8n-receiver` (:5678), который только логирует события в память. Выполнение узлов, retries, error-workflow и бизнес-эффекты workflows **не проверялись фактически — их нельзя проверить без запущенного n8n и credentials**.

## 2. Что доказано фактически (эта сессия)

| Проверка | Результат | Доказательство |
|---|---|---|
| Приложение создаёт и отправляет события | Доказано ранее (Z-v20) и повторно в Z-v21 прогоном E2E | `emitEvent()` в `src/lib/n8n.ts`; при health-пробе stub отвечает |
| Stub-receiver принимает события | PASS | `mini-services/n8n-receiver` `GET /healthz` → ok; события видны в `GET /events` |
| JSON-валидность 25 workflow | PASS | `n8n-workflows/*.json` — все парсятся (Z-v20 + повторная проверка структуры в Z-v21) |
| Health-проба n8n | PASS (с оговоркой) | `checkN8n()` fail-open: «ok» = «какой-то HTTP ответил на :5678» — **не** доказательство работающего n8n |
| Идемпотентность повторной доставки | **NOT VERIFIED** | эмиттер не посылает `eventId`, receiver не дедуплицирует; повторная доставка → повторное событие в stub |

## 3. Таблица приёмки (обязательные сценарии)

| Workflow | Trigger | Реальный запуск | Результат | Idempotency | Ошибки |
|---|---|---|---|---|---|
| 26-conditera-event-bus (шаблон маршрутизации 9 событий) | webhook `conditera-*` | НЕТ (n8n не запущен) | NOT VERIFIED | нет (нет eventId) | не проверялся |
| automation/new-order → Telegram | webhook | НЕТ | NOT VERIFIED | нет | Telegram credentials ПУСТЫ → заблокировано |
| automation/auto-approve (cron 30 мин) | schedule | НЕТ | NOT VERIFIED | n/a | требует живого n8n |
| automation/daily-digest (09:00) | schedule | НЕТ | NOT VERIFIED | n/a | требует живого n8n |
| 01–25 (каталог: abandoned-cart, backup, cleanup, AI-модерации и пр.) | schedule/webhook | НЕТ | NOT VERIFIED | у HTTP-узлов retryOnFail maxTries=3 (JSON), фактически не проверено | требует n8n |

**Поддержка escalation и критические ошибки:** события `support escalation` и `critical error` в n8n **не отправляются** (эмиттер покрывает 9 доменных событий: order.created/paid/status_changed/cancelled, refund.created/completed, chat.message.created, inventory.low, service.booking.created). Разрыв против ТЗ §8 — зафиксирован.

## 4. Архитектура (как есть)

```
Бизнес-код ──emitEvent()──► POST ${N8N_WEBHOOK_BASE_URL||N8N_BASE_URL}/conditera-${type}
                            (fire-and-forget, 3s timeout, БЕЗ ретраев/очереди/eventId)
                            при сбое → audit_log «n8n.dead-letter» (без replay-инструмента в main)
n8n ──pull──► GET /api/cron/* с X-Cron-Secret (pull-модель, основной контракт)
n8n ──push──► POST /api/webhooks/n8n с X-N8N-Secret (audit_log; 503 fail-closed без секрета)
```

Обратная сторона (webhooks/n8n): тайминг-безопасное сравнение секрета (Z-v20). Stub-receiver: сравнение НЕ тайминг-безопасное (улучшение существует только на gate-ветках `release-candidate/gate-19/20` — не смержено в main).

## 5. Блокеры и что нужно для фактической приёмки

1. **Запущенный n8n** (владелец: `docker compose up -d n8n` на VPS/staging или активация установки в `/home/z/n8n`).
2. **`N8N_WEBHOOK_SECRET`** в env — иначе push-приёмник 503 fail-closed (сейчас отсутствует в `.env.local`).
3. **Telegram credentials** для workflow уведомлений (сейчас `CONDITERA_TG_BOT_TOKEN` пуст).
4. Рекомендуемые улучшения (не блокеры релиза, но нужно для надёжности): cherry-pick из gate-веток `eventId` + `res.ok`-dead-letter + replay-скрипт (`scripts/verify/n8n-dead-letter-replay.mjs`); отправка событий escalation/critical error; выравнивание имён env (`N8N_WEBHOOK_URL`/`N8N_API_KEY` в шаблонах нигде не читаются кодом).
5. Уточнить health-семантику: пробовать `/healthz` вместо корня (сейчас «ok» завышен).

## 6. Демонстрация потока (воспроизводимая)

```
bun run dev (порт 3000) + bun run dev в mini-services/n8n-receiver (:5678)
GET http://localhost:5678/healthz → ok
E2E-прогон заказа (order-lifecycle-verify) → события order.created/status_changed
GET http://localhost:5678/events → события присутствуют (Z-v20: 12 событий; Z-v21: повторные прогоны)
```

Вывод: **канал доставки приложение→receiver работает**; «n8n workflow выполняется и производит бизнес-эффект» — не доказано, статус NOT VERIFIED/BLOCKED до запуска движка владельцем.
