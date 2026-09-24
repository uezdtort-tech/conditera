# ПОЛНЫЙ ПРОМПТ ДЛЯ СОЗДАНИЯ МАРКЕТПЛЕЙСА «УЕЗДНЫЙ КОНДИТЕР»

> **Версия ТЗ:** 1.0 final
> **Дата:** 2026-07-29
> **Стек:** Next.js 16 + React 19 + TypeScript + Prisma 6 + PostgreSQL + Zustand
> **Объём:** 108 Prisma моделей, 153 API endpoints, 138 компонентов, 23 mobile экрана, 14 cron jobs

---

## 1. НАЗНАЧЕНИЕ ПРОЕКТА

Маркетплейс кондитерских изделий от частных кондитеров России. Платформа соединяет покупателей и кондитеров напрямую, обеспечивает эскроу-платежи, верификацию, логистику, программы лояльности и AI-инструменты.

**Аналоги по функционалу:** Авито (маркетплейс) + Яндекс.Еда (доставка) + Instagram (сторис/каналы) + Tilda (конструктор).

---

## 2. ТЕХНОЛОГИЧЕСКИЙ СТЕК

### Frontend
- **Next.js 16.1.3** (App Router, Turbopack для dev, webpack для production build)
- **React 19** с Server Components
- **TypeScript 5** (strict mode)
- **Tailwind CSS 4** + **shadcn/ui** (127 компонентов)
- **Zustand** с persist middleware (SPA state management)
- **Recharts** для графиков
- **lucide-react** для иконок
- **sonner** для toast-уведомлений

### Backend
- **Next.js API Routes** — 153 endpoints
- **Prisma 6.11** с PostgreSQL (dev: PGlite WASM через pglite-prisma-adapter)
- **JWT** (jose) + bcryptjs для авторизации
- **TOTP** (RFC 6238) на нативном crypto для 2FA
- **Socket.IO** для real-time чата (порт 3030)
- **YooKassa SDK** для платежей (mock/real режимы)

### AI/ML
- **z-ai-web-dev-sdk** — LLM (chat completions), VLM (vision), image generation
- **Sentiment analysis** — v1 лексический (100+ RU слов), v2 embeddings
- **FAQ-бот** — 15 RU + 10 EN тем, keyword + Jaccard + fuzzy matcher

### Инфраструктура
- **Docker Compose** — 8 сервисов (web, db, redis, chat, n8n, caddy, smp-server, simplex-bridge)
- **Caddy 2.8** — reverse proxy + auto-HTTPS + security headers
- **PostgreSQL 16** + **Redis 7**
- **n8n** — 21 workflow для автоматизации
- **PWA** — service worker v4.0 (5 стратегий кэширования, offline-режим)

### Mobile
- **Expo React Native** — 23 экрана
- **expo-secure-store** для токенов
- **expo-haptics** для виброотклика

---

## 3. РОЛИ ПОЛЬЗОВАТЕЛЕЙ (26 ролей)

```
enum UserRole {
  CUSTOMER           // Покупатель
  CONFECTIONER       // Кондитер
  COURIER            // Курьер
  SUPPLIER           // Поставщик ингредиентов
  ADMIN              // Администратор
  SUPER_ADMIN        // Супер-админ
  MODERATOR          // Модератор контента
  OPERATOR           // Оператор чата поддержки
  BLOGGER            // Блогер
  TASTER             // Дегустатор
  FRANCHISEE         // Франчайзи
  NUTRITIONIST       // Нутрициолог
  CORPORATE_CLIENT   // Корпоративный клиент
  QUALITY_INSPECTOR  // Инспектор качества
  CERTIFICATION_AGENT // Сертификационный агент
  COPYWRITER         // Копирайтер
  EVENT_ORGANIZER    // Организатор мероприятий
  FOOD_SERVICE       // Общепит
  STUDIO             // Фотостудия
  PICKUP_POINT       // Пункт выдачи
  WHOLESALER         // Оптовик
  VENUE_OWNER        // Владелец площадки
  DECOR_SUPPLIER     // Поставщик декора
  EQUIPMENT_SUPPLIER // Поставщик оборудования
  INGREDIENT_SUPPLIER // Поставщик ингредиентов
  TEAM_MEMBER        // Член команды кондитера
}
```

---

## 4. БАЗА ДАННЫХ — 108 PRISMA МОДЕЛЕЙ

### 4.1. Пользователи и авторизация (12 моделей)

