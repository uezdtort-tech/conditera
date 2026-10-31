# Browser-Defect-Fixes — work record (Fix Agent, tasks 1–3)

HEAD на старте: `59833d9` (чисто, кроме agent-ctx). Сервер: `GET /api/health → 200`.

## Fix 1 — /cake-builder шаг «Доставка»: выбор даты уводил из конструктора — COMMIT `e20798e`

**Root cause (воспроизведён в браузере, не гипотеза):** на шаге стоял нативный `input[type=date]`
(cake-builder-page.tsx:989–994). При viewport тестера 1280×577 ниже инпута не хватает места для
нативного календаря (~330px), и Chromium рендерит popup НАД инпутом — поверх шапки. Проверено
пробing elementFromPoint по зоне popup: под ячейками дней лежат кнопки навигации «Акции»,
«Рецепты», «B2B и услуги». Клики по «календарю» (нативный popup — не DOM) проходят насквозь к
этим кнопкам → `navigate()` → уход из конструктора. Отсюда же «×2 reproduced» и рабочее
«обходной путь — ввод даты с клавиатуры».

**Fix:** нативный инпут заменён на реальный DOM-календарь: shadcn `Popover` + существующий
`ui/calendar.tsx` (react-day-picker v9, locale ru). Клик по триггеру (`type="button"`,
aria-label «Выбрать дату доставки») открывает PopoverContent — клики по дням попадают в
приложение, сквозной проход к навигации невозможен физически. `onSelect` только пишет
`deliveryDate` (ISO `format(day,"yyyy-MM-dd")`) и закрывает поповер — без автоперехода шага.
Шаг не перекроен: та же позиция поля, тот же стор, «Далее» активируется как раньше.

**Verify (browser, интерактивно):** клик триггера → грид дней; клик «четверг, 15 октября 2026» →
`deliveryDate="2026-10-15"`, `step=7`, view не изменился (остались в конструкторе), «Далее» enabled.
`curl /cake-builder → 200`. tsc/lint чисто.

**Файл:** src/components/cake-builder/cake-builder-page.tsx (+45/−6).

## Fix 2 — гостевой «Написать»: модалка входа вместо пустого чат-виджета — COMMIT `ad8669e`

**Root cause:** обработчики (6a68ac1) на `ensureDirectRoom` при 401 всегда делали
`setChatOpen(true)` — гость видел пустой виджет с demo-комнатами.

**Fix:** в обоих местах (product-page.tsx `openDirectChatWithConfectioner`,
confectioner-profile-page.tsx `openDirectChat`) при `err.message === "unauthorized"`:
если `!isAuthenticated` (канонический признак логина, как в header.tsx) → `setAuthModalOpen(true)`
(существующий стор-флаг auth-modal.tsx); у аутентифицированного (истёкший токен) — прежнее
поведение (`setChatOpen(true)`). Прочие ошибки → toast, как было.

**Файлы:** src/components/pages/product-page.tsx, src/components/pages/confectioner-profile-page.tsx (+21/−6). tsc/lint чисто.

## Fix 3 — «socket.io-client не установлен — stub-режим» — COMMIT `586396b`

**Root cause:** пакет УСТАНОВЛЕН (socket.io-client@4.8.4 в node_modules, `"^4.8.1"` в
package.json — совпадает по мажору с socket.io@^4.7.5 чат-сервера), но хук грузил его
динамическим `await import("socket.io-client")` → отдельный чанк, который при HMR-инвалидациях
dev-сборки периодически падал → catch → «stub-режим» (×5). ~107 socket auth errors — отдельный
шум: это живой engine.io polling, отбиваемый «auth: token required/unauthorized» (доказывает,
что в части запусков импорт успевал загрузиться).

**Fix:** статический `import { io } from "socket.io-client"` в src/lib/use-socket-io.ts
(комментарии в шапке обновлены); catch теперь только для ошибок инициализации с честным
сообщением («не удалось инициализировать socket — чат работает на polling-фолбэке»).
Polling-фолбэк в chat-widget не тронут; stub-типы src/types/socket.io-client.d.ts оставлены
(совместимы, tsc clean).

**Verify (browser):** юзер в сторе → консоль: НЕТ «не установлен — stub-режим»; есть ожидаемый
`auth: token required` (фейковый юзер без cd_session — токена нет; у реального логина JWT есть).
lint 0, tsc 0.

**Файл:** src/lib/use-socket-io.ts (+12/−5).

## Final

- `bunx vitest run src/components/chat src/lib/demo-seed.test.ts src/lib/analytics-compute.test.ts`
  → **3 files / 22 tests passed**.
- lint: `eslint .` exit 0; `bunx tsc --noEmit` exit 0.
- Финальный HEAD: `586396b` (59833d9 → e20798e → ad8669e → 586396b). Не пушил, не удалял, build не гонял.
