/**
 * useChat — React hook for Socket.IO chat connection.
 *
 * Connects to the existing chat server (mini-services/chat-server on port 3030).
 * Protocol matches the web app's use-socket-io.ts:
 *   - handshake auth: { userId, userName, userAvatar }
 *   - room:join / room:leave
 *   - message:send / message:receive
 *   - typing:start / typing:stop
 *   - message:read
 *   - user:online / disconnect
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import Constants from "expo-constants";

const CHAT_URL =
  (Constants.expoConfig?.extra as { chatUrl?: string } | undefined)?.chatUrl ||
  "http://localhost:3030";

export interface ChatMessage {
  id: string;
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

export interface ChatRoom {
  id: string;
  name: string;
  avatar?: string;
  type: "direct" | "group" | "support" | "order";
  lastMessage?: ChatMessage;
  unreadCount: number;
  online: boolean;
}

interface UseChatOptions {
  userId: string | null;
  userName: string;
  userAvatar?: string;
  enabled?: boolean;
}

interface UseChatReturn {
  socket: Socket | null;
  isConnected: boolean;
  rooms: ChatRoom[];
  messages: Record<string, ChatMessage[]>;
  typingUsers: Record<string, string[]>;
  onlineUsers: string[];
  error: string | null;
  joinRoom: (roomId: string) => void;
  leaveRoom: (roomId: string) => void;
  sendMessage: (roomId: string, text: string, replyTo?: string) => void;
  startTyping: (roomId: string) => void;
  stopTyping: (roomId: string) => void;
  markAsRead: (roomId: string, messageIds: string[]) => void;
  reactToMessage: (roomId: string, messageId: string, emoji: string) => void;
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { userId, userName, userAvatar, enabled = true } = options;
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  useEffect(() => {
    if (!userId || !enabled) return;

    const socket = io(CHAT_URL, {
      auth: { userId, userName, userAvatar },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setError(null);
      console.log("[chat] connected");
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      console.log("[chat] disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      setError(err.message);
      setIsConnected(false);
      console.warn("[chat] connect error:", err.message);
    });

    socket.on("message:receive", (data: { roomId: string; message: ChatMessage }) => {
      setMessages((prev) => ({
        ...prev,
        [data.roomId]: [...(prev[data.roomId] || []), data.message],
      }));
      setRooms((prev) =>
        prev.map((r) =>
          r.id === data.roomId
            ? { ...r, lastMessage: data.message, unreadCount: r.unreadCount + 1 }
            : r
        )
      );
    });

    socket.on("message:sent", (data: { roomId: string; messageId: string; status: string }) => {
      setMessages((prev) => ({
        ...prev,
        [data.roomId]: (prev[data.roomId] || []).map((m) =>
          m.id === data.messageId ? { ...m, status: data.status as ChatMessage["status"] } : m
        ),
      }));
    });

    socket.on("typing:start", (data: { roomId: string; userId: string; name: string }) => {
      setTypingUsers((prev) => ({
        ...prev,
        [data.roomId]: Array.from(new Set([...(prev[data.roomId] || []), data.name])),
      }));
    });

    socket.on("typing:stop", (data: { roomId: string; userId: string }) => {
      setTypingUsers((prev) => {
        const current = prev[data.roomId] || [];
        return { ...prev, [data.roomId]: current.filter((n) => n !== data.userId) };
      });
    });

    socket.on("message:read", (data: { roomId: string; messageIds: string[]; readAt: string }) => {
      setMessages((prev) => ({
        ...prev,
        [data.roomId]: (prev[data.roomId] || []).map((m) =>
          data.messageIds.includes(m.id) ? { ...m, status: "read" } : m
        ),
      }));
    });

    socket.on("message:react", (data: { roomId: string; messageId: string; emoji: string }) => {
      console.log("[chat] reaction:", data);
    });

    socket.on("user:online", (data: { userId: string; name: string }) => {
      setOnlineUsers((prev) => Array.from(new Set([...prev, data.userId])));
    });

    socket.on("user:offline", (data: { userId: string }) => {
      setOnlineUsers((prev) => prev.filter((id) => id !== data.userId));
    });

    socket.on("room:online_users", (data: { roomId: string; users: string[] }) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === data.roomId ? { ...r, online: data.users.length > 0 } : r
        )
      );
    });

    socket.on("room:user_joined", (data: { userId: string; name: string }) => {
      console.log(`[chat] ${data.name} joined room`);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId, userName, userAvatar, enabled]);

  const joinRoom = useCallback((roomId: string) => {
    socketRef.current?.emit("room:join", roomId);
  }, []);

  const leaveRoom = useCallback((roomId: string) => {
    socketRef.current?.emit("room:leave", roomId);
  }, []);

  const sendMessage = useCallback(
    (roomId: string, text: string, replyTo?: string) => {
      const socket = socketRef.current;
      if (!socket || !userId) return;

      const messageId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const message: ChatMessage = {
        id: messageId,
        text,
        senderId: userId,
        senderName: userName,
        senderAvatar: userAvatar,
        type: "text",
        replyTo,
        timestamp: new Date().toISOString(),
        status: "sending",
      };

      setMessages((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), message],
      }));

      socket.emit("message:send", {
        roomId,
        message: {
          id: message.id,
          text: message.text,
          senderId: message.senderId,
          senderName: message.senderName,
          senderAvatar: message.senderAvatar,
          type: message.type,
          replyTo: message.replyTo,
        },
      });

      setTimeout(() => {
        setMessages((prev) => ({
          ...prev,
          [roomId]: (prev[roomId] || []).map((m) =>
            m.id === messageId && m.status === "sending" ? { ...m, status: "sent" } : m
          ),
        }));
      }, 1500);
    },
    [userId, userName, userAvatar]
  );

  const startTyping = useCallback((roomId: string) => {
    socketRef.current?.emit("typing:start", { roomId });
  }, []);

  const stopTyping = useCallback((roomId: string) => {
    socketRef.current?.emit("typing:stop", { roomId });
  }, []);

  const markAsRead = useCallback((roomId: string, messageIds: string[]) => {
    socketRef.current?.emit("message:read", { roomId, messageIds });
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r))
    );
  }, []);

  const reactToMessage = useCallback(
    (roomId: string, messageId: string, emoji: string) => {
      socketRef.current?.emit("message:react", {
        roomId,
        messageId,
        emoji,
        userId,
        userName,
      });
    },
    [userId, userName]
  );

  return {
    socket: socketRef.current,
    isConnected,
    rooms,
    messages,
    typingUsers,
    onlineUsers,
    error,
    joinRoom,
    leaveRoom,
    sendMessage,
    startTyping,
    stopTyping,
    markAsRead,
    reactToMessage,
  };
}