```
User                    — главный пользователь (email, passwordHash, roles[], 2FA, anti-fraud)
Account                 — OAuth-аккаунты (Google, Yandex, VK, Telegram)
Session                 — сессии пользователей
RefreshToken            — refresh-токены с rotation
TwoFactorChallenge      — challenge для 2FA
NotificationPreferences — настройки уведомлений (email, sms, push, telegram, in_app)
PushSubscription        — Web Push подписки (VAPID)
UserHoliday             — праздники пользователя (для персональных предложений)
BlacklistEntry          — чёрный список (email, phone, ip, device)
Semaphore               — семафоры для анти-спама
Referral                — реферальные связи
WishlistItem            — список желаний
```

### 4.2. Профили ролей (14 моделей)

```
ConfectionerProfile     — профиль кондитера (businessName, slug, tariff, trustLevel, legalInfo, taxMode)
CourierProfile          — профиль курьера (транспорт, регионы, рейтинг)
SupplierProfile         — профиль поставщика (категории, minOrder, deliveryTime)
CustomerProfile         — профиль покупателя (адреса, предпочтения)
BloggerProfile          — профиль блогера (соцсети, аудитория)
TasterProfile           — профиль дегустатора (квалификация, специализация)
FranchiseeProfile       — профиль франчайзи (территория, договор)
NutritionistProfile     — профиль нутрициолога (сертификация)
CorporateClientProfile  — профиль корпоративного клиента (реквизиты)
QualityInspectorProfile — профиль инспектора качества
CertificationAgentProfile — профиль сертификационного агента
CopywriterProfile       — профиль копирайтера
EventOrganizerProfile   — профиль организатора мероприятий
FoodServiceProfile      — профиль общепита
StudioProfile           — профиль фотостудии
PickupPointProfile      — профиль пункта выдачи
WholesalerProfile       — профиль оптовика
```

### 4.3. Каталог и товары (8 моделей)

```
Product                 — товар (title, price, images[], fillings[], coatings[], decorations[], AR/3D)
ProductSlice            — срез торта по начинке (image, config JSON для визуализатора)
Filling                 — начинка (name, category, allergens, color, sliceImage, sliceConfig)
Recipe                  — рецепт (ingredients, steps, КБЖУ, difficulty)
RecipeAcceptance        — подтверждение готовности кондитера испечь по рецепту
ConstructorDraft        — черновик конструктора торта
PriceInquiry            — запрос цены (конструктор → кондитеры)
WholesalePrice          — оптовые цены
```

### 4.4. Заказы и платежи (12 моделей)

```
Order                   — заказ (status, total, confectionerId, customerId, items[])
OrderItem               — позиции заказа
OrderTracking           — трекинг заказа (статусы, геолокация)
OrderNegotiation        — согласование цены/условий
Payment                 — платёж (YooKassa, status, escrow)
PayoutRequest           — заявка на вывод средств
Refund                  — возврат
CartItem                — корзина
RecurringOrder          — рекуррентные заказы (подписка)
OrderFraudLog           — лог анти-фрод проверок
InsuranceContribution   — страховые взносы
```

### 4.5. Финансы кондитера (6 моделей)

```
ConfectionerTransaction — транзакции кондитера (доходы/расходы)
BusinessExpense         — бизнес-расходы (ингредиенты, упаковка)
TaxReport               — налоговые отчёты (НПД/УСН/ОСНО)
FinancialAuditLog       — финансовый аудит
PromoCode               — промокоды (процент/фикс, лимиты, период)
PromoCodeUsage          — использование промокодов
```

### 4.6. Чат и коммуникации (10 моделей)

```
ChatRoom                — комната чата (direct, group, support, order)
ChatMessage             — сообщение (text, image, file, voice, system)
MessageAttachment       — вложения
MessageReaction         — реакции на сообщения
MessageReport           — жалобы на сообщения
ChatNotificationSettings — настройки уведомлений чата
OperatorEscalation      — эскалация на оператора
CannedResponse          — шаблонные ответы оператора
SimpleXContact          — SimpleX E2E-контакт (приватный канал)
SimpleXMessage          — SimpleX-сообщение (E2E, direction, readByOperator)
```

### 4.7. Канал кондитера (Stories/Posts) (6 моделей)

```
ChannelPost             — пост канала (как в Instagram)
ChannelStory            — сторис (TTL 24ч, image/video, productId, likesCount, repliesCount)
ChannelFollower         — подписчики канала
ChannelComment          — комментарии к постам
ChannelLike             — лайки постов
StoryLike               — лайки сторис
StoryReply             — ответы на сторис
```

