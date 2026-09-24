# 🧁 ПОЛНОЕ ТЕХНИЧЕСКОЕ ЗАДАНИЕ (ПРОМПТ)

## Маркетплейс кондитерских изделий «Уездный кондитер» v2.0 — Полная реконструкция на self-hosted Supabase

---

## 🎯 КОНТЕКСТ ПРОЕКТА

Создаётся маркетплейс кондитерских изделий и услуг **«Уездный кондитер»** — российский аналог Goldbelly/CakeIt/Flowwow, объединяющий **покупателей**, **домашних кондитеров**, **поставщиков ингредиентов**, **курьеров** и **администраторов**.

**Бренд и домен:**
- **Название:** «Уездный кондитер» (не «Кондитера», не «Уездный»)
- **Домен:** `conditera.ru` (+ www.conditera.ru)
- **Telegram-канал:** @conditera
- **Фирменные шрифты:** Brokgauz & Efron Italic (заголовки), TriodPostnaja Medium (брендовое название), Neucha (рукописный), Geist/Geist Mono (body)
- **Палитра:** тёмно-ягодный #8B2942 (primary), амбер #D97706 (accent), slate #1F2937 (body)
- **Стиль:** дореволюционный кондитерский колорит + современный UX

**Целевая аудитория:**
- Частные покупатели, ищущие уникальные десерты
- Домашние кондитеры и кондитерские ателье
- Поставщики ингредиентов, декора, упаковки
- Корпоративные клиенты (рестораны, отели, ивент-агентства)

---

## ⚠️ КРИТИЧЕСКИ ВАЖНО: СТЕК ПРОЕКТА (НЕ МЕНЯТЬ!)

| Компонент | Технология | Примечание |
|-----------|------------|------------|
| **Frontend** | Next.js 16 (App Router) | Turbopack, SSR/SSG |
| **Backend** | Next.js API routes | Route handlers |
| **База данных** | **Supabase PostgreSQL 15** (self-hosted) | Через Docker |
| **ORM/клиент** | **@supabase/supabase-js** | **НЕ PRISMA!** |
| **Аутентификация** | Supabase Auth (GoTrue) | JWT, OAuth, Magic Link, 2FA |
| **Realtime** | Supabase Realtime | WebSockets, postgres_changes |
| **Хранилище** | Supabase Storage | S3-совместимое + imgproxy |
| **Поиск** | Postgres FTS (tsvector + GIN) | Замена Meilisearch |
| **Автоматизация** | pg_cron + Supabase Edge Functions | Замена n8n |
| **Деплой** | Docker Compose + GitHub Actions | Единый стек |
| **Reverse Proxy** | Caddy 2.8 | Авто-HTTPS + health-check |
| **Туннель** | Cloudflare Tunnel | Доступ без публичного IP |

### 🚫 ЗАПРЕЩЕНО ИСПОЛЬЗОВАТЬ:
- ❌ Prisma (любой версии)
- ❌ SQLite (любой версии)
- ❌ Drizzle ORM, TypeORM, MikroORM
- ❌ Socket.IO (заменён на Supabase Realtime)
- ❌ Redis (заменён на Supabase)
- ❌ n8n (заменён на Edge Functions)
- ❌ Meilisearch (заменён на Postgres FTS)

### ✅ РАЗРЕШЕНО:
- ✅ @supabase/supabase-js
- ✅ @supabase/ssr
- ✅ Raw SQL через `supabase.rpc()`

---

## 📋 ОСНОВНЫЕ ФУНКЦИОНАЛЬНЫЕ МОДУЛИ (12)

### Модуль 1: Auth (аутентификация)
**Возможности:**
- Email + password регистрация и логин
- Email confirmation (письмо с подтверждением)
- Password reset (forgot password flow)
- Magic Link (бесшарольный вход)
- OAuth: Google, Яндекс, ВКонтакте
- 2FA через TOTP (Google Authenticator, Authy)
- Session management: access token (1 час) + refresh token (7 дней)
- Row Level Security (RLS) на уровне БД

**Таблицы БД:**
- `auth.users` — встроенная GoTrue
- `auth.identities` — OAuth providers
- `auth.sessions` — активные сессии
- `auth.mfa_factors` — 2FA TOTP secrets
- `public.profiles` — расширение auth.users (full_name, avatar_url, phone, city, address)
- `public.user_roles` — множественные роли (user_id, role, is_active)

**API Endpoints:**
```
GET    /api/auth/callback       - OAuth redirect callback
POST   /api/auth/refresh        - Обновить access token
POST   /api/auth/logout         - Выход (revoke session)
GET    /api/auth/check          - Проверка сессии
GET    /api/profile             - Получить профиль
PATCH  /api/profile             - Обновить профиль
POST   /api/profile/avatar      - Загрузить аватар
PATCH  /api/profile/password    - Сменить пароль
DELETE /api/profile/delete      - Удалить аккаунт
```

**UI Компоненты:**
- `AuthModal` — модалка входа/регистрации (email+pass, OAuth, Magic Link)
- `ProfileSettings` — настройки профиля (смена пароля, 2FA, адреса)
- `AvatarUpload` — загрузка аватара с crop и resize
- `RoleSwitcher` — переключатель ролей

---

### Модуль 2: Marketplace (маркетплейс)
**Возможности:**
- Каталог товаров с фильтрацией по категориям, городу, цене, рейтингу
- Карточка товара с фото, видео, 3D-срезом, описанием, отзывами
- Корзина (работает без логина, через session ID)
- Оформление заказа с выбором доставки
- Оплата через Yookassa (test mode + production)
- Избранное (wishlist)
- Поиск через Postgres FTS (tsvector + GIN + pg_trgm)
- История заказов с возможностью повторного заказа

**Таблицы БД:**
```sql
products (id, name, description, price, category, confectioner_id, status, created_at, views_count)
product_categories (id, name, slug, description, parent_id)
product_images (id, product_id, url, position)
product_videos (id, product_id, video_url, title, is_primary, position, status, views_count)
product_variants (id, product_id, name, price, weight_grams, is_default, in_stock)
cart_items (id, session_id, user_id, product_id, variant_id, quantity)
orders (id, customer_id, confectioner_id, total_amount, status, delivery_address, delivery_date, created_at, previous_order_id, is_repeat_order)
order_items (id, order_id, product_id, quantity, price_snapshot, custom_options)
order_status_history (id, order_id, status_from, status_to, changed_by, created_at)
payments (id, order_id, yookassa_payment_id, status, amount, method)
deliveries (id, order_id, type, status, courier_id, delivery_address, tracking_code)
delivery_tracking (id, order_id, courier_id, lat, lng, status, created_at)
```

