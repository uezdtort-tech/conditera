# ПРОМПТ S6B1 — Чаты (websocket mini-service)

Этап 6 «Коммуникации» | Блок 1. Зависимости: S2B1 (auth).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — fullstack-разработчик real-time. Чаты v2: отдельный websocket
микросервис + чат-поверхности в кабинете и на карточке кондитера.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui; дизайн-система 2025; без indigo/blue.
- Real-time: ОТДЕЛЬНЫЙ bun-микросервис в mini-services/chat-service
  (socket.io, СВОЙ порт 3030, свой package.json, запуск `bun --hot`);
  фронт подключается ТОЛЬКО через относительный путь с гейтвеем:
  `io("/?XTransformPort=3030")` — никаких localhost:порт в коде.
- Данные: только Prisma (Next-сторона); сервис чата — свой лёгкий
  стор (in-memory + синхронизация в PG через DATABASE_URL Prisma
  клиента — единая БД).
- Безопасность: JWT-проверка при handshake — Supabase access token
  (socket.handshake.auth.token), верификация jose с секретом
  SUPABASE_JWT_SECRET (env) либо через supabase.auth.getUser; комнаты
  по участникам; rate-limit сообщений (30/мин).
- Процесс: коммит `[S6B1] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/секреты; старый проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
Чат покупатель↔кондитер (по заказу и прямой), истории сообщений,
unread-счётчики, online-статусы — end-to-end через гейтвей.

## 4. ШАГИ
1. Модели (миграция): Conversation (type order|direct, orderId?,
   participantA, participantB), Message (conversationId, senderId,
   body, createdAt, readAt). Индексы: (conversationId, createdAt).
2. mini-services/chat-service/index.ts (bun, socket.io):
   - порт 3030 (в коде константа PORT=3030, не из env);
   - handshake: middleware — verify Supabase access token из
     socket.handshake.auth.token (jose verify с SUPABASE_JWT_SECRET)
     → attach {userId, roles из app_metadata.roles};
     невалид → disconnect;
   - события: join:conversation (проверка участника!), message:send
     (rate-limit, sanitize body: plain text, ≤2000 симв,
     attachment?: {fileId} — проверка владения/доступа через files
     из S2B4), message:read;
   - broadcast: message:new (в комнату), conversation:updated;
   - persistence: INSERT Message через Prisma; история — GET
     /api/chat/conversations/:id/messages (Next-сторона, guard
     участника) с пагинацией (30/стр);
   - /health — HTTP-эндпоинт для мониторинга.
3. Next API: GET /api/chat/conversations (свои, с lastMessage и
   unread), POST /api/chat/conversations (создать/получить direct с
   кондитером или по orderId).
4. UI: /account/chats — список бесед + окно чата (правая колонка на
   десктопе, Sheet на мобайле): сообщения-пузыри (Shadcn-карточки),
   дата-разделители, unread-бейджи, textarea+send (Ctrl+Enter);
   кнопка «Написать кондитеру» на странице кондитера (S3B2) и в
   заказе (S5B1).
5. Клиентский хук useChat (src/hooks/use-chat.ts): подключение через
   io("/?XTransformPort=3030"), авто-reconnect, оптимистичный вывод,
   метка прочитанного при открытой беседе.
6. Онлайн-статусы: presence в памяти сервиса (socket.io rooms) →
   событие presence:update.
7. Проверка золотого пути в двух окнах (agent-browser): оба пользователя
   получают сообщения в реальном времени.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- mini-services/chat-server/index.ts — паттерн handshake/health
  (адаптировать: JWT-проверку усилить);
- chat-UI старого проекта — паттерн пузырей и списка бесед.

## 6. ЗАПРЕТЫ
- io("http://localhost:3030") и io(":3030") — ЗАПРЕЩЕНЫ (только
  io("/?XTransformPort=3030"), path "/" по умолчанию).
- Не доверять client-side userId — только из verified JWT.
- Не хранить сообщения в памяти без персистенции.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] Handshake без валидного Supabase access token → disconnect
      (проверка curl + браузер);
- [ ] Сообщение проходит в реальном времени в 2 браузерах и пишется в
      БД; unread у получателя; read-метки работают;
- [ ] Не-участник беседы: join → отказ (проверка тестом из curl);
- [ ] Гейтвей: в коде нет прямых портов (grep "localhost:3030" → 0);
- [ ] tsc 0, lint 0; коммит [S6B1]; worklog.

## 8. ВЕРИФИКАЦИЯ (agent-browser)
- Два контекста (customer + confectioner): сообщение туда-обратно,
  скриншоты; мобайл-вид чата.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S6B1]; worklog (события socket.io, модель бесед).
- Отчёт: как запускается сервис, как проверять real-time.
