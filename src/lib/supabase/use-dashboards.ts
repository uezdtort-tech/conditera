/**
 * use-dashboards.ts — прямые supabase-js hooks для 5 дашбордов (v2.0).
 *
 * Заменяет stub-API routes (useSupplierData, useCourierData, useAdminData)
 * на прямые запросы к Supabase через supabaseBrowser с RLS.
 *
 * Преимущества:
 *   - Нет лишнего сетевого хопа (браузер → API → Supabase → браузер)
 *   - RLS на уровне БД (нет дублирования проверок в API routes)
 *   - Realtime обновления (опционально через onSnapshot)
 *   - Автокэширование через TanStack Query
 *
 * Query hooks:
 *   - useCustomerDashboard() — заказы, избранное, бонусы, переговоры
 *   - useConfectionerDashboard() — входящие inquiries, переговоры, товары, доход
 *   - useSupplierDashboard() — заказы, товары, склад, доход
 *   - useCourierDashboard() — активные доставки, история, заработок
 *   - useAdminDashboard() — KPI, последние заказы, рост платформы
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchWithAuthRetry,
  getSessionAuthHeaders,
  getStoredAccessToken,
} from "@/lib/api-client";

// ==================== Types ====================
export interface CustomerDashboardData {
  stats: {
    activeOrders: number;
    completedOrders: number;
    bonusBalance: number;
    loyaltyLevel: string;
    favoritesCount: number;
    activeInquiries: number;
    activeNegotiations: number;
    totalSpent: number;
  };
  recentOrders: Array<{
    id: string;
    number: string;
    total: number;
    status: string;
    created_at: string;
    items?: Array<{ product_title: string; quantity: number }>;
  }>;
  favorites: Array<{
    id: string;
    product_id: string;
    product?: { id: string; title: string; price: number; images?: Array<{ url: string }> };
  }>;
  activeInquiriesList: Array<{
    id: string;
    event_type: string | null;
    city: string | null;
    status: string;
    negotiations_count: number;
    expires_at: string;
  }>;
}

export interface ConfectionerDashboardData {
  stats: {
    activeNegotiations: number;
    pendingInquiries: number;
    activeOrders: number;
    completedOrders: number;
    totalEarnings: number;
    rating: number;
    productsCount: number;
    publishedProducts: number;
  };
  incomingInquiries: Array<{
    id: string;
    event_type: string | null;
    base: string | null;
    filling: string | null;
    servings: number;
    city: string | null;
    delivery_date: string | null;
    estimated_price: number | null;
    expires_at: string;
    user?: { id: string };
  }>;
  activeOrders: Array<{
    id: string;
    number: string;
    user_id: string;
    total: number;
    status: string;
    delivery_date: string | null;
    delivery_address: string | null;
    items?: Array<{ product_title: string; quantity: number }>;
  }>;
  pendingOrders: Array<{
    id: string;
    number: string;
    user_id: string;
    total: number;
    status: string;
    delivery_date: string | null;
    delivery_address: string | null;
    items?: Array<{ product_title: string; quantity: number }>;
  }>;
  recentEarnings: Array<{
    id: string;
    amount: number;
    status: string;
    created_at: string;
    order?: { number: string };
  }>;
}

export interface SupplierDashboardData {
  stats: {
    activeOrders: number;
    completedOrders: number;
    totalProducts: number;
    lowStockItems: number;
    revenue: number;
    rating: number;
  };
  recentOrders: Array<{
    id: string;
    number: string;
    customer_name: string;
    items_count: number;
    total: number;
    status: string;
    created_at: string;
  }>;
  products: Array<{
    id: string;
    title: string;
    price: number;
    stock: number;
    is_active: boolean;
  }>;
}

export interface CourierDashboardData {
  stats: {
    activeDeliveries: number;
    completedToday: number;
    earningsToday: number;
    earningsMonth: number;
    rating: number;
  };
  activeDeliveries: Array<{
    id: string;
    order_id: string;
    address: string;
    status: string;
    estimated_time: string | null;
    cost: number;
    courier_earnings: number;
  }>;
  recentCompleted: Array<{
    id: string;
    order_id: string;
    address: string;
    delivered_at: string;
    courier_earnings: number;
  }>;
}

export interface AdminDashboardData {
  stats: {
    totalUsers: number;
    newUsersToday: number;
    totalOrders: number;
    revenueToday: number;
    revenueMonth: number;
    activeTickets: number;
    pendingPayouts: number;
    fraudAlerts: number;
  };
  recentOrders: Array<{
    id: string;
    number: string;
    customer_email: string;
    total: number;
    status: string;
    created_at: string;
  }>;
  platformGrowth: Array<{
    month: string;
    users: number;
    orders: number;
  }>;
}

// ==================== App-JWT authenticated data access ====================

function getAppSessionUserId(): string {
  const token = getStoredAccessToken();
  if (!token) throw new Error("Не авторизован");
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) throw new Error("Некорректная сессия");
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { userId?: string; sub?: string };
    const userId = payload.userId || payload.sub;
    if (!userId) throw new Error("Некорректная сессия");
    return userId;
  } catch {
    throw new Error("Не авторизован");
  }
}

async function restGet<T>(table: string, params: Record<string, string>): Promise<T[]> {
  const token = getStoredAccessToken();
  if (!token) throw new Error("Не авторизован");

  const headers = await getSessionAuthHeaders();
  headers.Authorization = `Bearer ${token}`;
  headers.Accept = "application/json";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) headers.apikey = anonKey;

  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const query = new URLSearchParams(params).toString();
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?${query}`;
  const response = await fetchWithAuthRetry(url, {
    method: "GET",
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Supabase REST HTTP ${response.status}`;
    throw new Error(message);
  }
  return Array.isArray(payload) ? (payload as T[]) : [];
}

// ==================== Query hooks ====================

/** Customer dashboard — app-JWT + RLS: заказы, избранное, бонусы, переговоры */
export function useCustomerDashboard() {
  return useQuery<CustomerDashboardData>({
    queryKey: ["customer-dashboard"],
    queryFn: async () => {
      const userId = getAppSessionUserId();
      const [ordersRes, favoritesRes, inquiriesRes, negotiationsRes, profileRes, allOrdersRes] =
        await Promise.all([
          restGet<CustomerDashboardData["recentOrders"][number]>("orders", {
            select: "id,number,total,status,created_at,items:order_items(product_title,quantity)",
            user_id: `eq.${userId}`,
            order: "created_at.desc",
            limit: "10",
          }),
          restGet<CustomerDashboardData["favorites"][number]>("product_favorites", {
            select: "id,product_id,product:products(id,title,price)",
            user_id: `eq.${userId}`,
            order: "created_at.desc",
            limit: "20",
          }),
          restGet<CustomerDashboardData["activeInquiriesList"][number]>("inquiries", {
            select: "id,event_type,city,status,negotiations_count,expires_at",
            user_id: `eq.${userId}`,
            status: "in.(open)",
            order: "submitted_at.desc",
            limit: "5",
          }),
          restGet<{ id: string; status: string }>("negotiations", {
            select: "id,status",
            user_id: `eq.${userId}`,
            status: "in.(pending_confectioner,quoted,counter_offered)",
          }),
          restGet<{ bonus_balance: number; loyalty_level: string }>("profiles", {
            select: "bonus_balance,loyalty_level",
            id: `eq.${userId}`,
            limit: "1",
          }),
          restGet<{ total: number; status: string }>("orders", {
            select: "total,status",
            user_id: `eq.${userId}`,
          }),
        ]);

      const completed = allOrdersRes.filter(
        (order) => order.status === "COMPLETED" || order.status === "DELIVERED"
      );
      const profile = profileRes[0];
      return {
        stats: {
          activeOrders: allOrdersRes.filter(
            (order) => !["COMPLETED", "CANCELLED", "REFUNDED"].includes(order.status)
          ).length,
          completedOrders: completed.length,
          bonusBalance: Number(profile?.bonus_balance || 0),
          loyaltyLevel: profile?.loyalty_level || "BRONZE",
          favoritesCount: favoritesRes.length,
          activeInquiries: inquiriesRes.length,
          activeNegotiations: negotiationsRes.length,
          totalSpent: completed.reduce((sum, order) => sum + Number(order.total || 0), 0),
        },
        recentOrders: ordersRes,
        favorites: favoritesRes,
        activeInquiriesList: inquiriesRes,
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Confectioner dashboard — app-JWT + RLS */
export function useConfectionerDashboard() {
  return useQuery<ConfectionerDashboardData>({
    queryKey: ["confectioner-dashboard"],
    queryFn: async () => {
      const userId = getAppSessionUserId();
      const [inquiriesRes, negotiationsRes, activeOrdersRes, pendingOrdersRes, productsRes, completedRes] =
        await Promise.all([
          restGet<ConfectionerDashboardData["incomingInquiries"][number]>("inquiries", {
            select: "id,event_type,base,filling,servings,city,delivery_date,estimated_price,expires_at,user_id",
            status: "eq.open",
            order: "submitted_at.desc",
            limit: "10",
          }),
          restGet<{ id: string; status: string }>("negotiations", {
            select: "id,status,quoted_price,inquiry_id",
            confectioner_id: `eq.${userId}`,
            status: "in.(pending_confectioner,quoted,counter_offered)",
            order: "created_at.desc",
          }),
          restGet<ConfectionerDashboardData["activeOrders"][number]>("orders", {
            select: "id,number,user_id,total,status,delivery_date,delivery_address,items:order_items(product_title,quantity)",
            confectioner_id: `eq.${userId}`,
            status: "in.(CONFIRMED,PREPARING,READY,IN_DELIVERY)",
            order: "delivery_date.asc",
            limit: "10",
          }),
          restGet<ConfectionerDashboardData["pendingOrders"][number]>("orders", {
            select: "id,number,user_id,total,status,delivery_date,delivery_address,items:order_items(product_title,quantity)",
            confectioner_id: `eq.${userId}`,
            status: "eq.PENDING",
            order: "created_at.desc",
            limit: "10",
          }),
          restGet<{ id: string; title: string; price: number; status: string; is_featured: boolean }>("products", {
            select: "id,title,price,status,is_featured",
            confectioner_id: `eq.${userId}`,
            deleted_at: "is.null",
            order: "created_at.desc",
          }),
          restGet<{ id: string; total: number; status: string }>("orders", {
            select: "id,total,status",
            confectioner_id: `eq.${userId}`,
            status: "in.(COMPLETED,DELIVERED)",
          }),
        ]);

      const orderIds = activeOrdersRes.map((order) => order.id);
      const payments = orderIds.length
        ? await restGet<ConfectionerDashboardData["recentEarnings"][number]>("payments", {
            select: "id,amount,status,created_at,order:orders!inner(number)",
            status: "eq.succeeded",
            order_id: `in.(${orderIds.join(",")})`,
            order: "created_at.desc",
            limit: "10",
          })
        : [];

      return {
        stats: {
          activeNegotiations: negotiationsRes.length,
          pendingInquiries: inquiriesRes.length,
          activeOrders: activeOrdersRes.length,
          completedOrders: completedRes.length,
          totalEarnings: completedRes.reduce((sum, order) => sum + Number(order.total || 0), 0),
          rating: 0,
          productsCount: productsRes.length,
          publishedProducts: productsRes.filter((product) => product.status === "published").length,
        },
        incomingInquiries: inquiriesRes,
        activeOrders: activeOrdersRes,
        pendingOrders: pendingOrdersRes,
        recentEarnings: payments,
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Supplier dashboard — склад по owner_id, app-JWT + RLS */
export function useSupplierDashboard() {
  return useQuery<SupplierDashboardData>({
    queryKey: ["supplier-dashboard-v3"],
    queryFn: async () => {
      const userId = getAppSessionUserId();
      const [productsRes, ordersRes, inventoryRes] = await Promise.all([
        restGet<{ id: string; title: string; price: number; status: string; is_featured: boolean }>("products", {
          select: "id,title,price,status,is_featured",
          confectioner_id: `eq.${userId}`,
          deleted_at: "is.null",
          order: "created_at.desc",
        }),
        restGet<{ id: string; number: string; total: number; status: string; created_at: string; items?: unknown[] }>("orders", {
          select: "id,number,total,status,created_at,items:order_items(product_id,quantity)",
          confectioner_id: `eq.${userId}`,
          order: "created_at.desc",
          limit: "10",
        }),
        restGet<{ id: string; quantity: number; cost_per_unit: number; min_quantity: number }>("inventory_items", {
          select: "id,quantity,cost_per_unit,min_quantity",
          owner_id: `eq.${userId}`,
        }),
      ]);

      const orderIds = ordersRes.map((order) => order.id);
      const payments = orderIds.length
        ? await restGet<{ amount: number }>("payments", {
            select: "amount",
            status: "eq.succeeded",
            order_id: `in.(${orderIds.join(",")})`,
          })
        : [];
      return {
        stats: {
          activeOrders: ordersRes.filter(
            (order) => !["COMPLETED", "CANCELLED", "REFUNDED"].includes(order.status)
          ).length,
          completedOrders: ordersRes.filter((order) => order.status === "COMPLETED").length,
          totalProducts: productsRes.length,
          lowStockItems: inventoryRes.filter(
            (item) => Number(item.quantity) <= Number(item.min_quantity)
          ).length,
          revenue: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
          rating: 0,
        },
        recentOrders: ordersRes.map((order) => ({
          id: order.id,
          number: order.number,
          customer_name: "—",
          items_count: Array.isArray(order.items) ? order.items.length : 0,
          total: Number(order.total || 0),
          status: order.status,
          created_at: order.created_at,
        })),
        products: productsRes.map((product) => ({
          id: product.id,
          title: product.title,
          price: Number(product.price || 0),
          stock: 0,
          is_active: product.status === "published" && !product.is_featured,
        })),
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Courier dashboard — server-side scope + one automatic refresh on 401 */
export function useCourierDashboard() {
  return useQuery<CourierDashboardData>({
    queryKey: ["courier-dashboard-v3"],
    queryFn: async () => {
      if (!getStoredAccessToken()) throw new Error("Не авторизован");
      const response = await fetchWithAuthRetry("/api/courier/dashboard", {
        headers: await getSessionAuthHeaders(),
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`${payload.error || "Не удалось загрузить кабинет курьера"} (HTTP ${response.status})`);
      }
      return {
        stats: payload.stats,
        activeDeliveries: (payload.activeDeliveries || []).map((delivery: any) => ({
          id: delivery.id,
          order_id: delivery.orderId,
          address: delivery.address || "—",
          status: delivery.status,
          estimated_time: delivery.deliveryTime || null,
          cost: Number(delivery.cost || 0),
          courier_earnings: Number(delivery.earnings || 0),
        })),
        recentCompleted: (payload.history || []).map((delivery: any) => ({
          id: delivery.id,
          order_id: delivery.orderId,
          address: delivery.address || "—",
          delivered_at: delivery.completedAt,
          courier_earnings: Number(delivery.earnings || 0),
        })),
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Admin dashboard — серверная проверка роли, а не клиентский обход RLS */
export function useAdminDashboard() {
  return useQuery<AdminDashboardData>({
    queryKey: ["admin-dashboard-v3"],
    queryFn: async () => {
      const response = await fetchWithAuthRetry("/api/admin/dashboard", {
        headers: await getSessionAuthHeaders(),
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`${payload.error || "Не удалось загрузить кабинет администратора"} (HTTP ${response.status})`);
      }
      return {
        stats: payload.stats,
        recentOrders: (payload.recentOrders || []).map((order: any) => ({
          id: order.id,
          number: order.number,
          customer_email: order.customer_email || order.customer || "—",
          total: Number(order.total || 0),
          status: order.status,
          created_at: order.created_at,
        })),
        platformGrowth: payload.platformGrowth || [],
      };
    },
    staleTime: 30 * 1000,
  });
}
