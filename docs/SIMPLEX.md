# SimpleX Chat — приватный E2E-канал в маркетплейсе «Уездный кондитер»

## Что это и зачем

**SimpleX Chat** — децентрализованный мессенджер с уникальной архитектурой:
- **Без идентификаторов пользователей** (нет ни номеров телефонов, ни email, ни random-ID)
- **E2E-шифрование** Double Ratchet + пост-квантовый CRYSTALS-Kyber (защита от «harvest now, decrypt later»)
- **Self-hosting** всех серверных компонентов в Docker (SMP, XFTP, NTF)

В маркетплейсе «Уездный кондитер» SimpleX работает **параллельно** с основным чатом Socket.IO:

| Канал | Назначение | Модерация | История |
|---|---|---|---|
| **Socket.IO** (основной) | Сделки, эскроу, споры, общая поддержка | полная | на сервере |
| **SimpleX** (приватный) | Конфиденциальные B2B-переговоры, премиум-клиенты | нет (E2E) | на устройствах |

Кондитеры тарифа **PREMIUM** могут создать SimpleX-профиль и показывать QR-код для прямого конфиденциального общения с клиентами.

---

## Архитектура

```
SimpleX-клиент (покупатель)
    ↓ SMP-протокол (E2E)
smp-server (Docker, порт 5223)
    ↓
simplex-chat CLI (запущен в simplex-bridge контейнере, порт 5225 WS)
    ↓ WebSocket (JSON)
simplex-bridge (этот процесс, порт 5226 HTTP)
    ↓ HTTP webhook
backend маркетплейса (/api/simplex/incoming)
    ↓
Prisma: SimpleXContact + SimpleXMessage (история в БД)
```

В обратную сторону:
```
dashboard оператора → POST /api/simplex/send
    → simplex-bridge /send
    → simplex-chat CLI (WebSocket cmd)
    → SMP-сервер
    → SimpleX-клиент покупателя
```

---

## Установка для администратора

### 1. Заполнить .env.production

```bash
# SimpleX Chat (приватный канал)
SIMPLEX_HOSTNAME=smp.conditera.ru          # домен SMP-сервера (с TLS-сертификатом)
SIMPLEX_BRIDGE_API_KEY=<openssl rand -hex 32>  # секрет для bridge-backend
SIMPLEX_BRIDGE_URL=http://simplex-bridge:5226
SIMPLEX_PROFILE_NAME=Уездный кондитер
```

### 2. Настроить DNS и TLS

Добавить A-запись `smp.conditera.ru` → IP вашего сервера.

Caddy автоматически выпустит Let's Encrypt-сертификат. Добавьте в Caddyfile:

```caddy
smp.conditera.ru {
    reverse_proxy smp-server:5223
}
```

### 3. Запустить сервисы

```bash
docker-compose up -d smp-server simplex-bridge
docker-compose logs -f simplex-bridge
```

### 4. Создать профиль поддержки

```bash
# Через bridge HTTP API
curl -X POST http://localhost:5226/api/create-profile \
  -H "X-Bridge-Api-Key: $SIMPLEX_BRIDGE_API_KEY"
```

В ответе будет `address` вида `smp://fingerprint@smp.conditera.ru#key`. Сохраните его в БД как support-профиль.

---

## Для кондитера (через дашборд)

1. Зайдите в дашборд → таб **«SimpleX (E2E)»**
2. Нажмите **«Создать SimpleX-профиль»**
3. Получите QR-код и адрес
4. Поделитесь QR-кодом с клиентами:
   - Разместите в карточке кондитера (автоматически показывается после создания профиля)
   - Отправьте в личных сообщениях клиентам тарифа PREMIUM
   - Распечатайте на визитках для B2B-клиентов

Когда клиент отсканирует QR и отправит сообщение, оно появится в дашборде → SimpleX → Входящие сообщения.

---

## Для покупателя