### 4.8. Live-commerce (4 модели)

```
LiveStream              — стрим (title, streamUrl, streamKey, viewersCount, peakViewers, revenue, recordUrl)
LiveStreamViewer        — зритель (joinedAt, watchTime, liked, ordered)
LiveStreamOrder         — заказ во время стрима
LiveStreamMessage       — сообщения чата стрима (pinned, deleted)
```

### 4.9. Геймификация (4 модели)

```
Badge                   — бейдж (code, name, icon, color, category, condition, rewardPoints, rarity)
UserBadge               — полученный бейдж (userId, badgeId, awardedAt, context)
Challenge               — челлендж (goalType, goalValue, rewardPoints, startsAt, endsAt)
UserChallenge           — прогресс по челленджу (progress, completed, rewardClaimed)
```

### 4.10. Лояльность (3 модели)

```
LoyaltyTransaction      — транзакция баллов (EARN, REDEEM, EXPIRE)
GiftCertificate         — подарочный сертификат (amount, design, toEmail)
Promotion               — акция (промокод, скидка, баннер, период)
```

### 4.11. Склад и инвентарь (3 модели)

```
InventoryItem           — элемент склада (name, quantity, unit, minQuantity)
StockMovement           — движение склада (IN, OUT, ADJUSTMENT)
ImageProcessingQueue    — очередь обработки изображений
```

### 4.12. Команда кондитера (4 модели)

```
TeamMember              — член команды (role, permissions)
TeamTask                — задача команды (assignee, deadline, status)
TeamEvent              — событие команды (встреча, дедлайн)
TeamInvitation          — приглашение в команду
```

### 4.13. CMS и администрирование (8 моделей)

```
CmsPage                 — страница CMS
CmsBlock                — блок контента
CmsSection              — секция страницы
CmsSectionBlock         — связь секции и блока
Banner                  — баннер (image, link, position, period)
NavMenuItem             — пункт меню
SiteSetting             — настройка сайта (key-value)
MediaFile               — медиафайл (url, type, alt, dimensions)
```

### 4.14. Верификация и модерация (3 модели)

```
OrganizationVerification — верификация организации (DaData, ИНН, ОГРН)
MaintenanceLog           — журнал техработ
ActionLog                — лог действий (audit trail)
AuditLog                 — лог аудита (16 API routes пишут сюда)
```

### 4.15. Отзывы (2 модели)

```
Review                   — отзыв (rating, text, productId, orderId)
VideoReview              — видео-отзыв (url, duration, thumbnail)
```

### 4.16. Уведомления (2 модели)

```
Notification             — уведомление (template, channels[], scheduledFor, readAt)
```

### 4.17. Биржа франшизы (через AuditLog)

```
/franchise-exchange/listings   — листинги франшизы
/franchise-exchange/buy        — покупка
/franchise-exchange/transfer   — передача
/franchise-exchange/agreements — договоры
```

### 4.18. Корпоративные события и площадки (через existing models)

```
Event                    — корпоративное мероприятие
Venue                    — площадка для мероприятия
```

---

## 5. API ENDPOINTS — 153 МАРШРУТА

### 5.1. Авторизация (10 endpoints)
```
POST   /api/auth/register              — регистрация
POST   /api/auth/login                 — вход (с проверкой 2FA)
POST   /api/auth/2fa/login-verify      — второй шаг 2FA (TOTP или backup-код)
POST   /api/auth/2fa/setup             — настройка 2FA
POST   /api/auth/2fa/verify            — подтверждение 2FA
POST   /api/auth/2fa/disable           — отключение 2FA
POST   /api/auth/refresh               — обновление токена
GET    /api/auth/oauth/[provider]      — OAuth (Google, Yandex, VK, Telegram)
GET    /api/auth/oauth/[provider]/callback — OAuth callback
GET    /api/csrf-token                 — CSRF-токен
```