**API Endpoints (15):**
```
GET    /api/products                 - Список товаров с фильтрами
GET    /api/products/[id]            - Карточка товара
GET    /api/products/[id]/reviews    - Отзывы на товар
POST   /api/products/[id]/reviews    - Добавить отзыв
GET    /api/cart                     - Получить корзину
POST   /api/cart                     - Добавить в корзину
DELETE /api/cart/[id]                - Удалить из корзины
POST   /api/checkout                 - Оформление заказа
POST   /api/payment/create           - Создать платёж Yookassa
POST   /api/payment/webhook          - Webhook от Yookassa
GET    /api/orders                   - Список заказов
GET    /api/orders/[id]              - Детали заказа
PATCH  /api/orders/[id]              - Обновить заказ
POST   /api/orders/[id]/repeat       - Повторить заказ
GET    /api/orders/[id]/track        - Отслеживание доставки
GET    /api/favorites                - Избранное
POST   /api/favorites                - Добавить в избранное
DELETE /api/favorites/[id]           - Удалить из избранного
GET    /api/search                    - Поиск через FTS
POST   /api/search/reindex            - Переиндексация FTS (admin only)
```

**UI Компоненты:**
- `CatalogPage` — каталог с фильтрами
- `ProductPage` — карточка товара с видео и 3D-срезом
- `CartDrawer` — корзина (выдвижная панель)
- `CheckoutPage` — оформление заказа
- `ProductCard` — карточка товара в списке
- `ProductGallery` — галерея изображений и видео
- `OrderHistory` — история заказов с фильтрацией
- `OrderTracking` — отслеживание доставки

---

### Модуль 3: Cake Builder (конструктор тортов) — ПОЛНАЯ РЕАЛИЗАЦИЯ

**Компонент:** `src/components/cake-builder/cake-builder-dialog.tsx` (930 строк)
**Тип:** Модальное окно (Dialog из shadcn/ui)
**State management:** Zustand store (`useAppStore`) → в v2.0 Supabase (`useSubmitInquiry`)
**Размер:** `max-w-4xl max-h-[95vh]`
**Поведение:** 8-шаговый wizard с прогресс-баром

**Архитектура компонента:**

```
┌──────────────────────────────────────────────────┐
│  Dialog (max-w-4xl, max-h-95vh)                  │
│  ┌────────────────────────────────────────────┐  │
│  │  Background Image (/builder-bg.png)         │  │
│  │  + Semi-transparent overlay (bg-background/90)│
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │  HEADER (shrink-0)                    │  │  │
│  │  │  - Cake icon (круглый, primary)       │  │  │
│  │  │  - Title: "Конструктор тортов"        │  │  │
│  │  │  - Badge: "Шаг N / 8"                 │  │  │
│  │  │  - Subtitle: STEP_LABELS[step]        │  │  │
│  │  │  - Close button (X)                   │  │  │
│  │  │  - Progress bar: 8 сегментов          │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │  CONTENT (flex-1, overflow-y-auto)    │  │  │
│  │  │  - step === 0 → Мероприятие          │  │  │
│  │  │  - step === 1 → Основа               │  │  │
│  │  │  - step === 2 → Начинка              │  │  │
│  │  │  - step === 3 → Покрытие             │  │  │
│  │  │  - step === 4 → Декор                │  │  │
│  │  │  - step === 5 → Диета                │  │  │
│  │  │  - step === 6 → Доставка             │  │  │
│  │  │  - step === 7 → Резюме + Кондитеры    │  │  │
│  │  │  - submitted → Success screen         │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │  FOOTER (shrink-0, border-t)         │  │  │
│  │  │  - Back button (ghost, disabled 0)   │  │  │
│  │  │  - "Шаг N из 8" / "Отправить N"     │  │  │
│  │  │  - Next/Submit button (primary)      │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**State (Zustand store):**
```typescript
interface CakeBuilderState {
  step: number;              // 0-7 (текущий шаг)
  eventType: string | null;  // 'birthday' | 'wedding' | 'kids' | 'corporate' | 'romantic' | 'just'
  base: string | null;       // 'sponge' | 'mousse' | 'cheesecake' | 'honey' | 'red_velvet' | 'biscuit'
  filling: string | null;    // 'condensed_milk' | 'cream_pleshir' | 'chocolate_ganache' | ...
  coating: string | null;    // 'cream_cheese' | 'ganache_white' | 'ganache_dark' | 'mirror_glaze' | ...
  decorations: string[];     // ['berries', 'chocolate_curls', 'macarons', ...] — мультивыбор
  dietary: string[];         // ['sugar_free', 'gluten_free', 'vegan', ...] — мультивыбор
  servings: number;          // 2-200 (по умолчанию 8)
  city: string | null;       // 'Москва', 'Тула', ...
  deliveryDate: string;      // '2026-08-20'
  deliveryType: string;      // 'delivery' | 'pickup' | 'self_pickup'
  address: string;           // 'ул. Тверская, д. 12, кв. 45'
  inscription: string;       // 'С днём рождения, Маша!' (max 50 символов)
  comment: string;           // особые пожелания
}
```

**ДЕТАЛЬНОЕ ОПИСАНИЕ ШАГОВ:**

**Шаг 0: Мероприятие (обязательно)**
- Заголовок: "Какое мероприятие?"
- Layout: Grid 2×3 (mobile) / 3×2 (desktop)
- 6 опций: День рождения, Свадьба, Детский праздник, Корпоратив, Романтический, Просто так
- canProceed: `!!cakeBuilder.eventType`

**Шаг 1: Основа (обязательно)**
- Заголовок: "Выберите основу торта"
- 6 опций: Бисквит, Муссовый, Чизкейк, Медовик, Красный бархат, Песочный бисквит
- Цена: добавляется `priceBase` к базовой (0-400 ₽)
- canProceed: `!!cakeBuilder.base`

**Шаг 2: Начинка (обязательно)**
- Заголовок: "Начинка"
- 8 опций с **3D-превью среза** через `FillingSlicePreview` компонент (56px)
- Цена: добавляется `price` (0-400 ₽)
- canProceed: `!!cakeBuilder.filling`

**Шаг 3: Покрытие (обязательно)**
- Заголовок: "Покрытие"
- 6 опций: Крем-чиз, Белый ганаш, Тёмный ганаш, Зеркальная глазурь, Велюровое напыление, Мастика
- Цена: добавляется `price` (0-500 ₽)
- canProceed: `!!cakeBuilder.coating`

**Шаг 4: Декор (опционально, мультивыбор)**
- Заголовок: "Декор"
- 8 опций: Свежие ягоды, Шоколадная стружка, Макаронс, Безе, Сахарные цветы, Свежие фрукты, Сусальное золото, Вафельная бумага
- Цена: сумма всех выбранных `price`
- canProceed: `true` (всегда)

**Шаг 5: Диета (опционально, мультивыбор)**
- Заголовок: "Диетические предпочтения"
- 6 опций: Без сахара, Без глютена, Без лактозы, Веганский, Кето, Гипоаллергенный
- Цена: не влияет (но влияет на фильтрацию кондитеров)
- canProceed: `true` (всегда)

**Шаг 6: Доставка (обязательно)**
- Заголовок: "Доставка"
- Поля: Город (input), Дата доставки (date), Способ получения (OptionCard × 2), Адрес доставки (input), Количество порций (2-200)
- Способы получения: Доставка (расчёт через `calculateDelivery(price)`) или Самовывоз (бесплатно)
- canProceed: `!!city && !!deliveryDate && !!deliveryType`

**Шаг 7: Резюме + Кондитеры (обязательно)**
- Заголовок: "Выберите кондитеров"
- 4 секции: Сводка заказа, Надпись и комментарий, Запрос скидки (0-30%), Список кондитеров (мультивыбор)
- canProceed: `selectedConfectioners.length > 0`

**Формула расчёта цены:**
```
estimatedPrice = 1500                               // базовая цена (8 порций)
               + base.priceBase                     // + основа (0-400 ₽)
               + filling.price                      // + начинка (0-400 ₽)
               + coating.price                      // + покрытие (0-500 ₽)
               + SUM(decorations[].price)           // + декор (мультивыбор)
               + MAX(0, servings - 8) × 180         // + доп. порции

