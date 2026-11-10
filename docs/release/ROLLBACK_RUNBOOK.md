# ROLLBACK RUNBOOK — Conditera

Принцип: откатывается ПРИЛОЖЕНИЕ; БД откатывается только к backup (миграции прямые,
без down-файлов). Любой откат фиксируется в incident-логе.

## Сценарий A — дефект приложения после деплоя (БД не тронута)

1. Определить предыдущую зелёную точку: последний успешный GitHub Actions run
   (`deploy.yml`) или git-тег `release-YYYYMMDD`.
2. Перезапустить deploy.yml на предыдущем коммите/теге (workflow_dispatch + approval)
   — образ пересобирается из прежнего кода.
3. Health-check: `/api/health` → ok; smoke из RELEASE_RUNBOOK §4.
4. Пост-мортем: `/api/admin/diagnostics/incidents` → fingerprint дефекта.

## Сценарий B — миграция применена частично/с ошибкой

1. Остановить трафик (proxy → maintenance page).
2. Не «докатывать» миграции вручную поверх неизвестного состояния.
3. Восстановить БД из последнего backup:
   ```bash
   bun run ops:restore-verify   # сначала проверить живость backup на disposable
   # затем restore на production по docs/operations/BACKUP_RECOVERY.md
   ```
4. Исправить миграцию, проверить на disposable PG18
   (`node scripts/verify/prodpath-release03-verify.mjs`), повторить деплой.

## Сценарий C — повреждение данных (business-data incident)

1. Остановить запись (трафик вниз).
2. Зафиксировать время инцидента (RPO-граница).
3. Restore последнего backup ДО инцидента в disposable-БД → выборочная сверка
   затронутых таблиц (заказы/платежи/ledger).
4. Выгрузить только затронутые строки (не весь restore) и точечно восстановить.
5. Если затронуты платежи — сверка с провайдером (GET /payments/{id}) до любых
   ручных правок статусов.

## Сценарий D — компрометация секретов

1. Ротация: JWT_SECRET/JWT_REFRESH_SECRET (инвалидация сессий), TFA_ENCRYPTION_KEY
   (пользователи перенастраивают 2FA), YOOKASSA/OAuth/Telegram ключи.
2. Проверить audit_log на аномалии (`n8n.dead-letter`, admin-действия).
3. Диагностика: `/api/admin/diagnostics/events` — маскированные, но факт-времена сохранены.

## Что НЕ откатывать

- `app_error_events`, `app_incidents`, `audit_log`, `maintenance_logs` — диагностика
  и аудит; их потеря лишает пост-мортема.
- Финансовый ledger — только сверкой, не откатом.
