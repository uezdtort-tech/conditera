/**
 * /api/chat/rooms — единый real-chat контракт на таблицах 0004
 * (chat_channels + chat_channel_members) + 0040 (chat_channels.order_id).
 *
 * GET  — комнаты текущего пользователя: membership-комнаты + (для staff)
 *        все support-комнаты. С последним сообщением и счётчиком непрочитанных.
 * POST — find-or-create комнаты (идемпотентно: существующая возвращается
 *        вместо дубликата):
 *          { type:'direct',  peerId }  — диалог покупатель↔кондитер
 *          { type:'support', ticketId? } — комната поддержки (мост к
 *            support_tickets: если у пользователя есть открытый тикет,
 *            support_ticket_id проставляется автоматически; staff-участник
 *            добавляется при создании).
 *          { type:'order', orderId } — чат заказа (type='group' + order_id).
 *
 * Auth: getUserFromRequest (Bearer + cookie, единый контракт).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLES = ["SUPPORT", "ADMIN", "SUPER_ADMIN"];
const SUPPORT_ROOM_NAME = "Поддержка Уездного";
/** Жёсткий потолок комнат в списке (защита от N+1 при сотнях комнат). */
const MAX_ROOMS = 50;

interface SupabaseError { message: string; code?: string }

interface ChannelRow {
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

interface MemberRow {
  id: string;
  channel_id: string;
  user_id: string;
  role: string | null;
  muted: boolean | null;
  last_read_at: string | null;
  joined_at: string | null;
  left_at: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  sender_id: string;
  text: string | null;
  is_bot: boolean | null;
  created_at: string;
}

interface ProfileRow { id: string; name: string | null; avatar_url: string | null }

/** Вид комнаты для UI (совместим с store ChatRoom). */
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

function mapChannelType(ch: ChannelRow): ApiChatRoom["type"] {
  if (ch.order_id) return "order";
  if (ch.type === "support") return "support";
  if (ch.type === "group") return "group";
  return "direct"; // direct и negotiation → direct
}

async function fetchChannelsByIds(ids: string[]): Promise<ChannelRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("chat_channels")
    .select("*")
    .in("id", ids)
    .is("deleted_at", null) as { data: ChannelRow[] | null; error: SupabaseError | null };
  if (error) throw new HttpError(500, `Не удалось загрузить комнаты: ${error.message}`);
  return data || [];
}

async function fetchMembers(channelIds: string[]): Promise<MemberRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("chat_channel_members")
    .select("*")
    .in("channel_id", channelIds) as { data: MemberRow[] | null; error: SupabaseError | null };
  if (error) throw new HttpError(500, `Не удалось загрузить участников: ${error.message}`);
  return data || [];
}

/** Последнее сообщение комнаты (простой per-room запрос, shim-совместимый). */
async function fetchLastMessage(channelId: string): Promise<MessageRow | null> {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("id, channel_id, sender_id, text, is_bot, created_at")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(1) as { data: MessageRow[] | null; error: SupabaseError | null };
  if (error) return null;
  return (data && data[0]) || null;
}

/** Непрочитанные: сообщения новее last_read_at и не от самого пользователя. */
async function fetchUnreadCount(
  channelId: string,
  userId: string,
  lastReadAt: string | null
): Promise<number> {
  let q = supabaseAdmin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .neq("sender_id", userId);
  if (lastReadAt) q = q.gt("created_at", lastReadAt);
  const { count, error } = await q as { count: number | null; error: SupabaseError | null };
  if (error) return 0;
  return count || 0;
}

/** Имена/аватарки участников (для direct-комнат). */
async function fetchProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", userIds) as { data: ProfileRow[] | null; error: SupabaseError | null };
  for (const p of data || []) map.set(p.id, p);
  if (error) console.warn("[chat/rooms] profiles fetch:", error.message);
  return map;
}

