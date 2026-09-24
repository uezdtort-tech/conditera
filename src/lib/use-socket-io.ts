/**
 * use-socket-io.ts — Socket.IO hook для real-time чата.
 *
 * ВАЖНО: socket.io-client — ОПЦИОНАЛЬНАЯ зависимость.
 * Если пакет не установлен (npm ls socket.io-client пуст), хук работает
 * в stub-режиме: все функции no-op, isConnected всегда false.
 *
 * Это позволяет использовать хук в окружениях без чат-сервера
 * (например, в CI, при unit-тестах, в preview-режиме).
 *
 * Чтобы включить real-time чат:
 *   npm install socket.io-client
 *   NEXT_PUBLIC_CHAT_URL=http://localhost:3030
 *
 * URL чат-сервера (порт 3030) — задаётся через env, по умолчанию
 * подключение не происходит (stub-режим).
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAppStore } from "@/lib/store";

// URL чат-сервера. Если не задан — работаем в stub-режиме.
const CHAT_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_URL || "";
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
}

export interface TypingUser {
  roomId: string;
  userId: string;
  name: string;
}

export function useSocketIO() {
  const socketRef = useRef<SocketLike | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser[]>>(new Map());

  const user = useAppStore((s) => s.user);

  // Подключение — только если IS_ENABLED и пользователь залогинен
  useEffect(() => {
    if (!IS_ENABLED || !user) return;

    let socket: SocketLike | null = null;
    let disposed = false;

    // Dynamic import — если socket.io-client не установлен, fallback на stub.
    import("socket.io-client")
      .then(({ io }) => {
        if (disposed) return;

        const accessToken =
          (typeof window !== "undefined" &&
            localStorage.getItem("accessToken")) ||
          (user as { accessToken?: string }).accessToken ||
          null;

        socket = io(CHAT_SERVER_URL, {
          auth: {
            token: accessToken,
            userName: user.name,
            userAvatar: user.avatar,
          },
          transports: ["websocket"],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
        }) as unknown as SocketLike;

        socketRef.current = socket;

        socket.on("connect", () => {
          console.log("[Socket.IO] Подключено к чат-серверу");
          setIsConnected(true);
        });

        socket.on("disconnect", () => {
          console.log("[Socket.IO] Отключено");
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
          // Hook — компоненты могут подписаться через store
          if (!useAppStore.getState().chatOpen && payload?.message) {
            // Здесь можно показать toast уведомление
          }
        });

        socket.on("user:online", (data: unknown) => {
          const { userId } = data as { userId: string };
          setOnlineUsers((prev) => new Set(prev).add(userId));
        });

        socket.on("user:offline", (data: unknown) => {
          const { userId } = data as { userId: string };
          setOnlineUsers((prev) => {
            const next = new Set(prev);
            next.delete(userId);
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
          const { roomId, userId } = data as { roomId: string; userId: string };
          setTypingUsers((prev) => {
            const next = new Map(prev);
            const arr = next.get(roomId) || [];
            next.set(roomId, arr.filter((t) => t.userId !== userId));
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
      })
      .catch((err) => {
        if (!disposed) {
          console.warn(
            "[Socket.IO] socket.io-client не установлен — чат работает в stub-режиме.",
            err instanceof Error ? err.message : err
          );
        }
      });

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

  return {
    socket: socketRef.current,
    isConnected,
    isEnabled: IS_ENABLED,
    onlineUsers,
    typingUsers,
    joinRoom,
    leaveRoom,
    sendMessage,
    startTyping,
    stopTyping,
    markAsRead,
    reactToMessage,
    sendOrderNotification,
    checkUserStatus,
    isUserOnline,
  };
}
