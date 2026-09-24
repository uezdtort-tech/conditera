/**
 * use-cake-builder.ts — TanStack Query hooks для конструктора тортов.
 *
 * Query hooks:
 *   - useCakeBuilderOptions(category) — опции (bases, fillings, coatings, decorations, dietary)
 *   - useCakeBuilderDraft() — текущий черновик пользователя
 *   - useInquiries() — запросы пользователя (CUSTOMER)
 *   - useInquiry(id) — детали запроса
 *   - useNegotiations(filter) — переговоры (CUSTOMER: входящие, CONFECTIONER: для меня)
 *   - useNegotiation(id) — детали переговоров
 *   - useNegotiationMessages(negotiationId) — сообщения в переговорах (realtime)
 *   - useAvailableInquiries(city?) — доступные запросы для кондитеров
 *
 * Mutation hooks:
 *   - useSaveDraft() — автосохранение черновика
 *   - useSubmitInquiry() — отправить запрос (создаёт inquiry + negotiations для выбранных кондитеров)
 *   - useQuoteNegotiation() — кондитер предлагает цену
 *   - useAcceptNegotiation() — пользователь принимает
 *   - useDeclineNegotiation() — пользователь/кондитер отклоняет
 *   - useSendNegotiationMessage() — отправить сообщение
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ==================== Types ====================
export interface CakeBuilderOption {
  id: string;
  category: string;
  key: string;
  name: string;
  description: string | null;
  price_modifier: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  metadata: Record<string, unknown> | null;
}

export interface CakeBuilderDraft {
  id: string;
  user_id: string;
  event_type: string | null;
  base: string | null;
  filling: string | null;
  coating: string | null;
  decorations: string[] | null;
  dietary: string[] | null;
  servings: number;
  city: string | null;
  delivery_date: string | null;
  delivery_type: string;
  inscription: string | null;
  comment: string | null;
  step: number;
  is_submitted: boolean;
  updated_at: string;
}

export interface Inquiry {
  id: string;
  user_id: string;
  event_type: string | null;
  base: string | null;
  filling: string | null;
  coating: string | null;
  decorations: string[] | null;
  dietary: string[] | null;
  servings: number;
  city: string | null;
  delivery_date: string | null;
  delivery_type: string;
  inscription: string | null;
  comment: string | null;
  estimated_price: number | null;
  status: string;
  expires_at: string;
  negotiations_count: number;
  submitted_at: string;
  closed_at: string | null;
  created_at: string;
  // Joined
  negotiations?: Negotiation[];
}

export interface Negotiation {
  id: string;
  inquiry_id: string;
  user_id: string;
  confectioner_id: string;
  quoted_price: number | null;
  quoted_delivery_cost: number;
  quoted_prep_time: string | null;
  quoted_items: Record<string, unknown> | null;
  discount_requested: boolean;
  discount_percent: number;
  discount_comment: string | null;
  status: string;
  expires_at: string;
  quoted_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  order_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  confectioner?: { id: string; name: string | null; avatar_url: string | null };
  inquiry?: Inquiry;
  messages?: NegotiationMessage[];
}

export interface NegotiationMessage {
  id: string;
  negotiation_id: string;
  sender_id: string;
  text: string;
  attachments: unknown[] | null;
  is_system: boolean;
  created_at: string;
  read_at: string | null;
}

// ==================== Query hooks ====================

/** Опции конструктора по категории */
export function useCakeBuilderOptions(category: "base" | "filling" | "coating" | "decoration" | "dietary" | "event_type") {
  return useQuery<CakeBuilderOption[]>({
    queryKey: ["cake-builder-options", category],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("cake_builder_options")
        .select("*")
        .eq("category", category)
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw new Error(error.message);
      return data as CakeBuilderOption[];
    },
    staleTime: 10 * 60 * 1000, // 10 минут (опции меняются редко)
  });
}

/** Текущий черновик пользователя */
export function useCakeBuilderDraft() {
  return useQuery<CakeBuilderDraft | null>({
    queryKey: ["cake-builder-draft"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabaseBrowser
        .from("cake_builder_drafts")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_submitted", false)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data as CakeBuilderDraft | null;
    },
    staleTime: 30 * 1000, // 30 секунд
  });
}