deliveryCost   = calculateDelivery(estimatedPrice)  // 0 при ≥3000₽, иначе 300+50/км
                 if deliveryType === "delivery", else 0

total          = estimatedPrice + deliveryCost
               × (1 - discountPercent / 100)        // если запрошена скидка
```

**UI Компоненты:**
- `CakeBuilderDialog` — основное модальное окно (930 строк)
- `StepContainer` — обёртка для каждого шага
- `OptionCard` — карточка опции (selected/unselected)
- `FillingSlicePreview` — 3D-превью среза торта (56px / 64px)
- `SummaryRow` — строка в сводке

**Интеграция с Supabase (v2.0):**
```typescript
// Отправка запроса
useSubmitInquiry.mutate({
  draftId: "draft-123",
  confectionerIds: ["conf-1", "conf-2"],
  estimatedPrice: 7710,
  requestDiscount: true,
  discountPercent: 10,
  discountComment: "Постоянный клиент",
});
// → POST /api/inquiries
//   → Создаёт inquiry (snapshot проекта торта)
//   → Создаёт N negotiations (по одной на кондитера)
//   → Помечает draft как is_submitted = true
//   → Отправляет уведомления кондитерам через Edge Function
```

---

### Модуль 4: Тендерная площадка
**Возможности:**
- Создание тендера заказчиком (частное лицо, ресторан, отель)
- Подача предложений кондитерами
- Выбор победителя с автоматическим созданием заказа
- Приглашение конкретных кондитеров (закрытые тендеры)
- Автоматическое создание чата при создании тендера
- Событие в календаре кондитера при создании тендера

**Таблицы БД:**
```sql
tenders (id, customer_id, title, description, category, required_servings, budget_min, budget_max, required_city, required_delivery_date, end_date, specifications JSONB, status, is_public, is_urgent, chat_channel_id, created_at)
tender_offers (id, tender_id, confectioner_id, offer_price, offer_description, proposed_delivery_date, status, is_winner, created_at)
tender_invitations (id, tender_id, confectioner_id, status, invited_at)
tender_history (id, tender_id, user_id, action, old_value JSONB, new_value JSONB, created_at)
tender_reviews (id, tender_id, reviewer_id, target_user_id, rating, comment, created_at)
```

**API Endpoints:**
```
GET    /api/tenders                     - Список активных тендеров
GET    /api/tenders/[id]                - Детали тендера
POST   /api/tenders                     - Создать тендер
PATCH  /api/tenders/[id]                - Обновить тендер
POST   /api/tenders/[id]/offers         - Подать предложение
GET    /api/tenders/[id]/offers         - Список предложений
POST   /api/tenders/[id]/offers/[id]/accept - Принять предложение
POST   /api/tenders/[id]/invite         - Пригласить кондитера
POST   /api/tenders/[id]/reviews        - Оставить отзыв
```

**UI Компоненты:**
- `TenderCard` — карточка тендера
- `CreateTenderForm` — форма создания тендера
- `TenderDetail` — страница тендера
- `OfferList` — список предложений
- `CreateOfferForm` — форма подачи предложения

---

### Модуль 5: Карта кондитеров (Яндекс Карты)
**Возможности:**
- Автоопределение геолокации пользователя (IP + браузер)
- Поиск кондитеров на карте с кластеризацией
- Фильтры: дегустация, ателье, открыто сейчас, радиус поиска
- Карточка кондитера при клике на маркер
- Сайдбар со списком результатов
- Построение маршрута до кондитера
- Управление геоданными в дашборде кондитера
- Поиск кондитеров по локации для тендера

**Таблицы БД:**
```sql
confectioner_geo (id, confectioner_id, location GEOMETRY(POINT,4326), address, city, delivery_radius_km, working_hours JSONB, tasting_available, tasting_price, has_atelier, is_active, is_verified)
ateliers (id, confectioner_geo_id, name, description, location GEOMETRY(POINT,4326), services TEXT[], photos UUID[], working_hours JSONB)
tastings (id, atelier_id, date, start_time, end_time, max_participants, current_participants, price, status)
tasting_bookings (id, tasting_id, user_id, participants_count, status)
delivery_zones (id, confectioner_id, name, polygon GEOMETRY(POLYGON,4326), delivery_price, min_order_amount)
```

**API Endpoints:**
```
GET    /api/map/confectioners        - Поиск кондитеров в радиусе
GET    /api/map/ateliers             - Поиск ателье с дегустациями
POST   /api/confectioner/geo         - Управление геоданными
GET    /api/geo/ip                   - Определение города по IP
```

**UI Компоненты:**
- `ConfectionerMap` — карта с маркерами и кластеризацией
- `FilterPanel` — панель фильтров
- `ConfectionerCard` — карточка кондитера в сайдбаре
- `GeoManagement` — управление геоданными в дашборде
- `WorkingHoursEditor` — редактор часов работы

---

### Модуль 6: Чат (Supabase Realtime)
**Возможности:**
- Чат между покупателем и кондитером
- Чат между покупателем и поддержкой
- Групповые чаты (заказ → покупатель + кондитер + курьер)
- Статус "печатает" (typing indicator)
- Реакции на сообщения (эмодзи)
- Система непрочитанных сообщений
- Отправка файлов и изображений
- Push-уведомления о новых сообщениях
- Системные сообщения о смене статуса заказа

**Таблицы БД:**
```sql
chat_channels (id, type TEXT CHECK (type IN ('direct', 'order', 'group', 'support')), metadata JSONB, created_at)
chat_channel_members (id, channel_id, user_id, created_at)
chat_messages (id, channel_id, user_id, content, type TEXT CHECK (type IN ('text', 'image', 'file', 'system', 'status_update')), metadata JSONB, created_at)
chat_typing_indicators (channel_id, user_id, is_typing, updated_at)
chat_unread (user_id, channel_id, last_read_message_id, unread_count, updated_at)
chat_message_reactions (id, message_id, user_id, emoji, created_at)
```

**API Endpoints:**
```
GET    /api/chat/channels              - Список каналов
POST   /api/chat/channels              - Создать канал
GET    /api/chat/channels/[id]         - Детали канала
GET    /api/chat/channels/[id]/messages - Сообщения канала
POST   /api/chat/channels/[id]/messages - Отправить сообщение
PATCH  /api/chat/messages/[id]/read    - Отметить как прочитанное
POST   /api/chat/messages/[id]/reaction - Добавить реакцию
POST   /api/chat/typing                - Статус "печатает"
GET    /api/chat/unread                - Общее количество непрочитанных
```

**UI Компоненты:**
- `ChatWidget` — виджет чата (в правом нижнем углу)
- `ChatWindow` — полноэкранный чат
- `ChatMessage` — сообщение с аватаром
- `ChatInput` — поле ввода с поддержкой файлов
- `ChatTypingIndicator` — индикатор "печатает"

---

### Модуль 7: CRM (управление клиентами)
**Возможности:**
- Клиентская база (список, карточка, сегментация)
- Тикеты поддержки (список, ответы, эскалация)
- Kanban-доска лидов (drag-and-drop)
- История взаимодействий (timeline, заметки)
- Экспорт базы клиентов в CSV/Excel
- Автоматическое логирование действий

**Таблицы БД:**
```sql
support_tickets (id, user_id, title, description, category, priority, status, assigned_to, created_at)
ticket_messages (id, ticket_id, user_id, content, is_internal, created_at)
leads (id, source, status, stage, contact_name, contact_phone, contact_email, notes, assigned_to, created_at)
lead_activities (id, lead_id, type, description, created_at)
customer_profiles (id, user_id, total_orders, total_spent, lifetime_value, last_order_at, tags TEXT[], notes)
customer_timeline (id, user_id, event_type, description, metadata JSONB, created_at)
```

**API Endpoints:**
```
GET    /api/crm/clients                 - Список клиентов
GET    /api/crm/clients/[id]            - Карточка клиента
GET    /api/crm/tickets                 - Список тикетов
POST   /api/crm/tickets                 - Создать тикет
GET    /api/crm/tickets/[id]            - Детали тикета
POST   /api/crm/tickets/[id]/messages   - Ответить на тикет
GET    /api/crm/leads                   - Список лидов (Kanban)
POST   /api/crm/leads                   - Создать лид
PATCH  /api/crm/leads/[id]              - Обновить лид
GET    /api/crm/timeline                - Таймлайн клиента
```

**UI Компоненты:**
- `ClientList` — список клиентов с фильтрацией
- `ClientCard` — карточка клиента с историей
- `TicketList` — список тикетов
- `TicketDetail` — детали тикета с ответами
- `LeadBoard` — Kanban-доска лидов
- `ClientTimeline` — таймлайн взаимодействий

---

### Модуль 8: CMS (управление контентом)
**Возможности:**
- Управление страницами (WYSIWYG, версионирование)
- Управление баннерами (таргетинг, статистика)
- Управление навигацией (drag-and-drop, подменю)
- Медиатека (загрузка, категоризация, оптимизация)
- SEO-метаданные (Open Graph, JSON-LD)
- Управление дизайном (цвета, шрифты, макет)

**Таблицы БД:**
```sql
cms_pages (id, slug, title, content MDX, status, published_at, version, created_at)
cms_page_history (id, page_id, content, version, created_by, created_at)
cms_banners (id, name, type, title, description, image_url, link_url, target_roles TEXT[], target_pages TEXT[], show_start, show_end, priority, is_active, created_at)
cms_navigation (id, label, url, icon, parent_id, sort_order, roles TEXT[], is_active)
cms_media (id, name, url, type, size, mime_type, alt_text, uploaded_by, created_at)
cms_meta (page_slug, meta_title, meta_description, meta_keywords, og_title, og_description, og_image, json_ld JSONB, updated_at)
design_settings (id, theme, primary_color, accent_color, font_heading, font_body, layout_style, max_width, animations_enabled, custom_css, custom_js, updated_at)
```

**API Endpoints:**
```
GET    /api/cms/pages                   - Список страниц
POST   /api/cms/pages                   - Создать страницу
GET    /api/cms/pages/[slug]            - Получить страницу
PATCH  /api/cms/pages/[slug]            - Обновить страницу
DELETE /api/cms/pages/[slug]            - Удалить страницу
GET    /api/cms/banners                 - Список баннеров
POST   /api/cms/banners                 - Создать баннер
PATCH  /api/cms/banners/[id]            - Обновить баннер
DELETE /api/cms/banners/[id]            - Удалить баннер
GET    /api/cms/navigation              - Навигация
PATCH  /api/cms/navigation              - Обновить навигацию
GET    /api/cms/media                   - Медиатека
POST   /api/cms/media                   - Загрузить файл
DELETE /api/cms/media/[id]              - Удалить файл
GET    /api/admin/design/settings       - Настройки дизайна
PATCH  /api/admin/design/settings       - Обновить настройки
```

**UI Компоненты:**
- `PageEditor` — WYSIWYG редактор страниц
- `PageList` — список страниц
- `BannerManager` — управление баннерами
- `NavigationManager` — управление навигацией
- `MediaLibrary` — медиатека
- `DesignSettings` — настройки дизайна

---

### Модуль 9: Dashboards (личные кабинеты)
**Роли и их возможности:**

**CUSTOMER Dashboard:**
- Список заказов (active, history) с фильтрацией
- Избранное (wishlist)
- Адреса доставки (CRUD)
- Бонусы и скидки
- Переговоры с кондитерами
- Сообщения (chat)
- Настройки профиля
- Шаблоны повторных заказов
- Избранные кондитеры
- Отслеживание доставки

**CONFECTIONER Dashboard:**
- Входящие запросы (cake builder inquiries)
- Активные переговоры (suggest price, accept, decline)
- Заказы (принять, готовить, отправить) с трекингом
- Управление товарами (CRUD с видео)
- Календарь заказов с зонами доставки
- Финансы (доход, выплаты, комиссии)
- Отзывы и рейтинг
- Управление геоданными (карта)
- Аналитика продаж (графики, когорты)
- Склад (ингредиенты с остатками)
- Рецепты с расчётом КБЖУ и себестоимости
- Таблица Ганта для визуализации заказов

**SUPPLIER Dashboard:**
- Управление товарами (ингредиенты, упаковка)
- Склад (остатки, цены)
- Заказы от кондитеров (B2B)
- Финансы (доход, выплаты)

**COURIER Dashboard:**
- Активные доставки (список)
- История доставок
- Заработок за период
- Смена статуса (picked up, in transit, delivered)
- Отправка геопозиции (GPS)

**ADMIN Dashboard:**
- Пользователи (список, фильтр по ролям, ban/unban)
- Заказы (все, фильтры, экспорт CSV)
- Финансы (общий доход, комиссии, выплаты)
- CRM (тикеты, лиды, клиенты)
- CMS (страницы, баннеры, навигация)
- Модерация контента (отзывы, фото, видео)
- Аналитика (графики, Яндекс Метрика)
- Управление дизайном (цвета, шрифты, макет)
- Платёжная система (транзакции, выплаты, комиссии)

**UI Компоненты:**
- `DashboardLayout` — общая обёртка с сайдбаром
- `DashboardHeader` — шапка с приветствием
- `KpiGrid` — карточки KPI
- `RevenueChart` — график выручки
- `OrdersChart` — график заказов
- `UpcomingOrders` — ближайшие заказы
- `OrderHistory` — история заказов
- `OrderTracking` — отслеживание доставки
- `VideoManager` — управление видео в дашборде
- `InventoryManager` — управление складом
- `RecipeManager` — управление рецептами

---

### Модуль 10: Payments (платежи Yookassa)
**Возможности:**
- Создание платежа через Yookassa
- Webhook для подтверждения платежа
- Эскроу-счёт (деньги замораживаются до подтверждения)
- Возвраты (рефанды)
- Комиссии платформы (5-15% по тарифу)
- Выплаты кондитерам

**Поток платежа:**
1. Пользователь оформляет заказ → POST /api/checkout
2. Backend создаёт payment в Yookassa
3. Yookassa возвращает confirmation_url → редирект пользователя
4. Пользователь вводит карту, оплачивает на стороне Yookassa
5. Yookassa отправляет webhook на /api/payment/webhook (payment.succeeded)
6. Backend обновляет order.status = paid, отправляет уведомления

**Таблицы БД:**
```sql
payments (id, order_id, yookassa_payment_id, status, amount, method, escrow_released_at, refund_id, created_at)
refunds (id, order_id, amount, reason, status, yookassa_refund_id, processed_at)
payout_requests (id, confectioner_id, amount, status, bank_details, paid_at, created_at)
```

**API Endpoints:**
```
POST   /api/payment/create    - Создать платёж
POST   /api/payment/webhook   - Webhook от Yookassa
POST   /api/payment/refund    - Создать возврат
GET    /api/payment/status    - Статус платежа
POST   /api/admin/payouts     - Создать выплату
```

---

### Модуль 11: Telegram (уведомления + бот)
**Возможности:**
- Уведомления в канал @conditera о событиях (новый заказ, новый лид, тикет)
- Бот для пользователей (статус заказа, чат с поддержкой)
- Push-уведомления о новых сообщениях
- Реализация через Supabase Edge Functions

**Edge Functions:**
```
supabase/functions/telegram-webhook/      - Приём update от Telegram
supabase/functions/send-channel-notification/ - Отправка уведомления в канал
supabase/functions/telegram-bot-command/  - Обработка команд бота (/start, /status, /help)
supabase/functions/chat-notification/     - Push-уведомления о сообщениях
supabase/functions/send-push/             - Отправка push-уведомлений
```

**API Endpoints:**
```
POST   /api/telegram/webhook   - Webhook от Telegram
POST   /api/telegram/setup     - Установка webhook
POST   /api/telegram/test      - Тестовая отправка
```

---

### Модуль 12: Automation (автоматизация)
**Возможности:**
- Брошенная корзина (Edge Function + pg_cron)
- Ежедневный дайджест (Edge Function + pg_cron)
- Сгорание бонусов (Edge Function + pg_cron)
- Автоматические отчёты (ежедневные, еженедельные)
- Автоматические рассылки (email, push, sms, telegram)
- Автоматические уведомления о статусе заказа

**Cron-задачи:**
```
Брошенная корзина  → Каждый час: 0 * * * *
Ежедневный дайджест → 9:00 MSK: 0 9 * * *
Сгорание бонусов   → Полночь: 0 0 * * *
Реиндексация поиска → On INSERT/UPDATE products
Backup БД          → 3:00 MSK: 0 3 * * *
Авто-закрытие тендеров → Каждый час: 0 * * * *
Напоминание о дегустации → 9:00 MSK: 0 9 * * *
```

**Edge Functions:**
```
supabase/functions/abandoned-cart/        - Уведомление о брошенной корзине
supabase/functions/daily-digest/          - Ежедневный дайджест
supabase/functions/bonus-expiry/          - Сгорание бонусов
supabase/functions/send-email/            - Отправка email
supabase/functions/send-push/             - Отправка push-уведомлений
supabase/functions/auto-close-tenders/    - Авто-закрытие просроченных тендеров
supabase/functions/tasting-reminder/      - Напоминание о дегустации
```

**pg_cron настройка:**
```sql
SELECT cron.schedule('abandoned-cart', '0 * * * *', 'SELECT net.http_post(...)');
SELECT cron.schedule('daily-digest', '0 9 * * *', 'SELECT net.http_post(...)');
SELECT cron.schedule('bonus-expiry', '0 0 * * *', 'SELECT net.http_post(...)');
SELECT cron.schedule('auto-close-tenders', '0 * * * *', 'SELECT net.http_post(...)');
SELECT cron.schedule('tasting-reminder', '0 9 * * *', 'SELECT net.http_post(...)');
```

---

## 👥 РОЛИ ПОЛЬЗОВАТЕЛЕЙ (27 РОЛЕЙ)

### Базовые роли (5)
| # | Роль | Код | Описание |
|---|------|-----|----------|
| 1 | **Покупатель** | `CUSTOMER` | Заказывает торты, пишет отзывы, копит бонусы |
| 2 | **Кондитер** | `CONFECTIONER` | Продаёт изделия, принимает заказы |
| 3 | **Курьер** | `COURIER` | Доставляет заказы |
| 4 | **Поставщик** | `SUPPLIER` | Продаёт ингредиенты/упаковку |
| 5 | **Администратор** | `ADMIN` / `SUPER_ADMIN` | Управляет платформой |

### Расширенные роли (10)
| # | Роль | Код | Описание |
|---|------|-----|----------|
| 6 | **Гость** | `GUEST` | Неавторизованный посетитель |
| 7 | **Модератор** | `MODERATOR` | Модерирует контент |
| 8 | **Поддержка** | `SUPPORT` | Обрабатывает тикеты |
| 9 | **Студия** | `STUDIO` | Фотосъёмка, мастер-классы |
| 10 | **Блогер** | `BLOGGER` | Рецензии, промо |
| 11 | **Дегустатор** | `TASTER` | Сертифицированные отзывы |
| 12 | **Франчайзи** | `FRANCHISEE` | Управляет сетью |
| 13 | **Диетолог** | `NUTRITIONIST` | Верифицирует КБЖУ |
| 14 | **Корпоративный клиент** | `CORPORATE_CLIENT` | B2B заказы |
| 15 | **Копирайтер** | `COPYWRITER` | Создаёт контент |

### Нишевые роли (12)
| # | Роль | Код | Описание |
|---|------|-----|----------|
| 16 | **Владелец площадки** | `VENUE_OWNER` | Сдаёт залы |
| 17 | **Агентство аниматоров** | `ANIMATOR_AGENCY` | Доп. услуги |
| 18 | **Развлекательный центр** | `RECREATION_CENTER` | Площадки |
| 19 | **Детский клуб** | `KIDS_CLUB` | Площадки |
| 20 | **Инспектор качества** | `QUALITY_INSPECTOR` | Проверяет кондитеров |
| 21 | **Агент сертификации** | `CERTIFICATION_AGENT` | Выдаёт сертификаты |
| 22 | **Предприятие общепита** | `FOOD_SERVICE` | B2B заказы |
| 23 | **Организатор мероприятий** | `EVENT_ORGANIZER` | Организует мероприятия |
| 24 | **ПВЗ** | `PICKUP_POINT` | Пункт выдачи |
| 25 | **Оптовик** | `WHOLESALER` | Закупает большие объёмы |
| 26 | **Внутренний аудитор** | `INSPECTOR` | Финансовые проверки |
| 27 | **Франчайзи** | `FRANCHISEE` | Управляет сетью |

---

## 📦 КАТЕГОРИИ ТОВАРОВ (18)

### Кондитерские изделия (10)
| № | Категория | Описание |
|---|-----------|----------|
| 1 | **Торты** | Бисквитные, муссовые, чизкейки, свадебные |
| 2 | **Капкейки** | Мини-тортики с кремом |
| 3 | **Пирожные** | Эклеры, макаруны, тарты |
| 4 | **Печенье** | Имбирное, овсяное, шоколадное |
| 5 | **Шоколад** | Трюфели, плитки, конфеты |
| 6 | **Макарон** | Французские пирожные |
| 7 | **Бенто-торты** | Мини-торты с надписями |
| 8 | **Десерты** | Муссы, панна-котта |
| 9 | **Зефирные букеты** | Букеты из зефира |
| 10 | **Пироги** | Открытые и закрытые |

### Сопутствующие товары и услуги (8)
| № | Категория | Описание |
|---|-----------|----------|
| 11 | **Декор для тортов** | Мастика, фигурки, топперы |
| 12 | **Упаковка** | Коробки, подложки, ленты |
| 13 | **Ингредиенты** | Мука, масло, красители |
| 14 | **Оборудование** | Миксеры, формы, плиты |
| 15 | **Инвентарь** | Шпатели, насадки, мешки |
| 16 | **Услуги и площадки** | Доставка, аренда, мастер-классы |
| 17 | **Подарочные сертификаты** | Номиналы 500, 1000, 3000, 5000, 10000 ₽ |
| 18 | **Печать на пряниках** | Именные пряники, вафельные картинки |

---

## 🗄️ ПОЛНАЯ МОДЕЛЬ БАЗЫ ДАННЫХ (162 таблицы)

### Группы таблиц:

**Аутентификация и пользователи (15):**
- `auth.users`, `auth.identities`, `auth.sessions`, `auth.mfa_factors`, `auth.mfa_challenges`
- `public.profiles`, `public.user_roles`, `public.accounts`, `public.sessions`, `public.refresh_tokens`
- `public.two_factor_challenges`, `public.notification_preferences`, `public.push_subscriptions`
- `public.referrals`, `public.user_holidays`

**Профили ролей (17):**
- `CourierProfile`, `SupplierProfile`, `CustomerProfile`, `BloggerProfile`, `TasterProfile`
- `FranchiseeProfile`, `NutritionistProfile`, `CorporateClientProfile`, `QualityInspectorProfile`
- `CertificationAgentProfile`, `CopywriterProfile`, `ModeratorProfile`, `EventOrganizerProfile`
- `FoodServiceProfile`, `StudioProfile`, `PickupPointProfile`, `WholesalerProfile`

**Кондитерское дело (10):**
- `Confectioner`, `Product`, `ProductSlice`, `Filling`, `ConfectionerAtelier`
- `ConfectionerLesson`, `LessonEnrollment`, `HolidayReminder`, `ProductVideos`, `ProductVariants`

**Маркетплейс (15):**
- `Order`, `OrderItem`, `OrderNegotiation`, `OrderTracking`, `CourierLocation`
- `CartItem`, `WishlistItem`, `Review`, `VideoReview`, `ConstructorDraft`, `PriceInquiry`
- `OrderStatusHistory`, `RepeatOrderTemplates`, `FavoriteConfectioners`, `RoleNotificationSettings`

**Финансы (12):**
- `Payment`, `PayoutRequest`, `Refund`, `LoyaltyTransaction`, `GiftCertificate`
- `PromoCode`, `PromoCodeUsage`, `PromoCampaign`, `BusinessExpense`, `InsuranceContribution`
- `TaxReport`, `FinancialAuditLog`

**Тендеры (6):**
- `tenders`, `tender_offers`, `tender_invitations`, `tender_history`, `tender_reviews`, `tender_chat`

**Чат (10):**
- `chat_channels`, `chat_channel_members`, `chat_messages`, `chat_message_reads`
- `chat_attachments`, `chat_typing_indicators`, `chat_unread`, `chat_message_reactions`

**CRM (10):**
- `SupportTicket`, `TicketMessage`, `Lead`, `CustomerInteraction`, `EmailMessage`
- `EmailAttachment`, `OperatorEscalation`, `CannedResponse`, `ActionLog`, `AuditLog`

**CMS (10):**
- `CmsPage`, `CmsPageHistory`, `CmsBanner`, `CmsNavigation`, `CmsMedia`
- `CmsMeta`, `DesignSettings`, `DesignThemes`, `DesignChangeLog`, `PageTemplates`

**Геоданные (5):**
- `confectioner_geo`, `ateliers`, `tastings`, `tasting_bookings`, `delivery_zones`

**Автоматизация (4):**
- `MaintenanceLog`, `OrganizationVerification`, `Semaphore`, `HolidayReminder`

**Уведомления (3):**
- `Notification`, `PushSubscription`, `NotificationPreferences`

**Геймификация (4):**
- `Badge`, `UserBadge`, `Challenge`, `UserChallenge`

**Прочее (остальные):**
- `InventoryItem`, `StockMovement`, `Recipe`, `RecipeAcceptance`

---

## 🔐 БЕЗОПАСНОСТЬ (RLS политики)

**Принцип:** Каждая таблица с user data имеет RLS-политики. PostgREST автоматически фильтрует по `auth.uid()`.

**Примеры политик:**
```sql
-- Пользователь видит только свои заказы
CREATE POLICY "users_select_own_orders" ON orders
  FOR SELECT USING (auth.uid() = user_id);

