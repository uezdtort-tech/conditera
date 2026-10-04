/**
 * use-socket-io.ts — Socket.IO hook для real-time чата.
 *
 * Подключение (консолидация «настоящего чата»):
 *   • URL по умолчанию — ОТНОСИТЕЛЬНЫЙ "/?XTransformPort=3030" (gateway
 *     песочницы пробрасывает порт; прямой localhost:3030 запрещён и не
 *     работает из браузера). Переопределяется NEXT_PUBLIC_CHAT_URL.
 *   • JWT-токен для handshake берётся из /api/auth/session (единый
 *     auth-контракт: сервер читает httpOnly cookie cd_session и возвращает
 *     accessToken). localStorage НЕ используется.
 *   • socket.io-client — опциональная зависимость: если пакет не установлен,
 *     хук работает в stub-режиме (все функции no-op).
 *
 * События: room:join/leave, message:send/sent/receive, typing:start/stop,
 * message:read, message:react, order:notify.
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAppStore } from "@/lib/store";

// URL чат-сервера: относительный через gateway (порт 3030) или из env.
const CHAT_SERVER_URL =
  process.env.NEXT_PUBLIC_CHAT_URL || "/?XTransformPort=3030";
const IS_ENABLED = Boolean(CHAT_SERVER_URL);

// Минимальный интерфейс Socket — нужен только для типизации ref.
// Полный тип берётся из socket.io-client, если он установлен.
interface SocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener?: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  disconnect(): void;
  connected: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  text: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  type?: "text" | "image" | "file" | "system" | "voice";
  attachment?: { url: string; name: string; type: string; size: number };
  replyTo?: string;
  timestamp: string;
  status: "sending" | "sent" | "delivered" | "read";
  isBot?: boolean;
  botKind?: string;
  quickReplies?: { label: string; action: string; payload?: unknown }[];
}

export interface TypingUser {
  roomId: string;
  userId: string;
  name: string;
}

type MessageListener = (roomId: string, message: ChatMessage) => void;
type SentListener = (roomId: string, messageId: string) => void;

/** Взять access-токен для socket-handshake из /api/auth/session. */
async function fetchSocketToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/session");
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string | null };
    // Единый контракт: accessToken из сессии кешируем в sessionStorage —
    // его же использует getSessionAuthHeaders() (Bearer-канал api-client).
    if (data.accessToken) {
      const { setStoredAccessToken } = await import("@/lib/api-client");
      setStoredAccessToken(data.accessToken);
    }
    return data.accessToken || null;
  } catch {
    return null;
  }
}

