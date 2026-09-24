# Self-hosted Supabase — инструкция по запуску

## 🚀 Быстрый старт (dev)

### 1. Установить переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
cp .env.example .env
```

Сгенерируйте секреты (одной командой):

```bash
openssl rand -hex 32  # POSTGRES_PASSWORD
openssl rand -hex 32  # JWT_SECRET
openssl rand -hex 32  # ENCRYPTOR_KEY
openssl rand -hex 64  # SECRET_KEY_BASE
openssl rand -hex 32  # LOGFLARE_API_KEY
openssl rand -hex 16  # LOGFLARE_DASHBOARD_PASSWORD
```

Сгенерируйте Supabase API keys (нужен `supabase` CLI):

```bash
# Установить Supabase CLI
brew install supabase/tap/supabase  # macOS
# или: npm install -g supabase  # через npm

# Сгенерировать anon + service_role keys
supabase gen keys --project-id conditera
```

Вставьте сгенерированные ключи в `.env`:
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 2. Запустить Supabase stack

```bash
docker-compose -f docker-compose.supabase.yml up -d
```

Проверить что все 10 контейнеров запущены:
```bash
docker-compose -f docker-compose.supabase.yml ps
# Все должны быть "Up" или "healthy"
```

### 3. Применить миграции

```bash
# Установить supabase CLI если ещё не установлен
npm install -g supabase

# Линк к локальному проекту
supabase link --project-ref conditera

# Применить миграции
supabase db push
```

Или вручную через psql:
```bash
docker exec -i conditera-supabase-db psql -U supabase -d supabase < supabase/migrations/0001_init.sql
```

### 4. Открыть Supabase Studio

http://localhost:8100 — web UI для управления всем Supabase:
- Table Editor — просмотр/редактирование таблиц
- Authentication — список пользователей, OAuth настройки
- Storage — файлы (создать buckets: avatars, product_images, documents)
- SQL Editor — выполнение SQL запросов
- Edge Functions — deploy и логи
- Logs — просмотр логов через Logflare

### 5. Создать Storage Buckets

В Supabase Studio → Storage → New bucket:
- `avatars` (public) — аватары пользователей
- `product_images` (public) — фото товаров
- `documents` (private) — счета, договоры, налоговые отчёты
- `messages` (private) — вложения чата

### 6. Запустить Next.js

```bash
npm run dev:local
# Открыть http://localhost:3000
```

### 7. Зарегистрировать первого админа

1. Открыть http://localhost:3000 → кликнуть «Войти» → Регистрация
2. Указать email + пароль
3. В Supabase Studio → Authentication → Users — найти пользователя
4. В Table Editor → user_roles → вставить новую строку:
   ```
   user_id: <ваш user id>
   role: ADMIN
   is_active: true
   ```

Готово! Теперь у вас есть рабочий Supabase + Next.js стек.

## 📦 Что входит в стек

### 10 Supabase сервисов

| Сервис | Контейнер | Порт | Назначение |
|---|---|---|---|
| PostgreSQL 15 | conditera-supabase-db | 5432 (внутр.) | БД с расширениями pgsodium, pg_cron, pg_trgm |
| Kong API Gateway | conditera-supabase-kong | **8000** | Единая точка входа для всех API |
| GoTrue (Auth) | conditera-supabase-auth | 9999 (внутр.) | Email/pass, OAuth, Magic Link, 2FA |
| PostgREST | conditera-supabase-rest | 3000 (внутр.) | Auto REST API из БД схемы |
| Realtime | conditera-supabase-realtime | 4000 (внутр.) | WebSocket подписки на postgres_changes |
| Storage | conditera-supabase-storage | 5000 (внутр.) | S3-совместимое хранилище |
| imgproxy | conditera-supabase-imgproxy | 5001 (внутр.) | Обработка изображений |
| postgres-meta | conditera-supabase-meta | 8080 (внутр.) | Управление схемой БД |
| Supabase Studio | conditera-supabase-studio | **8100** | Web UI админка |
| Logflare Analytics | conditera-supabase-analytics | 4000 (внутр.) | Логирование |

### Порты (изменены чтобы не конфликтовать с Next.js на :3000)
- **8000** — Kong (главный API gateway)
- **8100** — Supabase Studio (web UI)
- **3000** — Next.js (остаётся как было)

## 🔌 Подключение из Next.js

В коде использовать:

```typescript
// Client component (браузер)
import { supabaseBrowser } from '@/lib/supabase/browser';
const { data: { user } } = await supabaseBrowser.auth.getUser();

