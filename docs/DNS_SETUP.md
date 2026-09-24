# 🌐 Настройка DNS для conditera.ru

> Пошаговая инструкция по настройке DNS-записей для production-деплоя.

---

## 📋 Список необходимых DNS-записей

| Type | Name | Content | Proxy (Cloudflare) | Назначение |
|------|------|---------|--------------------|----|
| A | `conditera.ru` (apex) | `IP_СЕРВЕРА` | Proxied (оранжевое) | Главная страница |
| A | `www.conditera.ru` | `IP_СЕРВЕРА` | Proxied | www-редирект |
| A | `smp.conditera.ru` | `IP_СЕРВЕРА` | **DNS only** (серое) | SimpleX SMP (TCP 5223) |
| A | `n8n.conditera.ru` | `IP_СЕРВЕРА` | Proxied (опционально) | n8n (если нужен субдомен) |
| CNAME | `status.conditera.ru` | `conditera.statuspage.io` | Proxied | Status page (UptimeRobot) |
| TXT | `conditera.ru` | (для verification) | — | Verify домена для сервисов |

---

## 🚀 Вариант 1: DNS через Cloudflare (рекомендуется)

### Шаг 1: Добавить домен в Cloudflare
1. Открой https://dash.cloudflare.com/
2. **Add a Site** → введи `conditera.ru`
3. Выбери план **Free**
4. Cloudflare просканирует текущие DNS-записи (если домен уже где-то настроен)

### Шаг 2: Изменить nameservers
1. Cloudflare выдаст 2 nameserver'а, например:
   ```
   lloyd.ns.cloudflare.com
   meera.ns.cloudflare.com
   ```
2. Зайди в панель регистратора домена (где покупал `conditera.ru`):
   - **Beget:** https://cp.beget.com/domains/ → выбери домен → NS-серверы
   - **Reg.ru:** https://www.reg.ru/user/account/admin → DNS-серверы
   - **Ru-Center:** https://www.nic.ru/dns/service/manager/
3. Замени текущие NS на Cloudflare
4. Сохрани изменения

### Шаг 3: Дождаться делегирования
- Обычно 1-24 часа (часто ~30 минут)
- Cloudflare пришлёт email когда домен станет активным
- Проверка: `dig NS conditera.ru +short` — должны увидеть `*.ns.cloudflare.com`

### Шаг 4: Настроить DNS-записи в Cloudflare
В разделе **DNS → Records** добавь:

```
Type: A
Name: @  (или conditera.ru)
IPv4 address: ВАШ_IP_СЕРВЕРА
Proxy status: Proxied (оранжевое облако)
TTL: Auto

Type: A
Name: www
IPv4 address: ВАШ_IP_СЕРВЕРА
Proxy status: Proxied
TTL: Auto

Type: A
Name: smp
IPv4 address: ВАШ_IP_СЕРВЕРА
Proxy status: DNS only (серое облако!) ← ВАЖНО
TTL: Auto

Type: CNAME
Name: status
Target: conditera.statuspage.io
Proxy status: Proxied
TTL: Auto
```

### Шаг 5: Настроить SSL/TLS
- **SSL/TLS → Overview** → режим **Full (strict)**
- **SSL/TLS → Edge Certificates**:
  - Always Use HTTPS: On
  - HSTS: On (max-age=1 year, includeSubDomains, preload)
  - Minimum TLS Version: 1.2
  - TLS 1.3: On

### Шаг 6: Включить www-редирект
- **Rules → Redirect Rules → Create rule**
- Name: `www to apex`
- If: Hostname equals `www.conditera.ru`
- Then: Static redirect to `https://conditera.ru${http.request.uri.path}`
- Status code: 301

---

## 🚀 Вариант 2: DNS напрямую через регистратора (без Cloudflare)

Если не используешь Cloudflare, настрой DNS-записи в панели регистратора:

