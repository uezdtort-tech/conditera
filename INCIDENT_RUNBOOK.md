# 🚨 INCIDENT_RUNBOOK — «Уездный кондитер»

> **Дежурному:** этот документ — что делать, если что-то упало.
> Заполни контакты перед первым инцидентом. Распечатай и держи под рукой.

---

## 📞 Контакты дежурного

| Роль | Имя | Telegram | Телефон | Email |
|------|-----|----------|---------|-------|
| **Primary** (1-я линия) | Команда дежурных | @conditera_oncall | +7 999 000-00-01 | oncall@conditera.ru |
| **Secondary** (2-я линия) | DevOps-дежурный | @conditera_devops | +7 999 000-00-02 | devops@conditera.ru |
| **CTO** (эскалация) | Технический директор | @conditera_cto | +7 999 000-00-03 | cto@conditera.ru |
| **DevOps-инженер** | Старший DevOps | @conditera_sre | +7 999 000-00-04 | sre@conditera.ru |
| **Регистратор домена** | Beget / Reg.ru | — | +7 800 555-00-00 | — |
| **Хостинг** | Timeweb / Selectel | — | +7 812 555-00-00 | support@hosting.ru |

### 📱 Telegram-группа дежурных
- **Группа инцидентов:** `@conditera_incidents` (добавить всех дежурных + бота мониторинга)
- **Бот алертов:** `@conditera_alerts_bot` — автоматически постит алерты из UptimeRobot/Sentry

### Когда звонить
- **Primary не отвечает 10 минут** → звонить Secondary
- **Secondary не отвечает 10 минут** → звонить CTO
- **Критический инцидент (сайт лежит > 5 мин)** → сразу Primary + Secondary в Telegram-группу `@conditera_incidents`
- **Выходные/праздники 22:00–09:00** → только P0-инциденты (сайт полностью недоступен), для P1/P2 — ждать утро

### 🕐 График дежурств
- **Понедельник–пятница:** 09:00–22:00 — Primary, 22:00–09:00 — Secondary (ночной)
- **Суббота–воскресенье:** дежурный по ротации (см. Google Calendar `conditera-oncall@conditera.ru`)
- **Передача смены:** 09:00 и 22:00 — короткий sync в Telegram-группе, передача открытых инцидентов

---

## 🟢 Сервисы и healthchecks

| Сервис | Health URL / команда | Ожидаемый статус | SLA восстановления |
|--------|----------------------|------------------|-------------------|
| **web** (Next.js) | `curl -s https://conditera.ru/api/health \| jq .status` | `"ok"` + HTTP 200 | 5 мин |
| **db** (PostgreSQL) | `docker exec uyezdny-db pg_isready -U uyezdny` | `accepting connections` | 5 мин |
| **redis** | `docker exec uyezdny-redis redis-cli ping` | `PONG` | 2 мин |
| **chat-service** (Socket.IO) | `curl -s http://localhost:3030/health` | HTTP 200 | 10 мин |
| **n8n** | `curl -s https://conditera.ru/n8n/healthz` | HTTP 200 | 10 мин |
| **caddy** | `curl -s http://localhost:2019/config/` | HTTP 200 | 2 мин |
| **smp-server** (SimpleX) | `echo 'PING' \| timeout 3 nc -q 1 smp.conditera.ru 5223` | соединение установлено | 15 мин |
| **simplex-bridge** | `curl -s http://localhost:5226/health` | HTTP 200 | 15 мин |

---

## 🔴 Типичные сценарии

### 🔴 1. web down (5xx / timeout / не отвечает)

**Симптомы:**
- Главная страница не открывается
- `curl -s https://conditera.ru/api/health` возвращает не 200
- Мониторинг (UptimeRobot / BetterStack) прислал алерт

**Что делать:**

1. **Проверить статус всех контейнеров:**
   ```bash
   docker compose ps
   ```
   Если `web` в статусе `Restarting` или `Exited` → смотри логи (п.2)

2. **Посмотреть последние логи web:**
   ```bash
   docker compose logs web --tail=100
   ```
   - Если `OOMKilled` → рестарт + увеличить memory limit в `docker-compose.yml`
   - Если `migration failed` → см. п.3 (проблема с migrator)
   - Если `EADDRINUSE` → другой процесс занял порт 3000

3. **Просто рестарт web:**
   ```bash
   docker compose restart web
   # ждать 30 сек
   docker compose ps web
   curl -s https://conditera.ru/api/health
   ```

