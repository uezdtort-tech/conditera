"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Send, MessageCircle, Phone, Video, MoreVertical, Bot, Sparkles, Mic, Square, X, Loader2, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { formatDateTime } from "@/lib/finance";
import type { QuickReply, ChatMessage, ChatRoom } from "@/lib/types";
import { useVoiceRecorder, formatDuration } from "@/hooks/useVoiceRecorder";
import { VoiceMessagePlayer } from "@/components/chat/voice-message-player";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSessionAuthHeaders, getCsrfToken, getStoredAccessToken } from "@/lib/api-client";
import { useSocketIO, type ChatMessage as SocketChatMessage } from "@/lib/use-socket-io";
import {
  ensureChatRoom,
  fetchChatMessages,
  fetchChatRooms,
  mapApiMessageToChatMessage,
  mapApiRoomToChatRoom,
  markChatRoomRead,
  sendChatMessage,
} from "@/components/chat/chat-api";

/**
 * Легаси mock-комната поддержки (r1/r2/r3 из store). Для залогиненных
 * пользователей используется реальная комната из БД (find-or-create через
 * POST /api/chat/rooms); «r3» остаётся только анонимным фолбэком.
 */
const SUPPORT_ROOM_ID = "r3";

/**
 * p1-b (B4): быстрые действия для order-чатов (ТЗ §9). Вставляют текст-шаблон
 * в поле ввода (НЕ отправляют сразу). «Отправить фото» НЕ реализовано:
 * механизм вложений в реальном чате отсутствует (POST /api/chat/rooms/:id/
 * messages принимает только текст) — пайплайн вложений сознательно не строился.
 */
const ORDER_QUICK_ACTIONS: { label: string; text: string }[] = [
  { label: "Уточнить заказ", text: "Здравствуйте! Хочу уточнить детали моего заказа: " },
  { label: "Изменить дату", text: "Здравствуйте! Можно ли изменить дату получения заказа? Мне удобно: " },
  { label: "Уточнить доставку", text: "Здравствуйте! Подскажите, пожалуйста, когда ожидается доставка заказа? " },
];

