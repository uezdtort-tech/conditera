# Обновление проекта — инструкция

Этот документ описывает, как безопасно обновлять работающий проект, получая новый архив от разработчика или AI-ассистента, **не теряя** ваши настройки (`.env.local`, `.env.production`), бэкапы БД, загруженные пользователями файлы и т.д.

---

## TL;DR — быстрая команда

Получили новый архив `conditera-2026-09-24.tar.gz`?

```bash
# Сначала dry-run (просто посмотреть, что изменится):
bash scripts/update-from-archive.sh /path/to/conditera-2026-09-24.tar.gz --dry-run

# Применить обновление:
bash scripts/update-from-archive.sh /path/to/conditera-2026-09-24.tar.gz
```

Скрипт:
1. Создаст бэкап в `backups/pre-update-YYYYMMDD_HHMMSS/`
2. Покажет список изменённых/новых файлов
3. Покажет новые env-переменные (если появились)
4. Покажет новые миграции БД
5. Покажет новые зависимости
6. Запросит подтверждение
7. Обновит код, сохранив `.env.local`, `.env.production`, `backups/`, `db/`, `public/uploads/`, `upload/`, `node_modules/`, `.next/`, `.git/`
8. Запустит `npm install` (если появились зависимости)
9. Применит миграции (если появились, опционально)
10. Запустит `env-check.sh` и подскажет что заполнить
11. Спросит要不要 пересобрать `npm run build`

---

## Что СОХРАНЯЕТСЯ при обновлении

| Путь | Что это | Почему сохраняется |
|------|---------|--------------------|
| `.env.local` | Ваши dev-секреты и ID счётчиков | Без них проект не запустится |
| `.env.production` | Ваши prod-секреты | То же самое |
| `backups/` | Ваши бэкапы БД (см. `docs/DATABASE.md`) | Нельзя потерять историю |
| `db/` | Локальная SQLite (если используете PGlite) | Ваши dev-данные |
| `public/uploads/` | Файлы, загруженные пользователями | Чужие данные |
| `upload/` | SimpleX-мост (для IM-интеграции) | Ваши сообщения |
| `node_modules/` | Установленные пакеты | `npm install` пересоберёт нужные |
| `.next/` | Билд Next.js | Будет пересобран |
| `.git/` | Git-история | Ваша VCS |
| `tsconfig.tsbuildinfo` | TS-кэш | Ускоряет следующие typecheck |

## Что ОБНОВЛЯЕТСЯ

| Путь | Что это |
|------|---------|
| `src/` | Весь исходный код приложения |
| `supabase/` | SQL-миграции, edge functions, seed-данные |
| `prisma/` | Prisma-схема и миграции |
| `scripts/` | Bash/Python-утилиты (deploy, env-check, update и т.д.) |
| `public/` (кроме `uploads/`) | Статика: иконки, og-картинки, fonts, manifest |
| `docs/` | Документация |
| `package.json`, `package-lock.json` | Зависимости |
| `next.config.ts`, `tsconfig.json`, `tailwind.config.ts` | Конфигурация сборки |
| `.env.local.example`, `.env.production.example` | Шаблоны env (только шаблоны, не ваши секреты) |

---

## Предварительная настройка — что должно быть заполнено

Перед обновлением у вас должны быть заполнены:

### Минимум для запуска dev:
- `DATABASE_URL` — URL подключения к PostgreSQL (Supabase)
- `NEXT_PUBLIC_SUPABASE_URL` — URL Kong/Supabase (для клиента)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key (RLS-aware)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only, обход RLS)
- `JWT_SECRET` — секрет для подписи JWT
- `NEXT_PUBLIC_YANDEX_METRIKA_ID` — ID счётчика Метрики (для проекта «Уездный кондитер»: `111432662`)
- `SMTP_HOST`, `SMTP_FROM` — для отправки email

### Для production:
- Всё из dev-минимума + `POSTGRES_PASSWORD`, реальные `*_REDIRECT` для OAuth, `YOOKASSA_*` для платежей, `YANDEX_CLIENT_ID` для кнопки «Войти через Яндекс» и т.д.

Проверить готовность: `bash scripts/env-check.sh` (dev) или `bash scripts/env-check.sh production` (prod).

---

## Конкретная настройка Yandex

### 1. Yandex Metrika — аналитика

**ID счётчика** (для проекта «Уездный кондитер» — `111432662`):
- Проверить ID: https://metrica.yandex.ru/list
- Без него счётчик не грузится на страницах