-- Кондитер видит заказы где он назначен
CREATE POLICY "confectioner_select_assigned_orders" ON orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = orders.id AND p.confectioner_id = auth.uid())
  );

-- Участники канала видят сообщения
CREATE POLICY "members_select_messages" ON chat_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM chat_channel_members
            WHERE channel_id = chat_messages.channel_id
            AND user_id = auth.uid())
  );

-- Только админ может создавать промокоды
CREATE POLICY "admin_insert_promocodes" ON promo_codes
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles
            WHERE user_id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN') AND is_active = true)
  );
```

**Security headers (через Caddy + Next.js):**
- CSP: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://yookassa.ru https://*.yoomoney.ru https://api-maps.yandex.ru; ...`
- HSTS: `max-age=31536000; includeSubDomains; preload`
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff

**CSRF защита:** Supabase Auth session-based, CSRF токен генерируется на сервере.

**Rate limiting:**
- `/api/auth/*` — 5 запросов/мин на IP
- `/api/payment/*` — 10 запросов/мин на пользователя
- `/api/search` — 60 запросов/мин на IP

---

## 🎨 UI/UX ПРАВИЛА

### Фирменный стиль
- **Брендовое название:** «Уездный кондитер» (шрифт TriodPostnaja Medium)
- **Заголовки:** Brokgauz & Efron Italic (энциклопедическая антиква)
- **Body:** Geist Sans
- **Скрипт (рукописный):** Neucha

