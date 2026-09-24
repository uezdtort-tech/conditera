/**
 * use-crm.ts — TanStack Query hooks для CRM (тикеты, лиды, клиенты).
 *
 * Query hooks:
 *   - useSupportTickets(filter) — список тикетов (own/assigned/all)
 *   - useSupportTicket(id) — детали тикета
 *   - useTicketMessages(ticketId) — сообщения (с realtime)
 *   - useLeads(filter) — лиды в Kanban
 *   - useLead(id) — детали лида
 *   - useLeadActivities(leadId) — активности по лиду
 *   - useCustomerTimeline(userId) — все взаимодействия с клиентом
 *
 * Mutation hooks:
 *   - useCreateTicket() — создать тикет
 *   - useSendTicketMessage() — отправить сообщение в тикет
 *   - useUpdateTicketStatus() — сменить статус тикета
 *   - useCreateLead() — создать лид
 *   - useUpdateLeadStatus() — сменить статус лида (drag-and-drop)
 *   - useAddLeadActivity() — добавить активность
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ==================== Types ====================
export interface SupportTicket {
  id: string;
  number: string;
  user_id: string;
  assigned_to: string | null;
  subject: string;
  category: string;
  priority: string;
  status: string;
  order_id: string | null;
  messages_count: number;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  messages?: TicketMessage[];
  user?: { id: string; email: string; name: string | null };
  assignee?: { id: string; name: string | null } | null;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  text: string;
  attachments: unknown[] | null;
  is_internal: boolean;
  is_system: boolean;
  created_at: string;
  read_at: string | null;
}

export interface Lead {
  id: string;
  source: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  inquiry: string | null;
  budget: number | null;
  event_date: string | null;
  city: string | null;
  status: string;
  stage: string;
  assigned_to: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  user_id: string;
  type: string;
  description: string | null;
  outcome: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CustomerInteraction {
  id: string;
  user_id: string;
  type: string;
  description: string | null;
  related_id: string | null;
  related_type: string | null;
  initiated_by: string | null;
  created_at: string;
}

// ==================== Query hooks ====================

/** Список тикетов */
export function useSupportTickets(filter?: { status?: string; assignedToMe?: boolean }) {
  return useQuery<SupportTicket[]>({
    queryKey: ["support-tickets", filter],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];

      let query = supabaseBrowser
        .from("support_tickets")
        .select(`
          *,
          user:auth.users!support_tickets_user_id_fkey(id, email),
          assignee:auth.users!support_tickets_assigned_to_fkey(id)
        `);

      if (filter?.assignedToMe) {
        query = query.eq("assigned_to", user.id);
      }

      if (filter?.status && filter.status !== "all") {
        query = query.eq("status", filter.status);
      }

      const { data, error } = await query.order("created_at", { ascending: false }).limit(50);

      if (error) throw new Error(error.message);
      return (data || []) as unknown as SupportTicket[];
    },
    staleTime: 30 * 1000,
  });
}

/** Детали тикета */
export function useSupportTicket(ticketId: string | null) {
  return useQuery<SupportTicket>({
    queryKey: ["support-ticket", ticketId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("support_tickets")
        .select(`
          *,
          user:auth.users!support_tickets_user_id_fkey(id, email),
          assignee:auth.users!support_tickets_assigned_to_fkey(id)
        `)
        .eq("id", ticketId)
        .single();

      if (error) throw new Error(error.message);
      return data as unknown as SupportTicket;
    },
    enabled: Boolean(ticketId),
  });
}

/** Сообщения в тикете с Realtime подпиской */
export function useTicketMessages(ticketId: string | null) {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!ticketId) return;

    const channel = supabaseBrowser
      .channel(`ticket-messages-${ticketId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "ticket_messages",
        filter: `ticket_id=eq.${ticketId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["ticket-messages", ticketId] });
        queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      })
      .subscribe();

    return () => {
      void supabaseBrowser.removeChannel(channel);
    };
  }, [ticketId, queryClient]);

  return useQuery<TicketMessage[]>({
    queryKey: ["ticket-messages", ticketId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw new Error(error.message);
      return data as TicketMessage[];
    },
    enabled: Boolean(ticketId),
    staleTime: 0,
  });
}

/** Лиды (Kanban) */
export function useLeads(filter?: { status?: string }) {
  return useQuery<Lead[]>({
    queryKey: ["leads", filter],
    queryFn: async () => {
      let query = supabaseBrowser
        .from("leads")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(100);

      if (filter?.status && filter.status !== "all") {
        query = query.eq("status", filter.status);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as Lead[];
    },
    staleTime: 30 * 1000,
  });
}

/** Детали лида */
export function useLead(leadId: string | null) {
  return useQuery<Lead>({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .single();

      if (error) throw new Error(error.message);
      return data as Lead;
    },
    enabled: Boolean(leadId),
  });
}

