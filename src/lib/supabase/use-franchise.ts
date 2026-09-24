/**
 * use-franchise.ts — Franchise network management hooks.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

export interface FranchiseNetwork {
  id: string;
  franchiser_id: string;
  name: string;
  region: string | null;
  description: string | null;
  royalty_rate: number;
  monthly_fee: number;
  is_active: boolean;
  contract_start: string | null;
  contract_end: string | null;
  total_confectioners: number;
  total_sales: number;
  created_at: string;
}

export interface RoyaltyPayment {
  id: string;
  network_id: string;
  period_month: string;
  total_sales: number;
  royalty_rate: number;
  royalty_amount: number;
  status: string;
  paid_at: string | null;
}

export function useFranchiseNetworks() {
  return useQuery<FranchiseNetwork[]>({
    queryKey: ["franchise-networks"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabaseBrowser
        .from("franchise_networks")
        .select("*")
        .eq("franchiser_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as FranchiseNetwork[];
    },
  });
}

export function useRoyaltyPayments(networkId?: string) {
  return useQuery<RoyaltyPayment[]>({
    queryKey: ["royalty-payments", networkId],
    queryFn: async () => {
      let query = supabaseBrowser.from("royalty_payments").select("*");
      if (networkId) query = query.eq("network_id", networkId);
      const { data, error } = await query.order("period_month", { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as RoyaltyPayment[];
    },
    enabled: Boolean(networkId) || true,
  });
}

export function useCreateFranchiseNetwork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (network: Partial<FranchiseNetwork>) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");
      const { data, error } = await supabaseBrowser
        .from("franchise_networks")
        .insert({ ...network, franchiser_id: user.id })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchise-networks"] });
      toast.success("Сеть франчайзи создана");
    },
  });
}

export function useAddConfectionerToNetwork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ networkId, confectionerId }: { networkId: string; confectionerId: string }) => {
      const { data, error } = await supabaseBrowser
        .from("franchise_points")
        .insert({ network_id: networkId, confectioner_id: confectionerId, status: "pending" })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchise-networks"] });
      toast.success("Кондитер добавлен в сеть");
    },
  });
}

export function useGenerateRoyaltyReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ networkId, month }: { networkId: string; month: string }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");
      const { data, error } = await supabaseBrowser
        .from("royalty_payments")
        .insert({
          network_id: networkId,
          period_month: month,
          total_sales: 0,
          royalty_rate: 5.0,
          royalty_amount: 0,
          status: "pending",
        })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["royalty-payments"] });
      toast.success("Отчёт по роялти создан");
    },
  });
}
