/**
 * use-chat.ts — TanStack Query + Supabase Realtime hooks для чата.
 *
 * Query hooks:
 *   - useChatChannels() — список каналов пользователя
 *   - useChatMessages(channelId) — сообщения в канале (с realtime обновлением)
 *   - useUnreadCounts() — количество непрочитанных по каналам
 *
 * Mutation hooks:
 *   - useCreateDirectChannel(otherUserId) — создать direct-канал
 *   - useCreateGroupChannel(name, memberIds) — создать group-канал
 *   - useSendMessage(channelId, text, attachments) — отправить сообщение
 *   - useMarkAsRead(channelId) — отметить как прочитанное
 *   - useSetTyping(channelId) — typing indicator
 *
 * Realtime:
 *   - postgres_changes на INSERT chat_messages → мгновенное обновление
 *   - presence для online/offline статуса
 *   - broadcast для typing indicator
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ==================== Types ====================
export interface ChatChannel {
  id: string;
  type: "direct" | "group" | "support" | "negotiation";
  name: string | null;
  negotiation_id: string | null;
  support_ticket_id: string | null;
  last_message_at: string | null;
  last_message_text: string | null;
  messages_count: number;
  created_at: string;
  // Joined
  members?: ChatChannelMember[];
  last_message_sender?: { id: string; name: string | null };
}

export interface ChatChannelMember {
  id: string;
  channel_id: string;
  user_id: string;
  role: string;
  muted: boolean;
  last_read_at: string | null;
  joined_at: string;
  // Joined
  user?: { id: string; name: string | null; avatar_url: string | null };
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  text: string | null;
  attachments: unknown[] | null;
  reply_to_id: string | null;
  is_edited: boolean;
  edited_at: string | null;
  is_deleted: boolean;
  is_system: boolean;
  system_event: string | null;
  created_at: string;
  // Joined
  sender?: { id: string; name: string | null; avatar_url: string | null };
  reply_to?: ChatMessage | null;
  reads?: Array<{ user_id: string; read_at: string }>;
}

// ==================== Query hooks ====================

/** Список каналов пользователя */
export function useChatChannels() {
  return useQuery<ChatChannel[]>({
    queryKey: ["chat-channels"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];

      // Сначала найдем channels где user — member
      const { data: memberships, error: mErr } = await supabaseBrowser
        .from("chat_channel_members")
        .select("channel_id")
        .eq("user_id", user.id)
        .is("left_at", null);

      if (mErr) throw new Error(mErr.message);

      const channelIds = (memberships || []).map((m) => m.channel_id);
      if (channelIds.length === 0) return [];

      const { data, error } = await supabaseBrowser
        .from("chat_channels")
        .select(`
          *,
          members:chat_channel_members(
            *,
            user:auth.users!chat_channel_members_user_id_fkey(id)
          )
        `)
        .in("id", channelIds)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) throw new Error(error.message);
      return (data || []) as unknown as ChatChannel[];
    },
    staleTime: 30 * 1000,
  });
}

