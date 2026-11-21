# S6B1-R4 (recreate-3) — отчёт zai-code: чаты conditera-v2

## Контекст восстановления

Предыдущая S6B1-сессия потеряна целиком (recycle-урок №7: сессия без
бандла). R4 строился заново на бандле
backups/conditera-v2-S9B2R3-recovery-355bb23.bundle (база S5B3 +
сид-фиксы). HEAD при старте r4: 21baef5 — чат-сервис :3030 (socket.io,
JWT-handshake, персистенция Prisma, presence ref-count), conversations
API, /account/chats UI, gateway-safe транспорт; матрица PASS=36/0 уже
была зелёной; in-flight: два модифицированных файла chat-service.

## Финальные коммиты (main: 06e571c)

- 21baef5 — тело S6B1 (сервис+API+UI), унаследовано из r4-начала.
- 0aa9bba — env/service tweaks (ревью in-flight: coherent → commit):
  presence дублируется в личные комнаты `user:<profileId>` партнёров
  (виден в списке/шапке без join беседы; дубли room-канала безвредны —
  клиент пишет map); env.ts — fail-closed ТОЛЬКО на postgres-URL:
  shell-окружение песочницы тащило чужой sqlite `file:`-URL из
  проекта-предка; .env.local-постгрес остаётся валидным источником,
  если shell-URL не постгрес.
- 2f75841 — транспорт-фикс (главное открытие r4):
  1) Корневой баг: клиент socket.io и engine.io работали с дефолтным
     форматом пути С trailing slash ("path/?EIO=4..."), а прокси
     (Next-dev rewrite, тот же контракт у prod-шлюза) срезает слэш в
     rewrite-destination → до движка доходил путь без слэша → его
     path-check ("/socket.io/" === slice) не матчил → 404 → вечное
     «Нет соединения — переподключение» в UI.
     Фикс: согласованный no-slash формат на ОБОИХ концах
     (addTrailingSlash:false у клиента в обоих режимах — dev-rewrite и
     gateway XTransformPort; addTrailingSlash:false у Server). Прокси
     больше не может исказить путь. Старый формат "/socket.io/?..."
     от прямых клиентов нормализуется 308 (петли нет: слэш убирается
     один раз; прокси не достраивает слэш).
  2) Второй баг: ws-upgrade ветка engine.io (uWS-форк под bun) при
     churn соединений подвешивала event-loop сервиса (процесс жив,
     лог чист, порт молчит — воспроизводилось рандомно). Фикс:
     polling-only на клиенте (transport-список без websocket);
     long-poll socket.io даёт те же real-time <2s.
  3) Побочно: next.config — skipTrailingSlashRedirect (эксперимент
     с 308-циклом вылит в вывод выше; флаг оставлен как защита роутов).
- aec5550 — мобайл: одно-колоночный grid-трек списка бесед раздувался
  min-content nowrap-заголовков (длинные номера заказов
  "S6B1-SINGLE-…") → scrollWidth 504 → фикс minmax(0,1fr) → 390.

## События чата (контракт, стабилен с r4-начала)

handshake auth.token (JWT HS256, fail-closed) → join user:<profileId>;
message:send/ack{ok,message} → message:new (conversation-room) +
conversation:updated (личные комнаты партнёров, unreadDelta=1,
lastMessage) + персистенция ChatMessage; message:read →
conversation:read у отправителя + readAt в БД; presence:update
online:true/false (первый/последний коннект профиля; r4: также в
личные комнаты партнёров); chat:error (forbidden/rate_limited);
join чужой беседы → forbidden. Rate-limit: 30 сообщ/мин/профиль.

## Гейты r4 (все зелёные)

- lint 0 / tsc 0 — корень и mini-services/chat-service (трижды за сессию).
- Матрица S6B1: PASS=36 FAIL=0 (agent-ctx/s6b1-matrix-output.txt):
  cursor-пагинация, порядок asc, битый курсор 400, create order-chat,
  mixed_order 400, 11-й create/мин → 429 + Retry-After, grep-гейт
  портов в src/ → 0.
- Socket-проба двух клиентов в одном скрипте: PASS=14 FAIL=0
  (agent-ctx/s6b1-socket-probe-output.txt, финальный прогон на
  финальном коде): handshake без токена → connect_error; валидные
  токены → connected; presence online:true у партнёра; join FOREIGN →
  forbidden, join OWN → joined; real-time message:new <2s; персистенция
  row; conversation:updated unreadDelta=1; conversation:read + readAt;
  31-е сообщение → rate_limited; presence online:false после
  disconnect. Примечание: проба патчена в r4 (addTrailingSlash:false +
  polling-only) — она клиент, а не только инфраструктура.
- Браузер (два окна, /account/chats): сообщение "S6B1-R4 live hello
  from customer!" доставлено конfectioner-окну БЕЗ перезагрузки
  (socket push, REALTIME_OK), статус «Соединение установлено», presence
  «В сети» в списках обоих окон, unread-бейдж 1 в списке партнёра.
- Рендер: / 200, /catalog 200 (dev :3100).

## Скриншоты (agent-ctx/)

- s6b1-r4-chat-customer.png — окно покупателя, беседа заказа, сообщение
  отправлено (68 021 B).
- s6b1-r4-chat-confectioner.png — окно кондитера, сообщение получено
  real-time (72 387 B).
- s6b1-r4-mobile-390.png — 390px, scrollWidth == 390 (58 974 B).
- s6b1-r4-dark.png — тёмная тема через штатный toggle (71 714 B).

## Девиации и заметки

- Пробу и транспорт-клиент пришлось править вместе с сервисом: без
  согласованного no-slash формата любой клиент воспроизводил 404-цикл.
- bun-процессы сессии песочница периодически молча убивает (наблюдал
  на chat-service между вызовами агента; sleep-600-тест это подтвердил:
  фоновые процессы живут только внутри одного вызова). Для
  доказательства сервис перезапускался в каждом браузерном вызове;
  клиенты реконнектятся штатно. В проде — под супервизором шлюза.
- Эксперимент с `io.engine.handleRequest(req,res)`-форвардингом
  (попытка принять срезанный путь на сервисе) дал PASS=2/13 и был
  отозван — согласование формата на клиенте+движке оказалось
  единственным стабильным решением.
- Мобильная правка (aec5550) — доп-коммит сверх плана (гейт
  scrollWidth==390 не проходил без неё).
- Reuse-заметка: старые s6b1-r3-*.png не понадобились — браузер не был
  флейк (флейк была песочница-убийца фоновых процессов).

## Пины и артефакты

- Финальный код: aec5550; docs: 06e571c (worklog, пины).
- Бандл: backups/conditera-v2-S6B1-aec5550.bundle — 1 367 555 B,
  `git bundle verify` OK (complete history, main=06e571c), закоммичен
  в корневое репо: efc8665.
- Демо: customer@demo.ru / confectioner@demo.ru (Demo123!), беседа
  «Заказ S6B1-SINGLE-1795278513247» (order-chat из матрицы).
- Следующий блок карты: S6B2 (уведомления) → S7B1 → … → S9B2 (финал).