export function ChatWidget({
  /**
   * P1 контракт: если задан — виджет при открытии находит или создаёт
   * order-комнату (POST /api/chat/rooms {type:"order", orderId}) и открывает её.
   * Реализация — задача p1-b; prop зарезервирован, чтобы вызывающие стороны
   * (кабинет клиента, заказы) могли подключаться уже сейчас.
   */
  initialOrderId,
}: {
  initialOrderId?: string;
}) {
  // Пока реализация order-комнат в виджете не подключена (p1-b), prop
  // резервируется без эффекта.
  void initialOrderId;
  const chatOpen = useAppStore((s) => s.chatOpen);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const chatRooms = useAppStore((s) => s.chatRooms);
  const chatMessages = useAppStore((s) => s.chatMessages);
  const activeChatRoom = useAppStore((s) => s.activeChatRoom);
  const setActiveChatRoom = useAppStore((s) => s.setActiveChatRoom);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const sendQuickReply = useAppStore((s) => s.sendQuickReply);
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  // === Real-time канал (socket.io, порт 3030 через gateway) ===
  const {
    isConnected,
    isEnabled: socketEnabled,
    typingUsers,
    joinRoom,
    leaveRoom,
    sendMessage: socketSendMessage,
    sendQuickReplyAction,
    startTyping,
    stopTyping,
    onMessageReceive,
  } = useSocketIO();

  const [messageText, setMessageText] = useState("");
  // p1-chat: состояния отправки — «отправляется», ошибка доставки с повтором.
  // Первопричина: doSend был fire-and-forget — при неудаче POST оптимистичная
  // копия оставалась без пометки, повтор был невозможен, состояние не видно.
  const [sendPending, setSendPending] = useState(false);
  const [failedMessage, setFailedMessage] = useState<ChatMessage | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);

  // Voice recorder
  const recorder = useVoiceRecorder({ maxDurationSec: 120, waveformSamples: 30 });
  const [showRecorder, setShowRecorder] = useState(false);

  // === Real-first: список комнат из БД (GET /api/chat/rooms) ===
  // null — API ещё не отвечал / пользователь не залогинен → показываем store
  // (mock r1/r2/r3 — фолбэк ТОЛЬКО для анонимных; при неудачном API для
  // залогиненных остаёмся на пустом списке, без mock).
  const [apiRooms, setApiRooms] = useState<ChatRoom[] | null>(null);
  const rooms = apiRooms ?? chatRooms;

  const supportRoomIdRef = useRef<string | null>(null);
  const historyLoadedRef = useRef<Set<string>>(new Set());
  // p1-b: фокус order-комнаты (чтобы не пересоздавать на каждый рендер) и
  // кеш номеров заказов для бейджа в шапке order-чатов
  const orderFocusRef = useRef<string | null>(null);
  const orderNumberCacheRef = useRef<Map<string, string>>(new Map());
  const [orderNumberInfo, setOrderNumberInfo] = useState<string | null>(null);

  const activeRoom = rooms.find((r) => r.id === activeChatRoom);
  const roomMessages = chatMessages.filter((m) => m.roomId === activeChatRoom);

  // D-CHAT: превью последнего сообщения в списке комнат. room.lastMessage
  // приходит из GET /api/chat/rooms на момент загрузки списка и НЕ обновляется,
  // когда тред продолжает жить (оптимистичная отправка, real-time, ответы
  // FAQ-бота) — список показывал «Нет сообщений» для тредов с сообщениями,
  // хотя сам список сообщений корректен. Дополняем превью последним сообщением
  // из store (загружено существующим GET /api/chat/rooms/:id/messages и
  // доставляется по real-time) — новых эндпоинтов и запросов не нужно.
  const lastMessageByRoom = useMemo(() => {
    const byRoom = new Map<string, ChatMessage>();
    for (const m of chatMessages) {
      const prev = byRoom.get(m.roomId);
      if (
        !prev ||
        new Date(m.createdAt).getTime() > new Date(prev.createdAt).getTime()
      ) {
        byRoom.set(m.roomId, m);
      }
    }
    return byRoom;
  }, [chatMessages]);

  const roomPreview = useCallback(
    (room: ChatRoom): string => {
      const storeLast = lastMessageByRoom.get(room.id);
      const storeTs = storeLast
        ? new Date(storeLast.createdAt).getTime()
        : 0;
      const roomTs = room.lastMessageAt
        ? new Date(room.lastMessageAt).getTime()
        : 0;
      // Сообщение из store новее снимка списка комнат — оно и есть последнее
      if (storeLast && storeTs >= roomTs) {
        const text = storeLast.text.trim();
        if (text) return text;
        if (storeLast.voice) return "Вложение";
      }
      const apiText = room.lastMessage?.trim();
      if (apiText) return apiText;
      return "Нет сообщений";
    },
    [lastMessageByRoom]
  );

  // Этап 10: если активная комната (например, открытая из карточки заказа —
  // openOrderChat создаёт её ПОСЛЕ загрузки списка при логине) отсутствует
  // в списке — перезагружаем список. Без этого панель показывала «Выберите
  // чат» при уже выбранной комнате (activeRoom = undefined).
  const activeRoomMissing = activeChatRoom && apiRooms !== null && !activeRoom;
  useEffect(() => {
    if (!activeRoomMissing) return;
    let cancelled = false;
    (async () => {
      const list = await fetchChatRooms();
      if (cancelled) return;
      setApiRooms((list || []).map(mapApiRoomToChatRoom));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRoomMissing]);

  const activeTyping = typingUsers.get(activeChatRoom || "") || [];

  // Загрузка реальных комнат при логине (real-first; mock — только анонимам)
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated || !user?.id) {
      setApiRooms(null);
      supportRoomIdRef.current = null;
      historyLoadedRef.current.clear();
      return;
    }
    (async () => {
      const list = await fetchChatRooms();
      if (cancelled) return;
      const mapped = (list || []).map(mapApiRoomToChatRoom);
      setApiRooms(mapped);
      const support = (list || []).find((r) => r.type === "support");
      if (support) supportRoomIdRef.current = support.id;
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  // Живой список комнат: пока виджет открыт — рефетч каждые 20с (unread-счётчики
  // и превью последнего сообщения обновляются без перезагрузки; фолбэк на случай
  // недоступности real-time канала). Локально созданные комнаты (direct/order,
  // ещё не попавшие в ответ сервера) сохраняются в списке.
  useEffect(() => {
    if (!chatOpen || !isAuthenticated || !user?.id) return;
    const refresh = async () => {
      const list = await fetchChatRooms();
      if (!list) return;
      setApiRooms((prev) => {
        const mapped = list.map(mapApiRoomToChatRoom);
        const known = new Set(mapped.map((r) => r.id));
        const extras = (prev || []).filter((r) => !known.has(r.id));
        return [...mapped, ...extras];
      });
    };
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [chatOpen, isAuthenticated, user?.id]);

  // При открытии виджета: залогиненным — реальная support-комната из БД
  // (find-or-create, идемпотентно), анонимам — легаси mock-комната r3.
  // p1-b: при заданном initialOrderId у залогиненного приоритет у order-комнаты
  // (эффект ниже), чтобы не мигать support-комнатой перед фокусом на заказе.
  useEffect(() => {
    if (!chatOpen || activeChatRoom) return;
    if (initialOrderId && isAuthenticated && user?.id) return;
    if (!isAuthenticated || !user?.id) {
      setActiveChatRoom(SUPPORT_ROOM_ID);
      return;
    }
    if (supportRoomIdRef.current) {
      setActiveChatRoom(supportRoomIdRef.current);
      return;
    }
    let cancelled = false;
    (async () => {
      const room = await ensureChatRoom({ type: "support" });
      if (cancelled || !room) return;
      supportRoomIdRef.current = room.id;
      const mapped = mapApiRoomToChatRoom(room);
      setApiRooms((prev) => {
        const base = prev || [];
        if (base.some((r) => r.id === room.id)) return base;
        return [mapped, ...base];
      });
      setActiveChatRoom(room.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatOpen, activeChatRoom, isAuthenticated, user?.id, initialOrderId, setActiveChatRoom]);

  // p1-b (B2): initialOrderId — при открытии виджета / смене orderId
  // find-or-create order-комнаты (POST /api/chat/rooms {type:"order"}) и
  // фокус на ней: комната появляется/выделяется в списке. Support-ветка
  // не затронута (эффект выше пропускается при заданном initialOrderId).
  useEffect(() => {
    if (!chatOpen || !initialOrderId || !isAuthenticated || !user?.id) return;
    if (orderFocusRef.current === initialOrderId && activeChatRoom) return;
    let cancelled = false;
    (async () => {
      const room = await ensureChatRoom({ type: "order", orderId: initialOrderId });
      if (cancelled || !room) return;
      orderFocusRef.current = initialOrderId;
      const mapped = mapApiRoomToChatRoom(room);
      setApiRooms((prev) => {
        const base = prev || [];
        if (base.some((r) => r.id === room.id)) {
          return base.map((r) => (r.id === room.id ? mapped : r));
        }
        return [mapped, ...base];
      });
      setActiveChatRoom(room.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatOpen, initialOrderId, isAuthenticated, user?.id, activeChatRoom, setActiveChatRoom]);

  // p1-b (B2): лениво достаём № заказа (GET /api/orders/[id]) для бейджа
  // «Заказ №…» в шапке order-комнаты (кеш на сессию — один запрос на заказ).
  useEffect(() => {
    const orderId = activeRoom?.orderId;
    if (activeRoom?.type !== "order" || !orderId) {
      setOrderNumberInfo(null);
      return;
    }
    const cached = orderNumberCacheRef.current.get(orderId);
    if (cached) {
      setOrderNumberInfo(cached);
      return;
    }
    setOrderNumberInfo(null);
    let cancelled = false;
    (async () => {
      try {
        const token = getStoredAccessToken();
        const res = await fetch(`/api/orders/${orderId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as { order?: { number?: string } };
        const num = data?.order?.number;
        if (!cancelled && num) {
          orderNumberCacheRef.current.set(orderId, num);
          setOrderNumberInfo(num);
        }
      } catch {
        // бейдж не критичен: остаётся имя комнаты из списка
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRoom?.orderId, activeRoom?.type]);

  // История активной комнаты из БД (один раз на комнату за монтирование)
  useEffect(() => {
    if (!isAuthenticated || !user?.id || !activeChatRoom) return;
    if (activeChatRoom === SUPPORT_ROOM_ID) return; // легаси mock-комната
    if (historyLoadedRef.current.has(activeChatRoom)) return;
    historyLoadedRef.current.add(activeChatRoom);
    let cancelled = false;
    (async () => {
      const msgs = await fetchChatMessages(activeChatRoom);
      if (cancelled || !msgs || msgs.length === 0) return;
      const currentUserId = user.id;
      const mapped = msgs.map((m) => mapApiMessageToChatMessage(m, currentUserId));
      useAppStore.setState((s) => {
        const byId = new Set(s.chatMessages.map((m) => m.id));
        // Мягкий дедуп: socket-доставленное (client-uuid) vs строка из БД —
        // тот же отправитель/текст в окне 15с считается одним сообщением
        const isDup = (fresh: ChatMessage) =>
          s.chatMessages.some(
            (m) =>
              m.senderId === fresh.senderId &&
              m.text === fresh.text &&
              Math.abs(
                new Date(m.createdAt).getTime() - new Date(fresh.createdAt).getTime()
              ) < 15_000
          );
        const fresh = mapped.filter((m) => !byId.has(m.id) && !isDup(m));
        if (fresh.length === 0) return s;
        const merged = [...s.chatMessages, ...fresh].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        return { chatMessages: merged };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatRoom, isAuthenticated, user?.id]);

  // Отметить комнату прочитанной (POST /read): при открытии комнаты с
  // непрочитанными И когда в уже открытой комнате появились непрочитанные
  // (поллинг/рефетч списка добрали сообщения). Один POST на батч — guard
  // по ref (ключ roomId:unread), чтобы не спамить на каждый рендер.
  const markReadBatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatOpen || !isAuthenticated || !activeChatRoom) return;
    if (activeChatRoom === SUPPORT_ROOM_ID) return;
    const unread = activeRoom?.unreadCount ?? 0;
    if (unread <= 0) return;
    const batchKey = `${activeChatRoom}:${unread}`;
    if (markReadBatchRef.current === batchKey) return;
    markReadBatchRef.current = batchKey;
    markChatRoomRead(activeChatRoom);
    setApiRooms((prev) =>
      prev
        ? prev.map((r) =>
            r.id === activeChatRoom ? { ...r, unreadCount: 0 } : r
          )
        : prev
    );
  }, [chatOpen, isAuthenticated, activeChatRoom, activeRoom]);

  // Real-time: подписка на входящие сообщения → append в store (с дедупом)
  useEffect(() => {
    if (!onMessageReceive) return;
    const unsubscribe = onMessageReceive((roomId, incoming: SocketChatMessage) => {
      const mapped: ChatMessage = {
        id: incoming.id,
        roomId,
        senderId: incoming.senderId,
        senderName: incoming.senderName,
        senderAvatar: incoming.senderAvatar,
        text: incoming.text,
        createdAt: incoming.timestamp || new Date().toISOString(),
        isOwn: incoming.senderId === user?.id,
        isBot: incoming.isBot,
        botKind: incoming.botKind as ChatMessage["botKind"],
        quickReplies: incoming.quickReplies as ChatMessage["quickReplies"],
      };
      useAppStore.setState((s) => {
        // Дедуп: сервер может переслать сообщение, добавленное оптимистично
        if (s.chatMessages.some((m) => m.id === mapped.id)) return s;
        return { chatMessages: [...s.chatMessages, mapped] };
      });
    });
    return unsubscribe;
  }, [onMessageReceive, user?.id]);

  // p1-chat: смена комнаты — сбрасываем ввод и состояния отправки (одно поле
  // ввода на все комнаты: без очистки текст предыдущей комнаты уезжал в следующую).
  useEffect(() => {
    setMessageText("");
    setSendPending(false);
    setFailedMessage(null);
  }, [activeChatRoom]);

  // Socket: вход в активную комнату (получать real-time сообщения)
  useEffect(() => {
    if (!isConnected || !activeChatRoom) return;
    joinRoom(activeChatRoom);
    return () => leaveRoom(activeChatRoom);
  }, [isConnected, activeChatRoom, joinRoom, leaveRoom]);

  // === Live-fallback: поллинг сообщений активной комнаты ===
  // Real-time канал (socket.io за gateway) может не подключиться — доставка
  // остаётся на HTTP-поллинге: GET /api/chat/rooms/:id/messages?after=<курсор>
  // (инкрементально, только новые). Интервал: 5с при отключённом socket,
  // 15с при живом (страховка от пропусков). Дедуп по id + мягкое окно 15с
  // против client-uuid-копий; append только новых — скролл-поведение прежнее
  // (существующий эффект реагирует на roomMessages.length).
  useEffect(() => {
    if (!chatOpen || !isAuthenticated || !user?.id) return;
    if (!activeChatRoom || activeChatRoom === SUPPORT_ROOM_ID) return;
    const roomId = activeChatRoom;
    const currentUserId = user.id;
    // Начальный курсор — created_at последнего известного сообщения комнаты
    let cursor: string | null = null;
    for (const m of useAppStore.getState().chatMessages) {
      if (m.roomId === roomId && (!cursor || m.createdAt > cursor)) cursor = m.createdAt;
    }

    const poll = async () => {
      const fresh = await fetchChatMessages(roomId, undefined, cursor || undefined);
      if (!fresh || fresh.length === 0) return;
      // ASC-порядок → последний элемент самый свежий; курсор двигаем только
      // по серверным timestamp (created_at), не по клиентским часам.
      cursor = fresh[fresh.length - 1].createdAt;
      const mapped = fresh.map((m) => mapApiMessageToChatMessage(m, currentUserId));
      useAppStore.setState((s) => {
        const byId = new Set(s.chatMessages.map((m) => m.id));
        const isDup = (incoming: ChatMessage) =>
          s.chatMessages.some(
            (m) =>
              m.senderId === incoming.senderId &&
              m.text === incoming.text &&
              Math.abs(
                new Date(m.createdAt).getTime() - new Date(incoming.createdAt).getTime()
              ) < 15_000
          );
        const newMsgs = mapped.filter((m) => !byId.has(m.id) && !isDup(m));
        if (newMsgs.length === 0) return s;
        const merged = [...s.chatMessages, ...newMsgs].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        return { chatMessages: merged };
      });
    };

    const intervalMs = isConnected ? 15_000 : 5_000;
    const timer = setInterval(poll, intervalMs);
    return () => clearInterval(timer);
  }, [chatOpen, activeChatRoom, isAuthenticated, user?.id, isConnected]);

  // Скроллинг вниз при появлении новых сообщений И при переключении комнаты
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [roomMessages.length, activeChatRoom, activeTyping.length]);

  // Последнее bot-сообщение с quick-replies (для отображения кнопок)
  const lastBotWithQuickReplies = [...roomMessages]
    .reverse()
    .find((m) => m.isBot && m.quickReplies && m.quickReplies.length > 0);

  // Скелет сообщения отправителя через real-time канал
  const appendOwnMessage = useCallback(
    (id: string, text: string) => {
      const msg: ChatMessage = {
        id,
        roomId: activeChatRoom || SUPPORT_ROOM_ID,
        senderId: user?.id || "me",
        senderName: user?.name || "Я",
        senderAvatar: user?.avatar,
        text,
        createdAt: new Date().toISOString(),
        isOwn: true,
      };
      useAppStore.setState((s) => ({ chatMessages: [...s.chatMessages, msg] }));
    },
    [activeChatRoom, user?.id, user?.name, user?.avatar]
  );

  /** Единая отправка: оптимистичный append + идемпотентный POST в БД +
   *  socket-доставка другим участникам (real-time путь).
   *  reuseId — повторная отправка недоставленного: используется ТОТ ЖЕ
   *  idempotency-key (клиентский uuid), иначе socket.io-буфер исходной
   *  попытки (доставка при реконнекте) и retry запишут в БД две строки.
   *  Возвращает успех доставки в БД — для состояния отправки в UI. */
  const doSend = useCallback(
    async (text: string, options?: { reuseId?: string }): Promise<boolean> => {
      if (!activeChatRoom) return false;
      const clientId =
        options?.reuseId ||
        (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

      appendOwnMessage(clientId, text);

      // Socket-путь: real-time доставка другим участникам (чат-сервер сам
      // персистит сообщение, форвардя наш JWT — история переживёт рестарт).
      if (socketEnabled && isConnected) {
        socketSendMessage(activeChatRoom, {
          id: clientId,
          text,
          senderId: user?.id || "me",
          senderName: user?.name || "Я",
          senderAvatar: user?.avatar,
          type: "text",
        });
      }

      // Real-first: сообщение персистится в БД через /api/chat (idempotencyKey
      // = клиентский uuid → повтор возвращает ту же строку, дублей нет).
      const saved = await sendChatMessage(activeChatRoom, text, clientId);
      if (!saved) {
        // Доставка не состоялась: помечаем optimistic-копию как недоставленную —
        // повтор доступен кнопкой «Повторить» над полем ввода.
        setFailedMessage({
          id: clientId,
          roomId: activeChatRoom,
          senderId: user?.id || "me",
          senderName: user?.name || "Я",
          text,
          createdAt: new Date().toISOString(),
          deliveryState: "failed",
        });
        useAppStore.setState((s) => ({
          chatMessages: s.chatMessages.map((m) =>
            m.id === clientId ? { ...m, deliveryState: "failed" as const } : m
          ),
        }));
        return false;
      }
      const savedMsg = mapApiMessageToChatMessage(saved, user?.id);
      useAppStore.setState((s) => ({
        chatMessages: s.chatMessages.map((m) =>
          m.id === clientId ? savedMsg : m
        ),
      }));
      return true;
    },
    [
      activeChatRoom,
      appendOwnMessage,
      socketEnabled,
      isConnected,
      socketSendMessage,
      user?.id,
      user?.name,
      user?.avatar,
    ]
  );

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = messageText.trim();
    if (!text || !activeChatRoom) return;
    if (!isAuthenticated) {
      setChatOpen(false);
      setAuthModalOpen(true);
      return;
    }
    if (sendPending) return; // защита от двойной отправки

    setSendPending(true);
    setFailedMessage(null);
    setMessageText("");
    try {
      await doSend(text);
    } finally {
      setSendPending(false);
    }

    if (socketEnabled && isConnected) {
      stopTyping(activeChatRoom);
    }
  };

  // p1-chat: повторная отправка недоставленного сообщения — с тем же
  // idempotency-key (идемпотентный повтор: socket-буфер исходной попытки,
  // доставленный при реконнекте, и retry дают одну строку в БД).
  const handleRetrySend = async () => {
    if (!failedMessage || !activeChatRoom || sendPending) return;
    const text = failedMessage.text;
    const staleId = failedMessage.id;
    setSendPending(true);
    setFailedMessage(null);
    // Убираем недоставленную копию — повтор переиспользует её id как
    // idempotency-key, поэтому в БД вернётся одна строка.
    useAppStore.setState((s) => ({
      chatMessages: s.chatMessages.filter((m) => m.id !== staleId),
    }));
    try {
      await doSend(text, { reuseId: staleId });
    } finally {
      setSendPending(false);
    }
  };

  const handleQuickReply = (reply: QuickReply) => {
    if (!activeChatRoom) return;
    if (isAuthenticated) {
      // Залогиненным quick-reply уходит как обычное сообщение: персистится в
      // БД, а серверный FAQ-бот матчится по тексту кнопки (легаси-поведение
      // bot:quick_reply сохранено для анонимного пути ниже).
      doSend(reply.label);
    } else if (socketEnabled && isConnected) {
      // Сервер сам добавит сообщение-кнопку в комнату (в т.ч. отправителю)
      sendQuickReplyAction(activeChatRoom, reply as { label: string; action: string });
    } else {
      sendQuickReply(activeChatRoom, reply);
    }
  };

  // Typing: throttled индикатор «печатает…» в real-time комнату
  const handleInputChange = (value: string) => {
    setMessageText(value);
    if (socketEnabled && isConnected && activeChatRoom) {
      const now = Date.now();
      if (value && now - lastTypingSentRef.current > 2000) {
        lastTypingSentRef.current = now;
        startTyping(activeChatRoom);
      }
      if (!value) {
        stopTyping(activeChatRoom);
      }
    }
  };

  // AI-подсказка ответа (для кондитеров)
  const handleAiSuggestion = async () => {
    if (!activeRoom || roomMessages.length === 0) return;
    const lastCustomerMsg = [...roomMessages].reverse().find(m => !m.isOwn && !m.isBot);
    if (!lastCustomerMsg) return;

    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await fetch("/api/ai-dialogue/respond", {
        method: "POST",
        headers: await getSessionAuthHeaders(await getCsrfToken()),
        body: JSON.stringify({
          message: lastCustomerMsg.text,
          customerId: lastCustomerMsg.senderId || "customer",
          confectionerId: user?.id || "confectioner",
          chatHistory: roomMessages.slice(-5).map(m => m.text),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestion(data.suggestion);
      }
    } catch {
      // Fallback — простая подсказка
      setAiSuggestion("Спасибо за сообщение! Уточните, пожалуйста, детали заказа — и я подберу для вас лучший вариант.");
    } finally {
      setAiLoading(false);
    }
  };

  const useAiSuggestion = () => {
    if (aiSuggestion) {
      setMessageText(aiSuggestion);
      setAiSuggestion(null);
    }
  };

  // === Voice recording ===
  const handleStartRecording = async () => {
    if (!isAuthenticated) {
      setChatOpen(false);
      setAuthModalOpen(true);
      return;
    }
    setShowRecorder(true);
    await recorder.start();
  };

  const handleStopRecording = async () => {
    const recording = await recorder.stop();
    setShowRecorder(false);
    if (recording && activeChatRoom) {
      // Создаём voice-сообщение и добавляем в store
      const voiceMsg = {
        id: `voice_${Date.now()}`,
        roomId: activeChatRoom,
        senderId: user?.id || "u1",
        senderName: user?.name || "Я",
        senderAvatar: user?.avatar,
        text: "🎤 Голосовое сообщение",
        createdAt: new Date().toISOString(),
        isOwn: true,
        voice: {
          url: recording.url,
          durationSec: recording.durationSec,
          waveform: recording.waveform,
        },
      };
      // Добавляем через store напрямую
      useAppStore.setState((s) => ({
        chatMessages: [...s.chatMessages, voiceMsg],
      }));
    }
  };

  const handleCancelRecording = () => {
    recorder.cancel();
    setShowRecorder(false);
  };

  return (
    <Sheet open={chatOpen} onOpenChange={setChatOpen}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col h-[100dvh] sm:h-[calc(100dvh-0px)]">
        <SheetHeader className="p-0 border-b shrink-0">
          <SheetTitle className="sr-only">Чат</SheetTitle>
          <div className="flex flex-1 min-h-0">
            {/* Sidebar — rooms list */}
            <div className="w-1/3 border-r min-w-[180px] flex flex-col">
              <div className="p-3 border-b">
                <h2 className="font-display font-bold text-sm">Сообщения</h2>
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-1 p-2">
                  {rooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setActiveChatRoom(room.id)}
                      className={`w-full text-left p-2 rounded-lg transition-colors ${
                        activeChatRoom === room.id
                          ? "bg-primary/10"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={room.avatar} alt={room.name} />
                          <AvatarFallback className="text-[10px]">
                            {room.name.slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{room.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {roomPreview(room)}
                          </div>
                        </div>
                        {room.unreadCount > 0 && (
                          <Badge className="shrink-0 h-4 min-w-4 px-1 text-[9px] bg-primary text-primary-foreground">
                            {room.unreadCount > 99 ? "99+" : room.unreadCount}
                          </Badge>
                        )}
                        {room.id === SUPPORT_ROOM_ID && socketEnabled && (
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              isConnected ? "bg-emerald-500" : "bg-muted-foreground/40"
                            }`}
                            title={isConnected ? "Real-time подключён" : "Real-time офлайн"}
                          />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Main — active room */}
            <div className="flex-1 flex flex-col">
              {activeRoom ? (
                <>
                  {/* Header */}
                  <div className="p-3 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={activeRoom.avatar} alt={activeRoom.name} />
                        <AvatarFallback className="text-xs">
                          {activeRoom.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {activeRoom.type === "order" && orderNumberInfo ? (
                            <>
                              <Badge className="text-[9px] px-1.5 py-0 h-4 shrink-0">Заказ</Badge>
                              <span>№{orderNumberInfo}</span>
                            </>
                          ) : (
                            activeRoom.name
                          )}
                        </div>
                        <div
                          className={`text-[10px] flex items-center gap-1 ${
                            activeTyping.length > 0
                              ? "text-primary"
                              : socketEnabled && isConnected
                                ? "text-emerald-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {activeTyping.length > 0 ? (
                            <>
                              <span className="inline-flex gap-0.5">
                                <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                                <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:120ms]" />
                                <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:240ms]" />
                              </span>
                              {activeTyping[0]?.name || "Кто-то"} печатает…
                            </>
                          ) : socketEnabled && isConnected ? (
                            <>
                              ● онлайн (real-time)
                              {(activeRoom.type === "order" || activeRoom.type === "support" || activeRoom.id === SUPPORT_ROOM_ID) && (
                                <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-3.5">
                                  <Bot className="h-2.5 w-2.5 mr-0.5" />
                                  авточат
                                </Badge>
                              )}
                            </>
                          ) : (
                            "● офлайн — сообщения локальные"
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="mr-1 text-muted-foreground/60" title={socketEnabled ? (isConnected ? "Чат-сервер подключён" : "Нет связи с чат-сервером") : "Чат-сервер не настроен"}>
                        {socketEnabled && isConnected ? (
                          <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <WifiOff className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Phone className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Video className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Messages */}
                  <ScrollArea className="flex-1 bg-muted/30 min-h-0 overflow-y-auto" ref={scrollContainerRef}>
                    <div className="p-3 space-y-2">
                      {dedupeMessages(roomMessages).map((msg, idx) => {
                        // Уникальный ключ: id + индекс + первые 20 символов текста для гарантии уникальности
                        const uniqueKey = `${msg.id}-${idx}-${(msg.text || "").slice(0, 20).replace(/\s/g, "_")}`;
                        return (
                        <div
                          key={uniqueKey}
                          className={`flex gap-2 ${
                            msg.isOwn ? "flex-row-reverse" : ""
                          }`}
                        >
                          {!msg.isOwn && (
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarImage src={msg.senderAvatar} alt={msg.senderName} />
                              <AvatarFallback className={`text-[10px] ${msg.isBot ? "bg-primary/15" : ""}`}>
                                {msg.isBot ? <Bot className="h-3.5 w-3.5" /> : msg.senderName.slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className="flex flex-col gap-1 max-w-[75%]">
                            <div
                              className={`rounded-2xl px-3 py-2 ${
                                msg.isOwn
                                  ? "bg-primary text-primary-foreground rounded-br-md"
                                  : msg.isBot
                                  ? "bg-gradient-to-br from-primary/5 to-accent/30 border border-primary/20 rounded-bl-md"
                                  : "bg-card border border-border rounded-bl-md"
                              }`}
                            >
                              {msg.isBot && !msg.isOwn && (
                                <div className="flex items-center gap-1 mb-1 text-[10px] text-primary font-medium">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  {msg.senderName}
                                  {msg.botKind === "escalation" && (
                                    <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0 h-3">
                                      оператор
                                    </Badge>
                                  )}
                                </div>
                              )}
                              {msg.voice ? (
                                <VoiceMessagePlayer
                                  url={msg.voice.url}
                                  durationSec={msg.voice.durationSec}
                                  waveform={msg.voice.waveform}
                                  isOwn={msg.isOwn}
                                />
                              ) : (
                                <div className="text-xs leading-relaxed whitespace-pre-wrap">
                                  {msg.text}
                                </div>
                              )}
                              <div
                                className={`text-[9px] mt-1 ${
                                  msg.isOwn
                                    ? "text-primary-foreground/70"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {formatDateTime(msg.createdAt)}
                                {msg.isOwn && msg.deliveryState === "failed" && (
                                  <span className="ml-1 font-medium text-red-200">
                                    · не доставлено
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  {/* Quick replies — показываем только под последним bot-сообщением с ними */}
                  {lastBotWithQuickReplies && lastBotWithQuickReplies.quickReplies && (
                    <div className="px-3 pt-2 border-t bg-background/50">
                      <div className="flex flex-wrap gap-1.5 py-2">
                        {lastBotWithQuickReplies.quickReplies.map((reply, i) => (
                          <button
                            key={i}
                            onClick={() => handleQuickReply(reply)}
                            className="px-3 py-1.5 text-xs rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors text-primary"
                          >
                            {reply.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI-подсказка */}
                  {aiSuggestion && (
                    <div className="px-3 pt-2 border-t bg-purple-50/50">
                      <div className="flex items-start gap-2 py-2">
                        <div className="h-6 w-6 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                          <Sparkles className="h-3 w-3 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-purple-900">{aiSuggestion}</p>
                          <div className="flex gap-1 mt-1">
                            <button onClick={useAiSuggestion} className="text-[10px] text-purple-600 font-medium hover:underline">Использовать</button>
                            <button onClick={() => setAiSuggestion(null)} className="text-[10px] text-muted-foreground hover:underline">Отклонить</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* p1-b (B4): быстрые действия для order-чатов — вставка шаблона в инпут */}
                  {activeRoom?.type === "order" && !showRecorder && !recorder.isRecording && (
                    <div className="px-3 border-t bg-background/50">
                      <div className="flex flex-wrap gap-1.5 py-2">
                        {ORDER_QUICK_ACTIONS.map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            onClick={() => setMessageText(action.text)}
                            title="Вставить шаблон в поле ввода"
                            className="px-2.5 py-1 text-[11px] rounded-full border border-border bg-muted/40 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Input — текст или voice-recorder */}
                  {showRecorder || recorder.isRecording ? (
                    <div className="p-3 border-t flex items-center gap-2 bg-red-50/30">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleCancelRecording}
                        className="h-10 w-10 shrink-0 text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500 transition-all"
                            style={{ width: `${Math.min(100, recorder.level * 200)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono tabular-nums text-red-600">
                          {formatDuration(recorder.elapsedSec)}
                        </span>
                      </div>
                      <Button
                        size="icon"
                        onClick={handleStopRecording}
                        className="h-10 w-10 shrink-0 bg-red-500 hover:bg-red-600"
                      >
                        <Square className="h-4 w-4 fill-current" />
                      </Button>
                    </div>
                  ) : (
                    <form
                      onSubmit={handleSend}
                      className="p-3 border-t flex items-center gap-2"
                    >
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={handleAiSuggestion}
                        disabled={aiLoading || !activeRoom || roomMessages.length === 0}
                        className="h-10 w-10 shrink-0 text-purple-600 hover:bg-purple-50"
                        title="AI-подсказка ответа"
                      >
                        {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </Button>
                      <Input
                        value={messageText}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onBlur={() => activeChatRoom && stopTyping(activeChatRoom)}
                        placeholder="Сообщение..."
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={handleStartRecording}
                        className="h-10 w-10 shrink-0 text-muted-foreground hover:text-primary"
                        title="Записать голосовое сообщение"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!messageText.trim() || sendPending}
                        className="h-10 w-10 shrink-0"
                        title={sendPending ? "Отправляется…" : "Отправить"}
                      >
                        {sendPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </form>
                  )}
                  {recorder.error && (
                    <div className="px-3 pb-2 text-xs text-destructive">
                      {recorder.error}
                    </div>
                  )}
                  {failedMessage && (
                    <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      <span className="flex-1 truncate text-xs text-destructive">
                        Сообщение не доставлено
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={sendPending}
                        onClick={handleRetrySend}
                        className="h-6 shrink-0 px-2 text-[11px]"
                      >
                        {sendPending ? "Отправляется…" : "Повторить"}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <MessageCircle className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Выберите чат</h3>
                    <p className="text-sm text-muted-foreground">
                      Выберите диалог слева, чтобы начать общение
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Дедупликация сообщений по id внутри одного рендера (гарантия
 * уникальных React-ключей: socket-сообщения + mock + голосовые).
 */
function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}
