# Уездный кондитер — мобильное приложение (React Native + Expo)

Мобильное приложение для маркетплейса частных кондитеров России. Использует тот же backend API, что и веб-версия (`/api/*`), аутентификация через JWT с авто-обновлением токена.

## 📱 Возможности

- **Каталог товаров** — поиск, фильтры по категориям, сортировка
- **Карточка товара** — выбор начинки/покрытия/декора, количество, AR-кнопка
- **Корзина** — добавление, изменение количества, очистка
- **Оформление заказа** — адрес доставки, способ оплаты, комментарий
- **Профиль кондитера** — рейтинг, специализация, портфолио товаров
- **Лояльность** — баланс бонусов, уровень, история начислений, прогресс
- **Заказы** — список с фильтром по статусу, детали заказа
- **Уведомления** — список + настройка каналов (email/SMS/push/Telegram) и категорий
- **Избранное** — отмеченные товары
- **Push-уведомления** — регистрация токена, обработка тапов
- **Тёмная тема** — автоматическая по системной настройке
- **Haptic-фидбек** — на ключевых действиях
- **💬 Чат с кондитером** — real-time через Socket.IO, typing indicators, статусы сообщений
- **🎤 Голосовые сообщения** — запись (expo-av) с live-waveform, воспроизведение с прогрессом и скоростью
- **📍 Геолокация** — поиск кондитеров рядом, расчёт расстояния, зона доставки, **карта с маркерами** (react-native-maps)
- **🔐 Биометрия** — Face ID / Touch ID / отпечаток пальца для входа
- **🥽 AR-просмотр 3D-моделей** — WebView с Google model-viewer, Scene Viewer (Android), Quick Look (iOS)

## 🚀 Запуск

### Установка зависимостей

```bash
cd mobile-app
npm install
```

### Запуск dev-сервера

```bash
# Запустить backend (веб-приложение) на http://localhost:3000
cd .. && bun run dev

# В другом терминале — запустить Expo
cd mobile-app
npx expo start
```

Откроется DevTools на http://localhost:8080. Сканируйте QR-код приложением **Expo Go** (Android/iOS).

### Настройка API URL

По умолчанию приложение обращается к `http://localhost:3000`. Для тестирования на реальном устройстве:

1. Узнайте IP компьютера: `ip addr show | grep "inet " | grep -v 127.0.0.1`
2. Отредактируйте `app.json` → `extra.apiUrl`:
   ```json
   "extra": {
     "apiUrl": "http://192.168.1.100:3000"
   }
   ```
3. Перезапустите Expo

### Сборка APK (Android)

```bash
# Установить eas-cli
npm install -g eas-cli

# Войти в Expo аккаунт
eas login

# Настроить проект
eas build:configure

# Собрать APK
eas build -p android --profile preview
```

### Сборка IPA (iOS, требуется Apple Developer аккаунт)

```bash
eas build -p ios --profile production
```

## 📂 Структура

```
mobile-app/
├── App.tsx                     # Entry point — splash, push, biometric login
├── app.json                    # Expo config (slug, icon, permissions)
├── package.json
├── babel.config.js
├── metro.config.js
├── tsconfig.json
├── assets/                     # Иконки, splash-экран (нужно добавить)
└── src/
    ├── api/
    │   └── client.ts           # API клиент — fetch + JWT + авто-refresh
    ├── store/
    │   └── index.ts            # Zustand store — auth, cart, favorites (persisted)
    ├── theme/
    │   └── index.ts            # Colors, Spacing, FontSize, formatCurrency
    ├── navigation/
    │   └── AppNavigator.tsx    # Bottom tabs + nested stacks
    ├── hooks/
    │   └── useChat.ts          # Socket.IO hook — real-time chat
    ├── services/
    │   ├── biometric.ts        # Face ID / Touch ID / Fingerprint
    │   ├── geolocation.ts      # Haversine, distance, service area
    │   └── voice.ts            # expo-av — запись + воспроизведение
    ├── screens/                # 19 экранов
    │   ├── HomeScreen.tsx
    │   ├── CatalogScreen.tsx
    │   ├── ProductDetailScreen.tsx
    │   ├── ConfectionersScreen.tsx
    │   ├── ConfectionerDetailScreen.tsx
    │   ├── NearbyConfectionersScreen.tsx   ← геолокация
    │   ├── CartScreen.tsx
    │   ├── CheckoutScreen.tsx
    │   ├── FavoritesScreen.tsx
    │   ├── ProfileScreen.tsx
    │   ├── AuthScreen.tsx
    │   ├── OrdersScreen.tsx
    │   ├── OrderDetailScreen.tsx
    │   ├── LoyaltyScreen.tsx
    │   ├── NotificationsScreen.tsx
    │   ├── NotificationPreferencesScreen.tsx
    │   ├── ChatListScreen.tsx              ← список чатов
    │   ├── ChatDetailScreen.tsx            ← диалог real-time
    │   ├── ARViewerScreen.tsx              ← WebView + model-viewer
    │   └── BiometricScreen.tsx             ← настройка биометрии
    └── components/
        ├── ProductCard.tsx
        ├── ConfectionerCard.tsx
        └── VoiceMessageBubble.tsx   # Голосовое сообщение с плеером
```