/** Собрать UI-комнаты из каналов + membership-карты. */
async function buildRooms(
  channels: ChannelRow[],
  memberByChannel: Map<string, MemberRow>,
  userId: string
): Promise<ApiChatRoom[]> {
  const memberRows = await fetchMembers(channels.map((c) => c.id));
  const allMemberUserIds = [...new Set(memberRows.map((m) => m.user_id))];
  const profiles = await fetchProfiles(allMemberUserIds);

  const rooms: ApiChatRoom[] = [];
  for (const ch of channels) {
    const myMember = memberByChannel.get(ch.id);
    const chMembers = memberRows.filter((m) => m.channel_id === ch.id && !m.left_at);
    let name = ch.name || "";
    let avatar: string | undefined;
    const participants = chMembers.map((m) => ({
      id: m.user_id,
      name: profiles.get(m.user_id)?.name || "Пользователь",
      avatar: profiles.get(m.user_id)?.avatar_url || undefined,
    }));

    if (mapChannelType(ch) === "direct") {
      const peer = chMembers.find((m) => m.user_id !== userId) || chMembers[0];
      const peerProfile = peer ? profiles.get(peer.user_id) : undefined;
      name = peerProfile?.name || name || "Диалог";
      avatar = peerProfile?.avatar_url || undefined;
    } else if (mapChannelType(ch) === "support") {
      name = name || SUPPORT_ROOM_NAME;
    } else if (mapChannelType(ch) === "order") {
      name = name || `Заказ ${(ch.order_id || "").slice(0, 8)}`;
    }

    const last = myMember ? await fetchLastMessage(ch.id) : null;
    const unread = myMember
      ? await fetchUnreadCount(ch.id, userId, myMember.last_read_at)
      : 0;

    rooms.push({
      id: ch.id,
      type: mapChannelType(ch),
      name: name || "Чат",
      avatar,
      participants,
      lastMessage: last?.text || ch.last_message_text || undefined,
      lastMessageAt: last?.created_at || ch.last_message_at || undefined,
      unreadCount: unread,
      orderId: ch.order_id || undefined,
      supportTicketId: ch.support_ticket_id || undefined,
      createdAt: ch.created_at,
    });
  }
  // Свежие сверху
  rooms.sort((a, b) =>
    (b.lastMessageAt || b.createdAt).localeCompare(a.lastMessageAt || a.createdAt)
  );
  return rooms;
}

async function myMembershipMap(userId: string): Promise<Map<string, MemberRow>> {
  const { data, error } = await supabaseAdmin
    .from("chat_channel_members")
    .select("*")
    .eq("user_id", userId) as { data: MemberRow[] | null; error: SupabaseError | null };
  if (error) throw new HttpError(500, `Не удалось загрузить membership: ${error.message}`);
  const map = new Map<string, MemberRow>();
  for (const m of data || []) {
    if (!m.left_at) map.set(m.channel_id, m);
  }
  return map;
}