/** Запросы пользователя */
export function useInquiries() {
  return useQuery<Inquiry[]>({
    queryKey: ["inquiries"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabaseBrowser
        .from("inquiries")
        .select(`
          *,
          negotiations:negotiations(
            *,
            confectioner:auth.users!negotiations_confectioner_id_fkey(id)
          )
        `)
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false });

      if (error) throw new Error(error.message);
      return data as unknown as Inquiry[];
    },
    staleTime: 30 * 1000,
  });
}

/** Детали конкретного запроса */
export function useInquiry(inquiryId: string) {
  return useQuery<Inquiry>({
    queryKey: ["inquiry", inquiryId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("inquiries")
        .select(`
          *,
          negotiations:negotiations(
            *,
            confectioner:auth.users!negotiations_confectioner_id_fkey(id)
          )
        `)
        .eq("id", inquiryId)
        .single();

      if (error) throw new Error(error.message);
      return data as unknown as Inquiry;
    },
    enabled: Boolean(inquiryId),
  });
}

/** Переговоры пользователя (CUSTOMER) или для кондитера (CONFECTIONER) */
export function useNegotiations(filter?: { role?: "customer" | "confectioner" }) {
  return useQuery<Negotiation[]>({
    queryKey: ["negotiations", filter],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];

      let query = supabaseBrowser
        .from("negotiations")
        .select(`
          *,
          inquiry:inquiries(*),
          confectioner:auth.users!negotiations_confectioner_id_fkey(id)
        `);

      if (filter?.role === "confectioner") {
        query = query.eq("confectioner_id", user.id);
      } else {
        query = query.eq("user_id", user.id);
      }

      const { data, error } = await query.order("updated_at", { ascending: false });

      if (error) throw new Error(error.message);
      return data as unknown as Negotiation[];
    },
    staleTime: 30 * 1000,
  });
}

/** Детали переговоров */
export function useNegotiation(negotiationId: string) {
  return useQuery<Negotiation>({
    queryKey: ["negotiation", negotiationId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("negotiations")
        .select(`
          *,
          inquiry:inquiries(*),
          confectioner:auth.users!negotiations_confectioner_id_fkey(id)
        `)
        .eq("id", negotiationId)
        .single();

      if (error) throw new Error(error.message);
      return data as unknown as Negotiation;
    },
    enabled: Boolean(negotiationId),
  });
}

/** Сообщения в переговорах (с Realtime подпиской) */
export function useNegotiationMessages(negotiationId: string) {
  const queryClient = useQueryClient();

  // Realtime подписка на новые сообщения
  React.useEffect(() => {
    if (!negotiationId) return;

    const channel = supabaseBrowser
      .channel(`negotiation-messages-${negotiationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "negotiation_messages",
          filter: `negotiation_id=eq.${negotiationId}`,
        },
        () => {
          // Инвалидируем кэш → useQuery перезагрузит данные
          queryClient.invalidateQueries({
            queryKey: ["negotiation-messages", negotiationId],
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "negotiation_messages",
          filter: `negotiation_id=eq.${negotiationId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["negotiation-messages", negotiationId],
          });
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [negotiationId, queryClient]);

  return useQuery<NegotiationMessage[]>({
    queryKey: ["negotiation-messages", negotiationId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("negotiation_messages")
        .select("*")
        .eq("negotiation_id", negotiationId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw new Error(error.message);
      return (data || []) as NegotiationMessage[];
    },
    enabled: Boolean(negotiationId),
    staleTime: 0, // всегда обновляем при invalidate
  });
}

// Нужно импортировать React для useEffect
import * as React from "react";

/** Доступные запросы для кондитеров (открытые в их городе) */
export function useAvailableInquiries(city?: string) {
  return useQuery<Inquiry[]>({
    queryKey: ["available-inquiries", city],
    queryFn: async () => {
      let query = supabaseBrowser
        .from("inquiries")
        .select("*")
        .eq("status", "open")
        .order("submitted_at", { ascending: false });

      if (city) {
        query = query.eq("city", city);
      }

      const { data, error } = await query.limit(50);

      if (error) throw new Error(error.message);
      return (data || []) as Inquiry[];
    },
    staleTime: 30 * 1000,
  });
}

// ==================== Mutation hooks ====================

/** Сохранить черновик (автосохранение) */
export function useSaveDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: Partial<CakeBuilderDraft> & { id?: string }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      if (draft.id) {
        // Update existing
        const { data, error } = await supabaseBrowser
          .from("cake_builder_drafts")
          .update({ ...draft, updated_at: new Date().toISOString() })
          .eq("id", draft.id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      } else {
        // Insert new
        const { data, error } = await supabaseBrowser
          .from("cake_builder_drafts")
          .insert({ ...draft, user_id: user.id })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cake-builder-draft"] });
    },
    onError: (error: Error) => {
      console.error("[saveDraft]", error.message);
    },
  });
}