## 🔌 API

Приложение использует те же эндпоинты, что и веб-версия:

| Метод   | Endpoint                              | Назначение                              |
|---------|---------------------------------------|-----------------------------------------|
| POST    | `/api/auth/login`                     | Вход                                    |
| POST    | `/api/auth/register`                  | Регистрация                             |
| POST    | `/api/auth/refresh`                   | Обновление access-токена                |
| GET     | `/api/products`                       | Список товаров (с фильтрами)            |
| GET     | `/api/products/:id`                   | Детали товара                           |
| GET     | `/api/confectioners`                  | Список кондитеров                       |
| GET     | `/api/orders`                         | Заказы пользователя                     |
| POST    | `/api/orders`                         | Создать заказ                           |
| GET     | `/api/loyalty/history`                | История бонусов                         |
| GET     | `/api/loyalty/levels`                 | Конфигурация уровней                    |
| GET/POST| `/api/loyalty/redeem`                 | Списать бонусы                          |
| GET     | `/api/notifications/list`             | Список уведомлений                      |
| GET     | `/api/notifications/unread-count`     | Счётчик непрочитанных                   |
| POST    | `/api/notifications/mark-read`        | Отметить прочитанными                   |
| GET/PUT | `/api/notifications/preferences`      | Настройки уведомлений                   |
| GET     | `/api/promotions`                     | Акции                                   |
| POST    | `/api/payment/create`                 | Создать платёж (YooKassa)               |

## 🔐 Безопасность

- **JWT-токены** хранятся в `expo-secure-store` (Keystore на Android, Keychain на iOS — зашифрованы)
- **Access token** автоматически прикрепляется к каждому запросу
- При **401** автоматически вызывается `/api/auth/refresh` и запрос повторяется
- Если refresh не удался — пользователь разлогинивается
- Все остальные данные (корзина, избранное, профиль) — в `AsyncStorage`

## 📲 Push-уведомления

Приложение регистрируется для push-уведомлений при логине:

1. Запрашивает разрешение (iOS — `requestPermissionsAsync`, Android — автоматически)
2. Получает Expo Push Token через `getExpoPushTokenAsync`
3. Создаёт канал `default` на Android с цветом бренда
4. Слушает входящие уведомления (`addNotificationReceivedListener`)
5. Слушает тапы (`addNotificationResponseReceivedListener`) — можно навигировать на конкретный экран