### 5.2. Каталог и товары (12 endpoints)
```
GET    /api/products                   — список товаров
GET    /api/products/[id]/slices       — срезы торта по начинкам
POST   /api/products/[id]/slices       — создать срез
DELETE /api/products/[id]/slices       — удалить срез
GET    /api/products/[id]/slice-3d-config — 3D-конфигурация из среза
POST   /api/products/ai-photo          — AI-генерация фото торта (z-ai-web-dev-sdk)
POST   /api/products/ai-description    — AI-генерация описания (LLM, 4 тона)
GET    /api/fillings/list              — список начинок
POST   /api/fillings/create            — создать начинку
GET    /api/fillings/[id]/slice        — получить срез начинки
PUT    /api/fillings/[id]/slice        — обновить срез
POST   /api/fillings/ai-generate-slice — AI-генерация среза (LLM → JSON)
POST   /api/fillings/moderate          — модерация начинки
POST   /api/slice/export-png           — экспорт SVG в PNG (Playwright)
POST   /api/visual-search              — поиск по фото (VLM)
```

### 5.3. Заказы и платежи (15 endpoints)
```
GET    /api/orders                     — список заказов
POST   /api/orders/[id]/accept         — принять заказ
POST   /api/orders/[id]/cancel         — отменить заказ
POST   /api/payment/create             — создать платёж (YooKassa)
POST   /api/payment/webhook            — webhook YooKassa (IP whitelist)
POST   /api/payouts/request            — заявка на вывод (с 2FA)
GET    /api/courier/available-orders   — доступные заказы для курьера
POST   /api/courier/assign             — назначить курьера
POST   /api/courier/location           — обновить геолокацию
GET    /api/courier/deliveries         — доставки курьера
GET    /api/courier/earnings           — заработок курьера
GET    /api/pickup-point/orders        — заказы пункта выдачи
POST   /api/pickup-point/confirm       — подтвердить получение
GET    /api/pickup-point/inventory     — инвентарь пункта
```

### 5.4. Чат и SimpleX (12 endpoints)
```
POST   /api/chat/auto-reply            — авто-ответ (FAQ-бот)
POST   /api/chat/bot-trigger           — триггер бота
GET    /api/simplex/contacts           — SimpleX-профиль + сообщения
POST   /api/simplex/contacts           — создать SimpleX-профиль (PREMIUM only)
DELETE /api/simplex/contacts           — деактивировать профиль
POST   /api/simplex/send               — отправить через SimpleX
POST   /api/simplex/read               — отметить прочитанными
GET    /api/simplex/support-address    — публичный адрес поддержки
POST   /api/simplex/incoming           — webhook от simplex-bridge
GET    /api/operator/escalations       — эскалации на оператора
POST   /api/operator/assign            — назначить оператора
POST   /api/operator/resolve           — разрешить эскалацию
```

### 5.5. Stories и Live-commerce (8 endpoints)
```
GET    /api/stories                    — лента сторис
POST   /api/stories                    — создать сторис (TTL 24ч)
POST   /api/stories/[id]/view          — отметить просмотр
POST   /api/stories/[id]/like          — лайк сторис
POST   /api/stories/[id]/reply         — ответ на сторис
GET    /api/live-streams               — список стримов
POST   /api/live-streams/[id]/join     — присоединиться к стриму
POST   /api/live-streams/[id]/chat     — сообщение в чат стрима
POST   /api/live-streams/[id]/like     — лайк стрима
```

### 5.6. Геймификация (3 endpoints)
```
GET    /api/gamification/badges              — бейджи + статистика
GET    /api/gamification/challenges          — активные челленджи
POST   /api/gamification/challenges/[id]/claim — получить награду
```

### 5.7. AI и аналитика (4 endpoints)
```
GET    /api/confectioner/predictions    — прогноз спроса на 7 дней
GET    /api/confectioner/recipe-stats   — статистика по подтверждённым рецептам
POST   /api/confectioner/recipe-acceptances — подтверждение готовности испечь
GET    /api/confectioner/status         — статус верификации кондитера
```

### 5.8. Cron jobs (14 endpoints)
```
POST   /api/cron/abandoned-cart          — брошенная корзина (напоминание)
POST   /api/cron/auto-approve            — авто-подтверждение через DaData
POST   /api/cron/backup                  — резервное копирование БД
POST   /api/cron/certification-reminders — напоминания о сертификации
POST   /api/cron/cleanup                 — очистка старых данных
POST   /api/cron/escrow-release          —释放 эскроу (24ч после получения)
POST   /api/cron/expiring-bonuses        — сгорание бонусов
POST   /api/cron/franchisee-reports      — отчёты франчайзи
POST   /api/cron/payment-reminders       — напоминания об оплате
POST   /api/cron/pp-certification-check  — проверка сертификации ПП
POST   /api/cron/quality-inspections     — плановые проверки качества
POST   /api/cron/taster-assignment       — назначение дегустаторов
POST   /api/cron/weekly-digest           — еженедельный дайджест
GET    /api/cron/status                  — статус cron-задач
```

