// ============================================================
// Socket.IO Chat Server for "Кондитера"
// ============================================================
// Запуск: bun run dev (в директории mini-services/chat-server)
// Порт: 3030
//
// Возможности:
// - Real-time сообщения в чатах
// - Typing indicators (печатает...)
// - Online status (онлайн/офлайн)
// - Read receipts (прочитано)
// - Уведомления о новых заказах
// - Комнаты: direct, group, support, order, supplier, studio
// - JWT-аутентификация (проверка access-token из handshake.auth.token)
// ============================================================

import { createServer } from "http";
import { Server } from "socket.io";
import { jwtVerify } from "jose";

const PORT = process.env.CHAT_PORT || 3030;
const CORS_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// ===== Персистентность через Next API (история переживёт рестарт) =====
// На message:send сервер после broadcast пересылает сообщение в
// POST /api/chat/rooms/{id}/messages с JWT ОТПРАВИТЕЛЯ и тем же
// Idempotency-Key, что у клиента → дубли исключены (23505 → существующая
// строка). Сбой Next API не роняет сокет — broadcast уже прошёл.
const NEXT_API_BASE = process.env.NEXT_API_URL || "http://127.0.0.1:3000";
// Секрет server-to-server канала персистенции bot-сообщений
// (POST /api/chat/rooms/{id}/bot-message, заголовок x-bot-secret).
// Если не задан — bot-сообщения работают как раньше (real-time only, без истории).
const BOT_SECRET = process.env.BOT_SECRET || "";

interface CsrfPair { token: string; cookie: string; ts: number }
let csrfPair: CsrfPair | null = null;

/** CSRF double-submit для server-to-server POST: GET /api/csrf-token отдаёт
 *  токен в JSON + httpOnly cookie — пересылаем оба обратно. */
async function fetchCsrfPair(force = false): Promise<CsrfPair | null> {
  if (!force && csrfPair && Date.now() - csrfPair.ts < 3600_000) return csrfPair;
  try {
    const res = await fetch(`${NEXT_API_BASE}/api/csrf-token`);
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    const setCookie = res.headers.get("set-cookie") || "";
    const m = setCookie.match(/csrf_token=([^;]+)/);
    if (!body.token || !m) return null;
    csrfPair = { token: body.token, cookie: m[1], ts: Date.now() };
    return csrfPair;
  } catch {
    return null;
  }
}

async function persistMessage(
  roomId: string,
  text: string,
  idemKey: string,
  token: string
): Promise<{ ok: boolean; roomType?: string | null }> {
  const pair = await fetchCsrfPair();
  if (!pair || !token || !text) return { ok: false };
  const doPost = (p: CsrfPair) =>
    fetch(`${NEXT_API_BASE}/api/chat/rooms/${roomId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idemKey,
        "x-csrf-token": p.token,
        Cookie: `csrf_token=${p.cookie}`,
      },
      body: JSON.stringify({ content: text, idempotencyKey: idemKey }),
    });
  try {
    let res = await doPost(pair);
    if (res.status === 403) {
      // CSRF-токен ротировался — обновляем пару и пробуем ещё раз
      const fresh = await fetchCsrfPair(true);
      if (fresh) res = await doPost(fresh);
    }
    if (!res.ok) {
      console.warn(`[persist] POST /messages ${roomId} → ${res.status}`);
      return { ok: false };
    }
    const data = (await res.json().catch(() => null)) as
      | { roomType?: string | null }
      | null;
    return { ok: true, roomType: data?.roomType ?? null };
  } catch (err) {
    // Next API недоступен — сокет-доставка уже прошла (транзиентно ок)
    console.warn("[persist] Next API недоступен:", (err as Error).message);
    return { ok: false };
  }
}

/** Персистенция bot-сообщения (server-to-server, x-bot-secret).
 *  sender_id = системный бот-пользователь (seed 0004_seed_bot_user.sql).
 *  Сбой не критичен: real-time доставка уже прошла. */
async function persistBotMessage(
  roomId: string,
  text: string,
  botKind: "faq" | "escalation",
  quickReplies?: QuickReply[]
): Promise<void> {
  if (!BOT_SECRET || !text) return;
  try {
    const pair = await fetchCsrfPair();
    if (!pair) return;
    const idemKey = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const doPost = (p: CsrfPair) =>
      fetch(`${NEXT_API_BASE}/api/chat/rooms/${roomId}/bot-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bot-secret": BOT_SECRET,
          "Idempotency-Key": idemKey,
          "x-csrf-token": p.token,
          Cookie: `csrf_token=${p.cookie}`,
        },
        body: JSON.stringify({ text, botKind, quickReplies, idempotencyKey: idemKey }),
      });
    let res = await doPost(pair);
    if (res.status === 403) {
      const fresh = await fetchCsrfPair(true);
      if (fresh) res = await doPost(fresh);
    }
    if (!res.ok) {
      console.warn(`[bot-persist] POST bot-message ${roomId} → ${res.status}`);
    }
  } catch (err) {
    console.warn("[bot-persist] Next API недоступен:", (err as Error).message);
  }
}

