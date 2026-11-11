# RELEASE-ROLLBACK-CHECKLIST — Conditera (v4.8)

> Назначение: процедурный чек-лист отката/остановки релиза и мониторинга.
> Статус заполнения: repository-anchored (что видно из репо) + явные `OWNER INPUT REQUIRED`
> для инфраструктуры, недоступной в sandbox. Никакие выдуманные команды/параметры
> production-инфраструктуры не вписаны.

## 0. Полномочия (КТО разрешает deploy/rollback)

| Действие | Кто разрешает |
|---|---|
| Запуск deploy | **OWNER INPUT REQUIRED** — имя/канал ответственного не зафиксирован в репо |
| Разрешение rollback | **OWNER INPUT REQUIRED** |
| Остановка релиза при деградации | Любой инженер с доступом к серверу МОЖЕТ остановить трафик (безопасность > согласования), но обязан уведомить владельца немедленно |

## 1. Резервные копии БД (PostgreSQL через docker-compose, сервис `db`)

- **Источник**: PostgreSQL-контейнер (`db`), том `db_data` (см. `docker-compose.yml`).
- **Частота**: `OWNER INPUT REQUIRED` — в compose автоматический backup-сервис ОТСУТСТВУЕТ (проверено rg «backup|pg_dump» docker-compose.yml — 0 совпадений). Рекомендация: pg_dump cron каждые 6ч + перед каждым deploy.
- **Хранение/ретеншн**: `OWNER INPUT REQUIRED` (минимум 7 дневных копий, 4 недельных — рекомендация).
- **Последняя верификация восстановления**: `OWNER INPUT REQUIRED` (если никогда не проверялась — считать бэкапы НЕподтверждёнными).

### 1.1 Команда backup ПЕРЕД применением изменений (шаблон, требует проверки владельцем)

```bash
# Выполнять НА ХОСТЕ с работающим compose-стеком.
# Имя контейнера db см. docker-compose.yml (service db, container_name — OWNER INPUT REQUIRED).
docker exec <db_container> pg_dump -U postgres -Fc conditera > "backup-$(date -u +%Y%m%dT%H%M%SZ)-pre-deploy.dump"
sha256sum "backup-$(date -u +%Y%m%dT%H%M%SZ)-pre-deploy.dump"  # зафиксировать checksum рядом с файлом
```

### 1.2 Проверка, что копия РЕАЛЬНО восстанавливается (обязательна хотя бы раз до релиза)

```bash
# Восстановление во ВРЕМЕННУЮ БД (не в production-контейнер!)
docker exec <db_container> pg_restore -U postgres -d postgres --create --clean \
  --dbname=restore_check < backup-pre-deploy.dump
# Сверка: число ключевых таблиц/строк (profiles, orders, order_fraud_logs) между restore_check и conditera
docker exec <db_container> psql -U postgres -d restore_check -c "\dt"
```

**Гейт**: копия без успешного test-restore не считается валидной.

## 2. Откат приложения к предыдущему образу

- Образы тегируются SHA кандидата: `conditera:<SHA>`, `conditera-chat:<SHA>`, `conditera-simplex-bridge:<SHA>` (ci.yml, `CANDIDATE_SHA`).
- Предыдущий валидный образ: `OWNER INPUT REQUIRED` — список образов на сервере (`docker images`) и последний green-CI SHA.

```bash
# Откат web на предыдущий SHA (на сервере):
# 1) зафиксировать текущий тег: docker inspect conditera-web | jq '.Config.Image'
docker compose -f docker-compose.yml stop web
docker tag conditera:<PREV_SHA> conditera:local   # или WEB_IMAGE=conditera:<PREV_SHA> в .env.production
docker compose -f docker-compose.yml up -d web
curl -sf http://127.0.0.1:3000/api/health   # healthcheck до возобновления трафика
```

- Chat/simplex-bridge откатываются аналогично своими compose-сервисами.
- **Порядок при частичном откате**: web → chat → остальные. Не смешивать образы разных SHA в одном релизе без понимания совместимости API.

## 3. Совместимость отката кода с применёнными миграциями

- Миграции: `supabase/migrations/*.sql` (последняя: `0060_p11_hardening_integrity.sql`).
- Правило: **откат кода НЕ откатывает миграции.** Перед deploy миграций убедиться, что новая версия кода НЕ требует колонок/таблиц из ещё не применённых миграций — и наоборот: предыдущий образ должен работать с уже применёнными миграциями (backward-compatible schema).
- Процедура: перед deploy сверить список применённых миграций с теми, что引入 новым кодом; если миграции разрушительны (DROP/RENAME) — сначала backup (п.1), затем миграция, и откат кода до предыдущего образа возможен ТОЛЬКО если он совместим с новой схемой.

