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
    origin: [CORS_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"],
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
 * Эмулирует real-time ответ бота.
 */
function handleAutoReply(roomId: string, userMessage: string, _userId: string) {
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

  // Регистрируем онлайн
  onlineUsers.set(userId, { socketId: socket.id, userId, name: userName, avatar: userAvatar });

  // Оповещаем всех, что пользователь онлайн
  io.emit("user:online", { userId, name: userName });

  // ===== Присоединение к комнате чата =====
  socket.on("room:join", (roomId: string) => {
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
  socket.on("message:send", (data: {
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
    const message = {
      ...data.message,
      timestamp: new Date().toISOString(),
      status: "sent" as const,
    };

    // Отправляем всем в комнате, кроме отправителя
    socket.to(data.roomId).emit("message:receive", {
      roomId: data.roomId,
      message,
    });

    // Подтверждение отправителю
    socket.emit("message:sent", {
      roomId: data.roomId,
      messageId: message.id,
      status: "sent",
    });

    console.log(`💬 ${userName} → ${data.roomId}: ${message.text?.slice(0, 50)}...`);

    // ===== Авточат: если комната имеет prefix "order:" или type=order,
    //       запускаем FAQ-matcher и отвечаем через 800мс =====
    if (data.roomId.startsWith("order:") || data.roomId === "r2") {
      handleAutoReply(data.roomId, message.text, userId);
    }
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
      }, 500);
    } else {
      // Иначе — обычный auto-reply по тексту кнопки
      handleAutoReply(data.roomId, data.reply.label, userId);
    }
  });

  // ===== Indicators: печатает =====
  socket.on("typing:start", (data: { roomId: string }) => {
    socket.to(data.roomId).emit("typing:start", {
      roomId: data.roomId,
      userId,
      name: userName,
    });
  });

  socket.on("typing:stop", (data: { roomId: string }) => {
    socket.to(data.roomId).emit("typing:stop", {
      roomId: data.roomId,
      userId,
    });
  });

  // ===== Read receipts: прочитано =====
  socket.on("message:read", (data: { roomId: string; messageIds: string[] }) => {
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
    socket.to(data.roomId).emit("message:react", data);
  });

  // ===== Закрепление сообщений =====
  socket.on("message:pin", (data: { roomId: string; messageId: string; pinned: boolean }) => {
    socket.to(data.roomId).emit("message:pin", data);
  });

  // ===== Уведомления о заказах =====
  socket.on("order:notify", (data: {
    targetUserId: string;
    orderId: string;
    orderNumber: string;
    status: string;
    message: string;
  }) => {
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
