/**
 * Общие хелперы чат-роутов /api/chat/* — единый контракт на таблицах 0004
 * (chat_channels / chat_channel_members / chat_messages.text) + 0040
 * (is_bot / idempotency_key / chat_channels.order_id).
 *
 * Схема (проверено по миграциям):
 *   chat_messages: channel_id, sender_id, TEXT `text` (НЕ content/message),
 *   is_bot/bot_kind/quick_replies/idempotency_key — из 0040.
 *   chat_channel_members: UNIQUE(channel_id, user_id), last_read_at.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuthenticatedUser } from "@/lib/auth";

export interface SupabaseError { message: string; code?: string }

export interface ChannelRow {
  id: string;
  type: string; // 'direct' | 'group' | 'support' | 'negotiation'
  name: string | null;
  support_ticket_id: string | null;
  order_id: string | null;
  last_message_at: string | null;
  last_message_text: string | null;
  messages_count: number | null;
  created_at: string;
  deleted_at: string | null;
}

export interface MemberRow {
  id: string;
  channel_id: string;
  user_id: string;
  role: string | null;
  muted: boolean | null;
  last_read_at: string | null;
  joined_at: string | null;
  left_at: string | null;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  sender_id: string;
  text: string | null;
  attachments: unknown;
  is_bot: boolean | null;
  bot_kind: string | null;
  quick_replies: unknown;
  is_deleted: boolean | null;
  created_at: string;
}

export const STAFF_ROLES = ["SUPPORT", "ADMIN", "SUPER_ADMIN"];

/**
 * Системный пользователь FAQ-бота (seed 0004_seed_bot_user.sql, фиксированный
 * UUID). Все bot-сообщения персистятся от его имени (is_bot=true).
 */
export const BOT_USER_ID = "aaaaaaaa-0000-4000-8000-000000000b07";

/** Тип комнаты для ответа bot-message роута (как в messages/route.ts). */
export function mapChannelTypeForBot(ch: { order_id: string | null; type: string }): string {
  if (ch.order_id) return "order";
  if (ch.type === "support") return "support";
  if (ch.type === "group") return "group";
  return "direct";
}

export function isStaffUser(user: AuthenticatedUser): boolean {
  return (user.roles || []).some((r) => STAFF_ROLES.includes(r));
}

export async function fetchChannel(channelId: string): Promise<ChannelRow | null> {
  const { data, error } = await supabaseAdmin
    .from("chat_channels")
    .select("*")
    .eq("id", channelId)
    .limit(1) as { data: ChannelRow[] | null; error: SupabaseError | null };
  if (error) {
    console.warn("[chat] channel fetch:", error.message);
    return null;
  }
  return (data && data[0]) || null;
}

export async function fetchMyMember(
  channelId: string,
  userId: string
): Promise<MemberRow | null> {
  const { data, error } = await supabaseAdmin
    .from("chat_channel_members")
    .select("*")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .limit(1) as { data: MemberRow[] | null; error: SupabaseError | null };
  if (error) return null;
  const row = (data || [])[0];
  return row && !row.left_at ? row : null;
}

/**
 * Доступ к комнате: активный membership ИЛИ staff для support-комнат
 * (оператор подключается к любой support-комнате без membership).
 */
export async function canAccessRoom(
  channel: ChannelRow,
  user: AuthenticatedUser
): Promise<boolean> {
  const member = await fetchMyMember(channel.id, user.id);
  if (member) return true;
  if (isStaffUser(user) && channel.type === "support") return true;
  return false;
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

/** Сообщения + имена отправителей (профили догружаются вручную — shim-безопасно). */
export async function fetchRoomMessages(
  channelId: string,
  opts: { limit: number; before?: string | null }
): Promise<ApiChatMessage[]> {
  let q = supabaseAdmin
    .from("chat_messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true })
    .limit(opts.limit);
  if (opts.before) q = q.lt("created_at", opts.before);

  const { data, error } = await q as { data: MessageRow[] | null; error: SupabaseError | null };
  if (error) {
    console.warn("[chat] messages fetch:", error.message);
    return [];
  }
  const rows = (data || []).filter((m) => !m.is_deleted);

  const senderIds = [...new Set(rows.map((m) => m.sender_id))];
  const profiles = new Map<string, { name: string | null; avatar_url: string | null }>();
  if (senderIds.length > 0) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", senderIds) as {
      data: { id: string; name: string | null; avatar_url: string | null }[] | null;
      error: SupabaseError | null;
    };
    for (const p of profs || []) profiles.set(p.id, p);
  }

  return rows.map((m) => ({
    id: m.id,
    roomId: m.channel_id,
    text: m.text || "",
    senderId: m.sender_id,
    senderName:
      (m.sender_id === "bot" && "Уездный помощник") ||
      profiles.get(m.sender_id)?.name ||
      "Пользователь",
    senderAvatar: profiles.get(m.sender_id)?.avatar_url || undefined,
    createdAt: m.created_at,
    isBot: m.is_bot === true || m.sender_id === "bot",
    botKind: m.bot_kind || undefined,
    quickReplies: Array.isArray(m.quick_replies)
      ? (m.quick_replies as ApiChatMessage["quickReplies"])
      : undefined,
  }));
}
