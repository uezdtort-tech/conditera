# Обновление n8n: 1.95.0 → 2.49.5 (чек-лист для владельца)

Дата коммита: 2026-11-24. Пин `2.49.5` — релиз, который Docker Hub на момент
обновления помечал тегом `stable` (совпадает с digest тега `latest`;
hub.docker.com/v2/r/n8nio/n8n/tags). Линия 3.x (3.4.0) существует, но сознательно
не взята: свежая мажорная ветка без периода стабилизации.

## Что изменилось

| Место | Было | Стало |
|---|---|---|
| `docker-compose.yml` (prod, сервис `n8n`) | `n8nio/n8n:1.95.0` | `n8nio/n8n:2.49.5` |
| `docker-compose.dev.yml` (сервис `n8n-dev`) | `n8nio/n8n:latest` | `n8nio/n8n:2.49.5` |

Синхронизация dev с prod устраняет дрейф: workflow-JSON в `n8n-workflows/`
теперь тестируются в dev против той же версии, что будет в проде.

**Не изменялось намеренно:** `N8N_BASIC_AUTH_*` переменные остались в обоих
compose-файлах. n8n 2.x их игнорирует (deprecated), но они необходимы при
откате на 1.95.0. `git revert` коммита возвращает тег и env атомарно.
`N8N_WEBHOOK_SECRET`-контур (`/api/webhooks/n8n`, constant-time сравнение)
не менялся — версия n8n на него не влияет.

## Шаги миграции на машине владельца

### 0. Перед первым запуском 2.x (ОБЯЗАТЕЛЬНО)

n8n 2.x при старте мигрирует внутреннюю SQLite-схему в volume `n8n_data`.
**Обратная миграция не поддерживается** — откат на 1.95.0 с уже
мигрированным volume может не завестись. Поэтому:

```bash
# backup volume ДО первого старта новой версии
docker run --rm -v conditera_n8n_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n_data-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### 1. Обновление

```bash
git pull                       # коммит с пином 2.49.5
docker compose pull n8n
docker compose up -d n8n
docker compose logs -f n8n     # смотреть миграции схемы (INFO Migration)
```

### 2. Первый вход в UI (вместо basic auth)

n8n 2.x игнорирует `N8N_BASIC_AUTH_*`. При первом открытии UI будет
экран **Set up owner account**: задать email и пароль владельца n8n.
Эти креденшелы — новые, к аккаунтам магазина отношения не имеют.
Доступ к UI снаружи по-прежнему через маршрут Caddy `/n8n/` (не изменился).

### 3. Верификация workflow (все 10 из ./n8n-workflows)

- [ ] Все 10 workflow на месте и активны (backup, cleanup, digest,
      bonuses, abandoned-cart, moderation, CRM, forecast, delivery, pricing)
- [ ] Credential-ноды выжили (шифрование через ключ volume; при СВЕЖЕМ
      volume — пересоздать credential'ы вручную)

### 4. Смок-тесты контуров

```bash
# 4a. Webhook-контур n8n → приложение (ожидание {"success":true,...} и HTTP 200)
curl -s -X POST https://conditera.ru/api/webhooks/n8n \
  -H "X-N8N-Secret: $N8N_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"event":"ping","data":{}}'

# 4b. Ручной запуск workflow «abandoned cart» из UI → письмо/событие дошло
# 4c. Weekly digest dry-run → дайджест собрался без ошибок в executions
# 4d. Expiring bonuses → задания отработали, статус Success в executions
```

Если `N8N_WEBHOOK_SECRET` на сервере не задан — приложение ответит 503
(fail-closed): задать переменную в `.env.production` и
`docker compose up -d web n8n`.

### 5. Откат (если что-то пошло не так)

```bash
git revert <sha коммита обновления>   # вернёт тег 1.95.0 и basic-auth env
docker compose up -d n8n
# если volume уже мигрирован 2.x и 1.95.0 не стартует — восстановить backup из шага 0:
docker run --rm -v conditera_n8n_data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/n8n_data-backup-YYYYMMDD.tar.gz -C /data"
```

## Проверки после восстановления прода (связка с мониторингом)

- `/api/health` должен показывать `"n8n":"ok"` (крон Production-watch
  проверяет это 3 раза/день; протокол крона — GET-only, поэтому контур
  `X-N8N-Secret` проверяется вручную шагом 4a).
- В executions n8n не должно быть ошибок аутентификации к `APP_URL`.

## Сопровождение (на будущее)

1. Обновление пина — отдельным коммитом с прогоном смок-тестов 4a–4d на dev.
2. Линия 3.x: пересматривать после её стабилизации (наблюдать за тегом
   `stable` на Docker Hub).
3. Полное удаление `N8N_BASIC_AUTH_*` из compose/docs — после того как
   откат на 1.95.0 станет неактуальным (через 1–2 успешных релиза на 2.x).
