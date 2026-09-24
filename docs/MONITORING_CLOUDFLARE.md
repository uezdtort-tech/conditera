# 📊 Мониторинг — UptimeRobot / BetterStack + Cloudflare

> Инструкция по настройке внешнего мониторинга и DDoS-защиты для `conditera.ru`.

---

## 1️⃣ UptimeRobot — мониторинг доступности (бесплатно до 50 мониторов)

### Регистрация
1. Открой https://uptimerobot.com/
2. Зарегистрируйся (бесплатный план Free: 50 мониторов, интервал 5 минут)
3. Подтверди email

### Создание мониторов

#### Монитор 1: Главная страница
- **Monitor Type:** HTTP(s)
- **Friendly Name:** `conditera.ru — Homepage`
- **URL:** `https://conditera.ru/`
- **Monitoring Interval:** 5 minutes
- **Timeout:** 30 seconds
- **HTTP Keyword (опционально):** `Уездный кондитер` (если ключевое слово не найдено — алерт)
- **Alert When:** Down (5 consecutive failures)

#### Монитор 2: Health endpoint (критичный)
- **Monitor Type:** HTTP(s) + Keyword
- **Friendly Name:** `conditera.ru — /api/health`
- **URL:** `https://conditera.ru/api/health`
- **Monitoring Interval:** 5 minutes
- **HTTP Keyword:** `"status":"ok"` (если не найдено — алерт, даже если 200)
- **Alert When:** Down OR keyword not found

#### Монитор 3: API products
- **Monitor Type:** HTTP(s)
- **Friendly Name:** `conditera.ru — /api/products`
- **URL:** `https://conditera.ru/api/products`
- **Monitoring Interval:** 10 minutes
- **Alert When:** Down (200 или 500 — оба ОК, главное что сервер отвечает)

#### Монитор 4: SSL-сертификат
- **Monitor Type:** HTTP(s) + Keyword
- **Friendly Name:** `conditera.ru — SSL expiry`
- **URL:** `https://conditera.ru/`
- **Monitoring Interval:** 1 day
- **Alert When:** SSL expires in < 14 days

#### Монитор 5: SimpleX SMP (порт 5223)
- **Monitor Type:** Port
- **Friendly Name:** `smp.conditera.ru — TCP 5223`
- **URL/IP:** `smp.conditera.ru`
- **Port:** 5223
- **Monitoring Interval:** 5 minutes

### Настройка алертов
1. **Alert Contacts → Add Alert Contact**
2. **Telegram:**
   - Создай бота через `@BotFather` → получи токен
   - В UptimeRobot: тип `Telegram`, вставь токен, выбери чат `@conditera_incidents`
3. **Email:** `oncall@conditera.ru`
4. **SMS (платный):** для P0-инцидентов ночью

### Настройка Status Page (публичная)
1. **Status Pages → Add New Status Page**
2. **Name:** `Уездный кондитер — Статус`
3. **URL:** `conditera.statuspage.io` (или кастомный `status.conditera.ru`)
4. Добавь все 5 мониторов
5. Включи `Show overall uptime`

---

## 2️⃣ BetterStack (альтернатива UptimeRobot, лучше для команд)

### Регистрация
1. Открой https://betterstack.com/better-uptime
2. Зарегистрируйся (Free plan: 10 monitors, 3-minute interval)

### Преимущества над UptimeRobot
- 3-минутный интервал в бесплатном плане (vs 5 мин в UptimeRobot)
- Better on-call scheduling (календарь дежурств)
- Heartbeat monitoring для cron jobs
- Better status pages

### Создание мониторов
Аналогично UptimeRobot — создай 5 мониторов как описано выше.

### On-call schedule
1. **On-call → Schedules → Create schedule**
2. **Name:** `conditera-oncall`
3. **Rotation:** Weekly (Primary/Secondary меняются каждую неделю)
4. **Members:** добавить emails всех дежурных
5. **Escalation:** если Primary не ответил за 5 мин → Secondary, ещё через 5 мин → CTO

### Heartbeat для cron jobs (только BetterStack)
Для каждого cron-эндпоинта создай heartbeat:
- **Heartbeat URL:** `https://betteruptime.com/heartbeat/<token>`
- В cron-обработчик добавь в конце: `await fetch(process.env.BETTER_STACK_HEARTBEAT_URL)`

---

## 3️⃣ Cloudflare — DDoS protection + WAF + CDN