4. **Если не помогает — полный рестарт:**
   ```bash
   docker compose down
   docker compose up -d
   # migrator применит миграции автоматически, затем web стартует
   ```

5. **Если миграция застряла (migrator в статусе Exited non-zero):**
   ```bash
   docker compose logs migrator --tail=50
   # если миграция partially applied:
   npx prisma migrate resolve --rolled-back <migration_name>
   # затем перезапустить migrator:
   docker compose up -d migrator
   ```

6. **Если OOM (out of memory) на сервере:**
   ```bash
   free -h
   docker stats --no-stream
   # определить какой контейнер жрёт память
   # временно увеличить swap:
   sudo fallocate -l 4G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   ```

---

### 🔴 2. db down (PostgreSQL не отвечает)

**Симптомы:**
- Все API возвращают 500 с `PrismaClientInitializationError`
- `docker exec uyezdny-db pg_isready` возвращает `no response`

**Что делать:**

1. **Проверить логи db:**
   ```bash
   docker compose logs db --tail=100
   ```
   - Если `disk full` → см. п.2
   - Если `database files are inconsistent` → см. п.4 (восстановление из бекапа)
   - Если `too many connections` → см. п.3

2. **Диск полный:**
   ```bash
   df -h
   # если /var/lib/docker заполнен на 95%+:
   docker system prune -af --volumes  # ОСТОРОЖНО: удаляет unused volumes
   # или освободить место:
   docker compose logs --tail=0 -f  # остановить streaming логов
   rm -rf /var/lib/docker/containers/*/*-json.log*  # старые логи
   # расширить том (если облачный провайдер):
   # - Yandex Cloud: yc compute disk resize
   # - AWS: aws ec2 modify-volume
   ```

3. **Слишком много соединений:**
   ```bash
   docker exec uyezdny-db psql -U uyezdny uyezdny_konditer -c "SELECT count(*) FROM pg_stat_activity;"
   # если > 90 — прибить idle соединения:
   docker exec uyezdny-db psql -U uyezdny uyezdny_konditer -c \
     "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '15 minutes';"
   ```

4. **Восстановление из бекапа (коррупция БД):**
   ```bash
   # Найти последний бекап
   ls -lh /home/z/my-project/backups/pg/
   # Остановить web (чтобы не было новых записей)
   docker compose stop web
   # Восстановить
   gunzip -c /home/z/my-project/backups/pg/latest.sql.gz | \
     docker exec -i uyezdny-db psql -U uyezdny uyezdny_konditer
   # Перезапустить
   docker compose up -d
   ```

---

### 🔴 3. redis down (сессии/кэш недоступны)

**Симптомы:**
- Пользователи выкидываются из аккаунта
- Rate-limiting не работает (слишком много запросов проходит)
- Socket.IO чат не работает

**Что делать:**

1. **Рестарт redis:**
   ```bash
   docker compose restart redis
   # ждать 10 сек
   docker exec uyezdny-redis redis-cli ping
   ```
   Обычно помогает — Redis персистит данные на диск, при рестарте поднимает их.

2. **Если не помогает — проверить диск:**
   ```bash
   docker compose logs redis --tail=50
   # если RDB/AOF corruption:
   docker compose down redis
   docker volume rm uyezdny-konditer_redis_data
   docker compose up -d redis
   ```
   ⚠️ **Внимание:** это сбросит все сессии — пользователи будут разлогинены.

3. **Предупредить пользователей:**
   - Опубликовать в Telegram-канале: «Кратковременные проблемы с авторизацией, нужно перезайти»
   - Проверить что кэш `next` не лежит в Redis (если лежит — пересобрать ISR)

---

### 🔴 4. n8n down (автоматизация не работает)

**Симптомы:**
- Не приходят дайджесты / напоминания о брошенной корзине
- Cron-задачи не выполняются
- `curl -s https://conditera.ru/n8n/healthz` возвращает не 200

**Что делать:**

1. **Проверить логи n8n:**
   ```bash
   docker compose logs n8n --tail=100
   ```
   - Частая причина: `webhook URL` недоступен (n8n не достучен до `web:3000`)
   - Если `OOM` → увеличить memory limit

2. **Рестарт n8n:**
   ```bash
   docker compose restart n8n
   ```

3. **Проверить активные workflows:**
   - Открыть `https://conditera.ru/n8n/` (basic auth: admin / `N8N_ADMIN_PASSWORD`)
   - Раздел `Executions` → последние ошибки
   - Если workflow упал — перезапустить вручную

