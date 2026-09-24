# Mobile App — Сборка

## Текущий статус

| Метод | Статус | Описание |
|-------|--------|----------|
| Web-сборка | ✅ Готово | `npx expo export --platform web` → 1.69 MB |
| Native проект | ✅ Сгенерирован | `android/` папка через `expo prebuild` |
| APK (локально) | ⚠ Требует Android SDK | Gradle готов, нужен Android Studio |
| APK (EAS Build) | ⚠ Требует expo.dev аккаунт | Облачная сборка |
| PWA | ✅ Готово | Установка через браузер телефона |

## Быстрая PWA-альтернатива (готова сейчас)

```bash
cd mobile-app
npx expo export --platform web
cd dist && npx serve -p 8080
# Откройте http://localhost:8080 на телефоне
# "Добавить на главный экран" → установится как PWA
```

## APK через EAS Build (облачная сборка)

### 1. Создать аккаунт на expo.dev

```bash
cd mobile-app
npm install -g eas-cli
eas login  # создайте аккаунт на expo.dev
```

### 2. Сборка APK

```bash
# Preview APK (для тестирования на устройстве)
eas build --platform android --profile preview

# Production AAB (для Google Play)
eas build --platform android --profile production
```

Сборка займёт ~10-15 минут в облаке Expo. Результат — ссылка на скачивание APK.

### 3. Установка на устройство

```bash
# Скачайте APK по ссылке из EAS
# Передайте на телефон (USB, облако, direct link)
# На телефоне: разрешить установку из неизвестных источников
# Откройте APK файл → установить
```

## APK через Android Studio (локально)

### 1. Установить Android Studio

Скачать с https://developer.android.com/studio
(включает Android SDK + Gradle + эмулятор)

### 2. Открыть проект

```bash
# Android Studio → Open → выбрать mobile-app/android/
```

### 3. Сборка

```bash
# Через Android Studio: Build → Build Bundle(s)/APK(s) → Build APK(s)
# Или через командную строку:
cd mobile-app/android
./gradlew assembleDebug     # debug APK
./gradlew assembleRelease   # release APK (нужен signing config)
```

APK будет в `android/app/build/outputs/apk/debug/app-debug.apk`

### 4. Установка на устройство

```bash
# Включить USB-отладку на телефоне (Настройки → Для разработчиков)
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Запуск через Expo Go (без сборки)

```bash
cd mobile-app
npx expo start
# Установите Expo Go из Google Play / App Store
# Отсканируйте QR-код из терминала
# Приложение запустится на телефоне (требует сеть)
```

## iOS сборка (требует Mac)

```bash
cd mobile-app
eas build --platform ios --profile preview  # для симулятора
eas build --platform ios --profile production  # для App Store
```

Требует Apple Developer Account ($99/год).

## Конфигурация

### eas.json (готов)

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": { "buildType": "app-bundle" }
    }
  }
}
```

### app.json (готов)

- `applicationId`: `ru.conditera.konditer`
- `versionName`: `1.0.0`
- Разрешения: камера, галерея, геолокация, Face ID, микрофон

### API endpoint

В production замените `http://localhost:3000` на ваш домен:
- `mobile-app/src/screens/*.tsx` — все fetch() вызовы
- `mobile-app/src/services/*.ts` — API helpers

## Структура native проекта

```
mobile-app/
├── android/               # Native Android проект (сгенерирован)
│   ├── app/
│   │   ├── build.gradle   # Конфигурация сборки
│   │   └── src/           # Native код
│   ├── build.gradle       # Корневой Gradle
│   ├── gradle/            # Gradle wrapper
│   └── settings.gradle    # Настройки проекта
├── App.tsx                # Entry point
├── app.json               # Expo config
├── eas.json               # EAS Build config
└── src/
    ├── screens/           # 24 экрана
    ├── hooks/             # useChat, useVoiceRecorder
    ├── services/          # biometric, geolocation, voice
    └── theme/             # Colors, Spacing
```

## Известные проблемы

1. **ExpoModulesCorePlugin** — publishing-блок закомментирован для локальной сборки
   (не влияет на APK, только на Maven-публикацию)
2. **expo-module-gradle-plugin** — требует Android SDK для полного разрешения
3. Для production сборки рекомендуется EAS Build (облако) — не требует локального SDK