### Палитра
```css
--primary: #8B2942;        /* тёмно-ягодный (бренд) */
--primary-foreground: #FFFFFF;
--accent: #D97706;         /* амбер (акценты, CTA) */
--background: #FFFFFF;
--foreground: #1F2937;     /* slate-800 */
--muted: #F3F4F6;          /* slate-100 */
--muted-foreground: #6B7280; /* slate-500 */
--border: #E5E7EB;         /* slate-200 */
--destructive: #DC2626;    /* red-600 */
--success: #16A34A;        /* green-600 */
--warning: #F59E0B;        /* amber-500 */
```

### Страницы (26 публичных + 5 дашбордов)

**Публичные страницы:**
1. `/` — главная
2. `/catalog` — каталог с фильтрами
3. `/catalog/[id]` — карточка товара
4. `/confectioners` — список кондитеров
5. `/confectioners/[id]` — профиль кондитера
6. `/recipes` — рецепты
7. `/recipes/[id]` — детально
8. `/blog` — блог
9. `/faq`, `/help`, `/about`, `/contacts`, `/reviews`
10. `/checkout` — оформление
11. `/promotions`, `/ready-made`, `/tenders`, `/corporate-events`
12. `/decor-shop`, `/services-shop`, `/supplier-shop`, `/gift-certificates`
13. `/map` — карта кондитеров
14. `/gift-ideas` — идеи подарков
15. `/handmade` — ручная работа
16. Легальные: `/about?legal=terms|privacy|consent|cookies`