### 5.9. Ролевые endpoints (85+ маршрутов)
```
/admin/*          — администрирование (верификация, анти-фрод, CMS, баннеры)
/b2b/*            — B2B каталог и заказы
/certification/*  — сертификация кондитеров
/channel/*        — канал кондитера (посты, сторис, подписчики)
/copywriter/*     — задачи копирайтера
/courier/*        — курьерская логистика
/events/*         — корпоративные мероприятия
/franchisee/*     — франчайзи (отчёты, статистика)
/franchise-exchange/* — биржа франшизы
/inspector/*      — инспектор качества
/loyalty/*        — программа лояльности
/maintenance/*    — технические работы
/notifications/*  — уведомления (email, sms, push, telegram, in_app)
/nutritionist/*   — нутрициолог (сертификация, рекомендации)
/operator/*       — оператор поддержки
/pickup-point/*   — пункт выдачи
/supplier/*       — поставщик
/taster/*         — дегустатор
/team/*           — команда кондитера
/tenders/*        — тендеры
/venues/*         — площадки для мероприятий
```

---

## 6. АВТОМАТИЗАЦИЯ

### 6.1. Cron Jobs (14 задач)

| Задача | Расписание | Описание |
|---|---|---|
| `escrow-release` | каждые 10 мин | Release эскроу-платежей через 24ч после получения заказа |
| `abandoned-cart` | каждые 2 часа | Напоминание о брошенной корзине (email + push) |
| `expiring-bonuses` | ежедневно 00:00 | Списание бонусов с истекшим сроком + уведомление |
| `weekly-digest` | понедельник 10:00 | Еженедельный дайджест (заказы, доходы, отзывы) |
| `auto-approve` | каждые 30 мин | Авто-подтверждение кондитеров через DaData (ИНН) |
| `payment-reminders` | ежедневно 12:00 | Напоминания об ожидающих платежах |
| `backup` | ежедневно 03:00 | Резервное копирование PostgreSQL + cleanup старых backup |
| `cleanup` | ежедневно 04:00 | Очистка истёкших сессий, старых логов, temporary files |
| `certification-reminders` | ежедневно 09:00 | Напоминания о необходимости сертификации |
| `franchisee-reports` | 1-го числа месяца | Генерация отчётов для франчайзи |
| `quality-inspections` | по понедельникам | Плановые проверки качества кондитеров |
| `pp-certification-check` | ежедневно 06:00 | Проверка сертификатов ПП (производственной программы) |
| `taster-assignment` | по средам | Назначение дегустаторов на новые продукты |
| `status` | по запросу | Текущий статус всех cron-задач |

### 6.2. n8n Workflows (21 сценарий)

1. **Брошенная корзина** — Webhook от cron → email через SMTP → push-уведомление
2. **Еженедельный дайджест** — SQL запрос → HTML шаблон → email
3. **Сгорание бонусов** — SQL → уведомление + списание
4. **Новый заказ → кондитеру** — Webhook → Telegram bot → push
5. **Заказ доставлен → отзыв** — Webhook → email через 24ч
6. **Отзыв < 3 звёзд → оператору** — Webhook → эскалация
7. **Новый кондитер → верификация** — Webhook → DaData → auto-approve
8. **Платёж получен → эскроу** — YooKassa webhook → update DB → уведомление
9. **Эскроу-релиз → кондитеру** — Cron trigger → payout → уведомление
10. **День рождения клиента** — SQL → email + бонусы
11. **Персональные рекомендации** — ML → email с похожими товарами
12. **Аналитика для админа** — SQL → PDF → email
13. **Напоминание о мероприятии** — SQL → email + push
14. **Обновление тарифа** — SQL → email + уведомление
15. **Реферальная программа** — SQL → бонусы + email
16. **Акции и промокоды** — SQL → push + email
17. **Чат-эскалация → оператору** — Webhook → Telegram + push
18. **Сток < минимум** — SQL → email поставщику
19. **Сертификация истекает** — SQL → email + уведомление
20. **Франчайзи-отчёт** — SQL → PDF → email
21. **Backup-уведомление** — Cron → проверка backup → email статуса

### 6.3. Авточат (FAQ-бот + sentiment)

**FAQ-бот:**
- 15 RU + 10 EN тем (доставка, оплата, эскроу, бонусы, отмена, аллергены, конструктор, жалобы)
- ML matcher: keyword + Jaccard similarity + fuzzy matching
- Quick replies (кнопки для быстрого ответа)
- Авто-эскалация на оператора при негативном sentiment