/** Кеш типа комнаты (для решения «отвечает ли FAQ-бот») + легаси-маппинг. */
const roomTypeCache = new Map<string, string>();
const legacySupportRoom = new Map<string, string>(); // userId → реальная support-комната

async function getRoomType(roomId: string, token: string): Promise<string | null> {
  if (roomTypeCache.has(roomId)) return roomTypeCache.get(roomId) || null;
  if (!token) return null;
  try {
    const res = await fetch(`${NEXT_API_BASE}/api/chat/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { room?: { type?: string } };
    const t = data.room?.type || null;
    if (t) roomTypeCache.set(roomId, t);
    return t;
  } catch {
    return null;
  }
}

/** Легаси-маппинг mock-комнат витрины: r3 → реальная support-комната
 *  (find-or-create через API), r1/r2 остаются mock (не персистятся). */
async function resolveRoomId(roomId: string, token: string, userId: string): Promise<string> {
  if (roomId !== "r3") return roomId;
  const cached = legacySupportRoom.get(userId);
  if (cached) return cached;
  try {
    const pair = await fetchCsrfPair();
    if (!pair) return roomId;
    const res = await fetch(`${NEXT_API_BASE}/api/chat/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-csrf-token": pair.token,
        Cookie: `csrf_token=${pair.cookie}`,
      },
      body: JSON.stringify({ type: "support" }),
    });
    if (res.ok) {
      const data = (await res.json()) as { room?: { id?: string } };
      if (data.room?.id) {
        legacySupportRoom.set(userId, data.room.id);
        return data.room.id;
      }
    }
  } catch {
    // упадём в легаси-поведение
  }
  return roomId;
}

// ===== P1.1: проверка membership комнаты (аудит §15) =====
// Раньше room:join/message:send работали с ЛЮБОЙ комнатой: любой
// аутентифицированный пользователь мог слушать чужой заказ-чат и
// вколачивать real-time сообщения с подделанным senderId.
// Гейт через Next API (GET /api/chat/rooms/{id} — canAccessRoom):
// 200 → member; 403/404 → чужая комната. Позитивный результат кешируется
// (TTL 60 c), чтобы не бить API на каждом typing/read.

const LEGACY_MOCK_ROOMS = new Set(["r1", "r2"]); // mock-комнаты витрины, не персистятся

const roomAccessCache = new Map<string, { ts: number }>(); // `${userId}:${roomId}` → verified
const ROOM_ACCESS_TTL_MS = 60_000;