### Регистрация и добавление домена
1. Открой https://dash.cloudflare.com/
2. Зарегистрируйся (бесплатный план Free подойдёт для начала)
3. **Add a Site** → введи `conditera.ru`
4. Cloudflare просканирует текущие DNS-записи
5. Выбери план **Free**

### Изменение nameservers
1. Cloudflare выдаст 2 nameserver'а: `xxx.ns.cloudflare.com` и `yyy.ns.cloudflare.com`
2. Зайди в панель регистратора домена (Beget / Reg.ru)
3. Замени текущие nameserver'ы на Cloudflare
4. Жди 1-24 часа (обычно ~30 минут) — Cloudflare уведомит когда готово

### DNS-записи (в Cloudflare)

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | `conditera.ru` | `IP_СЕРВЕРА` | Proxied (оранжевое облако) | Auto |
| A | `www.conditera.ru` | `IP_СЕРВЕРА` | Proxied | Auto |
| A | `smp.conditera.ru` | `IP_СЕРВЕРА` | **DNS only** (серое облако) | Auto |
| A | `n8n.conditera.ru` | `IP_СЕРВЕРА` | Proxied | Auto |
| CNAME | `status.conditera.ru` | `conditera.statuspage.io` | Proxied | Auto |

⚠️ **Важно:** `smp.conditera.ru` должен быть **DNS only** (не Proxied), потому что:
- SimpleX SMP использует TCP+TLS на порту 5223, не HTTP
- Cloudflare free не проксирует не-HTTP порты (только 80/443/8080/8443/2052/2053/2082/2083/2086/2087/2095/2096)
- Если проксировать — клиенты SimpleX не смогут подключиться

### SSL/TLS настройки
1. **SSL/TLS → Overview** → режим **Full (strict)** (не Flexible!)
   - Flexible вызовет infinite redirect loop с Caddy
   - Full (strict) требует валидный сертификат на сервере (Caddy его автоматически получит)
2. **SSL/TLS → Edge Certificates:**
   - Always Use HTTPS: **On**
   - HTTP Strict Transport Security (HSTS): **On** (max-age=1 year, includeSubDomains, preload)
   - Minimum TLS Version: **1.2**
   - Opportunistic Encryption: **On**
   - TLS 1.3: **On**
   - Automatic HTTPS Rewrites: **On**

### Security настройки (WAF)
1. **Security → WAF → Managed rules:**
   - Cloudflare Managed Ruleset: **On** (бесплатно в Free)
   - Cloudflare OWASP Core Ruleset: **On**
2. **Security → Bots:**
   - Bot Fight Mode: **On** (бесплатно — блокирует простых ботов)
3. **Security → DDoS:**
   - HTTP DDoS attack protection: **On** (по умолчанию)
   - Network DDoS: **On** (для L3/L4 атак)
4. **Security → Settings:**
   - Security Level: **Medium** (или High при атаке)
   - Challenge Passage: 30 minutes
   - Browser Integrity Check: **On**

### Page Rules (для конкретных путей)
1. **Page Rule 1:** `*conditera.ru/api/*`
   - Cache Level: **Bypass** (API не должен кэшироваться)
   - Security: Disable Security (опционально, если WAF ломает API)
2. **Page Rule 2:** `*conditera.ru/dashboard*`
   - Cache Level: **Bypass**
   - Browser Cache TTL: Respect Existing
3. **Page Rule 3:** `*conditera.ru/_next/static/*`
   - Cache Level: **Cache Everything**
   - Browser Cache TTL: 1 year
   - Edge Cache TTL: 1 month

### Caching настройки
1. **Caching → Configuration:**
   - Caching Level: **Standard**
   - Browser Cache TTL: **4 hours**
2. **Caching → Cache Rules:**
   - Static assets (`/_next/static/*`, `/_next/image*`, `/public/*`): Cache 1 month

### Rate Limiting (Cloudflare, дополнительный к app-level)
1. **Security → WAF → Rate limiting rules:**
   - **Rule 1:** `/api/auth/login` — 10 requests per minute per IP → Block for 1 hour
   - **Rule 2:** `/api/auth/register` — 5 requests per minute per IP → Block for 1 hour
   - **Rule 3:** `/api/payment/*` — 20 requests per minute per IP → Challenge
   - **Rule 4:** `/api/*` (general) — 200 requests per minute per IP → Challenge

### Transform Rules (для добавления заголовков)
1. **Rules → Transform Rules → Modify Request Header:**
   - Add `X-Real-IP` = `{{cf-connecting-ip}}` (чтобы Next.js видел реальный IP клиента)
