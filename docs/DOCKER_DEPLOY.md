# 🐳 Docker Compose — запуск production-стека

> Пошаговая инструкция по деплою «Уездного кондитера» через Docker Compose.

---

## 📋 Предварительные требования

На сервере должны быть установлены:
- **Docker** 24+ ([установка](https://docs.docker.com/engine/install/))
- **Docker Compose** v2+ (входит в состав Docker)
- **Git** (для клонирования репозитория)
- **Минимум 4 ГБ RAM** (рекомендуется 8 ГБ)
- **20 ГБ диска** (для образов + БД + бекапы)

### Проверка
```bash
docker --version          # Docker version 24+
docker compose version    # Docker Compose version v2+
git --version
free -h                   # минимум 4 ГБ RAM
df -h                     # минимум 20 ГБ на диске
```

---

## 🚀 Первый деплой

### Шаг 1: Клонировать репозиторий
```bash
cd /opt
git clone https://github.com/YOUR_ORG/uyezdny-konditer.git conditera
cd conditera
```

### Шаг 2: Создать .env.production
```bash
# Скопировать шаблон
cp .env.production.template .env.production

# Сгенерировать секреты (если ещё не сделано)
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "TFA_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "CRON_SECRET=$(openssl rand -hex 24)"
echo "N8N_ADMIN_PASSWORD=$(openssl rand -base64 16)"
echo "SIMPLEX_BRIDGE_API_KEY=$(openssl rand -hex 32)"
echo "IP_HASH_SALT=$(openssl rand -hex 16)"

# Отредактировать .env.production — вставить сгенерированные значения
nano .env.production
```

⚠️ **Важно:** заполни также `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `DADATA_API_KEY`, `DADATA_SECRET_KEY`, `SENTRY_DSN` из соответствующих личных кабинетов.

### Шаг 3: Настроить DNS
Следуй инструкции в `docs/DNS_SETUP.md` — настрой A-записи:
- `conditera.ru` → IP сервера
- `www.conditera.ru` → IP сервера
- `smp.conditera.ru` → IP сервера (DNS only, не проксировать!)

### Шаг 4: Собрать и запустить стек
```bash
# Сборка образов (первый раз — ~5-10 минут)
docker compose build

# Запуск всех сервисов
docker compose up -d

# Наблюдение за запуском (логи в реальном времени)
docker compose logs -f --tail=50
```

### Что произойдёт при `docker compose up -d`:

1. **db** запускается первым (PostgreSQL 16)
   - Healthcheck: `pg_isready -U uyezdny`
   - Ждём 10 секунд до ready

2. **redis** запускается параллельно
   - Healthcheck: `redis-cli ping`

3. **migrator** запускается после db+redis
   - Выполняет: `npx prisma migrate deploy`
   - Применяет все миграции из `prisma/migrations/`
   - Завершается с кодом 0 (контейнер останавливается)

4. **web** запускается после успешного migrator
   - Next.js standalone server на порту 3000
   - Healthcheck: `curl /api/health`
   - Ждём 30 секунд до ready

5. **chat-service** запускается после redis
   - Socket.IO сервер на порту 3030

6. **n8n** запускается после web (healthcheck)
   - Автоматизация workflows

7. **caddy** запускается после web + chat-service
   - Обратный прокси + авто-HTTPS (Let's Encrypt)
   - При первом запуске — получает SSL-сертификат (может занять 1-2 минуты)

8. **smp-server** запускается параллельно
   - SimpleX SMP на порту 5223

9. **simplex-bridge** запускается после smp-server + web
   - WebSocket мост между SimpleX и backend

### Шаг 5: Проверить что всё работает
```bash
# Статус всех сервисов
docker compose ps

# Все должны быть "Up" (кроме migrator — он "Exited (0)" после успеха)
# Caddy может быть "health: starting" первые 30 секунд

# Проверка health endpoint
curl -s https://conditera.ru/api/health | jq .
# Должно вернуть: {"status":"ok","service":"uyezdny-konditer",...}

# Проверка главной страницы
curl -sI https://conditera.ru/ | head -5
# Должно вернуть: HTTP/2 200

# Проверка SSL сертификата
openssl s_client -connect conditera.ru:443 -servername conditera.ru < /dev/null 2>/dev/null | openssl x509 -noout -dates
```

---

## 🔄 Обновление (redeploy)

### Через Git pull + rebuild
```bash
cd /opt/conditera
git pull origin main

# Пересобрать образы (только изменённые слои)
docker compose build

# Применить миграции (если есть новые)
docker compose up -d migrator

# Перезапустить web
docker compose up -d web

# Проверить что новый код работает
curl -s https://conditera.ru/api/health
```

### Через CI/CD (автоматически)
Если настроен GitHub Actions с push to registry:
```bash
# На сервере — просто pull + restart
docker compose pull web
docker compose up -d web
```

### Rollback (откат)
```bash
# Откатить код к предыдущей версии
git log --oneline -10
git checkout <previous-commit-hash>
docker compose build web
docker compose up -d web

# Если миграция сломала БД — восстановить из бекапа
gunzip -c ./backups/pg/latest.sql.gz | docker exec -i uyezdny-db psql -U uyezdny uyezdny_konditer
```

---

## 📊 Мониторинг и обслуживание

### Просмотр логов
```bash
# Все сервисы (streaming)
docker compose logs -f --tail=50

# Конкретный сервис
docker compose logs web --tail=100
docker compose logs db --since 1h
docker compose logs caddy -f  # streaming

# Только ошибки
docker compose logs web 2>&1 | grep -i error
```

### Статус сервисов
```bash
# Полный статус
docker compose ps

# С healthcheck статусом
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}"

# Ресурсы (CPU, memory, network)
docker stats --no-stream
```

### Бекап БД
```bash
# Ручной бекап
docker exec uyezdny-db pg_dump -U uyezdny uyezdny_konditer | gzip > \
  ./backups/pg/manual-$(date +%Y%m%d-%H%M).sql.gz

# Авто-бекап через cron (добавить в crontab -e):
# 0 3 * * * cd /opt/conditera && docker exec uyezdny-db pg_dump -U uyezdny uyezdny_konditer | gzip > ./backups/pg/$(date +\%Y\%m\%d).sql.gz
# 0 4 * * * find /opt/conditera/backups/pg/ -mtime +7 -delete  # удалить старше 7 дней
```

### Восстановление из бекапа
```bash
# Остановить web (чтобы не было новых записей)
docker compose stop web

# Восстановить
gunzip -c ./backups/pg/latest.sql.gz | \
  docker exec -i uyezdny-db psql -U uyezdny uyezdny_konditer

# Перезапустить
docker compose up -d
```

### Очистка места
```bash
# Удалить неиспользуемые образы (ОСТОРОЖНО — удалит все unused)
docker system prune -af

# Только старые логи контейнеров
docker compose logs --tail=0 -f  # остановить streaming

# Посмотреть что занимает место
docker system df -v
```

---

## 🛠️ Управление отдельными сервисами

```bash
# Перезапустить один сервис
docker compose restart web
docker compose restart caddy

# Остановить один сервис
docker compose stop n8n

# Запустить остановленный
docker compose start n8n

# Пересобрать один сервис
docker compose build web
docker compose up -d web --force-recreate

# Зайти в контейнер
docker exec -it uyezdny-web sh
docker exec -it uyezdny-db psql -U uyezdny uyezdny_konditer
docker exec -it uyezdny-redis redis-cli
docker exec -it uyezdny-caddy sh
```

---

## 🔧 Применение миграций вручную

Если migrator-контейнер не отработал или нужно применить миграцию вручную:

```bash
# Применить все pending миграции
docker compose run --rm migrator

# Или вручную через prisma CLI
docker exec -it uyezdny-web npx prisma migrate deploy

# Проверить статус миграций
docker exec -it uyezdny-web npx prisma migrate status

# Откатить конкретную миграцию (ОПАСНО — destructively!)
docker exec -it uyezdny-web npx prisma migrate resolve --rolled-back <migration_name>
```

---

## 🚨 Устранение проблем

### web не стартует
```bash
docker compose logs web --tail=100

# Частые причины:
# 1. OOMKilled → увеличить memory limit в docker-compose.yml
# 2. Migration failed → docker compose logs migrator
# 3. Port 3000 занят → sudo lsof -i :3000
```

### db не отвечает
```bash
docker compose logs db --tail=50

# Проверить диск
df -h
# Если 100% — очистить: docker system prune

# Проверить соединения
docker exec uyezdny-db psql -U uyezdny uyezdny_konditer -c "SELECT count(*) FROM pg_stat_activity;"
```

### caddy не выдаёт HTTPS
```bash
docker compose logs caddy --tail=100

# Проверить что DNS настроен
dig conditera.ru +short

# Проверить что порт 80 открыт (нужен для ACME challenge)
sudo ufw status | grep 80

# Принудительно перезапросить сертификат
docker compose restart caddy
```

### n8n не запускается
```bash
docker compose logs n8n --tail=100

# Если N8N_ADMIN_PASSWORD не задан — проверить .env.production
grep N8N_ADMIN_PASSWORD .env.production
```

---

## ✅ Чек-лист первого деплоя

- [ ] Docker и Docker Compose установлены
- [ ] Репозиторий склонирован в `/opt/conditera`
- [ ] `.env.production` создан и заполнен (все секреты)
- [ ] DNS настроен (`conditera.ru`, `www`, `smp`)
- [ ] `docker compose build` — без ошибок
- [ ] `docker compose up -d` — все сервисы Up
- [ ] `docker compose ps` — все healthy (кроме migrator)
- [ ] `curl https://conditera.ru/api/health` → `{"status":"ok"}`
- [ ] `curl -sI https://conditera.ru/` → HTTP/2 200
- [ ] SSL-сертификат получен (Caddy logs показывают "certificate obtained")
- [ ] Бекап БД настроен в cron
- [ ] Мониторинг UptimeRobot подключён
- [ ] Cloudflare настроен (если используется)

---

## 📞 Экстренные контакты

- **Не работает деплой** → смотри `INCIDENT_RUNBOOK.md`
- **Проблема с БД** → восстанови из бекапа (см. выше)
- **Домен не работает** → `docs/DNS_SETUP.md`
- **DDoS-атака** → включи Cloudflare Under Attack mode