/** Отправить запрос кондитерам (создаёт inquiry + negotiations) */
export function useSubmitInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      draftId,
      confectionerIds,
      estimatedPrice,
      requestDiscount,
      discountPercent,
      discountComment,
    }: {
      draftId: string;
      confectionerIds: string[];
      estimatedPrice: number;
      requestDiscount?: boolean;
      discountPercent?: number;
      discountComment?: string;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      // 1. Загрузить черновик
      const { data: draft, error: draftError } = await supabaseBrowser
        .from("cake_builder_drafts")
        .select("*")
        .eq("id", draftId)
        .single();

      if (draftError || !draft) throw new Error("Черновик не найден");
      if (draft.user_id !== user.id) throw new Error("Не ваш черновик");

      // 2. Создать inquiry из draft
      const { data: inquiry, error: inquiryError } = await supabaseBrowser
        .from("inquiries")
        .insert({
          user_id: user.id,
          event_type: draft.event_type,
          base: draft.base,
          filling: draft.filling,
          coating: draft.coating,
          decorations: draft.decorations,
          dietary: draft.dietary,
          servings: draft.servings,
          city: draft.city,
          delivery_date: draft.delivery_date,
          delivery_type: draft.delivery_type,
          inscription: draft.inscription,
          comment: draft.comment,
          estimated_price: estimatedPrice,
          status: "open",
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (inquiryError || !inquiry) throw new Error(inquiryError?.message || "Ошибка создания inquiry");

      // 3. Создать negotiations для выбранных кондитеров
      const negotiations = confectionerIds.map((confectionerId) => ({
        inquiry_id: inquiry.id,
        user_id: user.id,
        confectioner_id: confectionerId,
        discount_requested: requestDiscount || false,
        discount_percent: requestDiscount ? (discountPercent || 0) : 0,
        discount_comment: requestDiscount ? (discountComment || "") : "",
        status: "pending_confectioner",
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      }));

      const { error: negError } = await supabaseBrowser
        .from("negotiations")
        .insert(negotiations);

      if (negError) throw new Error(negError.message);

      // 4. Помечаем draft как submitted
      await supabaseBrowser
        .from("cake_builder_drafts")
        .update({ is_submitted: true })
        .eq("id", draftId);

      return { inquiryId: inquiry.id, negotiationsCount: negotiations.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["cake-builder-draft"] });
      queryClient.invalidateQueries({ queryKey: ["inquiries"] });
      queryClient.invalidateQueries({ queryKey: ["available-inquiries"] });
      toast.success(`Запрос отправлен ${result.negotiationsCount} кондитер(ам)!`, {
        description: "Ответы придут в течение 48 часов.",
      });
    },
    onError: (error: Error) => {
      toast.error("Ошибка отправки запроса", { description: error.message });
    },
  });
}