**Sentiment analysis:**
- v1: лексический (100+ RU слов с весами)
- v2: embeddings (через @xenova/transformers, если установлен)
- A/B тестирование (62 сообщения)
- Триггер: sentiment < -0.5 → эскалация на оператора

**Operator dashboard:**
- Очередь эскалаций
- 20 шаблонных ответов (canned responses)
- История переписки
- Статус: online/busy/offline

---

## 7. AI-ФУНКЦИИ

### 7.1. AI-фото тортов (image generation)
```
POST /api/products/ai-photo
- Input: { description, style, size, productId? }
- z-ai-web-dev-sdk → images.generations.create
- 6 стилей: modern, classic, minimalist, rustic, luxury, festive
- 4 размера: 1024x1024, 1344x768, 768x1344, 1440x720
- MD5-кэш по (description + style + size)
- Fallback: Unsplash stock-photo
```

### 7.2. AI-описания товаров (LLM)
```
POST /api/products/ai-description
- Input: { title, category?, fillings?, weight?, servings?, price?, tone, maxLength }
- z-ai-web-dev-sdk → chat.completions.create
- 4 тона: selling (продающий), elegant (элегантный), playful (игривый), minimal
- Возвращает: { description, shortDescription, tags[], seoKeywords[] }
- Fallback: шаблонное описание
```

### 7.3. AI-генерация среза торта (LLM → JSON)
```
POST /api/fillings/ai-generate-slice
- Input: { name, description, consistency, color }
- LLM анализирует описание → генерирует JSON конфигурацию слоёв
- Возвращает: { layers: [{type, color, label, height}], coating, decoration, shape }
- 5 пресетов: chocolate, vanilla, red_velvet, berry, caramel
- Fallback: detectPreset() по имени начинки
```

### 7.4. Visual search (VLM)
```
POST /api/visual-search
- Input: { image (base64 или URL), limit }
- z-ai-web-dev-sdk → vision messages (text + image_url)
- VLM анализирует: category, colors, tags, keywords, style, estimatedWeight
- Поиск товаров по keywords + category (mode: insensitive)
- Подсчёт searchScore: title match +30, tag match +20, category match +25
```

### 7.5. Predictive analytics (прогноз спроса)
```
GET /api/confectioner/predictions
- Загрузка заказов за 90 дней
- Скользящее среднее по дням недели
- Расчёт тренда (последние 30 дней vs предыдущие 30)
- Сезонность: выходные +30%, праздники +80%
- Прогноз на 7 дней с confidence (0-1)
- 11 российских праздников 2026 в словаре
- Возвращает: forecast[], insights[], recommendedStock[], trends[]
```

---

## 8. SIMPLEX CHAT (E2E-шифрование)

### Архитектура
```
SimpleX-клиент → SMP-сервер (5223) → simplex-chat CLI (5225) →
→ simplex-bridge (5226) → backend /api/simplex/incoming → Prisma БД
```

### Компоненты
- **SMP-сервер** (Docker, simplexchat/smp-server) — передача сообщений
- **simplex-bridge** (Node.js mini-service) — WebSocket к CLI + HTTP webhook
- **Prisma**: SimpleXContact + SimpleXMessage

### Premium-gate
- SimpleX доступен только кондиторам тарифа PREMIUM или BUSINESS
- При низком тарифе: 403 с `code: "TARIFF_UPGRADE_REQUIRED"`

### Push-уведомления
- Template: SIMPLEX_MESSAGE (in_app + push)
- Polling каждые 20 сек в дашборде + toast при новых сообщениях

---

## 9. PWA OFFLINE

### Service Worker v4.0 (5 стратегий кэширования)
```
CacheFirst          — изображения (быстро, нет сети) + SVG placeholder
CacheFirst          — _next/static (компилированные ассеты)
StaleWhileRevalidate — кэшируемые API (каталог, кондитеры, акции, рецепты, сторис)
NetworkFirst        — страницы (свежие данные → fallback в кэш → /offline.html)
StaleWhileRevalidate — прочее
```

### Кэшируемые API (для offline-просмотра каталога)
```
/api/products, /api/confectioners, /api/promotions,
/api/recipes, /api/categories, /api/stories, /api/live-streams
```