**Дашборды (5):**
- `/dashboard` → редирект по роли (CUSTOMER, CONFECTIONER, SUPPLIER, COURIER, ADMIN)

---

## 🌐 ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ

```bash
# .env (dev)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...    # только server-side
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Уездный кондитер

YOOKASSA_API_URL=https://api.yookassa.ru/v3
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=test_XXXX

TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHANNEL_ID=@conditera
TELEGRAM_ADMIN_CHAT_IDS=123456789

SMTP_HOST=smtp.mailgun.org
SMTP_USER=postmaster@...
SMTP_PASSWORD=...
SMTP_FROM=Кондитерский маркетплейс <noreply@conditera.ru>

NEXT_PUBLIC_YANDEX_METRIKA_ID=111432662
NEXT_PUBLIC_YANDEX_MAPS_API_KEY=your_api_key
NEXT_PUBLIC_YANDEX_GEOCODER_KEY=your_geocoder_key
```

---

## 📁 СТРУКТУРА ПРОЕКТА

```
/home/z/my-project/
├── docker-compose.yml              # Единый Docker-стек (Supabase + Next.js + Caddy)
├── docker-compose.dev.yml          # Dev: только Next.js + remote Supabase
├── Dockerfile                      # Multi-stage Next.js (deps → build → runner)
├── Dockerfile.bot                  # Telegram-бот (Deno)
├── Caddyfile                       # Reverse proxy + health-check
├── next.config.ts                  # Без experimental, без watchOptions
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── .env                            # Dev env
├── .env.production                 # Prod env (в .gitignore)
├── .env.example                    # Шаблон
│
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── page.tsx                # Главная
│   │   ├── layout.tsx              # Root: шрифты, Toaster, JsonLd
│   │   ├── dashboard/              # Личные кабинеты
│   │   │   ├── page.tsx            # Редирект по роли
│   │   │   ├── customer/           # Покупатель
│   │   │   ├── confectioner/       # Кондитер
│   │   │   ├── supplier/           # Поставщик
│   │   │   ├── courier/            # Курьер
│   │   │   └── admin/              # Админ
│   │   ├── catalog/                # Каталог
│   │   ├── confectioners/          # Кондитеры
│   │   ├── recipes/                # Рецепты
│   │   ├── tenders/                # Тендеры
│   │   ├── map/                    # Карта кондитеров
│   │   ├── reviews/                # Отзывы
│   │   ├── checkout/               # Оформление заказа
│   │   ├── gift-ideas/             # Подарки
│   │   ├── handmade/               # Ручная работа
│   │   └── api/                    # 58+ route handlers
│   │       ├── auth/               # Аутентификация
│   │       ├── products/           # Товары
│   │       ├── orders/             # Заказы
│   │       ├── tenders/            # Тендеры
│   │       ├── chat/               # Чат
│   │       ├── map/                # Карта
│   │       ├── crm/                # CRM
│   │       ├── cms/                # CMS
│   │       ├── payment/            # Платежи
│   │       ├── telegram/           # Telegram
│   │       ├── admin/              # Администрирование
│   │       └── confectioner/       # Кондитер (дашборд API)
│   │
│   ├── components/                 # React компоненты
│   │   ├── layout/                 # Header, Footer, AuthModal
│   │   ├── dashboard/              # Дашборды (5 ролей)
│   │   ├── cake-builder/           # Конструктор (8 шагов, 930 строк)
│   │   ├── marketplace/            # Cart, checkout, product cards
│   │   ├── tenders/                # Тендеры
│   │   ├── map/                    # Карта
│   │   ├── chat/                   # Чат
│   │   ├── reviews/                # Отзывы
│   │   ├── admin/                  # Админ-панель
│   │   │   ├── design/             # Управление дизайном
│   │   │   ├── crm/                # CRM
│   │   │   └── cms/                # CMS
│   │   ├── cake-slice/             # 3D-превью среза торта
│   │   └── ui/                     # shadcn/ui компоненты
│   │
│   ├── lib/
│   │   ├── supabase/               # browser, server, admin клиенты
│   │   ├── auth/                   # getSession, requireRole
│   │   ├── realtime/               # useChat, useNotifications hooks
│   │   ├── storage/                # uploadAvatar, getProductImage
│   │   ├── validation/             # Zod-схемы
│   │   ├── finance/                # Расчёт цен, доставка, налоги
│   │   ├── pricing/                # Ценовой движок
│   │   ├── ai/                     # AI-помощник
│   │   ├── repositories/           # Слой доступа к данным
│   │   └── services/               # Бизнес-логика
│   │
│   ├── types/                      # TypeScript типы (из Supabase schema)
│   ├── middleware.ts               # Refresh Supabase session
│   └── styles/globals.css
│
├── supabase/
│   ├── config.toml
│   ├── migrations/                 # SQL миграции
│   │   ├── 0001_init.sql           # Все таблицы
│   │   ├── 0002_rls.sql            # RLS политики
│   │   ├── 0003_functions.sql      # Триггеры, scheduled jobs
│   │   ├── 0004_fts.sql            # Full Text Search
│   │   ├── 0005_seed.sql           # Seed данные
│   │   ├── 0006_hybrid_migration.sql # FDW на старую БД
│   │   ├── 0007_cake_builder.sql   # Конструктор тортов
│   │   ├── 0008_tenders.sql        # Тендеры
│   │   └── 0009_video.sql          # Видео в карточках товаров
│   ├── functions/                  # Edge Functions (Deno)
│   │   ├── telegram-webhook/
│   │   ├── send-notification/
│   │   ├── abandoned-cart/
│   │   ├── bonus-expiry/
│   │   ├── daily-digest/
│   │   ├── chat-notification/
│   │   ├── send-email/
│   │   ├── send-push/
│   │   ├── auto-close-tenders/
│   │   └── tasting-reminder/
│   └── seed.sql
│
├── scripts/
│   ├── health-check.sh             # Curl всех 58 API
│   ├── backup.sh                   # Backup БД
│   ├── setup-secrets.sh            # GitHub Secrets из .env.production
│   └── generate-tz.js              # Генерация ТЗ документа
│
├── public/                         # Статика (fonts, images, icons)
├── docs/                           # Документация
└── .github/workflows/
    └── deploy.yml                  # CI/CD: build → SSH → docker compose
```