**Для включения реальных push-уведомлений:**
- Зарегистрируйте проект на [Expo](https://expo.dev)
- Укажите `projectId` в `app.json` → `extra.eas.projectId`
- Отправьте токен на backend через `POST /api/notifications/subscribe` (нужно реализовать)

## 🎨 Дизайн

- **Цвета** — соответствует веб-версии (фиолетовый `#7c3aed`, розовый `#ec4899`)
- **Шрифты** — системные (San Francisco на iOS, Roboto на Android)
- **Тёмная тема** — автоматическая по системной настройке
- **Haptic feedback** — на добавлении в корзину, избранное, смене фильтров

## 💬 Чат с кондитером (Socket.IO)

Real-time обмен сообщениями через существующий chat-сервер на порту 3030.

**Возможности:**
- Список чатов с непрочитанными бейджами
- Диалог с bubbles (мои/чужие), аватарами, временем
- Typing indicator («печатает...»)
- Статусы сообщений: ⏳ sending → ✓ sent → ✓✓ delivered → ✓✓ read (синий)
- Online/offline статус собеседника
- Авто-переподключение при разрыве (5 попыток, 1s интервал)
- Optimistic UI — сообщение появляется сразу, статус обновляется после подтверждения сервера

**Хук `useChat`** управляет всем состоянием: socket, rooms, messages, typingUsers, onlineUsers. Используется как в списке чатов, так и в детальном диалоге.

## 🎤 Голосовые сообщения

Запись и воспроизведение голосовых сообщений через `expo-av`.

**Запись:**
- Кнопка микрофона (вместо send) когда поле ввода пустое
- Запись в формате AAC .m4a, 44.1kHz, 128kbps
- Live waveform во время записи — обновляется каждые 100ms (metering API)
- Таймер длительности (mm:ss)
- Кнопка ✕ для отмены, ✓ для отправки
- Минимум 1 секунда — иначе отбрасывается

**Воспроизведение (VoiceMessageBubble):**
- Кнопка play/pause с анимированной иконкой
- Waveform из 28 баров (кликабельные — для перемотки)
- Прогресс-бар: позиция / длительность (mm:ss / mm:ss)
- Переключатель скорости: 1x → 1.5x → 2x (клик по бейджу)
- Auto-unload при покидании экрана
- Разные цвета для своих (фиолетовый) и чужих (серый) сообщений

**Сервис `voice.ts`:**
- `startRecording()` / `stopRecording()` → `{ uri, durationMs }`
- `cancelRecording()` — отбросить запись
- `getRecordingMetering()` — текущий уровень сигнала (dB)
- `loadAudio(uri, onStatusUpdate)` / `playAudio(uri)` / `pauseAudio(uri)` / `seekAudio(uri, positionMs)`
- `unloadAllAudio()` — cleanup при размонтировании

**Безопасность:**
- iOS: `NSMicrophoneUsageDescription` в Info.plist
- Android: `RECORD_AUDIO` permission
- Запрос разрешения через `Audio.requestPermissionsAsync()` при первом нажатии на mic

## 📍 Геолокация

Поиск кондитеров рядом с пользователем через `expo-location`.

**Алгоритм:**
1. Запрос разрешения `ACCESS_FINE_LOCATION` (Android) / `NSLocationWhenInUseUsageDescription` (iOS)
2. Получение координат `getCurrentPositionAsync({ accuracy: Balanced })`
3. Для каждого кондитера — расчёт расстояния по формуле Гаверсинуса (учитывает кривизну Земли)
4. Сортировка по расстоянию или рейтингу
5. Бейдж «Доставляет вам» если расстояние ≤ `serviceRadiusKm` из профиля кондитера

**Формат расстояния:** `450 м` / `2.3 км` / `15 км`

**Два режима просмотра:**
- **Список** — карточки с аватаром, именем, рейтингом, расстоянием, бейджем зоны доставки
- **Карта** — `react-native-maps` с маркерами:
  - Синий круг — ваша геопозиция
  - Фиолетовый пин — проверенный кондитер (verified=true)
  - Оранжевый пин — обычный кондитер
  - Тап по маркеру → callout с аватаром, именем, рейтингом, расстоянием, «Доставляет вам»
  - Тап по callout → переход на профиль кондитера
  - Кнопка «Список» сверху — вернуться к списку
  - Кнопка «Карта» сверху — переключиться на карту
  - Fallback: если `react-native-maps` не доступен (Expo Web), показывается подсказка «используйте список»

## 🔐 Биометрия (Face ID / Touch ID)

Вход в приложение без пароля — через биометрию устройства.

**Поддерживаемые методы:**
- iOS: Face ID, Touch ID
- Android: Fingerprint, Iris (Samsung), Facial (Android 10+)

**Безопасность:**
- Биометрические данные **никогда не покидают устройство** — Apple/Google не даёт к ним доступа
- Мы храним в SecureStore (зашифровано Keystore/Keychain):
  - флаг `biometric_enabled`
  - email пользователя (для re-auth)
- При запуске приложения, если флаг включён — показывается биометрический prompt
- Пользователь может в любой момент отключить в настройках

**Сценарий использования:**
1. Пользователь входит обычным способом (email + пароль)
2. В Профиле → Биометрия → включает тумблер
3. Подтверждает биометрию (Face ID / отпечаток)
4. При следующем запуске — приложение просит биометрию вместо пароля

## 🥽 AR-просмотр 3D-моделей

WebView с Google `<model-viewer>` web component для 3D/AR превью тортов.

**Как это работает:**
1. На странице товара, если есть `modelUrl`, показывается кнопка «AR»
2. Нажатие → открывается экран `ARViewerScreen` с WebView
3. WebView загружает self-contained HTML с `<model-viewer>` (CDN script)
4. Пользователь может:
   - Вращать модель пальцем (camera-controls)
   - Смотреть авто-вращение через 3 секунды
   - Нажать «Посмотреть в AR» — откроется:
     - **Android:** Scene Viewer (через Google Play Services for AR)
     - **iOS:** Quick Look (нативно, если есть USDZ-модель)

**AR-режимы (порядок fallback):**
1. `scene-viewer` — Android Chrome
2. `quick-look` — iOS Safari (нужен USDZ)
3. `webxr` — браузеры с WebXR поддержкой

**Для добавления 3D-модели товару:** кондитер загружает GLB файл, URL сохраняется в `Product.modelUrl`. Опционально `modelUsdzUrl` для iOS Quick Look.

## 📋 TODO

- [x] ~~Экран чата с кондитером (Socket.IO клиент)~~
- [x] ~~Геолокация для поиска кондитеров рядом~~
- [x] ~~Биометрическая аутентификация (Face ID/Touch ID)~~
- [x] ~~Web View для AR-просмотра 3D-моделей тортов~~
- [x] ~~Голосовые сообщения в чат (expo-av)~~
- [x] ~~Карта (react-native-maps) в NearbyConfectioners~~
- [ ] Добавить иконки и splash-изображения в `assets/`
- [ ] Реализовать отправку push-токена на backend
- [ ] Добавить камеру для фото-отзывов (`expo-camera`, `expo-image-picker`)
- [ ] Добавить экран настроек приложения (тёмная тема, язык, выход)
- [ ] Реализовать реальную биометрическую пере-аутентификацию (с refresh token)
- [ ] Загрузить голосовые файлы на backend (вместо local URI)

## 🧪 Тестирование

Демо-аккаунты:
- Покупатель: `customer@demo.ru` / `demo123`
- Кондитер: `confectioner@demo.ru` / `demo123`
- Администратор: `admin@demo.ru` / `admin123`