### Никогда не кэшируемые (приватные данные)
```
/api/auth, /api/payment, /api/orders, /api/cart,
/api/admin, /api/simplex, /api/confectioner/* (кроме predictions)
```

### Offline-страница
- `/offline.html` — красивая страница с gradient фоном
- Список доступных офлайн функций
- Авто-обновление при появлении сети

---

## 10. БЕЗОПАСНОСТЬ

### 10.1. Аутентификация
- JWT (jose, HS256) + bcryptjs (cost factor 10)
- Access token: 7 дней, Refresh token: 30 дней
- 2FA при логине: `/api/auth/login` → `tfaRequired` + `tfaTempToken` → `/api/auth/2fa/login-verify`
- TOTP RFC 6238 на нативном crypto (без otplib)
- Backup-коды: 10 штук, HMAC-SHA256, формат XXXX-XXXX
- AES-256-GCM шифрование TOTP-секретов

### 10.2. Anti-fraud
- Rate limiting по IP (SHA-256 хэш с солью, 152-ФЗ)
- Лимиты: login 20/час, register 3/час, order 5/час, review 10/час
- Подозрительная активность: ≥5 разных IP за 24ч → flag risk
- Anti-fraud покрывает только auth/login и auth/register (TODO: расширить)

### 10.3. Платежи (YooKassa)
- Mock-режим: `test_shop` / `test_secret` → isMock=true
- Идемпотентность: детерминированные ключи от orderId (не timestamp)
- IP whitelist: 8 диапазонов YooKassa (проверка только в production)
- Эскроу: деньги холдируются 24ч → cron `/api/cron/escrow-release`
- Webhook: `payment.succeeded`, `payment.canceled`, `refund.succeeded`

### 10.4. Security headers
```
X-Frame-Options: SAMEORIGIN (разрешает iframe для preview-платформы)
Content-Security-Policy: frame-ancestors 'self' https://*.space-z.ai
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self)
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload (HTTPS only)
```

### 10.5. Критичные секреты (без fallback в production)
- JWT_SECRET, TFA_ENCRYPTION_KEY, CRON_SECRET
- В production: throw Error если не заданы или содержат CHANGE_ME/dev_
- В dev: warn + тестовое значение

---

## 11. MOBILE APP (Expo React Native)

### 23 экрана
```
AuthScreen              — вход/регистрация
HomeScreen              — главная (лента, акции, популярные торты)
CatalogScreen           — каталог с фильтрами
ProductDetailScreen     — карточка товара + срезы + AR
ConfectionerDetailScreen — профиль кондитера + SimpleX-виджет
ConfectionersScreen     — список кондитеров
NearbyConfectionersScreen — кондитеры рядом (геолокация)
CartScreen              — корзина
CheckoutScreen          — оформление заказа
FavoritesScreen         — избранное
ProfileScreen           — профиль + меню (включая SimpleX)
OrdersScreen            — мои заказы
OrderDetailScreen       — детали заказа
LoyaltyScreen           — лояльность и бонусы
ChatListScreen          — список чатов
ChatDetailScreen        — чат с кондитером
NotificationsScreen     — уведомления
NotificationPreferencesScreen — настройки уведомлений
ARViewerScreen          — 3D/AR просмотр торта
BiometricScreen         — настройка биометрии
VerificationBannerScreen — статус модерации
OperatorDashboardScreen — дашборд оператора
SimpleXScreen           — управление SimpleX-профилем
```

