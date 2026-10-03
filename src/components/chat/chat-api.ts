"use client";

/**
 * chat-api.ts — клиент реального чата для ChatWidget (единый контракт
 * на таблицах 0004/0040 через /api/chat/*).
 *
 *   GET  /api/chat/rooms                — список комнат + unread
 *   POST /api/chat/rooms                — find-or-create (direct/support/order)
 *   GET  /api/chat/rooms/:id/messages   — история (created_at ASC)
 *   POST /api/chat/rooms/:id/messages   — отправка (идемпотентно по uuid)
 *   POST /api/chat/rooms/:id/read       — отметить прочитанным
 *
 * Bearer — из sessionStorage (cd_access_token, единый auth-контракт),
 * мутации — с x-csrf-token (double-submit cookie). CSRF-токен кешируется
 * в модуле на 10 минут.
 */

import { getCsrfToken, getStoredAccessToken } from "@/lib/api-client";
import type { ChatMessage, ChatRoom } from "@/lib/types";

// ===== Типы ответов API (зеркала серверных) =====

export interface ApiChatRoom {
  id: string;
  type: "direct" | "group" | "support" | "order";
  name: string;
  avatar?: string;
  participants: { id: string; name: string; avatar?: string }[];
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  orderId?: string;
  supportTicketId?: string;
  createdAt: string;
}

export interface ApiChatMessage {
  id: string;
  roomId: string;
  text: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  createdAt: string;
  isBot: boolean;
  botKind?: string;
  quickReplies?: { label: string; action: string; payload?: unknown }[];
}

// ===== CSRF-кеш =====

let csrfCache: { token: string; ts: number } | null = null;
const CSRF_TTL_MS = 10 * 60 * 1000;

async function csrf(): Promise<string> {
  if (csrfCache && Date.now() - csrfCache.ts < CSRF_TTL_MS) return csrfCache.token;
  const token = await getCsrfToken();
  if (token) csrfCache = { token, ts: Date.now() };
  return token;
}

function authHeaders(): Record<string, string> {
  const token = getStoredAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function mutationHeaders(): Promise<Record<string, string>> {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
    "x-csrf-token": await csrf(),
  };
}

// ===== API =====

export async function fetchChatRooms(): Promise<ApiChatRoom[] | null> {
  try {
    const res = await fetch("/api/chat/rooms", { headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { rooms?: ApiChatRoom[] };
    return data.rooms ?? [];
  } catch {
    return null;
  }
}

export async function ensureChatRoom(payload: {
  type: "direct" | "support" | "order";
  peerId?: string;
  orderId?: string;
  ticketId?: string;
}): Promise<ApiChatRoom | null> {
  try {
    const res = await fetch("/api/chat/rooms", {
      method: "POST",
      headers: await mutationHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { room?: ApiChatRoom };
    return data.room || null;
  } catch {
    return null;
  }
}

export async function fetchChatMessages(
  roomId: string,
  before?: string
): Promise<ApiChatMessage[] | null> {
  try {
    const qs = before ? `?before=${encodeURIComponent(before)}` : "";
    const res = await fetch(`/api/chat/rooms/${roomId}/messages${qs}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { messages?: ApiChatMessage[] };
    return data.messages ?? [];
  } catch {
    return null;
  }
}

/**
 * Отправка сообщения (идемпотентно): idempotencyKey — клиентский uuid.
 * При 200 возвращается сообщение (на повтор с тем же ключом — та же строка).
 */
export async function sendChatMessage(
  roomId: string,
  content: string,
  idempotencyKey: string
): Promise<ApiChatMessage | null> {
  try {
    const res = await fetch(`/api/chat/rooms/${roomId}/messages`, {
      method: "POST",
      headers: {
        ...(await mutationHeaders()),
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ content, idempotencyKey }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: ApiChatMessage };
    return data.message || null;
  } catch {
    return null;
  }
}

export async function markChatRoomRead(roomId: string): Promise<void> {
  try {
    await fetch(`/api/chat/rooms/${roomId}/read`, {
      method: "POST",
      headers: await mutationHeaders(),
      body: JSON.stringify({}),
    });
  } catch {
    // не критично: unread пересчитается при следующем открытии
  }
}

// ===== Маппинг в store-контракт =====

export function mapApiRoomToChatRoom(room: ApiChatRoom): ChatRoom {
  return {
    id: room.id,
    type: room.type,
    name: room.name,
    avatar: room.avatar,
    participants: room.participants,
    lastMessage: room.lastMessage,
    lastMessageAt: room.lastMessageAt,
    unreadCount: room.unreadCount || 0,
    orderId: room.orderId,
  };
}

export function mapApiMessageToChatMessage(
  msg: ApiChatMessage,
  currentUserId?: string
): ChatMessage {
  return {
    id: msg.id,
    roomId: msg.roomId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    senderAvatar: msg.senderAvatar,
    text: msg.text,
    createdAt: msg.createdAt,
    isOwn: currentUserId ? msg.senderId === currentUserId : false,
    isBot: msg.isBot,
    botKind: msg.botKind as ChatMessage["botKind"],
    quickReplies: msg.quickReplies as ChatMessage["quickReplies"],
  };
}
