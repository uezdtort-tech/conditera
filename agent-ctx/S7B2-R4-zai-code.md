# S7B2-R4 (recreate-3) — zai-code отчёт: AI-фичи витрины conditera-v2

Дата: 2026-11-21. Ветка main, дерево чистое. Предыдущий пин: S7B1 (be5f6e2,
bundle S7B1-be5f6e2). Код этого блока: 783892d; docs: 061046a; bundle-коммит
в root: 3fc12b1.

## 1. Feature map (код 783892d)

Пять AI-контуров поверх llm-core S7B1 (ai-config, цепочка провайдеров с
таймаутами D12, per-action лимиты, respondWithAi):

- `POST /api/ai-assistant/chat` — плавающий ассистент покупателя: контекст
  аккаунта из БД, история разговора (conversationId), reply-or-fallback.
- `POST /api/ai/search` — умный поиск каталога: разбор естественного языка
  (цена «до N», аллергены «без орехов», вкусы) → фильтры БД + выдача.
- `POST /api/ai/compare` — сравнение до 2 товаров: таблица параметров и
  insights строго из фактов карточек (цена/вес/порции/состав/аллергены).
- `POST /api/ai/cake-finder` — публичный подбор торта (гость разрешён):
  повод/бюджет/гости/вкусы/запрет аллергенов → подборка с витрины.
- `POST /api/ai/dialogue/respond` — черновики ответов для вендорских чатов
  (только группа вендоров), 1–2 варианта, опциональный orderContext.

UI: assistant-widget (плавающая кнопка «Открыть AI-ассистента», история,
typing-индикатор, тост на 429), smart-search на /catalog (раскрытие блока,
«Применённые фильтры», сетка результатов), compare-ui (CompareButton на
карточке товара + плавающая панель + страница /catalog/compare с таблицей и
AI-блоком), cake-finder-wizard (Повод → Бюджет и гости → Вкусы → Аллергии,
кнопка «Подобрать торт»), dialogue-suggest («AI-подсказка» в chat-panel,
вставка черновика, Ctrl/Cmd+Enter). Метрика: trackEvent ai_assistant,
ai_cake_finder.

## 2. Лимиты и гейты

- assistant: bucket 20/мин на пользователя; 21-й запрос → 429 + Retry-After
  (секунды до окна); UI показывает тост.
- compare: максимум 2 id — 5 id → 400.
- dialogue: 1–2 подсказки; RBAC — только CONFECTIONER/STUDIO/SUPPLIER/
  WHOLESALER; customer → 403; чужой/несуществующий orderId → 404.
- Порядок проверок S2B3 сохранён: CSRF до auth (аноним без токена → 403;
  с токеном без сессии → 401).
- Гость разрешён только на cake-finder (и GET рендерах).

## 3. Fallback-матрица (proof, гейт 1 шаг 8)

При AI_PROVIDER_ORDER=ollama + blackhole-адресе (рестарт с изменённым
окружением) все пять контуров: 200 + fallback:true + непустые данные из БД:
assistant — заготовка с пометкой «ответ без AI» (len ≥ 20); search — товары
по regex-парсеру запроса («капкейки до 2000» → товары есть); compare —
таблица 2 позиции + insights из фактов; cake-finder — товары есть, ореховых
0; dialogue — шаблонные черновики. Restore окружения + рестарт → 200.
LLM-содержимое не логируется и в матрице не печатается (только флаги/длины).

## 4. Аллергенный hard-filter (proof)

- search «торт без орехов до 5000»: filters.excludeAllergens=[орехи],
  maxPriceRub=5000; в products 0 позиций с орех/миндаль/фисташка/фундук/
  кешью/арахис (по фактам аллергенов из БД); все цены ≤ 500 000 коп (кап).
- cake-finder (гость) с tastes=[орехи] И allergensForbidden=[орехи]:
  excludedByAllergens ≥ 1 (фильтр виден потребителю), ореховых 0;
  все id подборки существуют в БД с isAvailable+approved (cross-check
  scripts/db/s7b2-dbcheck.mjs).

## 5. Гейты

Гейт 1 (curl-матрица agent-ctx/s7b2-matrix.sh → s7b2-matrix-output.txt):
PASS=44, FAIL=1. FAIL: restore-шаг «search fallback:false — got True».
Классификация: ОКРУЖЕНИЕ, не код — LLM-провайдер (zai) не ответил и сразу
после гейта (независимая проба: fallback:true, 200), поведение эндпоинта
корректно (штатная деградация D12), данные БД валидны. Восстановится
самостоятельно при доступности провайдера; повторный прогон шага 9 не
требует изменения кода.

Гейт 2 (браузер, agent-browser, 1 батч): 7 скринов в agent-ctx/:
- s7b2-r4-assistant.png — вход customer@demo.ru, панель ассистента, запрос
  «Посоветуй торт до 3000», POST /api/ai-assistant/chat → 200, ответ в панели.
- s7b2-r4-search.png — /catalog, «Умный поиск» раскрыт, «торт без орехов
  до 3000», блок «Применённые фильтры», выдача «Найдено».
- s7b2-r4-compare.png — 2 товара добавлены с карточек (prod-demo-11,
  prod-demo-02=Медовик), /catalog/compare: таблица Цена/Категория/Вес/
  Порций/Рейтинг/Состав/Аллергены + AI-ПОМОЩНИК блок.
- s7b2-r4-cake-finder.png — визард: День рождения → бюджет 5000 → шоколад →
  «без орехи» → «Подобрать торт» → результаты с карточками витрины
  (POST /api/ai/cake-finder → 200).
- s7b2-r4-mobile-390.png — viewport 390×844: scrollWidth == 390, гор.
  переполнений нет.
- s7b2-r4-dark.png — dark-тема.
- s7b2-r4-dialogue.png — confectioner@demo.ru, /account/chats, диалог
  «Демо-покупатель», «AI-подсказка» → 2 черновика-шаблона (fallback-ветка).
Консоль браузера: 0 ошибок (только info/log: React DevTools, HMR).
Рендеры: / =200, /catalog =200, /cake-finder =200.

## 6. Отклонения (осознанные)

1. Товары к сравнению добавлялись с карточек товара (/catalog/<slug>):
   в сетке каталога CompareButton не рендерится, плавающая панель каталога
   только отображает уже выбранные; сценарий «добавить 2 к сравнению»
   выполнен по реальному UI.
2. Вендорская AI-подсказка в прогоне — шаблонные черновики (fallback):
   LLM-провайдер вне песочницы; оба пути (LLM/шаблон) легальны по спеке.
3. Матрица хранит restore-FAIL как environmental — не блокер, код не трогался.

## 7. Recovery context

- Пин кода: 783892d; docs-коммит v2: 061046a; bundle:
  backups/conditera-v2-S7B2-783892d.bundle (1 511 008 B, verify: complete
  history, main = docs 061046a; имя файла пинует feature-sha 783892d),
  bundle-коммит root: 3fc12b1 (в root-репо только файл бандла).
- Dev :3100 (s7b1-restart.sh), health OK (app/database/auth/storage/n8n).
- Демо-креды публичные: customer@demo.ru / confectioner@demo.ru (Demo123!).
- Лимиты/фолбэки конфигурируются ai-config (S7B1), ключи окружения не
  менялись относительно S7B1.
- Следующий блок: S8B1. Полная детализация — worklog.md v2, секция
  recreate-3-S7B2-r4.
