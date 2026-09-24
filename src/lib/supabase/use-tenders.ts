/**
 * use-tenders.ts — TanStack Query hooks для тендеров (Модуль 4).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

export interface Tender {
  id: string;
  customer_id: string;
  title: string;
  description: string | null;
  category: string | null;
  required_servings: number | null;
  budget_min: number | null;
  budget_max: number | null;
  required_city: string | null;
  required_delivery_date: string | null;
  end_date: string;
  specifications: Record<string, unknown> | null;
  status: string;
  is_public: boolean;
  is_urgent: boolean;
  chat_channel_id: string | null;
  offers_count: number;
  views_count: number;
  awarded_at: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface TenderOffer {
  id: string;
  tender_id: string;
  confectioner_id: string;
  offer_price: number;
  offer_description: string | null;
  proposed_delivery_date: string | null;
  status: string;
  is_winner: boolean;
  created_at: string;
}

export function useTenders(filter?: { status?: string; city?: string }) {
  return useQuery<Tender[]>({
    queryKey: ["tenders", filter],
    queryFn: async () => {
      let query = supabaseBrowser.from("tenders").select("*").eq("is_public", true);
      if (filter?.status && filter.status !== "all") query = query.eq("status", filter.status);
      if (filter?.city) query = query.eq("required_city", filter.city);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return (data || []) as Tender[];
    },
    staleTime: 30 * 1000,
  });
}

export function useTender(tenderId: string | null) {
  return useQuery<Tender>({
    queryKey: ["tender", tenderId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser.from("tenders").select("*").eq("id", tenderId).single();
      if (error) throw new Error(error.message);
      return data as Tender;
    },
    enabled: Boolean(tenderId),
  });
}

export function useTenderOffers(tenderId: string | null) {
  return useQuery<TenderOffer[]>({
    queryKey: ["tender-offers", tenderId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser.from("tender_offers").select("*").eq("tender_id", tenderId).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as TenderOffer[];
    },
    enabled: Boolean(tenderId),
  });
}

export function useCreateTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tender: Omit<Tender, "id" | "created_at" | "offers_count" | "views_count" | "awarded_at" | "closed_at" | "chat_channel_id" | "status">) => {
      const { data, error } = await supabaseBrowser.from("tenders").insert({ ...tender, status: "active" }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenders"] });
      toast.success("Тендер создан!");
    },
    onError: (error: Error) => toast.error("Ошибка", { description: error.message }),
  });
}

export function useCreateTenderOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenderId, offerPrice, description, proposedDeliveryDate }: { tenderId: string; offerPrice: number; description?: string; proposedDeliveryDate?: string }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");
      const { data, error } = await supabaseBrowser.from("tender_offers").insert({
        tender_id: tenderId, confectioner_id: user.id,
        offer_price: offerPrice, offer_description: description,
        proposed_delivery_date: proposedDeliveryDate, status: "pending",
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tender-offers"] });
      queryClient.invalidateQueries({ queryKey: ["tenders"] });
      toast.success("Предложение отправлено!");
    },
    onError: (error: Error) => toast.error("Ошибка", { description: error.message }),
  });
}

export function useAcceptTenderOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenderId, offerId }: { tenderId: string; offerId: string }) => {
      const { error: offerErr } = await supabaseBrowser.from("tender_offers").update({ status: "accepted", is_winner: true }).eq("id", offerId);
      if (offerErr) throw new Error(offerErr.message);
      const { error: tenderErr } = await supabaseBrowser.from("tenders").update({ status: "awarded", awarded_at: new Date().toISOString() }).eq("id", tenderId);
      if (tenderErr) throw new Error(tenderErr.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tender-offers"] });
      queryClient.invalidateQueries({ queryKey: ["tenders"] });
      toast.success("Победитель выбран!");
    },
    onError: (error: Error) => toast.error("Ошибка", { description: error.message }),
  });
}
