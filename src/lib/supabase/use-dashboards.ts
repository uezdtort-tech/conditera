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
import { supabaseBrowser } from "@/lib/supabase/browser";
import { csrfFetch } from "@/lib/api-client";

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

// ==================== Query hooks ====================

/** Customer dashboard — заказы, избранное, бонусы, переговоры */
export function useCustomerDashboard() {
  return useQuery<CustomerDashboardData>({
    queryKey: ["customer-dashboard"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      // Параллельно загружаем все данные через supabase-js
      const [ordersRes, favoritesRes, inquiriesRes, negotiationsRes, profileRes] = await Promise.all([
        // Последние заказы
        supabaseBrowser
          .from("orders")
          .select(`
            id, number, total, status, created_at,
            items:order_items(product_title, quantity)
          `)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),

        // Избранное
        supabaseBrowser
          .from("product_favorites")
          .select(`
            id, product_id,
            product:products(id, title, price)
          `)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),

        // Активные inquiries
        supabaseBrowser
          .from("inquiries")
          .select("id, event_type, city, status, negotiations_count, expires_at")
          .eq("user_id", user.id)
          .in("status", ["open"])
          .order("submitted_at", { ascending: false })
          .limit(5),

        // Активные negotiations
        supabaseBrowser
          .from("negotiations")
          .select("id, status", { count: "exact", head: true })
          .eq("user_id", user.id)
          .in("status", ["pending_confectioner", "quoted", "counter_offered"]),

        // Профиль (для бонусов)
        supabaseBrowser
          .from("profiles")
          .select("bonus_balance, loyalty_level")
          .eq("id", user.id)
          .single(),
      ]);

      // Считаем completed orders и total spent
      const allOrdersRes = await supabaseBrowser
        .from("orders")
        .select("total, status")
        .eq("user_id", user.id);

      const completedOrders = (allOrdersRes.data || []).filter(
        (o: { status: string }) => o.status === "COMPLETED" || o.status === "DELIVERED"
      );

      return {
        stats: {
          activeOrders: (allOrdersRes.data || []).filter(
            (o: { status: string }) => !["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status)
          ).length,
          completedOrders: completedOrders.length,
          bonusBalance: profileRes.data?.bonus_balance || 0,
          loyaltyLevel: profileRes.data?.loyalty_level || "BRONZE",
          favoritesCount: favoritesRes.data?.length || 0,
          activeInquiries: inquiriesRes.data?.length || 0,
          activeNegotiations: negotiationsRes.count || 0,
          totalSpent: completedOrders.reduce(
            (sum: number, o: { total: number }) => sum + (o.total || 0),
            0
          ),
        },
        recentOrders: (ordersRes.data || []) as unknown as CustomerDashboardData["recentOrders"],
        favorites: (favoritesRes.data || []) as unknown as CustomerDashboardData["favorites"],
        activeInquiriesList: (inquiriesRes.data || []) as unknown as CustomerDashboardData["activeInquiriesList"],
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Confectioner dashboard — входящие запросы, переговоры, заказы, доход */
export function useConfectionerDashboard() {
  return useQuery<ConfectionerDashboardData>({
    queryKey: ["confectioner-dashboard"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const [inquiriesRes, negotiationsRes, activeOrdersRes, productsRes] = await Promise.all([
        // Входящие inquiries (открытые в городе кондитера)
        supabaseBrowser
          .from("inquiries")
          .select(`
            id, event_type, base, filling, servings, city, delivery_date,
            estimated_price, expires_at, user_id
          `)
          .eq("status", "open")
          .order("submitted_at", { ascending: false })
          .limit(10),

        // Активные negotiations для этого кондитера
        supabaseBrowser
          .from("negotiations")
          .select("id, status, quoted_price, inquiry_id")
          .eq("confectioner_id", user.id)
          .in("status", ["pending_confectioner", "quoted", "counter_offered"])
          .order("created_at", { ascending: false }),

        // Активные заказы (где confectioner_id = user.id)
        supabaseBrowser
          .from("orders")
          .select(`
            id, number, user_id, total, status, delivery_date, delivery_address,
            items:order_items(product_title, quantity)
          `)
          .eq("confectioner_id", user.id)
          .in("status", ["CONFIRMED", "PREPARING", "READY", "IN_DELIVERY"])
          .order("delivery_date", { ascending: true, nullsFirst: false })
          .limit(10),

        // Товары кондитера
        supabaseBrowser
          .from("products")
          .select("id, title, price, status, is_featured")
          .eq("confectioner_id", user.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ]);

      // Получаем платежи для активных заказов (отдельный запрос, т.к. зависит от orderIds)
      const orderIds = (activeOrdersRes.data || []).map((o: { id: string }) => o.id);
      let paymentsRes = { data: [] as Array<{ id: string; amount: number; status: string; created_at: string; order?: { number: string } }> };
      if (orderIds.length > 0) {
        const { data: payData } = await supabaseBrowser
          .from("payments")
          .select(`
            id, amount, status, created_at,
            order:orders!inner(number)
          `)
          .eq("status", "succeeded")
          .in("order_id", orderIds)
          .order("created_at", { ascending: false })
          .limit(10);
        paymentsRes.data = (payData || []) as unknown as Array<{ id: string; amount: number; status: string; created_at: string; order?: { number: string } }>;
      }

      // Считаем completed + total earnings
      const completedOrdersRes = await supabaseBrowser
        .from("orders")
        .select("id, total, status", { count: "exact", head: false })
        .eq("confectioner_id", user.id)
        .in("status", ["COMPLETED", "DELIVERED"]);

      const totalEarnings = (completedOrdersRes.data || []).reduce(
        (sum: number, o: { total: number }) => sum + (o.total || 0),
        0
      );

      return {
        stats: {
          activeNegotiations: negotiationsRes.data?.length || 0,
          pendingInquiries: inquiriesRes.data?.length || 0,
          activeOrders: activeOrdersRes.data?.length || 0,
          completedOrders: completedOrdersRes.count || 0,
          totalEarnings,
          rating: 0, // TODO: считать из reviews
          productsCount: productsRes.data?.length || 0,
          publishedProducts: (productsRes.data || []).filter(
            (p: { status: string }) => p.status === "published"
          ).length,
        },
        incomingInquiries: (inquiriesRes.data || []) as unknown as ConfectionerDashboardData["incomingInquiries"],
        activeOrders: (activeOrdersRes.data || []) as unknown as ConfectionerDashboardData["activeOrders"],
        recentEarnings: (paymentsRes.data || []) as unknown as ConfectionerDashboardData["recentEarnings"],
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Supplier dashboard — заказы, товары, склад, доход */
export function useSupplierDashboard() {
  return useQuery<SupplierDashboardData>({
    queryKey: ["supplier-dashboard-v2"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const [productsRes, ordersRes, inventoryRes] = await Promise.all([
        // Товары поставщика (через products.confectioner_id — supplier тоже кондитер в v1.0)
        supabaseBrowser
          .from("products")
          .select("id, title, price, status, is_featured")
          .eq("confectioner_id", user.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),

        // Заказы где есть товары этого поставщика (через order_items)
        supabaseBrowser
          .from("orders")
          .select(`
            id, number, total, status, created_at,
            items:order_items(product_id, quantity)
          `)
          .eq("confectioner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),

        // Inventory items (если есть в schema)
        supabaseBrowser
          .from("inventory_items")
          .select("id, quantity, cost_per_unit, min_quantity")
          .eq("confectioner_id", user.id),
      ]);

      const totalProducts = productsRes.data?.length || 0;
      const lowStockItems = (inventoryRes.data || []).filter(
        (i: { quantity: number; min_quantity: number }) => i.quantity <= i.min_quantity
      ).length;

      // Доход = сумма succeeded платежей для заказов этого поставщика
      const orderIds = (ordersRes.data || []).map((o: { id: string }) => o.id);
      let revenue = 0;
      if (orderIds.length > 0) {
        const { data: payments } = await supabaseBrowser
          .from("payments")
          .select("amount")
          .eq("status", "succeeded")
          .in("order_id", orderIds);
        revenue = (payments || []).reduce(
          (sum: number, p: { amount: number }) => sum + (p.amount || 0),
          0
        );
      }

      return {
        stats: {
          activeOrders: (ordersRes.data || []).filter(
            (o: { status: string }) => !["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status)
          ).length,
          completedOrders: (ordersRes.data || []).filter(
            (o: { status: string }) => o.status === "COMPLETED"
          ).length,
          totalProducts,
          lowStockItems,
          revenue,
          rating: 0,
        },
        recentOrders: (ordersRes.data || []).map((o: { id: string; number: string; items: unknown[]; total: number; status: string; created_at: string }) => ({
          id: o.id,
          number: o.number,
          customer_name: "—", // TODO: join с user
          items_count: Array.isArray(o.items) ? o.items.length : 0,
          total: o.total,
          status: o.status,
          created_at: o.created_at,
        })),
        products: (productsRes.data || []).map((p: { id: string; title: string; price: number; status: string; is_featured: boolean }) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          stock: 0, // TODO: брать из inventory
          is_active: p.status === "published" && !p.is_featured,
        })),
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Courier dashboard — активные доставки, история, заработок */
export function useCourierDashboard() {
  return useQuery<CourierDashboardData>({
    queryKey: ["courier-dashboard-v2"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const today = new Date(new Date().setHours(0, 0, 0, 0));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const [activeRes, todayRes, monthRes] = await Promise.all([
        // Активные доставки (assigned или on_the_way)
        supabaseBrowser
          .from("deliveries")
          .select(`
            id, order_id, address, status, estimated_time, cost, courier_earnings
          `)
          .eq("courier_id", user.id)
          .in("status", ["assigned", "picked_up", "on_the_way"])
          .order("created_at", { ascending: false }),

        // Сегодня завершённые
        supabaseBrowser
          .from("deliveries")
          .select("id, order_id, address, delivered_at, courier_earnings")
          .eq("courier_id", user.id)
          .eq("status", "delivered")
          .gte("delivered_at", today.toISOString())
          .order("delivered_at", { ascending: false }),

        // За месяц завершённые (для подсчёта earnings)
        supabaseBrowser
          .from("deliveries")
          .select("courier_earnings")
          .eq("courier_id", user.id)
          .eq("status", "delivered")
          .gte("delivered_at", monthStart.toISOString()),
      ]);

      const earningsToday = (todayRes.data || []).reduce(
        (sum: number, d: { courier_earnings: number }) => sum + (d.courier_earnings || 0),
        0
      );
      const earningsMonth = (monthRes.data || []).reduce(
        (sum: number, d: { courier_earnings: number }) => sum + (d.courier_earnings || 0),
        0
      );

      return {
        stats: {
          activeDeliveries: activeRes.data?.length || 0,
          completedToday: todayRes.data?.length || 0,
          earningsToday,
          earningsMonth,
          rating: 0, // TODO: считать из reviews
        },
        activeDeliveries: (activeRes.data || []) as unknown as CourierDashboardData["activeDeliveries"],
        recentCompleted: (todayRes.data || []) as unknown as CourierDashboardData["recentCompleted"],
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Admin dashboard — KPI, последние заказы, рост платформы.
 * Данные берутся с серверного /api/admin/dashboard (service_role на сервере):
 * прямой браузерный запрос к Supabase упирался в RLS и показывал нули.
 * Сервер — единственный источник правды (мастер-промпт §4/§17.2).
 */
export function useAdminDashboard() {
  return useQuery<AdminDashboardData>({
    queryKey: ["admin-dashboard-v2"],
    queryFn: async () => {
      const res = await csrfFetch("/api/admin/dashboard");
      if (!res.ok) {
        throw new Error(`Не удалось загрузить статистику (HTTP ${res.status})`);
      }
      const raw = (await res.json()) as {
        stats: AdminDashboardData["stats"];
        recentOrders?: Array<{
          id: string;
          number: string;
          customer?: string;
          customer_email?: string;
          total: number;
          status: string;
          date?: string;
          created_at?: string;
        }>;
        platformGrowth?: AdminDashboardData["platformGrowth"];
      };

      return {
        stats: raw.stats,
        recentOrders: (raw.recentOrders || []).map((o) => ({
          id: o.id,
          number: o.number,
          customer_email: o.customer_email || o.customer || "—",
          total: Number(o.total),
          status: o.status,
          created_at: o.created_at || o.date || "",
        })) as AdminDashboardData["recentOrders"],
        platformGrowth: raw.platformGrowth || [],
      };
    },
    staleTime: 30 * 1000,
  });
}
