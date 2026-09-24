# 🔑 GitHub Secrets — настройка

> Инструкция по добавлению секретов в GitHub репозиторий для CI/CD.

---

## 📋 Список необходимых секретов

| Secret name | Источник | Обязательно | Описание |
|-------------|----------|-------------|----------|
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` | ✅ | Пароль для PostgreSQL |
| `JWT_SECRET` | `openssl rand -base64 32` | ✅ | Секрет для подписи JWT-токенов |
| `TFA_ENCRYPTION_KEY` | `openssl rand -hex 32` | ✅ | Ключ шифрования 2FA-секретов (64 hex символа) |
| `CRON_SECRET` | `openssl rand -hex 24` | ✅ | Секрет для защиты cron-эндпоинтов |
| `IP_HASH_SALT` | `openssl rand -hex 16` | ✅ | Соль для хэширования IP-адресов (GDPR) |
| `N8N_ADMIN_PASSWORD` | `openssl rand -base64 16` | ✅ | Пароль администратора n8n |
| `SIMPLEX_BRIDGE_API_KEY` | `openssl rand -hex 32` | ⚠️ | Ключ для SimpleX bridge (только если используется SimpleX) |
| `YOOKASSA_SHOP_ID` | Личный кабинет YooKassa | 💳 | ID магазина в YooKassa |
| `YOOKASSA_SECRET_KEY` | Личный кабинет YooKassa | 💳 | Секретный ключ YooKassa |
| `DADATA_API_KEY` | Личный кабинет DaData | 📍 | API-ключ DaData |
| `DADATA_SECRET_KEY` | Личный кабинет DaData | 📍 | Секретный ключ DaData |
| `SENTRY_DSN` | sentry.io | 🐛 | DSN для Sentry error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | sentry.io | 🐛 | Публичный DSN Sentry (для client-side) |
| `SMTP_HOST` | Почтовый провайдер | 📧 | SMTP-сервер |
| `SMTP_USER` | Почтовый провайдер | 📧 | SMTP-логин |
| `SMTP_PASSWORD` | Почтовый провайдер | 📧 | SMTP-пароль |
| `TELEGRAM_BOT_TOKEN` | @BotFather | 📱 | Токен Telegram-бота |

---

## 🚀 Способ 1: Автоматически через `gh` CLI (рекомендуется)

### Предварительные требования
```bash
# Установить GitHub CLI: https://cli.github.com/
sudo apt install gh  # или brew install gh на macOS

# Авторизоваться
gh auth login
```

### Запуск скрипта
```bash
# Скрипт читает .env.production и добавляет секреты в GitHub
./scripts/setup-github-secrets.sh
```

Скрипт:
1. Проверяет что `.env.production` существует
2. Проверяет что `gh` установлен и авторизован
3. Для каждого секрета: читает значение из `.env.production`, добавляет в GitHub
4. Показывает итог (добавлено/пропущено)
5. Выводит список всех GitHub Secrets

---

## 🖱️ Способ 2: Вручную через GitHub Web UI

### Шаг 1: Открыть настройки репозитория
1. Открой https://github.com/YOUR_ORG/uyezdny-konditer
2. **Settings** → **Secrets and variables** → **Actions**
3. Нажми **New repository secret**

### Шаг 2: Добавить каждый секрет
Для каждого секрета из таблицы выше:
1. **Name:** имя секрета (например `JWT_SECRET`)
2. **Secret:** значение (например `GORtcr76v8djcDwa7os5Y08BIulVr3WbCVmfoEFjdsw=`)
3. Нажми **Add secret**

### Шаг 3: Проверить
- После добавления всех секретов, они появятся в списке
- Значения скрыты (показываются только последние 4 символа)
- Секреты доступны в workflow через `${{ secrets.SECRET_NAME }}`

---

## 🔐 Генерация секретов

### Все секреты сразу
```bash
echo "=== Скопируйте эти значения в .env.production и GitHub Secrets ==="
echo ""
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "TFA_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "CRON_SECRET=$(openssl rand -hex 24)"
echo "N8N_ADMIN_PASSWORD=$(openssl rand -base64 16)"
echo "SIMPLEX_BRIDGE_API_KEY=$(openssl rand -hex 32)"
echo "IP_HASH_SALT=$(openssl rand -hex 16)"
```

### Где получить остальные секреты

#### YooKassa (платежи)
1. https://yookassa.ru/my/merchant/integration
2. **Shop ID** → `YOOKASSA_SHOP_ID`
3. **Secret Key** → `YOOKASSA_SECRET_KEY`

#### DaData (проверка адресов/ИНН)
1. https://dadata.ru/profile/
2. **API-ключ** → `DADATA_API_KEY`
3. **Секретный ключ** → `DADATA_SECRET_KEY`

#### Sentry (error tracking)
1. https://sentry.io/ → создать проект `uyezdny-konditer`
2. **Settings → Client Keys (DSN)** → `SENTRY_DSN`
3. Тот же DSN → `NEXT_PUBLIC_SENTRY_DSN`

#### Telegram Bot
1. Открой `@BotFather` в Telegram
2. `/newbot` → выбери имя `@conditera_alerts_bot`
3. Получи токен → `TELEGRAM_BOT_TOKEN`

#### SMTP (email)
- **Mailgun:** https://app.mailgun.com/ → SMTP Credentials
- **SendGrid:** https://app.sendgrid.com/ → API Keys
- **Яндекс 360:** https://mail.yandex.ru/ → пароль приложения

---

## ✅ Проверка

### Через GitHub Web UI
1. **Settings → Secrets and variables → Actions**
2. Должны быть все 17 секретов из таблицы

### Через `gh` CLI
```bash
gh secret list
```
Должен вывести список всех секретов.

### Через CI
После добавления секретов, запусти CI:
```bash
git push origin main
```
CI pipeline должен пройти без ошибок `secret not found`.

---

## ⚠️ Важно

- **Никогда не коммить** `.env.production` в git (он в `.gitignore`)
- **Ротация секретов:** если секрет скомпрометирован — сгенерируй новый и обнови в GitHub
- **Доступ:** секреты видны только администраторам репозитория
- **Audit log:** GitHub записывает кто и когда добавлял/удалял секреты

---

## 📞 Если что-то не работает

### `secret not found` в CI
- Проверь что секрет добавлен в **тот же репозиторий**, где запускается CI
- Проверь точное имя секрета (case-sensitive)

### Скрипт `setup-github-secrets.sh` падает
```bash
# Проверить авторизацию
gh auth status

# Проверить что репозиторий выбран
gh repo set-default YOUR_ORG/uyezdny-konditer

# Проверить права (нужен admin)
gh repo view --json viewerPermission
```
