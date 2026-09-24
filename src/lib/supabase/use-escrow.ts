/**
 * use-escrow.ts — Escrow + Split Payment hooks.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface EscrowAccount {
  id: string;
  order_id: string;
  held_amount: number;
  confectioner_amount: number;
  platform_amount: number;
  courier_amount: number;
  partner_amount: number;
  commission_rate: number;
  status: string;
  held_at: string;
  release_scheduled_at: string | null;
  released_at: string | null;
}

export interface SplitPayment {
  id: string;
  payment_id: string;
  order_id: string;
  confectioner_id: string;
  courier_id: string | null;
  partner_id: string | null;
  total_amount: number;
  confectioner_amount: number;
  platform_amount: number;
  courier_amount: number;
  partner_amount: number;
  commission_rate: number;
  status: string;
}

export function useEscrowByOrder(orderId: string | null) {
  return useQuery<EscrowAccount | null>({
    queryKey: ["escrow", orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data, error } = await supabaseBrowser
        .from("escrow_accounts")
        .select("*")
        .eq("order_id", orderId)
        .single();
      if (error && error.code !== "PGRST116") throw new Error(error.message);
      return (data as EscrowAccount) || null;
    },
    enabled: Boolean(orderId),
  });
}

export function useSplitPayments(orderId: string | null) {
  return useQuery<SplitPayment | null>({
    queryKey: ["split-payment", orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data, error } = await supabaseBrowser
        .from("split_payments")
        .select("*")
        .eq("order_id", orderId)
        .single();
      if (error && error.code !== "PGRST116") throw new Error(error.message);
      return (data as SplitPayment) || null;
    },
    enabled: Boolean(orderId),
  });
}

export function useCreateEscrow() {
  return useMutation({
    mutationFn: async ({
      orderId,
      totalAmount,
      confectionerId,
      commissionRate = 10,
      courierAmount = 0,
      partnerAmount = 0,
    }: {
      orderId: string;
      totalAmount: number;
      confectionerId: string;
      commissionRate?: number;
      courierAmount?: number;
      partnerAmount?: number;
    }) => {
      const platformAmount = Math.round((totalAmount * commissionRate) / 100);
      const confectionerAmount = totalAmount - platformAmount - courierAmount - partnerAmount;

      const { data, error } = await supabaseAdmin
        .from("escrow_accounts")
        .insert({
          order_id: orderId,
          held_amount: totalAmount,
          confectioner_amount: confectionerAmount,
          platform_amount: platformAmount,
          courier_amount: courierAmount,
          partner_amount: partnerAmount,
          commission_rate: commissionRate,
          status: "held",
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onError: (error: Error) => toast.error("Ошибка создания эскроу", { description: error.message }),
  });
}

export function useCreateSplitPayment() {
  return useMutation({
    mutationFn: async ({
      paymentId,
      orderId,
      totalAmount,
      confectionerId,
      commissionRate = 10,
      courierId,
      partnerId,
      courierAmount = 0,
      partnerAmount = 0,
    }: {
      paymentId: string;
      orderId: string;
      totalAmount: number;
      confectionerId: string;
      commissionRate?: number;
      courierId?: string;
      partnerId?: string;
      courierAmount?: number;
      partnerAmount?: number;
    }) => {
      const platformAmount = Math.round((totalAmount * commissionRate) / 100);
      const confectionerAmount = totalAmount - platformAmount - courierAmount - partnerAmount;

      const { data, error } = await supabaseAdmin
        .from("split_payments")
        .insert({
          payment_id: paymentId,
          order_id: orderId,
          confectioner_id: confectionerId,
          courier_id: courierId || null,
          partner_id: partnerId || null,
          total_amount: totalAmount,
          confectioner_amount: confectionerAmount,
          platform_amount: platformAmount,
          courier_amount: courierAmount,
          partner_amount: partnerAmount,
          commission_rate: commissionRate,
          status: "processed",
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onError: (error: Error) => toast.error("Ошибка сплитования", { description: error.message }),
  });
}

export function useReleaseEscrow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (escrowId: string) => {
      const { data, error } = await supabaseAdmin
        .from("escrow_accounts")
        .update({
          status: "released",
          released_at: new Date().toISOString(),
        })
        .eq("id", escrowId)
        .eq("status", "held")
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escrow"] });
      toast.success("Эскроу освобождён, средства переведены кондитеру");
    },
    onError: (error: Error) => toast.error("Ошибка освобождения", { description: error.message }),
  });
}

export function useRefundEscrow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ escrowId, reason }: { escrowId: string; reason?: string }) => {
      const { data, error } = await supabaseAdmin
        .from("escrow_accounts")
        .update({
          status: "refunded",
          refunded_at: new Date().toISOString(),
          metadata: { refund_reason: reason },
        })
        .eq("id", escrowId)
        .eq("status", "held")
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escrow"] });
      toast.success("Эскроу возвращён покупателю");
    },
    onError: (error: Error) => toast.error("Ошибка возврата", { description: error.message }),
  });
}