/** Сообщения канала с Realtime подпиской */
export function useChatMessages(channelId: string | null) {
  const queryClient = useQueryClient();

  // Realtime подписка на новые сообщения
  React.useEffect(() => {
    if (!channelId) return;

    const channel = supabaseBrowser
      .channel(`chat-messages-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          // Инвалидируем кэш → useQuery перезагрузит данные
          queryClient.invalidateQueries({
            queryKey: ["chat-messages", channelId],
          });
          // Также обновим список каналов (последнее сообщение)
          queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["chat-messages", channelId],
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["chat-messages", channelId],
          });
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [channelId, queryClient]);

  return useQuery<ChatMessage[]>({
    queryKey: ["chat-messages", channelId],
    queryFn: async () => {
      if (!channelId) return [];

      const { data, error } = await supabaseBrowser
        .from("chat_messages")
        .select(`
          *,
          reads:chat_message_reads(user_id, read_at)
        `)
        .eq("channel_id", channelId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw new Error(error.message);
      return (data || []) as unknown as ChatMessage[];
    },
    enabled: Boolean(channelId),
    staleTime: 0, // всегда обновляем при invalidate
  });
}

/** Unread count по каналам */
export function useUnreadCounts() {
  return useQuery<Record<string, number>>({
    queryKey: ["unread-counts"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return {};

      // Найти memberships пользователя
      const { data: memberships, error } = await supabaseBrowser
        .from("chat_channel_members")
        .select("channel_id, last_read_at")
        .eq("user_id", user.id)
        .is("left_at", null);

      if (error || !memberships) return {};

      const counts: Record<string, number> = {};

      // Для каждого канала — посчитать непрочитанные
      await Promise.all(
        memberships.map(async (m: { channel_id: string; last_read_at: string | null }) => {
          let query = supabaseBrowser
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("channel_id", m.channel_id)
            .neq("sender_id", user.id)
            .eq("is_deleted", false);

          if (m.last_read_at) {
            query = query.gt("created_at", m.last_read_at);
          }

          const { count } = await query;
          if (count && count > 0) {
            counts[m.channel_id] = count;
          }
        })
      );

      return counts;
    },
    staleTime: 30 * 1000,
  });
}

// ==================== Mutation hooks ====================

/** Создать direct-канал (между двумя пользователями) */
export function useCreateDirectChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (otherUserId: string) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      // Проверяем, есть ли уже direct channel между ними
      const { data: existingMemberships } = await supabaseBrowser
        .from("chat_channel_members")
        .select("channel_id, user_id")
        .in("user_id", [user.id, otherUserId])
        .is("left_at", null);

      if (existingMemberships && existingMemberships.length >= 2) {
        // Найти пересечение — общий channel_id
        const myChannels = existingMemberships
          .filter((m) => m.user_id === user.id)
          .map((m) => m.channel_id);
        const theirChannels = existingMemberships
          .filter((m) => m.user_id === otherUserId)
          .map((m) => m.channel_id);
        const common = myChannels.find((c) => theirChannels.includes(c));
        if (common) {
          // Возвращаем существующий
          const { data: existing } = await supabaseBrowser
            .from("chat_channels")
            .select("*")
            .eq("id", common)
            .single();
          if (existing) return existing;
        }
      }

      // Создаём новый
      const { data: channel, error: channelError } = await supabaseBrowser
        .from("chat_channels")
        .insert({ type: "direct" })
        .select()
        .single();

      if (channelError || !channel) throw new Error(channelError?.message);

      // Добавляем обоих участников
      const { error: membersError } = await supabaseBrowser
        .from("chat_channel_members")
        .insert([
          { channel_id: channel.id, user_id: user.id, role: "member" },
          { channel_id: channel.id, user_id: otherUserId, role: "member" },
        ]);

      if (membersError) throw new Error(membersError.message);

      // Системное сообщение
      await supabaseBrowser.from("chat_messages").insert({
        channel_id: channel.id,
        sender_id: user.id,
        text: "Канал создан",
        is_system: true,
        system_event: "channel_created",
      });

      return channel;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
    },
    onError: (error: Error) => {
      toast.error("Ошибка создания канала", { description: error.message });
    },
  });
}

/** Создать group-канал */
export function useCreateGroupChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      memberIds,
    }: {
      name: string;
      memberIds: string[];
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data: channel, error } = await supabaseBrowser
        .from("chat_channels")
        .insert({ type: "group", name })
        .select()
        .single();

      if (error) throw new Error(error.message);

      // Добавляем всех участников (включая создателя как admin)
      const members = [
        { channel_id: channel.id, user_id: user.id, role: "admin" },
        ...memberIds.filter((id) => id !== user.id).map((id) => ({
          channel_id: channel.id,
          user_id: id,
          role: "member" as const,
        })),
      ];

      const { error: mErr } = await supabaseBrowser
        .from("chat_channel_members")
        .insert(members);

      if (mErr) throw new Error(mErr.message);

      return channel;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      toast.success("Групповой канал создан");
    },
    onError: (error: Error) => {
      toast.error("Ошибка создания группы", { description: error.message });
    },
  });
}

/** Отправить сообщение */
export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      channelId,
      text,
      attachments,
      replyToId,
    }: {
      channelId: string;
      text: string;
      attachments?: unknown[];
      replyToId?: string;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("chat_messages")
        .insert({
          channel_id: channelId,
          sender_id: user.id,
          text,
          attachments,
          reply_to_id: replyToId,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onError: (error: Error) => {
      toast.error("Ошибка отправки сообщения", { description: error.message });
    },
    // onSuccess не нужен — realtime уведомит через postgres_changes
  });
}

/** Отметить канал как прочитанный (update last_read_at) */
export function useMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { error } = await supabaseBrowser
        .from("chat_channel_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("channel_id", channelId)
        .eq("user_id", user.id);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unread-counts"] });
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
    },
  });
}

// ==================== Realtime: Typing indicator + Presence ====================

/** Hook для typing indicator (broadcast events) */
export function useTypingIndicator(channelId: string | null) {
  const [typingUsers, setTypingUsers] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!channelId) return;

    const channel = supabaseBrowser
      .channel(`typing-${channelId}`)
      .on("broadcast", { event: "typing" }, (payload: { payload?: { userId?: string; name?: string } }) => {
        const userId = payload.payload?.userId;
        if (userId) {
          setTypingUsers((prev) => new Set(prev).add(userId));
          // Убираем через 3 секунды
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Set(prev);
              next.delete(userId);
              return next;
            });
          }, 3000);
        }
      })
      .on("broadcast", { event: "stop_typing" }, (payload: { payload?: { userId?: string } }) => {
        const userId = payload.payload?.userId;
        if (userId) {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
        }
      })
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [channelId]);

  const sendTyping = React.useCallback(async () => {
    if (!channelId) return;
    const channel = supabaseBrowser.channel(`typing-${channelId}`);
    await channel.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: "current", timestamp: Date.now() },
    });
  }, [channelId]);

  const sendStopTyping = React.useCallback(async () => {
    if (!channelId) return;
    const channel = supabaseBrowser.channel(`typing-${channelId}`);
    await channel.send({
      type: "broadcast",
      event: "stop_typing",
      payload: { userId: "current" },
    });
  }, [channelId]);

  return { typingUsers, sendTyping, sendStopTyping };
}

/** Hook для online/offline статуса пользователей в канале (presence) */
export function useChannelPresence(channelId: string | null) {
  const [onlineUsers, setOnlineUsers] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!channelId) return;

    const { data: { user } } = { data: { user: null } }; // stub for now
    // TODO: загрузить user из auth

    const channel = supabaseBrowser
      .channel(`presence-${channelId}`)
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const userIds = new Set<string>();
        Object.values(state).forEach((presences: unknown) => {
          if (Array.isArray(presences)) {
            presences.forEach((p: unknown) => {
              const userId = (p as { user_id?: string }).user_id;
              if (userId) userIds.add(userId);
            });
          }
        });
        setOnlineUsers(userIds);
      })
      .on("presence", { event: "join" }, ({ key }: { key?: string }) => {
        if (key) setOnlineUsers((prev) => new Set(prev).add(key));
      })
      .on("presence", { event: "leave" }, ({ key }: { key?: string }) => {
        if (key) {
          setOnlineUsers((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      });

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [channelId]);

  return onlineUsers;
}
