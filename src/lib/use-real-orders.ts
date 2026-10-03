"use client";
/**
 * use-real-orders.ts — живые заказы из GET /api/orders для дашбордов.
 *
 * Заменяет MOCK-заказы store.orders там, где нужен реальный поток заказов:
 *  - покупатель видит свои заказы (user_id);
 *  - кондитер/админ — свои + назначенные (confectioner_id), скope решает API.
 *
 * Fallback: при ошибке сети/401 возвращаются store-заказы (устаревшие,
 * помечены stale), чтобы кабинет оставался работоспособным офлайн.
 */
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Order, OrderItem, OrderStatus } from "@/lib/types";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

/** Сырой заказ из GET /api/orders (snake_case, как в БД) */
export interface ApiOrder {
  id: string;
  number: string | null;
  status: string;
  total: number;
  delivery_address?: string | null;
  delivery_date?: string | null;
  delivery_time?: string | null;
  delivery_cost?: number | null;
  payment_method?: string | null;
  payment_status?: string | null;
  comment?: string | null;
  confectioner_id?: string | null;
  user_id: string;
  created_at: string;
  confectioner?: { business_name: string | null; avatar: string | null } | null;
  items?: ApiOrderItem[];
}

export interface ApiOrderItem {
  id?: string;
  order_id?: string;
  product_id?: string | null;
  title?: string | null;
  image?: string | null;
  price?: number | null;
  quantity?: number;
  customization?: Record<string, unknown> | null;
}

const VALID_PAYMENT_STATUSES = new Set([
  "pending",
  "waiting_for_capture",
  "succeeded",
  "escrow",
  "released",
  "cancelled",
  "refunded",
]);

const PAYMENT_STATUS_ALIASES: Record<string, Order["paymentStatus"]> = {
  paid: "escrow", // «оплачен, деньги на эскроу» — ближайший смысл в UI-контракте
  succeeded: "escrow",
};

/** Адаптер snake_case API → UI-модель Order (src/lib/types.ts) */
export function mapApiOrderToStoreOrder(raw: ApiOrder): Order {
  const items: OrderItem[] = (raw.items || []).map((it) => ({
    productId: it.product_id || "",
    title: it.title || "Товар",
    image: it.image || "",
    price: Number(it.price) || 0,
    quantity: Number(it.quantity) || 1,
    customization: (it.customization as OrderItem["customization"]) || undefined,
  }));

  const paymentStatus = String(raw.payment_status || "pending");
  const method = String(raw.payment_method || "card");

  return {
    id: raw.id,
    number: raw.number || "",
    customerId: raw.user_id,
    customerName: "", // список API не содержит имени покупателя — дозаполнять не требуется
    confectionerId: raw.confectioner_id || undefined,
    confectionerName: raw.confectioner?.business_name || undefined,
    items,
    total: Number(raw.total) || 0,
    status: String(raw.status || "PENDING") as OrderStatus,
    deliveryAddress: raw.delivery_address || undefined,
    deliveryDate: raw.delivery_date || raw.created_at,
    deliveryTime: raw.delivery_time || undefined,
    deliveryCost: Number(raw.delivery_cost) || 0,
    createdAt: raw.created_at,
    paymentMethod: (["card", "cash", "split"].includes(method) ? method : "card") as Order["paymentMethod"],
    paymentStatus: (VALID_PAYMENT_STATUSES.has(paymentStatus)
      ? PAYMENT_STATUS_ALIASES[paymentStatus] || paymentStatus
      : "pending") as Order["paymentStatus"],
    comment: raw.comment || undefined,
  };
}

async function fetchRealOrders(): Promise<Order[]> {
  const headers = await getSessionAuthHeaders();
  const res = await fetch("/api/orders", { headers, credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { orders?: ApiOrder[] };
  return (data.orders || []).map(mapApiOrderToStoreOrder);
}

export interface RealOrdersResult {
  /** Реальные заказы (если API доступен) — уже скоупнуты ролью на сервере */
  realOrders: Order[] | null;
  /** Фолбэк-заказы (store) — только если реальный запрос не удался */
  fallbackOrders: Order[];
  /** Итоговый список для рендера: real ?? fallback */
  orders: Order[];
  /** true → показывается фолбэк (API недоступен), данные устаревшие */
  isStale: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Живые заказы с фолбэком на store-заказы при ошибке */
export function useRealOrders(): RealOrdersResult {
  const storeOrders = useAppStore((s) => s.orders);
  const user = useAppStore((s) => s.user);

  const query = useQuery<Order[], Error>({
    queryKey: ["orders-real", user?.id ?? null],
    queryFn: fetchRealOrders,
    staleTime: 30_000,
    retry: 1,
    enabled: !!user,
  });

  const realOrders = query.data ?? null;
  const failed = !!query.error;

  return {
    realOrders,
    fallbackOrders: storeOrders,
    orders: realOrders ?? storeOrders,
    isStale: failed,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/** PATCH /api/orders/[id] — смена статуса (кондитер/курьер/админ/покупатель-отмена) */
export function useRealUpdateOrderStatus(options?: { onSuccess?: () => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderId: string; status: string; comment?: string }) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch(`/api/orders/${input.orderId}`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ status: input.status, comment: input.comment }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["orders-real"] });
      toast.success(`Статус заказа изменён: ${variables.status}`);
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error("Не удалось изменить статус", { description: error.message });
    },
  });
}

/** Заявка на возврат: POST /api/payment/refund { paymentId, amount, reason } */
export function useCreateRefundRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { paymentId: string; amount: number; reason: string }) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/payment/refund", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ refund?: { id: string; status?: string }; message?: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["refunds-real"] });
    },
  });
}

export interface RefundRow {
  id: string;
  payment_id: string;
  order_id: string;
  amount: number;
  reason: string;
  status: string;
  rejection_reason?: string | null;
  created_at: string;
}

export interface OrderPaymentInfo {
  id: string;
  amount: number;
  status: string;
  refund_amount?: number | null;
  currency?: string;
}

/** Возвраты пользователя: GET /api/payment/refund (order_id опционален) */
export function useRefunds(orderId?: string | null) {
  return useQuery<{ refunds: RefundRow[]; payment?: OrderPaymentInfo | null }, Error>({
    queryKey: ["refunds-real", orderId ?? "all"],
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const url = orderId ? `/api/payment/refund?order_id=${encodeURIComponent(orderId)}` : "/api/payment/refund";
      const res = await fetch(url, { headers, credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: orderId !== null, // undefined = все возвраты пользователя; null = не запрашивать
    staleTime: 15_000,
    retry: 1,
  });
}