2. **Rules → Transform Rules → Modify Response Header:**
   - Add `X-Frame-Options: SAMEORIGIN` (если Caddy не справляется)

### Under Attack Mode
Если сайт под DDoS-атакой:
1. **Security → Settings → Security Level:** `I'm Under Attack`
2. Все посетители увидят JavaScript challenge (5 секунд задержка)
3. Cloudflare отфильтрует ботов

---

## 4️⃣ Защита smp.conditera.ru:5223 (SimpleX)

SimpleX SMP — единственный сервис, который НЕ должен идти через Cloudflare (TCP, не HTTP).

### Настройка firewall (на сервере)

```bash
# Разрешить только Cloudflare IP-диапазоны для HTTP/HTTPS
# (чтобы DDoS-атака на 80/443 не дошла до Caddy напрямую)

# Список Cloudflare IP: https://www.cloudflare.com/ips/
# Создадим ipset для удобства:
sudo apt install ipset
sudo ipset create cloudflare iphash
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  sudo ipset add cloudflare $ip
done

# Применяем в iptables (разрешаем 80/443 только от Cloudflare):
sudo iptables -A INPUT -p tcp --dport 80 -m set ! --match-set cloudflare src -j DROP
sudo iptables -A INPUT -p tcp --dport 443 -m set ! --match-set cloudflare src -j DROP

# Для SimpleX 5223 — разрешаем всем (клиенты подключаются напрямую):
sudo iptables -A INPUT -p tcp --dport 5223 -j ACCEPT

# Для SSH — только с доверенных IP:
sudo iptables -A INPUT -p tcp --dport 22 -s YOUR_TRUSTED_IP -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 22 -j DROP

# Сохранить правила:
sudo apt install iptables-persistent
sudo netfilter-persistent save
```

### Мониторинг порта 5223
- UptimeRobot: создай Port-монитор для `smp.conditera.ru:5223` (см. выше)
- На сервере: `ss -tlnp | grep 5223` — проверить что SimpleX слушает

### Альтернатива: Spectrum (Cloudflare Enterprise)
Если нужен DDoS-защита для TCP-портов — Cloudflare Spectrum (Enterprise, платно):
- Проксирует любой TCP/UDP трафик
- DDoS-защита для L3/L4
- Для нашего случая — **избыточно**, бесплатного firewall достаточно

---

## 5️⃣ Проверка после настройки

### После UptimeRobot
- Дождись 5 минут, проверь что все мониторы показывают `Up` (зелёный)
- Нажми `Test Alert` для Telegram — убедись что бот прислал сообщение
- Открой Status Page — убедись что она доступна

### После Cloudflare
- `curl -sI https://conditera.ru/` → проверь заголовок `server: cloudflare`
- `curl -s https://conditera.ru/cdn-cgi/trace` → должен показать `cloudflare` в поле `wlp`
- `dig conditera.ru` → должен вернуть Cloudflare IP (не твой сервер)
- `dig smp.conditera.ru` → должен вернуть **твой** сервер IP (DNS only)

### После firewall
- `curl -sI https://conditera.ru/` → 200 (через Cloudflare)
- `curl -sI --resolve conditera.ru:443:ВАШ_IP https://conditera.ru/` → должен timeout (firewall блокирует)
- `nc -zv smp.conditera.ru 5223` → Connection succeeded (порт открыт)

---

## 6️⃣ Чек-лист готовности

- [ ] UptimeRobot: 5 мониторов созданы, все Up
- [ ] UptimeRobot: Telegram-бот добавлен как Alert Contact
- [ ] UptimeRobot: Status Page создана и доступна
- [ ] Cloudflare: домен добавлен, nameservers изменены
- [ ] Cloudflare: SSL/TLS = Full (strict)
- [ ] Cloudflare: HSTS, Always Use HTTPS, TLS 1.3 — On
- [ ] Cloudflare: WAF Managed Rules + OWASP — On
- [ ] Cloudflare: Bot Fight Mode — On
- [ ] Cloudflare: Page Rules для /api/* (Bypass) и /_next/static/* (Cache)
- [ ] Cloudflare: Rate Limiting для /api/auth/*
- [ ] Cloudflare: Transform Rule для X-Real-IP
- [ ] Firewall: только Cloudflare IP на 80/443
- [ ] Firewall: 5223 открыт для всех
- [ ] Firewall: 22 только с доверенных IP
- [ ] `smp.conditera.ru` DNS only (не Proxied)
- [ ] Проверка: `curl -sI https://conditera.ru/` показывает `server: cloudflare`