export function useSocketIO() {
  const socketRef = useRef<SocketLike | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser[]>>(new Map());

  const user = useAppStore((s) => s.user);

  // Подписчики на real-time сообщения (регистрирует ChatWidget)
  const messageListenersRef = useRef<Set<MessageListener>>(new Set());
  const sentListenersRef = useRef<Set<SentListener>>(new Set());

  // Подключение — только если IS_ENABLED и пользователь залогинен
  useEffect(() => {
    if (!IS_ENABLED || !user) return;

    let socket: SocketLike | null = null;
    let disposed = false;

    (async () => {
      const accessToken =
        (typeof window !== "undefined"
          ? sessionStorage.getItem("cd_access_token")
          : null) || (await fetchSocketToken());
      if (disposed) return;

      // Dynamic import — если socket.io-client не установлен, fallback на stub.
      try {
        const { io } = await import("socket.io-client");
        if (disposed) return;

        socket = io(CHAT_SERVER_URL, {
          path: "/",
          auth: {
            token: accessToken,
            userName: user.name,
            userAvatar: user.avatar,
          },
          // polling-first: за gateway/прокси WebSocket-апгрейд не всегда
          // проходит с первого раза; engine.io стартует polling-хендшейком
          // (sid через HTTP) и поднимает websocket при возможности.
          transports: ["polling", "websocket"],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
        }) as unknown as SocketLike;

        socketRef.current = socket;

        socket.on("connect", () => {
          setIsConnected(true);
        });

        socket.on("disconnect", () => {
          setIsConnected(false);
        });

        socket.on("connect_error", (err: unknown) => {
          const msg = (err as Error).message || "";
          console.warn("[Socket.IO] Ошибка подключения:", msg);
          setIsConnected(false);
          if (msg === "auth: unauthorized" || msg === "auth: token required") {
            console.warn("[Socket.IO] Аутентификация отклонена.");
            socket?.disconnect();
          }
        });

        socket.on("message:receive", (data: unknown) => {
          const payload = data as { roomId: string; message: ChatMessage };
          if (payload?.roomId && payload?.message) {
            messageListenersRef.current.forEach((cb) => {
              try {
                cb(payload.roomId, payload.message);
              } catch (e) {
                console.error("[Socket.IO] message listener error:", e);
              }
            });
          }
        });

        socket.on("message:sent", (data: unknown) => {
          const payload = data as { roomId: string; messageId: string; status: string };
          if (payload?.roomId && payload?.messageId) {
            sentListenersRef.current.forEach((cb) => {
              try {
                cb(payload.roomId, payload.messageId);
              } catch (e) {
                console.error("[Socket.IO] sent listener error:", e);
              }
            });
          }
        });

        socket.on("user:online", (data: unknown) => {
          const { userId: uid } = data as { userId: string };
          setOnlineUsers((prev) => new Set(prev).add(uid));
        });

        socket.on("user:offline", (data: unknown) => {
          const { userId: uid } = data as { userId: string };
          setOnlineUsers((prev) => {
            const next = new Set(prev);
            next.delete(uid);
            return next;
          });
        });

        socket.on("typing:start", (data: unknown) => {
          const tu = data as TypingUser;
          setTypingUsers((prev) => {
            const next = new Map(prev);
            const arr = next.get(tu.roomId) || [];
            if (!arr.find((t) => t.userId === tu.userId)) {
              next.set(tu.roomId, [...arr, tu]);
            }
            return next;
          });
        });

        socket.on("typing:stop", (data: unknown) => {
          const { roomId, userId: uid } = data as { roomId: string; userId: string };
          setTypingUsers((prev) => {
            const next = new Map(prev);
            const arr = next.get(roomId) || [];
            next.set(roomId, arr.filter((t) => t.userId !== uid));
            return next;
          });
        });

        socket.on("order:notification", (data: unknown) => {
          const payload = data as { orderId: string; orderNumber: string; status: string; message: string };
          import("sonner").then(({ toast }) => {
            toast.success(`Заказ ${payload.orderNumber}`, {
              description: payload.message,
            });
          });
        });
      } catch (err) {
        if (!disposed) {
          console.warn(
            "[Socket.IO] socket.io-client не установлен — чат работает в stub-режиме.",
            err instanceof Error ? err.message : err
          );
        }
      }
    })();

    return () => {
      disposed = true;
      if (socket) {
        socket.disconnect();
      }
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [user]);

  // ===== Действия — все safe-call через optional chaining =====

  const joinRoom = useCallback((roomId: string) => {
    socketRef.current?.emit("room:join", roomId);
  }, []);

  const leaveRoom = useCallback((roomId: string) => {
    socketRef.current?.emit("room:leave", roomId);
  }, []);

  const sendMessage = useCallback(
    (roomId: string, message: Omit<ChatMessage, "roomId" | "timestamp" | "status">) => {
      const fullMessage: ChatMessage = {
        ...message,
        roomId,
        timestamp: new Date().toISOString(),
        status: "sending",
      };
      socketRef.current?.emit("message:send", { roomId, message: fullMessage });
      return fullMessage;
    },
    []
  );

  const sendQuickReplyAction = useCallback(
    (roomId: string, reply: { label: string; action: string; payload?: unknown }) => {
      socketRef.current?.emit("bot:quick_reply", { roomId, reply });
    },
    []
  );

  const startTyping = useCallback((roomId: string) => {
    socketRef.current?.emit("typing:start", { roomId });
  }, []);

  const stopTyping = useCallback((roomId: string) => {
    socketRef.current?.emit("typing:stop", { roomId });
  }, []);

  const markAsRead = useCallback((roomId: string, messageIds: string[]) => {
    socketRef.current?.emit("message:read", { roomId, messageIds });
  }, []);

  const reactToMessage = useCallback(
    (roomId: string, messageId: string, emoji: string, userName: string) => {
      socketRef.current?.emit("message:react", {
        roomId,
        messageId,
        emoji,
        userId: user?.id || "",
        userName,
      });
    },
    [user]
  );

  const sendOrderNotification = useCallback(
    (
      targetUserId: string,
      orderData: { orderId: string; orderNumber: string; status: string; message: string }
    ) => {
      socketRef.current?.emit("order:notify", { targetUserId, ...orderData });
    },
    []
  );

  const checkUserStatus = useCallback((userIds: string[]) => {
    socketRef.current?.emit("user:check_status", { userIds });
  }, []);

  const isUserOnline = useCallback(
    (userId: string) => {
      return onlineUsers.has(userId);
    },
    [onlineUsers]
  );

  /** Подписка на входящие real-time сообщения. Возвращает unsubscribe. */
  const onMessageReceive = useCallback((cb: MessageListener) => {
    messageListenersRef.current.add(cb);
    return () => {
      messageListenersRef.current.delete(cb);
    };
  }, []);

  /** Подписка на ack-подтверждения отправки. Возвращает unsubscribe. */
  const onMessageSent = useCallback((cb: SentListener) => {
    sentListenersRef.current.add(cb);
    return () => {
      sentListenersRef.current.delete(cb);
    };
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    isEnabled: IS_ENABLED,
    onlineUsers,
    typingUsers,
    joinRoom,
    leaveRoom,
    sendMessage,
    sendQuickReplyAction,
    startTyping,
    stopTyping,
    markAsRead,
    reactToMessage,
    sendOrderNotification,
    checkUserStatus,
    isUserOnline,
    onMessageReceive,
    onMessageSent,
  };
}