/** Активности по лиду */
export function useLeadActivities(leadId: string | null) {
  return useQuery<LeadActivity[]>({
    queryKey: ["lead-activities", leadId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("lead_activities")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data || []) as LeadActivity[];
    },
    enabled: Boolean(leadId),
  });
}

/** Timeline взаимодействий с клиентом */
export function useCustomerTimeline(userId: string | null) {
  return useQuery<CustomerInteraction[]>({
    queryKey: ["customer-timeline", userId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("customer_interactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message);
      return (data || []) as CustomerInteraction[];
    },
    enabled: Boolean(userId),
  });
}

// ==================== Mutation hooks ====================

/** Создать тикет поддержки */
export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      subject,
      category = "other",
      priority = "medium",
      orderId,
      message,
    }: {
      subject: string;
      category?: string;
      priority?: string;
      orderId?: string;
      message: string;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data: ticket, error } = await supabaseBrowser
        .from("support_tickets")
        .insert({
          user_id: user.id,
          subject,
          category,
          priority,
          order_id: orderId,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      // Создаём первое сообщение
      await supabaseBrowser.from("ticket_messages").insert({
        ticket_id: ticket.id,
        sender_id: user.id,
        text: message,
      });

      return ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Тикет создан! Мы ответим в течение 24 часов.");
    },
    onError: (error: Error) => {
      toast.error("Ошибка создания тикета", { description: error.message });
    },
  });
}

/** Отправить сообщение в тикет */
export function useSendTicketMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ticketId,
      text,
      isInternal = false,
    }: {
      ticketId: string;
      text: string;
      isInternal?: boolean;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("ticket_messages")
        .insert({
          ticket_id: ticketId,
          sender_id: user.id,
          text,
          is_internal: isInternal,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      // Realtime уведомит через postgres_changes, но обновляем кэш для надёжности
      queryClient.invalidateQueries({ queryKey: ["ticket-messages"] });
    },
    onError: (error: Error) => {
      toast.error("Ошибка отправки", { description: error.message });
    },
  });
}

/** Сменить статус тикета */
export function useUpdateTicketStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ticketId,
      status,
    }: {
      ticketId: string;
      status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
    }) => {
      const updateData: Record<string, string | null> = { status };
      if (status === "resolved") updateData.resolved_at = new Date().toISOString();
      if (status === "closed") updateData.closed_at = new Date().toISOString();

      const { data, error } = await supabaseBrowser
        .from("support_tickets")
        .update(updateData)
        .eq("id", ticketId)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Статус тикета обновлён");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}

/** Создать лид */
export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lead: Omit<Lead, "id" | "created_at" | "updated_at" | "status" | "stage">) => {
      const { data, error } = await supabaseBrowser
        .from("leads")
        .insert({ ...lead, status: "new", stage: "awareness" })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Лид создан");
    },
    onError: (error: Error) => {
      toast.error("Ошибка создания лида", { description: error.message });
    },
  });
}

/** Сменить статус лида (для drag-and-drop в Kanban) */
export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      leadId,
      status,
      lostReason,
    }: {
      leadId: string;
      status: "new" | "contacted" | "qualified" | "won" | "lost";
      lostReason?: string;
    }) => {
      const updateData: Record<string, string | null> = { status };
      if (status === "contacted") updateData.contacted_at = new Date().toISOString();
      if (status === "qualified") updateData.qualified_at = new Date().toISOString();
      if (status === "won") updateData.won_at = new Date().toISOString();
      if (status === "lost") {
        updateData.lost_at = new Date().toISOString();
        if (lostReason) updateData.lost_reason = lostReason;
      }

      const { data, error } = await supabaseBrowser
        .from("leads")
        .update(updateData)
        .eq("id", leadId)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Статус лида обновлён");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}

/** Добавить активность по лиду */
export function useAddLeadActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      leadId,
      type,
      description,
      outcome,
      scheduledAt,
    }: {
      leadId: string;
      type: "call" | "email" | "meeting" | "note" | "status_change";
      description?: string;
      outcome?: string;
      scheduledAt?: string;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("lead_activities")
        .insert({
          lead_id: leadId,
          user_id: user.id,
          type,
          description,
          outcome,
          scheduled_at: scheduledAt,
          completed_at: scheduledAt ? null : new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lead-activities", variables.leadId] });
      toast.success("Активность добавлена");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}