### Beget
1. https://cp.beget.com/domains/
2. Выбери домен `conditera.ru` → **DNS**
3. Добавь записи:
   ```
   A  @    ВАШ_IP_СЕРВЕРА
   A  www  ВАШ_IP_СЕРВЕРА
   A  smp  ВАШ_IP_СЕРВЕРА
   CNAME status conditera.statuspage.io
   ```

### Reg.ru
1. https://www.reg.ru/user/account/admin
2. Выбери домен → **DNS-серверы → Управление зоной**
3. Добавь те же записи

⚠️ **Минус:** без Cloudflare нет DDoS-защиты и WAF. Рекомендуется всё же использовать Cloudflare.

---

## 🔍 Проверка DNS

После настройки подожди 5-30 минут, затем проверь:

```bash
# 1. Проверить что A-записи указывают на правильный IP
dig conditera.ru +short
dig www.conditera.ru +short
dig smp.conditera.ru +short

# 2. Проверить NS-записи (если через Cloudflare)
dig NS conditera.ru +short

# 3. Проверить что HTTPS работает
curl -sI https://conditera.ru/ | head -5

# 4. Проверить что www редиректит на apex
curl -sI https://www.conditera.ru/ | grep -i location
# Должно быть: location: https://conditera.ru/

# 5. Проверить SimpleX SMP (TCP 5223)
nc -zv smp.conditera.ru 5223
# Должно быть: succeeded

# 6. Проверить что сервер доступен напрямую (мимо Cloudflare)
curl -sI --resolve conditera.ru:443:ВАШ_IP https://conditera.ru/
# Если через Cloudflare — это может не сработать (нужен SNI)

# 7. Проверить статус SSL-сертификата
openssl s_client -connect conditera.ru:443 -servername conditera.ru < /dev/null 2>/dev/null | openssl x509 -noout -dates
```

---

## 📞 Если что-то не работает

### Домен не резолвится
1. Проверь NS-записи: `dig NS conditera.ru +short`
2. Если видишь старые NS — подожди ещё (DNS cache TTL)
3. Очисти локальный DNS cache:
   ```bash
   # Linux:
   sudo systemd-resolve --flush-caches
   # macOS:
   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
   # Windows:
   ipconfig /flushdns
   ```

### SSL-сертификат не выдаётся
1. Проверь что A-запись указывает на правильный IP
2. Проверь что порт 80 открыт на сервере (Caddy нужно для ACME challenge)
3. Посмотри логи Caddy: `docker compose logs caddy --tail=50`
4. Caddy сам получит сертификат Let's Encrypt при первом запросе

### SimpleX не подключается
1. Проверь что `smp.conditera.ru` — **DNS only** (не Proxied)
2. Проверь что порт 5223 открыт в firewall
3. Проверь что SimpleX SMP сервер запущен: `docker compose ps smp-server`
4. Telnet/nc проверка: `nc -zv smp.conditera.ru 5223`

### Cloudflare показывает Error 522 (Connection timed out)
1. Сервер не отвечает на порту 80/443
2. Проверь: `docker compose ps web caddy`
3. Проверь firewall: `sudo iptables -L -n | grep -E "80|443"`

### Cloudflare показывает Error 521 (Web server is down)
1. Caddy не запущен или не слушает порт
2. `docker compose logs caddy --tail=100`

---

## ✅ Чек-лист готовности DNS

- [ ] Домен `conditera.ru` добавлен в Cloudflare (или регистратора)
- [ ] Nameservers изменены на Cloudflare (если используется)
- [ ] A-запись `@` → IP сервера (Proxied)
- [ ] A-запись `www` → IP сервера (Proxied)
- [ ] A-запись `smp` → IP сервера (**DNS only**)
- [ ] CNAME `status` → statuspage.io (опционально)
- [ ] SSL/TLS = Full (strict)
- [ ] Always Use HTTPS = On
- [ ] HSTS = On
- [ ] `dig conditera.ru +short` возвращает IP
- [ ] `curl -sI https://conditera.ru/` возвращает 200
- [ ] `nc -zv smp.conditera.ru 5223` → succeeded
- [ ] www.conditera.ru редиректит на conditera.ru (301)