---

## 🚀 ПЛАН МИГРАЦИИ (14 дней)

### Этап 1: Setup Supabase (дни 1-2)
- Docker-стек, генерация ключей
- Конвертация schema.prisma → SQL миграции
- Применение миграций (162 таблицы)
- RLS-политики

### Этап 2: Auth + Profile (дни 3-4)
- supabase-js + @supabase/ssr
- AuthModal (email+pass, OAuth, Magic Link)
- AvatarUpload через Supabase Storage
- ProfileSettings (смена пароля, 2FA)
- RoleSwitcher

### Этап 3: Marketplace (дни 5-6)
- Каталог + карточка + корзина + заказ + оплата
- Webhook от Yookassa
- FTS поиск через tsvector + GIN
- Видео в карточках товаров

### Этап 4: Cake Builder + Chat (дни 7-8)
- Конструктор тортов (8 шагов, 930 строк)
- 3D-превью среза через FillingSlicePreview
- Запрос скидки (0-30%)
- Inquiries + Negotiations
- Чат через Supabase Realtime (postgres_changes)
- Typing indicator, presence, unread count

### Этап 5: Тендеры + Карта (дни 9-10)
- Тендерная площадка (создание, предложения, выбор победителя)
- Карта с Яндекс Картами (поиск по локации, фильтры)
- Интеграция геоданных в календарь