**OAuth-токен** (для server-side tracking — офлайн-конверсии):
- Перейти на https://oauth.yandex.ru/
- Авторизоваться под тем аккаунтом, на котором создан счётчик `111432662`
- Выдать права на `metrica:write`
- Скопировать токен → `YANDEX_METRIKA_OAUTH_TOKEN`

**Геокодер** (для определения координат по адресу — geocoder.ts):
- Получить ключ: https://developer.tech.yandex.ru/services/ → «Геокодер»
- Лимит free-tier: 25 000 запросов/сутки
- → `YANDEX_GEOCODER_API_KEY`

### 2. Yandex OAuth — кнопка «Войти через Яндекс»

⚠️ **Важно:** в проекте две OAuth-интеграции, и нужно настроить ОБЕ:

#### A. Server-side OAuth (через наш API route — `/api/auth/oauth/yandex`)
Используется в `auth-modal.tsx` (mock-модал в дашбордах). Настраивается через env:

1. Создать приложение: https://oauth.yandex.ru/client/new
2. Заполнить:
   - **Название сервиса**: «Уездный кондитер»
   - **Платформы → Веб-сервисы → Redirect URI**:
     - dev: `http://localhost:3000/api/auth/oauth/yandex/callback`
     - prod: `https://conditera.ru/api/auth/oauth/yandex/callback`
   - **Доступ к данным**:
     - `login:email` — email пользователя
     - `login:info` — имя/аватар
   - **Подтвердить телефон** (обязательно для Yandex OAuth)
3. После создания получите **ClientID** и **ClientSecret**
4. Записать в `.env.local` / `.env.production`:
   ```
   YANDEX_CLIENT_ID=<ваш_ClientID>
   YANDEX_OAUTH_REDIRECT=http://localhost:3000/api/auth/oauth/yandex/callback
   ```
5. Перезапустить проект: `npm run dev:local` или `bash scripts/deploy.sh`
6. Теперь кнопка «Войти через Яндекс» в mock-auth-modal будет реально редиректить на Yandex OAuth, а не возвращать 501 stub.

#### B. Supabase Auth OAuth (через GoTrue — для SupabaseAuthModal на странице /login)
Используется в `supabase-auth-modal.tsx`. Настраивается в Supabase Studio (через GoTrue провайдеры), env не нужен:

1. Открыть Supabase Studio: `http://localhost:8100` (dev) или ваш prod Studio URL
2. **Authentication → Providers → Yandex** → включить
3. Заполнить:
   - **Client ID**: тот же, что получили в шаге A.1
   - **Client Secret**: из шага A.1
   - **Redirect URL** (в Studio, не в Yandex!): `http://localhost:8000/auth/v1/callback` (dev self-hosted Kong) или `https://YOUR_PROJECT.supabase.co/auth/v1/callback` (cloud)
4. **ВАЖНО**: в Yandex OAuth приложении (шаг A.1) добавьте ещё один Redirect URI:
   - dev: `http://localhost:8000/auth/v1/callback`
   - prod: `https://conditera.ru/api/auth/v1/callback` (если Kong проксирует) или `https://YOUR_PROJECT.supabase.co/auth/v1/callback` (cloud)
5. Save в Studio
6. Перезапускать проект не нужно — GoTrue подхватит настройки на лету.

После настройки обеих интеграций:
- В mock-auth-modal (дашборды) кнопка «Войти через Яндекс» работает через `/api/auth/oauth/yandex`
- На странице `/login` (SupabaseAuthModal) кнопка «Войти через Яндекс» работает через Supabase Auth + GoTrue
- Оба пути в итоге создают сессию в `auth.users` и профиль в `public.profiles`

### 3. Google OAuth (опционально)

1. https://console.cloud.google.com/apis/credentials
2. Create credentials → OAuth client ID → Web application
3. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/oauth/google/callback` (dev)
   - `https://conditera.ru/api/auth/oauth/google/callback` (prod)
4. Скопировать Client ID → `GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT`

### 4. VK OAuth (опционально)

1. https://dev.vk.com/ → Мои приложения → Создать
2. Platform: Web → Redirect URI:
   - `http://localhost:3000/api/auth/oauth/vk/callback` (dev)
   - `https://conditera.ru/api/auth/oauth/vk/callback` (prod)
3. Скопировать ID приложения → `VK_CLIENT_ID`, `VK_OAUTH_REDIRECT`

---

## Workflow: 3 способа обновления

### Способ A. Интерактивный (рекомендуется)