## 4. Остановка релиза при ошибках health/readiness

1. **Обнаружение**: `/api/health` отвечает `503` с `status: degraded` (см. live-пробу v4.6: честный fail-closed контракт). Cloudflare Tunnel health + UptimeRobot опрашивают `/healthz` и `/api/health` (Caddyfile: health_uri /api/health, интервал 10s).
2. **Остановка трафика** (без удаления контейнеров):
   ```bash
   docker compose -f docker-compose.yml stop web          # приложение
   # Caddy остаётся живым: /healthz отвечает "OK 200", клиенты получают 503 от Caddy
   ```
3. **Возврат предыдущей версии**: см. п.2 (тег предыдущего SHA).
4. **Критерий отката** (любое из): error-rate 5xx > 5% за 5 минут; регистрация/логин массово 500; платежные webhook'и падают; чат недоступен > 10 мин.
5. После отката: сохранить логи (`docker logs conditera-web > web-fail-$(date +%s).log`) до остановки контейнера.

## 5. Мониторинг — ключевые сигналы

| Сигнал | Где смотреть | Порог внимания |
|---|---|---|
| Регистрации: 429 spike | логи web / anti-fraud reason «Превышен лимит» | > 10/час с одного IP — атака |
| 5xx | Caddy access log (`/data/access.log`, json) | > 5% за 5 мин |
| Failed payments/webhooks | логи web (yookassa/webhook handlers) | любой failed платеж |
| DB health | `/api/health` → database status | «unavailable» = немедленная реакция |
| Chat errors | контейнер chat-service, socket.io connect errors | отключения > 10 мин |
| Upload failures | логи /api/upload, /api/services/upload | рост 4xx/5xx |
| Anti-fraud fail-open | логи web «anti-fraud ... failed» | любое появление = деградация защиты |

- Алертинг-стек (Prometheus/Grafana/UptimeRobot и пр.): `OWNER INPUT REQUIRED` — в compose не описан.
- Синтетический мониторинг: `/healthz` (Caddy 200) + `/api/health` (реальный статус зависимостей).

## 6. Связь с release-gate

- Rollback-решения принимает владелец (см. RELEASE-GATE-v4.8-REPORT.md: PRODUCTION-READY: NO — CI/Docker гейты на опубликованном кандидате не выполнены).
- Перед первым production deploy обязательно: п.1.1 backup + п.1.2 test-restore + подтверждение владельцем.

## 7. OWNER INPUT REQUIRED — сводный перечень данных инфраструктуры (v4.8)

Все параметры, недоступные из sandbox, собраны в одну таблицу — владелец заполняет одним проходом до deploy. Ничего не выдумано: пустые ячейки = нет данных в репозитории.

| # | Параметр | Где взять на сервере | Значение (владелец) |
|---|---|---|---|
| OI-1 | Ответственный за deploy/rollback (имя, канал связи) | — | |
| OI-2 | Имя контейнера `db` (container_name в живом compose) | `docker ps --format '{{.Names}}'` | |
| OI-3 | Частота/окно автоматических backup БД (или подтверждение «только ручной перед deploy») | crontab/система backup | |
| OI-4 | Хранилище и ретеншн backup (где лежат, сколько хранятся) | — | |
| OI-5 | Дата последнего УСПЕШНОГО test-restore (п.1.2) | журнал восстановлений | |
| OI-6 | Список образов на сервере + последний green-CI SHA | `docker images \| grep conditera` | |
| OI-7 | Алертинг-стек (UptimeRobot/Prometheus/прочее) и кто получает алерты | панель мониторинга | |
| OI-8 | Фактический ingress cloudflared: `service:` для conditera.ru/www | `cat ~/.cloudflared/config.yml` или `systemctl cat cloudflared` | |
| OI-9 | Слушающие адреса 3000/6432/7700/8081 (должны быть 127.0.0.1) и 80/443 (0.0.0.0) | `sudo ss -tlnp` | |
| OI-10 | Поднимается ли на хосте supabase-стек (docker-compose.supabase.yml: Kong 8000/Studio 8100) — если да, перепривязать на 127.0.0.1 | `docker ps` | |
| OI-11 | Контакты поддержки, показываемые покупателю в футере (для пилота — путь возвратов без онлайн-формы) | сайт/футер | |
| OI-12 | Провайдер production-auth (GoTrue/Supabase URL) и подтверждение, что dev-stub не используется | env на сервере / AUTH.md | |

Заполненная таблица + выполненные п.1.1/1.2 — обязательное условие снятия BLOCKED с backup-гейта (RELEASE-GATE-v4.8-REPORT.md).