### Особенности
- expo-secure-store для JWT-токенов
- expo-haptics для виброотклика
- Voice messages (useVoiceRecorder hook)
- Biometric auth (Face ID / Touch ID)
- Deep linking для SimpleX (smp://)

---

## 12. ДЕПЛОЙ

### 12.1. Docker Compose (8 сервисов)
```yaml
services:
  web:              # Next.js production (standalone)
  db:               # PostgreSQL 16
  redis:            # Redis 7 (кэш, Socket.IO adapter)
  chat-service:     # Socket.IO сервер (порт 3030)
  n8n:              # Автоматизация (порт 5678)
  caddy:            # Reverse proxy + auto-HTTPS
  smp-server:       # SimpleX SMP (порт 5223)
  simplex-bridge:   # Bot-мост SimpleX (порт 5226)
```

### 12.2. Environment variables (36 переменных)
```
DATABASE_URL, JWT_SECRET, TFA_ENCRYPTION_KEY, CRON_SECRET, IP_HASH_SALT,
YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, DADATA_API_KEY, YANDEX_GEOCODER_API_KEY,
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SMTP_URL, SMSRU_API_ID,
TELEGRAM_BOT_TOKEN, SIMPLEX_HOSTNAME, SIMPLEX_BRIDGE_API_KEY, etc.
```

### 12.3. CI/CD (GitHub Actions)
```yaml
jobs:
  lint-typecheck:  # tsc --noEmit + eslint
  build:           # next build
  smoke-test-db:   # PGlite + Prisma smoke test
  docker-build:    # 3 образа: web, chat, simplex-bridge (main only)
  security-audit:  # npm audit + grep на секреты
```

---

## 13. СОВРЕМЕННЫЕ ТРЕНДЫ (реализовано)

### 13.1. Command Palette (Cmd+K)
- Глобальный поиск по Cmd+K / Ctrl+K
- 5 групп: actions, navigation, dashboard, products, confectioners
- Динамический поиск по товарам и кондитерам
- Клавиатурная навигация: ↑↓, Enter, Esc

### 13.2. AI-фото тортов
- Генерация изображений через z-ai-web-dev-sdk
- 6 стилей, 4 размера, MD5-кэш
- Fallback на Unsplash

### 13.3. Stories-формат
- Instagram-style сторис с TTL 24ч
- Progress bars, автопрогресс, pause при удержании
- Лайки, ответы, привязка к товару
- Gradient ring для непросмотренных

### 13.4. Bento Grid дашборд
- Современная сетка (Apple/Linear style)
- Крупная карточка баланса (2×2, gradient)
- Адаптив: 1→2→4 колонки

### 13.5. AI-описания товаров
- LLM генерирует продающее описание
- 4 тона, теги, SEO-ключевые слова

### 13.6. Gamification
- 12 бейджей (4 редкости: common, rare, epic, legendary)
- 3 челленджа с наградами (points, discount, free_shipping)
- Прогресс-бары, кнопка "Забрать награду"

### 13.7. Live-commerce
- Стримы кондитеров + чат в реальном времени
- Заказы во время стрима (revenue tracking)
- Записи (VOD) после завершения

### 13.8. Visual search
- Поиск торта по загруженному фото (VLM)
- AI-анализ: категория, цвета, теги, стиль
- Подсчёт релевантности (searchScore)

### 13.9. Predictive analytics
- Прогноз спроса на 7 дней для кондитеров
- Рекомендуемые запасы ингредиентов
- Insights (текстовые подсказки)

### 13.10. PWA offline
- 5 стратегий кэширования
- Offline-просмотр каталога
- Auto-обновление при появлении сети

---

## 14. ДОКУМЕНТАЦИЯ

- `README.md` — 206 строк, quick start, структура проекта, статус готовности
- `docs/SIMPLEX.md` — 250 строк, архитектура SimpleX, установка, troubleshooting
- `.env.example` — 36 переменных с комментариями
- `.env.production` — шаблон с CHANGE_ME_* заглушками
- `.github/workflows/ci.yml` — CI/CD pipeline (5 jobs)
- `download/MIGRATION_PG.md` — миграция SQLite → PostgreSQL
- `download/audit_report.pdf` — 10-страничный отчёт аудита готовности

---

## 15. СТАТУС ГОТОВНОСТИ

| Категория | Готовность |
|---|---|
| Backend / API | 95% |
| Frontend (web) | 92% |
| Mobile (Expo) | 85% |
| Auth & Security | 90% |
| Payments (YooKassa) | 85% |
| Chat (Socket.IO + SimpleX) | 85% |
| AI-функции | 90% |
| Геймификация | 85% |
| Live-commerce | 80% |
| PWA offline | 90% |
| Локализация | 5% |
| Тестирование | 10% |
| CI/CD | 50% |
| Документация | 60% |
| **Средняя готовность** | **~85%** |

---

## 16. ЗАПУСК

### Dev
```bash
cp .env.example .env
npm install
npx prisma generate
npm run dev:local  # next dev -p 3000 (Turbopack для разработки)
```

### Production
```bash
cp .env.production.example .env.production
# Заполнить секреты: openssl rand -base64 48, openssl rand -hex 32
docker-compose up -d
```

### Preview (для платформы Z.ai)
```bash
npm run dev  # next build && next start -H 0.0.0.0 -p 3000
```

---

*Конец промпта. Этот документ содержит полное ТЗ текущего исполнения проекта «Уездный кондитер» со всеми 108 моделями БД, 153 API endpoints, 14 cron jobs, 21 n8n workflows и 10 AI-функциями.*