1. В карточке кондитера нажмите **«Приватный канал»** (если кондитер активировал SimpleX)
2. Установите SimpleX Chat (iOS / Android / desktop) с [simplex.chat/downloads](https://simplex.chat/downloads/)
3. Откройте приложение → **«Добавить контакт»** → **«Сканировать QR-код»**
4. Наведите камеру на QR-код
5. Отправьте первое сообщение — кондитер ответит в течение обычного времени

**Важно:** SimpleX не имеет восстановления аккаунта. Если вы потеряете устройство:
- Сделайте backup в приложении SimpleX (Настройки → Backup)
- Сохраните backup-файл в надёжное место (облако, внешний диск)
- При потере без backup — история переписки не восстанавливается

---

## API Endpoints

### Для bridge-сервиса (внутренние)

- `POST /api/simplex/incoming` — webhook от bridge при входящем сообщении
  - Заголовок: `X-Bridge-Api-Key`
  - Тело: `{ event: "message_received" | "contact_connected" | "contact_request", ... }`

### Для frontend (с авторизацией)

- `GET /api/simplex/contacts` — профиль текущего пользователя + последние сообщения + статистика
- `POST /api/simplex/contacts` — создать SimpleX-профиль (только кондитеры)
- `DELETE /api/simplex/contacts` — деактивировать профиль
- `POST /api/simplex/send` — отправить ответ через SimpleX
  - Тело: `{ contactName, text, chatId? }`
- `POST /api/simplex/read` — отметить прочитанными
  - Тело: `{ messageIds: string[] }` или `{ all: true, chatId? }`

### Публичные (без авторизации)

- `GET /api/simplex/support-address` — получить адрес поддержки маркетплейса + QR-код
  - Используется виджетом `SimpleXConnectWidget` на странице «Контакты»

---

## Risks and Limitations

### Что SimpleX НЕ позволяет делать

1. **Модерация переписки** — E2E означает, что операторы маркетплейса не видят содержимое сообщений. Если возникнет спор по эскроу, переписка в SimpleX не может быть использована как доказательство.

2. **Восстановление аккаунта** — SimpleX не имеет центрального восстановления. Потеря устройства без backup = потеря всех чатов.

3. **Групповые звонки** — поддерживаются только 1-на-1 audio/video через WebRTC. Групповые звонки не реализованы.

4. **Встраивание в web** — нет web-клиента для встраивания в маркетплейс. Пользователь должен установить отдельное приложение SimpleX.

### Когда использовать SimpleX vs Socket.IO

| Сценарий | Канал |
|---|---|
| Обсуждение деталей заказа | Socket.IO |
| Эскроу-спор | Socket.IO (обязательно) |
| Корпоративный заказ на 100 торт | SimpleX (конфиденциально) |
| Оптовые поставки ингредиентов | SimpleX |
| Франшиза / партнерство | SimpleX |
| Поддержка по общим вопросам | Socket.IO |
| Premium-клиент хочет приватности | SimpleX |

---

## Troubleshooting

### Bridge не подключается к CLI

```bash
docker-compose logs simplex-bridge
# Ищем: "[bridge] Connecting to SimpleX CLI at ws://localhost:5225..."
# Если "CLI WebSocket error" — CLI не запустился
```

Проверьте, что simplex-chat binary доступен:
```bash
docker-compose exec simplex-bridge simplex-chat --version
```

### Сообщения не доходят до backend

1. Проверьте `SIMPLEX_BRIDGE_API_KEY` — должен совпадать в bridge и backend
2. Проверьте `BACKEND_WEBHOOK` — должен указывать на `https://conditera.ru/api/simplex/incoming`
3. Проверьте, что webhook не блокируется CSP (см. `src/middleware.ts`)

### Клиент не может подключиться по QR

1. Проверьте, что `smp.conditera.ru` резолвится в IP вашего сервера
2. Проверьте, что порт 5223 открыт в firewall
3. Проверьте TLS-сертификат: `openssl s_client -connect smp.conditera.ru:5223`

### Бэкап SimpleX-профиля

Профиль хранится в Docker volume `smp_data`. Для бэкапа:

```bash
docker run --rm -v uyezdny_smp_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/smp_data_$(date +%Y%m%d).tar.gz /data
```

---

## Ссылки

- [SimpleX Chat GitHub](https://github.com/simplex-chat/simplex-chat)
- [Документация SimpleX](https://simplex.chat/docs/)
- [Self-hosting SMP server](https://simplex.chat/docs/server.html)
- [Bot API](https://github.com/simplex-chat/simplex-chat/blob/stable/bots/api/COMMANDS.md)
- [Загрузить SimpleX-клиент](https://simplex.chat/downloads/)

## Лицензия

SimpleX Chat распространяется под AGPLv3. Маркетплейс использует SimpleX без модификаций
(CLI/сервер как чёрный ящик) — AGPL не касается backend-кода маркетплейса.