/** Кондитер предлагает цену */
export function useQuoteNegotiation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      negotiationId,
      quotedPrice,
      quotedDeliveryCost,
      quotedPrepTime,
      quotedItems,
      changeReason = "initial",
    }: {
      negotiationId: string;
      quotedPrice: number;
      quotedDeliveryCost?: number;
      quotedPrepTime?: string;
      quotedItems?: Record<string, unknown>;
      changeReason?: "initial" | "price_adjustment" | "counter_offer";
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      // 1. Сохранить текущее состояние в revisions (snapshot)
      const { data: current } = await supabaseBrowser
        .from("negotiations")
        .select("*")
        .eq("id", negotiationId)
        .single();

      if (current) {
        await supabaseBrowser.from("negotiation_revisions").insert({
          negotiation_id: negotiationId,
          quoted_price: current.quoted_price,
          quoted_delivery_cost: current.quoted_delivery_cost,
          quoted_prep_time: current.quoted_prep_time,
          quoted_items: current.quoted_items,
          discount_percent: current.discount_percent,
          discount_comment: current.discount_comment,
          changed_by: user.id,
          change_reason: changeReason,
        });
      }

      // 2. Обновить negotiation
      const { data, error } = await supabaseBrowser
        .from("negotiations")
        .update({
          quoted_price: quotedPrice,
          quoted_delivery_cost: quotedDeliveryCost || 0,
          quoted_prep_time: quotedPrepTime || null,
          quoted_items: quotedItems || null,
          status: "quoted",
          quoted_at: new Date().toISOString(),
        })
        .eq("id", negotiationId)
        .select()
        .single();

      if (error) throw new Error(error.message);

      // 3. Системное сообщение в переговорке
      await supabaseBrowser.from("negotiation_messages").insert({
        negotiation_id: negotiationId,
        sender_id: user.id,
        text: `Предложение: ${quotedPrice / 100}₽${quotedPrepTime ? `, срок: ${quotedPrepTime}` : ""}`,
        is_system: true,
      });

      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["negotiations"] });
      queryClient.invalidateQueries({ queryKey: ["negotiation", variables.negotiationId] });
      queryClient.invalidateQueries({ queryKey: ["negotiation-messages", variables.negotiationId] });
      toast.success("Предложение отправлено!");
    },
    onError: (error: Error) => {
      toast.error("Ошибка отправки предложения", { description: error.message });
    },
  });
}

/** Пользователь принимает предложение */
export function useAcceptNegotiation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (negotiationId: string) => {
      const { data, error } = await supabaseBrowser
        .from("negotiations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", negotiationId)
        .select()
        .single();

      if (error) throw new Error(error.message);

      // Закрыть inquiry как converted
      await supabaseBrowser
        .from("inquiries")
        .update({ status: "converted", closed_at: new Date().toISOString() })
        .eq("id", data.inquiry_id);

      // Отклонить все остальные negotiations этого inquiry
      await supabaseBrowser
        .from("negotiations")
        .update({
          status: "declined",
          declined_at: new Date().toISOString(),
        })
        .neq("id", negotiationId)
        .eq("inquiry_id", data.inquiry_id);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["negotiations"] });
      queryClient.invalidateQueries({ queryKey: ["inquiries"] });
      toast.success("Предложение принято! Создаём заказ...");
    },
    onError: (error: Error) => {
      toast.error("Ошибка принятия", { description: error.message });
    },
  });
}

/** Отклонить переговоры */
export function useDeclineNegotiation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (negotiationId: string) => {
      const { data, error } = await supabaseBrowser
        .from("negotiations")
        .update({
          status: "declined",
          declined_at: new Date().toISOString(),
        })
        .eq("id", negotiationId)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["negotiations"] });
      toast.success("Предложение отклонено");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}

/** Отправить сообщение в переговоры */
export function useSendNegotiationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      negotiationId,
      text,
      attachments,
    }: {
      negotiationId: string;
      text: string;
      attachments?: unknown[];
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("negotiation_messages")
        .insert({
          negotiation_id: negotiationId,
          sender_id: user.id,
          text,
          attachments,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["negotiation-messages", variables.negotiationId],
      });
    },
    onError: (error: Error) => {
      toast.error("Ошибка отправки сообщения", { description: error.message });
    },
  });
}