```bash
# 1. Скачали новый архив
cp ~/Downloads/conditera-2026-09-24.tar.gz /tmp/

# 2. Сухой прогон — посмотреть что изменится
bash scripts/update-from-archive.sh /tmp/conditera-2026-09-24.tar.gz --dry-run

# 3. Применить
bash scripts/update-from-archive.sh /tmp/conditera-2026-09-24.tar.gz

# 4. Если появились новые env-переменные — дозаполнить
bash scripts/setup-env.sh dev

# 5. Проверить готовность
bash scripts/env-check.sh

# 6. Перезапустить
npm run dev:local
```

### Способ B. Ручной (полный контроль)

```bash
# 1. Бэкап критичных файлов
cp .env.local .env.local.backup.$(date +%Y%m%d)
cp .env.production .env.production.backup.$(date +%Y%m%d)

# 2. Распаковать архив в соседнюю папку
mkdir -p /tmp/conditera-new
tar -xzf /tmp/conditera-2026-09-24.tar.gz -C /tmp/conditera-new

# 3. Синхронизировать код, исключая секреты и данные
rsync -a \
  --exclude='.env.local' \
  --exclude='.env.production' \
  --exclude='backups/' \
  --exclude='db/' \
  --exclude='public/uploads/' \
  --exclude='upload/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='.git/' \
  /tmp/conditera-new/ ./

# 4. Установить новые зависимости
npm install

# 5. Применить новые миграции (см. список в конце вывода update-from-archive.sh)
ls supabase/migrations/*.sql | tail -5
docker exec -i conditera-supabase-db psql -U postgres -d postgres \
  < supabase/migrations/0026_storage_buckets_and_confectioners_rls.sql

# 6. Проверить env (новые переменные?)
diff .env.local.example .env.local | grep '^<'

# 7. Пересобрать
npm run build
```

### Способ C. Production deploy

```bash
# На сервере:
git pull origin main
bash scripts/env-check.sh production
bash scripts/deploy.sh
```

---

## Частые проблемы

### «После обновления счётчик Метрики не грузится»

Проверьте:
```bash
grep "NEXT_PUBLIC_YANDEX_METRIKA_ID" .env.local
# должно вывести: NEXT_PUBLIC_YANDEX_METRIKA_ID=111432662
```
Если пусто или нет такого значения — запустите `bash scripts/setup-env.sh dev` и введите `111432662` когда спросит.

### «Кнопка «Войти через Яндекс» возвращает stub error»

Это значит `YANDEX_CLIENT_ID` не заполнен. Заполните его:
```bash
bash scripts/setup-env.sh dev
# когда спросит «Yandex OAuth Client ID» — вставьте ваш ClientID
```

### «build падает с ошибкой prisma.config.ts: file:// URL»

В `.env` остался `DATABASE_URL=file:...`. Замените на пустую строку или на `postgresql://...`:
```bash
echo "DATABASE_URL=" > .env
# реальный URL должен быть в .env.local через setup-env.sh
```

### «Новые миграции не применились автоматически»

Примените вручную через psql:
```bash
docker exec -i conditera-supabase-db psql -U postgres -d postgres \
  < supabase/migrations/0026_storage_buckets_and_confectioners_rls.sql
```
Или все новые миграции сразу:
```bash
for f in supabase/migrations/*.sql; do
  echo "Applying $f..."
  docker exec -i conditera-supabase-db psql -U postgres -d postgres < "$f" 2>&1 | grep -v "^$"
done
```

---

## Скрипты — справка

| Скрипт | Назначение |
|--------|------------|
| `bash scripts/setup-env.sh dev` | Интерактивный мастер создания `.env.local` |
| `bash scripts/setup-env.sh prod` | Интерактивный мастер создания `.env.production` |
| `bash scripts/env-check.sh` | Проверка `.env.local` на готовность |
| `bash scripts/env-check.sh production` | Проверка `.env.production` на готовность |
| `bash scripts/update-from-archive.sh <archive>` | Безопасное обновление из нового архива |
| `bash scripts/update-from-archive.sh <archive> --dry-run` | Dry-run — посмотреть что изменится |
| `bash scripts/deploy.sh` | Production deploy (с git pull + env-check + миграции + health check) |

---

## Файлы и их роли

| Файл | Роль | Коммитится в git? |
|------|------|-------------------|
| `.env` | Минимальный dev-fallback (пустой `DATABASE_URL=`) | ДА |
| `.env.local` | Ваши dev-секреты и ID счётчиков | НЕТ |
| `.env.local.example` | Шаблон для dev — обновляется скриптами | ДА |
| `.env.production` | Ваши prod-секреты | НЕТ |
| `.env.production.example` | Шаблон для prod — обновляется скриптами | ДА |
| `backups/pre-update-*/` | Бэкапы до обновления | НЕТ |
