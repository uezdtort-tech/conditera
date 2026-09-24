# Ролевая матрица «Уездный кондитер»

Стандартный набор функций ролей маркетплейса (по опыту Avito/Etsy/Airbnb/Яндекс.Услуги):
каждая роль, кроме покупателя, — это «поставщик предложения», и у неё обязаны работать
**жизненный цикл объявления**: создать → опубликовать → редактировать → добавить ещё →
снять с публикации (пауза) → удалить. Плюс ролевые функции поверх этого цикла.

## Базовый жизненный цикл объявления (все роли-поставщики)

| Операция | Реализация |
|---|---|
| Создать объявление | POST-эндпоинт соответствующего ресурса + форма в дашборде |
| Редактировать | PATCH с проверкой владения (owner_id/provider_id === user.id, иначе 403) |
| Добавить ещё одно | Та же форма создания; ограничений на количество нет |
| Снять с публикации (пауза) | PATCH is_active=false — soft-hide без потери статистики |
| Удалить | DELETE (владелец или ADMIN/SUPER_ADMIN); для ряда ресурсов soft-delete |
| Ownership-модель | Строки БД принадлежат auth-UUID владельца; админ-байпас через user_roles |
| Модерация | Админ/модератор может скрыть/вернуть объявление; verified-бейдж |

## Матрица по ролям

| Роль | Ресурс (таблица) | Create | Read (публ.) | Update | Delete | Пауза | Ролевые функции | Дашборд |
|---|---|---|---|---|---|---|---|---|
| CONFECTIONER / STUDIO | Товары (products) | ✅ POST /api/products | ✅ витрина /catalog | ✅ | ✅ | ✅ | заказы, эскроу, профиль/слаг, calendly-загрузки (Storage), ИНН/налог-режим в onboarding | dashboard-confectioner |
| SUPPLIER | Товары/склад (inventory_items) | ✅ POST /api/supplier/products | ✅ /supplier-shop | ✅ PATCH/DELETE | ✅ | — | склад (кол-во, мин. остаток), delivery terms | dashboard-supplier |
| VENUE_OWNER | Площадки (venues) | ✅ POST /api/venues | ✅ витрина /venues | ✅ PATCH /api/venues/:id | ✅ | ✅ is_active | бронирования, прайс-листы, услуги площадки, пронос тортов | dashboard-venue-owner |
| VENUE_OWNER / ANIMATOR_AGENCY / RECREATION_CENTER / KIDS_CLUB | Объявления услуг (service_products) | ✅ POST /api/services | ✅ витрина /services-shop | ✅ PATCH /api/services/:id | ✅ | ✅ is_active | витрина «Объявления услуг» в дашборде | dashboard-venue-owner / dashboard-extra |
| ANIMATOR_AGENCY | + услуги (service_products) | ✅ | ✅ | ✅ | ✅ | ✅ | аниматоры, программы, расписание | dashboard-extra |
| RECREATION_CENTER | + услуги (service_products) | ✅ | ✅ | ✅ | ✅ | ✅ | площадка, бронирования, пакеты, пронос тортов | dashboard-extra |
| KIDS_CLUB | + услуги (service_products) | ✅ | ✅ | ✅ | ✅ | ✅ | дни рождения, дети, партнёры-кондитеры | dashboard-extra |
| EVENT_ORGANIZER / FOOD_SERVICE | Объявления услуг (service_products) | ✅ API | ✅ | ✅ API | ✅ API | ✅ | (UI в дашборде — бэклог) | dashboard-extra |
| COURIER | Заявки на доставку | ✅ (регистрация) | — | ✅ | — | — | доступные заказы, трекинг | dashboard-courier |
| ADMIN / SUPER_ADMIN / MODERATOR | Все ресурсы | ✅ | ✅ | ✅ (чужие тоже) | ✅ (чужие тоже) | ✅ | модерация, верификация, users management | dashboard-admin |
| MODERATOR | Публикации | ✅ | ✅ | ✅ (скрытие) | — | ✅ | очередь модерации, эскалации | dashboard-extra |
| CUSTOMER / CORPORATE_CLIENT | — | ❌ | ✅ | — | — | — | корзина, заказы, избранное, дегустации | dashboard-customer |
| BLOGGER / TASTER / COPYWRITER | Контент | ✅ (в своей области) | ✅ | ✅ | ✅ | — | черновики, публикации | dashboard-extra |
| FRANCHISEE | Территория | ✅ | ✅ | ✅ | ✅ | — | франшизная панель | dashboard-extra |

## Правила владения (ownership)

1. **Владелец** видит свои объявления, включая снятые с публикации (`is_active=false`).
2. **ADMIN/SUPER_ADMIN/MODERATOR** — полный доступ через байпас в RLS и в API.
3. Публичные списки (`GET` без auth) показывают только `is_active=true`.
4. Мутации несут **CSRF-токен** (double-submit cookie) и `Bearer access-token`.
5. RLS на уровне PG дублирует проверки API (defence in depth) — миграции 0019/0029.

## Пробелы и бэклог (честный статус)

- Услуги EVENT_ORGANIZER/FOOD_SERVICE: API есть, UI-вкладка в дашборде не добавлена.
- Бронирование площадок: заявка-«тост» с контактами; полноценный bookings-флоу
  (слоты, подтверждение, депозит) — следующий раунд.
- Фото объявлений: пока внешние URL; подгрузка в Storage (`product_images`,
  `portfolio`) доступна и будет подключена к формам услуг.