// ===== GET — список комнат =====
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const isStaff = (user.roles || []).some((r) => STAFF_ROLES.includes(r));
    const memberByChannel = await myMembershipMap(user.id);

    let channels = await fetchChannelsByIds([...memberByChannel.keys()]);

    // Support-оператор видит все support-комнаты, даже где он не участник
    if (isStaff) {
      const { data: supportChannels, error } = await supabaseAdmin
        .from("chat_channels")
        .select("*")
        .eq("type", "support")
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(MAX_ROOMS) as { data: ChannelRow[] | null; error: SupabaseError | null };
      if (error) console.warn("[chat/rooms] staff support list:", error.message);
      const seen = new Set(channels.map((c) => c.id));
      for (const ch of supportChannels || []) {
        if (!seen.has(ch.id)) channels.push(ch);
      }
    }

    channels = channels.slice(0, MAX_ROOMS);
    const rooms = await buildRooms(channels, memberByChannel, user.id);
    return NextResponse.json({ rooms, total: rooms.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

// ===== POST — find-or-create =====
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<{
      type?: "direct" | "order" | "support";
      peerId?: string;
      orderId?: string;
      ticketId?: string;
    }>(request);
    if (parseErr) throw new HttpError(400, parseErr);
    const type = body?.type;
    if (type !== "direct" && type !== "order" && type !== "support") {
      throw new HttpError(400, "type должен быть direct | order | support");
    }

    const memberByChannel = await myMembershipMap(user.id);

    // ---- direct: покупатель ↔ кондитер (или любые два пользователя) ----
    if (type === "direct") {
      const peerId = body?.peerId || "";
      if (!UUID_RE.test(peerId)) throw new HttpError(400, "peerId должен быть UUID");
      if (peerId === user.id) throw new HttpError(400, "Нельзя создать диалог с самим собой");

      // Существующая direct-комната с обоими участниками
      const myChannels = [...memberByChannel.keys()];
      const { data: peerMembers } = await supabaseAdmin
        .from("chat_channel_members")
        .select("channel_id")
        .eq("user_id", peerId) as { data: { channel_id: string }[] | null };
      const peerChannelIds = new Set((peerMembers || []).map((m) => m.channel_id));
      const shared = myChannels.filter((id) => peerChannelIds.has(id));
      const existingChannels = await fetchChannelsByIds(shared);
      const existing = existingChannels.find((c) => c.type === "direct");
      if (existing) {
        const rooms = await buildRooms([existing], memberByChannel, user.id);
        return NextResponse.json({ room: rooms[0], created: false });
      }

      const { data: created, error } = await supabaseAdmin
        .from("chat_channels")
        .insert({ type: "direct" })
        .select("*")
        .single() as { data: ChannelRow | null; error: SupabaseError | null };
      if (error || !created) {
        console.error("[chat/rooms] create direct:", error?.message);
        throw new HttpError(500, "Не удалось создать диалог");
      }
      const { error: memberErr } = await supabaseAdmin
        .from("chat_channel_members")
        .insert([
          { channel_id: created.id, user_id: user.id, role: "member" },
          { channel_id: created.id, user_id: peerId, role: "member" },
        ]);
      if (memberErr) console.warn("[chat/rooms] members insert:", memberErr.message);

      const rooms = await buildRooms([created], memberByChannel, user.id);
      return NextResponse.json({ room: rooms[0], created: true });
    }

    // ---- support: комната поддержки (+ мост к support_tickets) ----
    if (type === "support") {
      // Мост: открытый тикет пользователя (если не передан явно)
      let ticketId = body?.ticketId || null;
      if (!ticketId) {
        const { data: tickets } = await supabaseAdmin
          .from("support_tickets")
          .select("id")
          .eq("user_id", user.id)
          .in("status", ["open", "in_progress", "new", "pending"])
          .order("created_at", { ascending: false })
          .limit(1) as { data: { id: string }[] | null };
        ticketId = (tickets && tickets[0]?.id) || null;
      }

      // Существующая support-комната пользователя
      const myChannels = [...memberByChannel.keys()];
      const existingChannels = await fetchChannelsByIds(myChannels);
      const candidates = existingChannels.filter((c) => c.type === "support");
      const existing =
        (ticketId && candidates.find((c) => c.support_ticket_id === ticketId)) ||
        candidates[0];
      if (existing) {
        const rooms = await buildRooms([existing], memberByChannel, user.id);
        return NextResponse.json({ room: rooms[0], created: false });
      }

      const { data: created, error } = await supabaseAdmin
        .from("chat_channels")
        .insert({
          type: "support",
          name: SUPPORT_ROOM_NAME,
          support_ticket_id: ticketId,
        })
        .select("*")
        .single() as { data: ChannelRow | null; error: SupabaseError | null };
      if (error || !created) {
        console.error("[chat/rooms] create support:", error?.message);
        throw new HttpError(500, "Не удалось создать комнату поддержки");
      }

      // Участники: автор + первый staff (SUPPORT/ADMIN)
      const memberRows: Record<string, unknown>[] = [
        { channel_id: created.id, user_id: user.id, role: "member" },
      ];
      const { data: staff } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", STAFF_ROLES)
        .limit(1) as { data: { user_id: string }[] | null };
      const staffId = (staff && staff[0]?.user_id) || null;
      if (staffId && staffId !== user.id) {
        memberRows.push({ channel_id: created.id, user_id: staffId, role: "admin" });
      }
      const { error: memberErr } = await supabaseAdmin
        .from("chat_channel_members")
        .insert(memberRows);
      if (memberErr) console.warn("[chat/rooms] support members:", memberErr.message);

      const rooms = await buildRooms([created], memberByChannel, user.id);
      return NextResponse.json({ room: rooms[0], created: true });
    }

    // ---- order: чат заказа ----
    const orderId = body?.orderId || "";
    if (!orderId) throw new HttpError(400, "orderId обязателен");

    // find-or-create по order_id
    const { data: found } = await supabaseAdmin
      .from("chat_channels")
      .select("*")
      .eq("order_id", orderId)
      .is("deleted_at", null)
      .limit(1) as { data: ChannelRow[] | null };
    let channel = (found || [])[0];
    let created = false;
    if (!channel) {
      const { data: createdRow, error } = await supabaseAdmin
        .from("chat_channels")
        .insert({
          type: "group",
          name: `Заказ ${orderId.slice(0, 8)}`,
          order_id: orderId,
        })
        .select("*")
        .single() as { data: ChannelRow | null; error: SupabaseError | null };
      if (error || !createdRow) {
        console.error("[chat/rooms] create order:", error?.message);
        throw new HttpError(500, "Не удалось создать чат заказа");
      }
      channel = createdRow;
      created = true;
    }

    // Гарантируем membership текущего пользователя
    if (!memberByChannel.has(channel.id)) {
      const { error: memberErr } = await supabaseAdmin
        .from("chat_channel_members")
        .insert({ channel_id: channel.id, user_id: user.id, role: "member" });
      if (memberErr) console.warn("[chat/rooms] order member:", memberErr.message);
    }

    const freshMembers = await myMembershipMap(user.id);
    const rooms = await buildRooms([channel], freshMembers, user.id);
    return NextResponse.json({ room: rooms[0], created });
  } catch (error) {
    return handleRouteError(error);
  }
}
