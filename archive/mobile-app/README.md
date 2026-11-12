# Архив: мобильное приложение «Уездный кондитер» (conditera-konditer-mobile)

**Статус:** NOT MAINTAINED (архивировано Z-v32, 2026-11-11)

## Причина архивирования

Решение владельца (ARCHIVED) по итогам аудита Z-v31:

- единственный коммит 2026-09-24, ~0 развития за ~48 дней и ~438 коммитов основной разработки;
- не менее 6 несовместимостей контракта с актуальным backend (payment confirmationUrl→paymentUrl; GET /api/loyalty/redeem 405; socket.io handshake без JWT; escalations shape; 2FA tfaRequired; cookie-паттерн в 2 экранах);
- вне CI/CD/docker/workspaces;
- не публиковался (EAS-плейсхолдеры).

## Стек

Expo SDK 52 / React Native 0.76.9 / TypeScript 5.3 / Zustand 4 / React Navigation 6 / socket.io-client 4.7.5; 22 экрана; собственный JWT-клиент (expo-secure-store, auto-refresh).

## Исходный SHA

Последний коммит, затрагивающий код — 6bcf5c3 (2026-09-24, «Clean initial commit»); дерево перенесено `git mv` из `mobile-app/` (история сохраняется через `git log --follow archive/mobile-app`).

## Условия возобновления

1. Обновить контракты по списку выше.
2. Перевести 2 экрана с cookie-паттерна на apiRequest (Bearer).
3. Добавить JWT в socket.io handshake.
4. Server-side cart/wishlist вместо локальных.
5. EAS-конфигурация с реальными проектами.
6. Включить в CI отдельным пайплайном.

Backend API НЕ должен меняться ради мобильного клиента.