### Этап 6: Dashboards + CRM + CMS (дни 11-12)
- 5 дашбордов (Customer, Confectioner, Supplier, Courier, Admin)
- CRM (клиентская база, тикеты, лиды, timeline)
- CMS (страницы, баннеры, навигация, медиатека)
- Управление дизайном (цвета, шрифты, макет)

### Этап 7: Автоматизация + Тестирование (дни 13-14)
- Edge Functions (telegram-webhook, abandoned-cart, daily-digest, bonus-expiry)
- pg_cron расписание
- 300+ unit-тестов, 20 e2e сценариев
- health-check.sh (curl всех 58 API)
- GitHub Actions: build → SSH → docker compose up
- Production деплой https://conditera.ru

---

## ✅ КРИТЕРИИ ПРИЁМКИ

### 1. Unit-тесты (≥300 тестов)
- Auth (30), Marketplace (50), Cake Builder (20), Chat (15), CRM (20), CMS (15)
- Finance (30), Validation (50), Security (20), Utils (50)

### 2. E2E тесты Playwright (≥20 сценариев)
- Регистрация+логин, OAuth Google, покупка товара, конструктор торта
- Чат, тикет, Kanban, CMS, админ-панель, Telegram уведомление
- Mobile responsive, security headers, CSRF, rate limiting, realtime chat
- Search, favorites, avatar upload, order status flow, payouts
- Видео в карточках товаров, 3D-превью среза

### 3. Health-check скрипт
`scripts/health-check.sh` — curl всех 58 API endpoints, отчёт в Markdown. Минимум 95% endpoints должны вернуть 200 или ожидаемые 4xx.

### 4. Ручное тестирование + скриншоты
- Полный цикл: регистрация → покупка → конструктор → чат → дашборды → CRM → CMS
- Скриншоты всех ключевых экранов в `/home/z/my-project/download/screenshots/`

### 5. Критерии успеха
- `docker compose up -d` разворачивает всё за ≤5 минут без ошибок
- Все 26 публичных страниц возвращают HTTP 200
- Все 58 API endpoints возвращают HTTP 200 или ожидаемые 4xx (не 500)
- Полный цикл: регистрация → заказ → оплата → уведомление в Telegram
- Потребление RAM всем стеком ≤2 GB
- Время cold start полного стека ≤30 секунд
- **Нет импортов из `@prisma/client`**

---

## 🚨 ВАЖНЫЕ ПРАВИЛА ДЛЯ РАЗРАБОТЧИКА

1. **Брендовое название** всегда «Уездный кондитер» — не «Кондитера», не «Уездный».
2. **Домен** всегда `conditera.ru` — не `uyezdny.ru`.
3. **Запрещены** Prisma, SQLite, Socket.IO, Redis, n8n, Meilisearch.
4. **Все таблицы с user data** должны иметь RLS-политики.
5. **Все API endpoints** типизированы через `src/types/supabase.ts`.
6. **Все формы** валидируются через Zod-схемы.
7. **Все финансовые операции** логируются в `FinancialAuditLog`.
8. **Backup** БД каждый день в 3:00 MSK.
9. **Деплой** только через GitHub Actions.
10. **Скриншоты** после каждого этапа — обязательны.
11. **Проверка на каждом шаге**: unit-тесты + e2e + health-check + скриншоты.
12. **Конструктор тортов** должен быть реализован полностью по описанию (8 шагов, 3D-превью, запрос скидки).

---

## 🎯 С ЧЕГО НАЧАТЬ

1. Прочитай этот промпт полностью
2. Создай структуру проекта по файловой структуре выше
3. Настрой Docker-стек (docker-compose.yml)
4. Примени миграции Supabase
5. Начни с **Этапа 1** (Setup Supabase)
6. После каждого этапа — обновляй `worklog.md`

---

**⚠️ ВАЖНО: Если AI использует Prisma в коде — это критическая ошибка. Немедленно остановить разработку и потребовать переписать код на supabase-js.**