4. **Если n8n не стартует (corrupted DB):**
   ```bash
   # Бекап текущего состояния
   docker cp uyezdny-n8n:/home/node/.n8n ./backups/n8n-$(date +%Y%m%d).tar
   # Удалить и пересоздать volume
   docker compose down n8n
   docker volume rm uyezdny-konditer_n8n_data
   docker compose up -d n8n
   # Импортировать workflows заново:
   docker exec uyezdny-n8n n8n import:workflow --all --input=/imports/*.json
   ```

---

### 🔴 5. caddy down (HTTPS не работает)

**Симптомы:**
- Браузер показывает `ERR_CONNECTION_REFUSED`
- `curl https://conditera.ru` не работает, `curl http://conditera.ru` работает
- Сертификат истёк

**Что делать:**

1. **Рестарт caddy:**
   ```bash
   docker compose restart caddy
   # ждать 10 сек
   curl -sI https://conditera.ru/ | head -3
   ```

2. **Проверить логи caddy:**
   ```bash
   docker compose logs caddy --tail=50
   ```
   - Если `certificate renewal failed` → см. п.3
   - Если `bind: address already in use` → другой процесс занял 80/443

3. **Проблема с сертификатом (Let's Encrypt):**
   ```bash
   # Проверить статус сертификата
   docker exec uyezdny-caddy caddy list-modules | grep tls
   # Принудительно запросить новый
   docker exec uyezdny-caddy caddy reload --config /etc/caddy/Caddyfile
   # Проверить что ACME challenge проходит:
   curl -sI https://acme-v02.api.letsencrypt.org/directory
   ```
   ⚠️ **Важно:** Let's Encrypt даёт только 5 попыток в неделю на домен.
   Не делай retry без понимания причины.

4. **Если порт занят:**
   ```bash
   sudo lsof -i :80
   sudo lsof -i :443
   # убить процесс:
   sudo kill -9 <PID>
   docker compose up -d caddy
   ```

---

### 🟡 6. Заметная деградация (медленный ответ, 5xx на части запросов)

**Симптомы:**
- Главная открывается, но медленно (> 3 сек)
- Часть API возвращает 500/502
- Пользователи жалуются на «лагает»

**Что делать:**

1. **Проверить нагрузку:**
   ```bash
   docker stats --no-stream
   # что потребляет CPU/memory?
   top -b -n 1 | head -20
   ```

2. **Проверить slow queries в БД:**
   ```bash
   docker exec uyezdny-db psql -U uyezdny uyezdny_konditer -c \
     "SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
      FROM pg_stat_activity
      WHERE state != 'idle' AND now() - pg_stat_activity.query_start > interval '5 seconds'
      ORDER BY duration DESC;"
   # прибить зависший запрос:
   # SELECT pg_terminate_backend(<pid>);
   ```

3. **Проверить Sentry** (если настроен):
   - `https://sentry.io/organizations/<org>/projects/uyezdny-konditer/`
   - Смотреть новые errors за последние 10 минут

4. **Включить maintenance-mode если нужно:**
   ```bash
   # Заглушка на caddy:
   echo 'conditera.ru { respond 503 }' > /tmp/Caddyfile.maintenance
   docker run --rm -v /tmp/Caddyfile.maintenance:/etc/caddy/Caddyfile caddy:2.8-alpine
   ```

---

### 🟡 7. Спам / атака (необычный трафик)

**Симптомы:**
- Резкий всплеск запросов (см. `docker stats`, `caddy access log`)
- Много 429 (rate limit сработал)
- Много 401 (brute-force на /api/auth/login)

**Что делать:**

1. **Определить источник:**
   ```bash
   # Топ IP по запросам за последний час
   docker compose logs caddy --since 1h | \
     grep -oP '"remote_ip":"[^"]+"' | sort | uniq -c | sort -rn | head -20
   ```

2. **Заблокировать IP в caddy (временно):**
   ```
   # добавить в Caddyfile:
   @blocked remote_ip 1.2.3.4 5.6.7.8
   handle @blocked { respond 403 }
   ```
   ```bash
   docker compose reload caddy
   ```

3. **Если DDoS — подключить Cloudflare:**
   - В Cloudflare dashboard: переключить DNS на proxied
   - Включить `Under Attack` mode

4. **Проверить что rate-limit работает:**
   ```bash
   # Должны быть 429 ответы
   docker compose logs caddy --since 10m | grep " 429 " | wc -l
   ```

---

## 📊 После инцидента (post-mortem)

В течение **24 часов** после разрешения инцидента:

1. **Создать задачу в трекере** с тегом `incident`
2. **Заполнить post-mortem шаблон:**

```markdown
## Инцидент #<NUMBER> — <краткое описание>

**Дата:** YYYY-MM-DD HH:MM (UTC+3)
**Длительность:** N минут
**Severity:** P0 (полный отказ) / P1 (частичный) / P2 (деградация)
**Затронуто пользователей:** ~N

### Что произошло
<описание симптомов>

### Причина (root cause)
<техническое объяснение>

### Что было сделано
1. ...
2. ...

### Что нужно сделать чтобы не повторилось
- [ ] <action item 1> (ответственный: @username, срок: YYYY-MM-DD)
- [ ] <action item 2>

### Что сработало хорошо
- ...

### Что сработало плохо
- ...
```

3. **Обсудить с командой** на ближайшем стендапе
4. **Обновить этот runbook** если нашли новый сценарий

---

## 🔧 Полезные команды (шпаргалка)

```bash
# ===== Статус всех сервисов =====
docker compose ps

# ===== Логи (последние 100 строк) =====
docker compose logs --tail=100 <service>
docker compose logs --tail=100 -f <service>  # streaming

# ===== Перезапуск одного сервиса =====
docker compose restart <service>

# ===== Полный перезапуск =====
docker compose down
docker compose up -d

# ===== Зайти в контейнер =====
docker exec -it uyezdny-web sh
docker exec -it uyezdny-db psql -U uyezdny uyezdny_konditer
docker exec -it uyezdny-redis redis-cli

# ===== Бекап БД вручную =====
docker exec uyezdny-db pg_dump -U uyezdny uyezdny_konditer | gzip > \
  ./backups/pg/manual-$(date +%Y%m%d-%H%M).sql.gz

# ===== Восстановление БД =====
gunzip -c ./backups/pg/latest.sql.gz | \
  docker exec -i uyezdny-db psql -U uyezdny uyezdny_konditer

# ===== Проверка health всех сервисов =====
for svc in web db redis chat n8n; do
  echo "=== $svc ==="
  docker compose ps $svc | tail -1
done

# ===== Очистка места (ОСТОРОЖНО) =====
docker system prune -af --volumes  # удаляет ВСЁ неиспользуемое
docker compose logs --tail=0 -f    # остановить streaming

# ===== Мониторинг в реальном времени =====
docker stats  # CPU/memory/network всех контейнеров
watch -n 2 'docker compose ps'
```

---

## 📋 Pre-deployment checklist

Перед каждым деплоем в production:

- [ ] Все тесты зелёные (`npm test`)
- [ ] Typecheck проходит (`npm run typecheck`)
- [ ] Build успешный (`npm run build`)
- [ ] E2E тесты прошли (`npm run test:e2e`)
- [ ] Миграции БД проверены на staging
- [ ] .env.production содержит все нужные секреты
- [ ] Caddyfile валиден (`caddy validate`)
- [ ] Backup БД сделан перед деплоем
- [ ] Заложено окно отката (rollback plan)

## 📋 Rollback plan

Если деплой сломал прод:

1. **Откатить код:**
   ```bash
   git revert <bad-commit>
   git push origin main
   # CI/CD автоматически соберёт и задеплоит
   ```

2. **Откатить миграции БД (если были):**
   ```bash
   # ВНИМАНИЕ: destructively! Сначала бекап!
   npx prisma migrate resolve --rolled-back <migration_name>
   ```

3. **Откатить Docker образ:**
   ```bash
   # Если используете теги версий:
   docker compose down web
   docker tag uyezdny-konditer:previous uyezdny-konditer:latest
   docker compose up -d web
   ```

4. **Восстановить БД из бекапа** (если миграция повредила данные):
   ```bash
   gunzip -c ./backups/pg/pre-deploy-$(date +%Y%m%d).sql.gz | \
     docker exec -i uyezdny-db psql -U uyezdny uyezdny_konditer
   ```

---

## 📚 Дополнительные ресурсы

- **CI/CD pipeline:** `.github/workflows/ci.yml`
- **Docker Compose:** `docker-compose.yml`
- **Caddyfile:** `Caddyfile`
- **Env template:** `.env.production.template`
- **Action plan:** `ACTION_PLAN.md`
- **Prisma schema:** `prisma/schema.prisma`
- **Sentry dashboard:** _заполнить URL_
- **Uptime monitoring:** _заполнить URL (UptimeRobot / BetterStack)_
- **Grafana dashboard:** _заполнить URL_

---

**Последнее обновление:** August 2026
**Версия документа:** 1.0
**Ответственный:** _заполнить_