// Server component / Route Handler
import { getSupabaseServer } from '@/lib/supabase/server';
const supabase = await getSupabaseServer();
const { data: profiles } = await supabase.from('profiles').select('*');

// Admin operations (полный доступ в обход RLS)
import { supabaseAdmin } from '@/lib/supabase/admin';
await supabaseAdmin.from('user_roles').insert({ user_id, role: 'ADMIN' });
```

## 📊 Структура файлов

```
supabase/
├── config.toml                      # Конфиг Supabase CLI
├── kong.yml                         # Kong API gateway routing
├── init-scripts/                    # SQL инициализация
├── migrations/                      # SQL миграции (применяются через supabase db push)
│   └── 0001_init.sql                # profiles, user_roles, addresses, triggers, RLS
└── functions/                       # Edge Functions (Deno)
    ├── abandoned-cart/              # Брошенная корзина (pg_cron каждый час)
    ├── daily-digest/                # Ежедневный дайджест (9:00 MSK)
    ├── bonus-expiry/                # Сгорание бонусов (00:00 MSK)
    ├── telegram-webhook/            # Приём webhook от Telegram
    ├── yookassa-webhook/            # Приём webhook от Yookassa
    └── send-notification/           # Отправка уведомлений в @conditera канал
```

## 🔐 Безопасность

### Row Level Security (RLS)
Все таблицы с user data имеют RLS политики:
- `profiles` — пользователь видит/редактирует только свой профиль (админ видит все)
- `user_roles` — пользователь видит только свои роли (админ может назначать)
- `addresses` — пользователь видит/создаёт/удаляет только свои адреса
- `notification_preferences` — пользователь видит/редактирует только свои

Пример RLS политики:
```sql
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
```

### API Keys
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — виден в браузере, обходит RLS только через PUBLIC-политики
- **`SUPABASE_SERVICE_ROLE_KEY`** — полный доступ в обход RLS, НИКОГДА не попадает в браузер

### JWT Secret
Используется для подписи JWT токенов (access + refresh). Минимум 32 символа. При компрометации — rotate.

## 🛠️ Команды

### Запуск/остановка
```bash
# Запуск всего стека
docker-compose -f docker-compose.supabase.yml up -d

# Остановка
docker-compose -f docker-compose.supabase.yml down

# Полная очистка (УДАЛИТ ВСЕ ДАННЫЕ!)
docker-compose -f docker-compose.supabase.yml down -v
```

### База данных
```bash
# Применить миграции
supabase db push

# Создать новую миграцию
supabase migration new add_table_name

# Сгенерировать TypeScript типы из схемы
supabase gen types typescript --local > src/lib/supabase/types.ts

# Backup
docker exec conditera-supabase-db pg_dump -U supabase supabase > backup_$(date +%Y%m%d).sql

# Восстановить
cat backup_20260817.sql | docker exec -i conditera-supabase-db psql -U supabase -d supabase
```

### Edge Functions
```bash
# Deploy функции
supabase functions deploy telegram-webhook

# Логи функции
supabase functions logs telegram-webhook

# Локальный запуск
supabase functions serve telegram-webhook
```

### Просмотр логов
```bash
# Все сервисы
docker-compose -f docker-compose.supabase.yml logs -f --tail=50

# Только GoTrue (auth)
docker-compose -f docker-compose.supabase.yml logs -f supabase-auth

# Только PostgreSQL
docker-compose -f docker-compose.supabase.yml logs -f supabase-db
```

## 🐛 Устранение проблем

### Проблема: Studio не открывается на :8100
**Решение:** Проверить что контейнер `conditera-supabase-studio` healthy:
```bash
docker ps | grep studio
# Если unhealthy — посмотреть логи:
docker logs conditera-supabase-studio
```

### Проблема: Cannot connect to localhost:8000
**Решение:** Kong не запустился. Проверить:
```bash
docker logs conditera-supabase-kong
# Если "permission denied" — sudo chown -R $USER:$USER ./supabase
```

### Проблема: RLS блокирует все запросы
**Решение:** Проверить что в запросе передаётся JWT:
```typescript
// Правильно (браузер автоматически добавляет JWT из cookies)
const { data } = await supabaseBrowser.from('profiles').select('*');

// На сервере:
const supabase = await getSupabaseServer(); // автоматически достаёт JWT из cookies
const { data } = await supabase.from('profiles').select('*');
```

### Проблема: PGlite WASM error в build
**Решение:** Это в v1.0. В v2.0 PGlite полностью убран — используйте только Supabase Postgres.

## 📚 Документация

- [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Row Level Security](https://www.postgresql.org/docs/15/ddl-rowsecurity.html)
- [Next.js + Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs)