async function verifyRoomAccess(
  socket: import("socket.io").Socket,
  rawRoomId: string
): Promise<{ ok: boolean; realRoomId: string }> {
  const userId: string = (socket as any).userId;
  const token = socket.handshake.auth?.token as string | undefined;

  // Легаси mock-комнаты витрины — публичные demo-чаты, доступа к БД не требуют
  if (LEGACY_MOCK_ROOMS.has(rawRoomId)) return { ok: true, realRoomId: rawRoomId };

  // r3 — легаси support-комната: резолвим в реальную (find-or-create свою)
  let roomId = rawRoomId;
  if (rawRoomId === "r3" && token && userId) {
    roomId = await resolveRoomId(rawRoomId, token, userId);
    if (roomId === "r3") return { ok: false, realRoomId: roomId }; // не смогли создать свою
  }

  const cacheKey = `${userId}:${roomId}`;
  const cached = roomAccessCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ROOM_ACCESS_TTL_MS) {
    return { ok: true, realRoomId: roomId };
  }
  if (!token) return { ok: false, realRoomId: roomId };
  try {
    const res = await fetch(`${NEXT_API_BASE}/api/chat/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      roomAccessCache.set(cacheKey, { ts: Date.now() });
      return { ok: true, realRoomId: roomId };
    }
    console.warn(`[room-access] ${userId} → ${roomId}: ${res.status} (denied)`);
  } catch (err) {
    // Next API недоступен — fail-closed (не впускаем), транзиентно ок
    console.warn("[room-access] check failed:", (err as Error).message);
  }
  return { ok: false, realRoomId: roomId };
}

// === КРИТИЧНО: JWT_SECRET без unsafe-default ===
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("КРИТИЧНО: JWT_SECRET не задан. Socket.IO-сервер не может проверить токены.");
    }
    console.warn("⚠️ JWT_SECRET не задан — dev-режим с тестовым ключом. НЕ для production!");
    return new TextEncoder().encode("dev_jwt_secret_change_me_in_production_32_chars");
  }
  if (secret.startsWith("CHANGE_ME") && process.env.NODE_ENV === "production") {
    throw new Error("КРИТИЧНО: JWT_SECRET содержит заглушку CHANGE_ME*. Установите реальное значение.");
  }
  return new TextEncoder().encode(secret);
}

const JWT_SECRET = getJwtSecret();

// === Health endpoint для Docker healthcheck ===
let io: Server;

const httpServer = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "conditera-chat-server",
      uptime: process.uptime(),
      connections: io ? io.engine.clientsCount : 0,
    }));
    return;
  }
  // Остальные запросы передаём Socket.IO
});

io = new Server(httpServer, {
  path: "/",
  cors: {
    // Origin отражаем (любой источник): auth-граница сокета — JWT в
    // handshake.auth.token, а НЕ origin/cookies. Строгий origin-лист ломал
    // доступ с preview-домена (gateway проксирует с другим Origin), при этом
    // JWT всё равно требуется.
    origin: true,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ===== Хранилище онлайн-пользователей =====
const onlineUsers = new Map<string, { socketId: string; userId: string; name: string; avatar?: string }>();

// ===== Авточат: простой FAQ-matcher на серверной стороне =====
// Полная версия — в src/lib/chat-faq.ts (недоступна из этого mini-service)
interface QuickReply { label: string; action: string; payload?: any }
interface FaqTopic { keywords: string[]; answer: string; quickReplies?: QuickReply[] }

const FAQ_TOPICS: FaqTopic[] = [
  {
    keywords: ["заказ", "оформ", "сделать заказ", "купить", "покупк"],
    answer:
      "🛒 Как сделать заказ:\n  1. Выберите товар в каталоге или соберите торт в конструкторе\n  2. Нажмите «В корзину» → «Оформить заказ»\n  3. Укажите адрес и дату доставки\n  4. Оплатите — деньги будут на эскроу до получения",
    quickReplies: [
      { label: "Способы оплаты", action: "faq:payment" },
      { label: "Сроки доставки", action: "faq:delivery" },
    ],
  },
  {
    keywords: ["когда", "доставка", "привезут", "срок"],
    answer:
      "📅 Сроки доставки:\n  • По Москве — день в день или на следующий день\n  • По России — 2-7 дней через СДЭК/Boxberry\n  • Самовывоз — сразу после готовности",
    quickReplies: [
      { label: "Как отследить?", action: "faq:track_order" },
      { label: "Самовывоз", action: "faq:self_pickup" },
    ],
  },
  {
    keywords: ["оплат", "карт", "сбп", "налич", "рассрочк"],
    answer:
      "💳 Способы оплаты:\n  • Карта (Visa, Mastercard, Мир)\n  • СБП по QR\n  • Наличные при получении\n  • Рассрочка: Сплит, Тинькофф, Сбер\n  • Подарочный сертификат\n\n🔒 Все платежи защищены по 3-D Secure.",
    quickReplies: [
      { label: "Что такое эскроу?", action: "faq:escrow" },
      { label: "Рассрочка", action: "faq:installment" },
    ],
  },
  {
    keywords: ["эскроу", "безопасн", "гаранти"],
    answer:
      "🛡️ Эскроу — промежуточный счёт, где ваши деньги 24 часа после получения заказа.\n\n  1. Оплата → деньги на эскроу\n  2. Получение заказа и проверка\n  3. Через 24ч → деньги кондитеру\n  4. Если проблема → спор, деньги остаются на эскроу",
    quickReplies: [{ label: "Открыть спор", action: "dispute:open" }],
  },
  {
    keywords: ["бонус", "балл", "лояльност", "кэшбек"],
    answer:
      "🎁 Программа лояльности:\n  • 1 балл за каждые 100₽\n  • 1 балл = 1₽\n\nУровни:\n  🥉 Бронзовый — ×1\n  🥈 Серебряный (5000₽) — ×1.2, скидка 3%\n  🥇 Золотой (15000₽) — ×1.5, скидка 5%\n  💎 Платиновый (50000₽) — ×2, скидка 10%",
    quickReplies: [{ label: "Мои бонусы", action: "loyalty:my" }],
  },
  {
    keywords: ["отмен", "вернуть", "отказ"],
    answer:
      "❌ Отмена заказа:\n  • PENDING/CONFIRMED — полная отмена\n  • IN_PROGRESS — с удержанием расходов\n  • После доставки — спор в течение 24ч\n\nВозврат: 3 рабочих дня на ту же карту.",
    quickReplies: [
      { label: "Отменить заказ", action: "order:cancel" },
      { label: "Соединить с оператором", action: "human:operator" },
    ],
  },
  {
    keywords: ["аллерг", "состав", "глютен", "орех", "пп", "веган"],
    answer:
      "🥗 Аллергены и состав:\n  • Полный состав в карточке товара\n  • Возможные: глютен, молоко, яйца, орехи, соя\n  • ПП-варианты: на стевии/эритрите\n  • Безглютеновые: миндальная/рисовая мука",
    quickReplies: [
      { label: "ПП-каталог", action: "catalog:pp" },
      { label: "Безглютеновые", action: "catalog:gluten_free" },
    ],
  },
  {
    keywords: ["конструктор", "собрать торт", "индивид", "на заказ"],
    answer:
      "🎂 Конструктор тортов:\n  • Выбор формы, размера, начинки, покрытия, декора\n  • Подпись на торте\n  • Подбор кондитеров\n  • Запрос скидки у нескольких",
    quickReplies: [{ label: "Открыть конструктор", action: "cake_builder:open" }],
  },
  {
    keywords: ["жалоб", "плохо", "невкус", "испорч", "битый"],
    answer:
      "😞 Сожалею. Что делать:\n  1. Сделайте фото проблемы\n  2. Откройте спор в течение 24ч\n  3. Опишите и приложите фото\n  4. Модератор ответит за 24ч\n\nВозможно: возврат, частичная компенсация или замена.",
    quickReplies: [
      { label: "Открыть спор", action: "dispute:open" },
      { label: "Оператор", action: "human:operator" },
    ],
  },
];

const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { label: "Как сделать заказ?", action: "faq:how_to_order" },
  { label: "Способы оплаты", action: "faq:payment" },
  { label: "Сроки доставки", action: "faq:delivery_time" },
  { label: "Программа лояльности", action: "faq:bonuses" },
  { label: "Соединить с оператором", action: "human:operator" },
];

function matchFaq(message: string): FaqTopic | null {
  const lower = message.toLowerCase();
  let best: FaqTopic | null = null;
  let bestScore = 0;
  for (const topic of FAQ_TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (lower.includes(kw)) score += kw.length > 5 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Авточат: matчит FAQ и отправляет bot-сообщение в комнату через 800мс.
 * Эмулирует real-time ответ бота. После доставки — персистенция через
 * bot-message API (история переживает рестарт).
 */
function handleAutoReply(roomId: string, userMessage: string, _userId: string, authToken?: string) {
  setTimeout(() => {
    let botText: string;
    let botKind: "faq" | "escalation" = "faq";
    let quickReplies: QuickReply[] | undefined;

    // Команда эскалации
    if (/^(оператор|поддержк|человек|operator|support|human)\b/i.test(userMessage.trim())) {
      botText = "👩‍💼 Я передал ваш запрос оператору поддержки. Среднее время ответа — 5-10 минут в рабочее время (10:00-22:00 МСК).";
      botKind = "escalation";
    } else {
      const match = matchFaq(userMessage);
      if (match) {
        botText = match.answer;
        quickReplies = match.quickReplies;
      } else {
        botText = "🤔 Я не уверен, что правильно понял вопрос. Переформулируйте, пожалуйста, или выберите тему ниже:";
        quickReplies = DEFAULT_QUICK_REPLIES;
      }
    }

    const botMsg = {
      id: `bot_${Date.now()}`,
      text: botText,
      senderId: "bot",
      senderName: "Уездный помощник",
      senderAvatar: "/logo.png",
      timestamp: new Date().toISOString(),
      status: "sent" as const,
      isBot: true,
      botKind,
      quickReplies,
    };
    io.to(roomId).emit("message:receive", { roomId, message: botMsg });
    console.log(`🤖 bot → ${roomId}: ${botText.slice(0, 50)}...`);

    // Персистенция: легаси-комнату (r3) маппим в реальную, реальные пишем как есть
    if (authToken) {
      resolveRoomId(roomId, authToken, _userId)
        .then((realRoomId) => persistBotMessage(realRoomId, botText, botKind, quickReplies))
        .catch(() => {});
    }
  }, 800);
}

// ===== Аутентификация (middleware) — проверка JWT из handshake.auth.token =====
// До этого любой мог передать handshake.auth.userId и выдать себя за любого.
// Теперь требуется валидный JWT access-token, подписанный тем же JWT_SECRET,
// что и Next.js. userId/roles берём из payload — нельзя подделать.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string;
    if (!token) {
      return next(new Error("auth: token required"));
    }

    // Проверяем подпись и срок действия
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (!payload.userId) {
      return next(new Error("auth: invalid token (no userId)"));
    }

    // Проверяем, что это не TFA-pending токен (используется только для логина)
    if ((payload as any).tfa_pending) {
      return next(new Error("auth: TFA pending token cannot be used for chat"));
    }

    // userId/roles/email берём из JWT — клиент не может их подделать
    (socket as any).userId = payload.userId as string;
    (socket as any).userEmail = payload.email as string;
    (socket as any).userRoles = (payload.roles as string[]) || [];
    (socket as any).userName =
      (socket.handshake.auth?.userName as string) ||
      (payload.email as string) ||
      "Пользователь";
    (socket as any).userAvatar = socket.handshake.auth?.userAvatar as string;

    next();
  } catch (err: any) {
    // Не раскрываем детали ошибки клиенту — только общий "unauthorized"
    console.warn(`[auth] Socket connection rejected: ${err.message || err}`);
    return next(new Error("auth: unauthorized"));
  }
});

// ===== Подключение =====
io.on("connection", (socket) => {
  const userId = (socket as any).userId;
  const userName = (socket as any).userName;
  const userAvatar = (socket as any).userAvatar;

  console.log(`✅ ${userName} (${userId}) подключился`);

  // ===== P1.1: хелперы доступа =====
  // Верифицированная комната = прошла room:join (membership гейт).
  // Для высокочастотных relay-событий (typing/read/react) — только
  // локальная проверка без API-вызова.
  const isVerifiedRoom = (rawRoomId: string): boolean => {
    const v = (socket.data as any).verifiedRooms as Set<string> | undefined;
    return !!v?.has(rawRoomId);
  };
  const STAFF_ROLES = new Set(["CONFECTIONER", "ADMIN", "SUPER_ADMIN", "SUPPORT"]);
  const hasStaffRole = (): boolean =>
    (((socket as any).userRoles as string[] | undefined) || []).some((r) => STAFF_ROLES.has(r));

  // Регистрируем онлайн
  onlineUsers.set(userId, { socketId: socket.id, userId, name: userName, avatar: userAvatar });

  // Оповещаем всех, что пользователь онлайн
  io.emit("user:online", { userId, name: userName });

  // ===== Присоединение к комнате чата =====
  // P1.1: только члены комнаты (или свои mock-комнаты витрины). Чужая —
  // room:error без join: слушать чужой заказ-чат больше нельзя.
  socket.on("room:join", async (rawRoomId: string) => {
    const access = await verifyRoomAccess(socket, rawRoomId);
    if (!access.ok) {
      socket.emit("room:error", { roomId: rawRoomId, error: "Нет доступа к комнате" });
      console.warn(`⛔ ${userName} → ${rawRoomId}: доступ запрещён`);
      return;
    }
    const roomId = access.realRoomId;
    (socket.data as any).verifiedRooms =
      ((socket.data as any).verifiedRooms as Set<string> | undefined) ?? new Set<string>();
    ((socket.data as any).verifiedRooms as Set<string>).add(roomId);
    if (roomId !== rawRoomId) ((socket.data as any).verifiedRooms as Set<string>).add(rawRoomId);
    socket.join(roomId);
    console.log(`📍 ${userName} вошёл в комнату ${roomId}`);

    // Оповещаем комнату
    socket.to(roomId).emit("room:user_joined", {
      userId,
      name: userName,
      avatar: userAvatar,
      timestamp: new Date().toISOString(),
    });

    // Отправляем список онлайн-участников комнаты
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (roomSockets) {
      const onlineInRoom: string[] = [];
      for (const socketId of roomSockets) {
        const s = io.sockets.sockets.get(socketId);
        if (s && (s as any).userId) {
          onlineInRoom.push((s as any).userId);
        }
      }
      socket.emit("room:online_users", { roomId, users: onlineInRoom });
    }
  });

  // ===== Выход из комнаты =====
  socket.on("room:leave", (roomId: string) => {
    socket.leave(roomId);
    socket.to(roomId).emit("room:user_left", {
      userId,
      name: userName,
      timestamp: new Date().toISOString(),
    });
  });

  // ===== Отправка сообщения =====
  // P1.1: (1) sender — ТОЛЬКО из JWT (клиентский senderId/senderName
  // подделываемы — игнорируются, whitelist полей вместо спреда);
  // (2) broadcast только после membership-гейта — вколотить сообщение
  // в чужую комнату больше нельзя.
  socket.on("message:send", async (data: {
    roomId: string;
    message: {
      id: string;
      text: string;
      senderId: string;
      senderName: string;
      senderAvatar?: string;
      type?: "text" | "image" | "file" | "system" | "voice";
      attachment?: { url: string; name: string; type: string; size: number };
      replyTo?: string;
      forwardedFrom?: string;
    };
  }) => {
    const access = await verifyRoomAccess(socket, data.roomId);
    if (!access.ok) {
      socket.emit("message:error", {
        roomId: data.roomId,
        messageId: data.message?.id,
        error: "Нет доступа к комнате",
      });
      console.warn(`⛔ message:send ${userName} → ${data.roomId}: доступ запрещён`);
      return;
    }
    const roomId = access.realRoomId;

    // Whitelist полей + sender из JWT — клиентский payload не доверенный
    const message = {
      id: data.message?.id,
      text: data.message?.text,
      senderId: userId,
      senderName: userName,
      senderAvatar: userAvatar,
      type: data.message?.type === "system" ? ("text" as const) : (data.message?.type ?? ("text" as const)),
      attachment: data.message?.attachment,
      replyTo: data.message?.replyTo,
      forwardedFrom: data.message?.forwardedFrom,
      timestamp: new Date().toISOString(),
      status: "sent" as const,
    };

    if (!message.id || !message.text) {
      socket.emit("message:error", { roomId, error: "Некорректное сообщение" });
      return;
    }

    // Отправляем всем в комнате, кроме отправителя
    socket.to(roomId).emit("message:receive", {
      roomId,
      message,
    });

    // Подтверждение отправителю
    socket.emit("message:sent", {
      roomId,
      messageId: message.id,
      status: "sent",
    });

    console.log(`💬 ${userName} → ${roomId}: ${message.text?.slice(0, 50)}...`);

    // ===== Персистентность: пересылаем в Next API с JWT отправителя =====
    // (тот же Idempotency-Key, что у клиента → при двойной записи
    // widget-POST + socket-POST возвращается одна и та же строка).
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (authToken && message.text && !data.roomId.startsWith("r1") && !data.roomId.startsWith("r2")) {
      resolveRoomId(data.roomId, authToken, userId)
        .then((realRoomId) =>
          persistMessage(realRoomId, message.text, message.id, authToken)
        )
        .then((pr) => {
          if (pr?.roomType) roomTypeCache.set(data.roomId, pr.roomType);
        })
        .catch(() => {
          // персистентность не критична для real-time доставки
        });
    }

    // ===== Авточат: комнаты поддержки и заказов =====
    //   • order:* / support:* / r2 / r3 — легаси-паттерны
    //   • реальные UUID-комнаты: тип запрашиваем у Next API (кеш),
    //     бот отвечает в support/order-комнатах
    (async () => {
      let roomType: string | null = roomTypeCache.get(data.roomId) || null;
      if (!roomType) roomType = await getRoomType(data.roomId, authToken || "");
      const isAutoReplyRoom =
        data.roomId.startsWith("order:") ||
        data.roomId.startsWith("support:") ||
        data.roomId === "r2" ||
        data.roomId === "r3" ||
        roomType === "support" ||
        roomType === "order";
      if (isAutoReplyRoom) {
        handleAutoReply(data.roomId, message.text, userId, authToken);
      }
    })();
  });

  // ===== Авточат: quick-reply от пользователя (нажал кнопку под bot-сообщением) =====
  socket.on("bot:quick_reply", (data: {
    roomId: string;
    reply: { label: string; action: string; payload?: any };
  }) => {
    // Добавляем сообщение пользователя с текстом кнопки
    const userMsg = {
      id: `m_${Date.now()}`,
      text: data.reply.label,
      senderId: userId,
      senderName,
      senderAvatar: userAvatar,
      timestamp: new Date().toISOString(),
      status: "sent" as const,
    };
    io.to(data.roomId).emit("message:receive", { roomId: data.roomId, message: userMsg });

    (async () => {
      const authToken = socket.handshake.auth?.token as string | undefined;
      let roomType: string | null = roomTypeCache.get(data.roomId) || null;
      if (!roomType) roomType = await getRoomType(data.roomId, authToken || "");
      const isChatRoom =
        data.roomId.startsWith("order:") ||
        data.roomId.startsWith("support:") ||
        data.roomId === "r2" ||
        data.roomId === "r3" ||
        roomType === "support" ||
        roomType === "order";

      // Если это эскалация — отвечаем как escalation
      if (data.reply.action === "human:operator") {
        setTimeout(() => {
          const botMsg = {
            id: `bot_${Date.now()}`,
            text: "👩‍💼 Соединяю с оператором поддержки. Среднее время ожидания — 5-10 минут.",
            senderId: "bot",
            senderName: "Уездный помощник",
            senderAvatar: "/logo.png",
            timestamp: new Date().toISOString(),
            status: "sent" as const,
            isBot: true,
            botKind: "escalation",
          };
          io.to(data.roomId).emit("message:receive", { roomId: data.roomId, message: botMsg });
          // Персистенция escalation-ответа бота
          if (authToken) {
            resolveRoomId(data.roomId, authToken, userId)
              .then((realRoomId) => persistBotMessage(realRoomId, botMsg.text, "escalation"))
              .catch(() => {});
          }
        }, 500);
      } else if (isChatRoom) {
        // Иначе — обычный auto-reply по тексту кнопки
        handleAutoReply(data.roomId, data.reply.label, userId, authToken);
      }
    })();
  });

  // ===== Indicators: печатает =====
  // P1.1: только в верифицированные комнаты (без API-вызова, best-effort)
  socket.on("typing:start", (data: { roomId: string }) => {
    if (!isVerifiedRoom(data.roomId)) return;
    socket.to(data.roomId).emit("typing:start", {
      roomId: data.roomId,
      userId,
      name: userName,
    });
  });

  socket.on("typing:stop", (data: { roomId: string }) => {
    if (!isVerifiedRoom(data.roomId)) return;
    socket.to(data.roomId).emit("typing:stop", {
      roomId: data.roomId,
      userId,
    });
  });

  // ===== Read receipts: прочитано =====
  // P1.1: relay-события только для верифицированных комнат (после room:join)
  socket.on("message:read", (data: { roomId: string; messageIds: string[] }) => {
    if (!isVerifiedRoom(socket, data.roomId)) return;
    socket.to(data.roomId).emit("message:read", {
      roomId: data.roomId,
      userId,
      messageIds: data.messageIds,
      readAt: new Date().toISOString(),
    });
  });

  // ===== Реакции на сообщения =====
  socket.on("message:react", (data: {
    roomId: string;
    messageId: string;
    emoji: string;
    userId: string;
    userName: string;
  }) => {
    if (!isVerifiedRoom(socket, data.roomId)) return;
    // P1.1: userId/userName — из JWT, не из клиентского payload
    socket.to(data.roomId).emit("message:react", {
      ...data,
      userId,
      userName,
    });
  });

  // ===== Закрепление сообщений =====
  socket.on("message:pin", (data: { roomId: string; messageId: string; pinned: boolean }) => {
    if (!isVerifiedRoom(socket, data.roomId)) return;
    socket.to(data.roomId).emit("message:pin", data);
  });

  // ===== Уведомления о заказах =====
  // P1.1: только персонал — заказ-статусы рассылает система/кондитер,
  // а не произвольный пользователь (phishing-вектор закрыт).
  socket.on("order:notify", (data: {
    targetUserId: string;
    orderId: string;
    orderNumber: string;
    status: string;
    message: string;
  }) => {
    if (!hasStaffRole(socket)) return;
    const target = onlineUsers.get(data.targetUserId);
    if (target) {
      io.to(target.socketId).emit("order:notification", data);
    }
  });

  // ===== Уведомления платформы =====
  socket.on("notification:send", (data: {
    targetUserId: string;
    type: string;
    title: string;
    body: string;
  }) => {
    if (!hasStaffRole(socket)) return;
    const target = onlineUsers.get(data.targetUserId);
    if (target) {
      io.to(target.socketId).emit("notification:receive", data);
    }
  });

  // ===== Курьерский трекинг (real-time) =====
  socket.on("courier:location", (data: {
    orderId: string;
    customerId: string;
    lat: number;
    lng: number;
    eta?: number;
  }) => {
    // P1.1: только роль COURIER — гео-координаты шлёт назначенный курьер
    if (!((socket as any).userRoles as string[] | undefined)?.includes("COURIER")) return;
    const target = onlineUsers.get(data.customerId);
    if (target) {
      io.to(target.socketId).emit("courier:location_update", {
        orderId: data.orderId,
        lat: data.lat,
        lng: data.lng,
        eta: data.eta,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ===== Проверка статуса пользователя =====
  socket.on("user:check_status", (data: { userIds: string[] }) => {
    const statuses: Record<string, boolean> = {};
    data.userIds.forEach((uid) => {
      statuses[uid] = onlineUsers.has(uid);
    });
    socket.emit("user:status", statuses);
  });

  // ===== Отключение =====
  socket.on("disconnect", () => {
    console.log(`❌ ${userName} (${userId}) отключился`);

    // Удаляем из онлайн
    onlineUsers.delete(userId);

    // Оповещаем всех
    io.emit("user:offline", { userId });

    // Задержка перед оповещением (на случай быстрого переподключения)
    setTimeout(() => {
      if (!onlineUsers.has(userId)) {
        io.emit("user:offline", { userId, name: userName });
      }
    }, 5000);
  });
});

// ===== Запуск =====
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Socket.IO Chat Server для «Кондитера»`);
  console.log(`   Порт: ${PORT}`);
  console.log(`   CORS: ${CORS_ORIGIN}`);
  console.log(`   Ожидание подключений...\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n🔴 Получен SIGTERM, выключение...");
  io.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});
