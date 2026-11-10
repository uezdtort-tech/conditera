# RELEASE RUNBOOK — Conditera

Порядок публикации после письменного разрешения владельца. Никакие шаги не выполняются
автоматически без approval.

## 0. Предусловия

- [ ] OWNER_ACTIONS_REQUIRED.md закрыт (credentials, environments, approval, юр. данные).
- [ ] `main` запушен, CI (ci.yml + e2e.yml) зелёный на HEAD.
- [ ] Staging deployment прошёл и проверен (staging-deploy.yml, health + smoke).
- [ ] GitHub Environment `production` настроен с required reviewers.

## 1. Подготовка

```bash
# 1.1. Тег релиза
git tag -a release-$(date +%Y%m%d) -m "Conditera public release" && git push origin release-$(date +%Y%m%d)

# 1.2. Запустить deploy.yml (workflow_dispatch) — окружение production запросит approval
```

## 2. Database

```bash
# 2.1. ОБЯЗАТЕЛЬНЫЙ backup ДО миграций
bun run ops:backup

# 2.2. Restore-verify на disposable-БД (доказательство, что backup живой)
bun run ops:restore-verify

# 2.3. Применение миграций statement-by-statement (боевой путь)
# См. DATABASE_RELEASE_CHECK.md; ledger-сверка после применения.
```

## 3. Deploy

- `deploy.yml` собирает production-образ (output: standalone) и выкатывает.
- Запрет: не выкатывать вручную в обход workflow (теряется аудит и rollback-точка).

## 4. Post-deploy верификация

```bash
curl -s https://<домен>/api/health          # → "status":"ok", database: ok
curl -s https://<домен>/robots.txt          # → Disallow: /dashboard, /api
curl -s https://<домен>/sitemap.xml | head  # → домен (не localhost)
```

Функциональный smoke (5 минут):
1. Регистрация нового пользователя → вход.
2. Товар → корзина → checkout (тестовый платёж YooKassa test-shop) → success-страница.
3. Админ: заказ появился, статусы переходят, чат по заказу работает.
4. `/api/admin/diagnostics/metrics` с админ-токеном → 200; без токена → 401.

## 5. Включение внешних контуров (поэтапно, после стабилизации)

1. Реальные YooKassa credentials (test-shop → prod) — см. OWNER_ACTIONS.
2. OAuth-провайдеры (Yandex/Google/VK) — redirect-URI на production-домен.
3. n8n (`docker compose up -d n8n`) + импорт 25 воркфлоу + `N8N_WEBHOOK_*`.
4. Telegram-бот (`/api/telegram/webhook` setWebhook с secret_token).

## 6. Первые сутки

- Мониторинг: `/api/health` (lastCriticalAt), Telegram-алерты инцидентов,
  `/api/admin/diagnostics/incidents` (fingerprint-агрегация).
- Backup: убедиться, что ночной cron (maintenance.yml) создал бэкап и прошёл restore-verify.
