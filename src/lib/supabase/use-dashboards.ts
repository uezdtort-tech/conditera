/**
 * use-dashboards.ts — прямые hooks для 5 дашбордов (v2.1).
 *
 * Аутентификация: единый app-JWT (cd_session cookie + Bearer cd_access_token).
 * supabaseBrowser (GoTrue) в локальном runtime всегда пуст — см. fix 0a8de5d:
 * GET-запросы идут через PostgREST-шим /rest/v1 с Bearer app-JWT
 * (роль authenticated, sub=auth.uid() → RLS), fetchWithAuthRetry
 * делает один авто-refresh при 401.
 *
 * Преимущества:
 *   - Нет лишнего сетевого хопа (браузер → API → Supabase → браузер)
 *   - RLS на уровне БД (нет дублирования проверок в API routes)
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
  csrfFetch,
  fetchWithAuthRetry,
  getSessionAuthHeaders,
  getStoredAccessToken,
} from "@/lib/api-client";

// ==================== App-session helpers (единый app-JWT контракт) ====================

/**
 * Идентичность из app-JWT (sessionStorage): userId/email/sub.
 * supabaseBrowser.auth.getUser() (GoTrue) в локальном runtime не работает —
 * сессия приложения живёт в cd_session cookie + cd_access_token Bearer.
 */
function appSessionUser(): { id: string; email: string } | null {
  const token = getStoredAccessToken();
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { userId?: string; sub?: string; email?: string };
    const id = payload.userId || payload.sub;
    if (!id) return null;
    return { id, email: payload.email || "" };
  } catch {
    return null;
  }
}

/**
 * GET /rest/v1/<table> под app-JWT (PostgREST-шим, роль authenticated, sub=auth.uid()).
 * fetchWithAuthRetry: один авто-refresh при 401 и один повтор с новым Bearer.
 */
async function pgrstGet<T>(table: string, search: string): Promise<T[]> {
  const headers = await getSessionAuthHeaders(undefined, { json: false });
  const res = await fetchWithAuthRetry(`/rest/v1/${table}?${search}`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${table}: HTTP ${res.status}${body ? ` — ${body.slice(0, 120)}` : ""}`);
  }
  return (await res.json()) as T[];
}

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
  /** Новые заказы (PENDING) — требуют подтверждения кондитером (Acceptance Engine). */
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

// ==================== Query hooks ====================

/** Customer dashboard — заказы, избранное, бонусы, переговоры.
 * Аутентификация: единый app-JWT (как в useConfectionerDashboard, 0a8de5d).
 * supabaseBrowser.auth.getUser() (GoTrue) в локальном runtime всегда пуст →
 * «Не авторизован» при живой app-сессии + anon-роль вместо authenticated.
 * Запросы идут через /rest/v1 с Bearer app-JWT: RLS видит auth.uid(),
 * все выборки ограничены user_id = auth.uid() + политиками RLS.
 */
export function useCustomerDashboard() {
  return useQuery<CustomerDashboardData>({
    queryKey: ["customer-dashboard"],
    queryFn: async () => {
      const user = appSessionUser();
      if (!user) throw new Error("Не авторизован");

      // Параллельно загружаем все данные через PostgREST-шим (та же SQL-семантика)
      const [recentOrders, favorites, inquiries, negotiations, profileRows, allOrders] = await Promise.all([
        // Последние заказы
        pgrstGet<CustomerDashboardData["recentOrders"][number]>("orders",
          `select=${encodeURIComponent("id,number,total,status,created_at,items:order_items(product_title,quantity)")}` +
          `&user_id=eq.${user.id}&order=created_at.desc&limit=10`),

        // Избранное
        pgrstGet<CustomerDashboardData["favorites"][number]>("product_favorites",
          `select=${encodeURIComponent("id,product_id,product:products(id,title,price)")}` +
          `&user_id=eq.${user.id}&order=created_at.desc&limit=20`),

        // Активные inquiries
        pgrstGet<CustomerDashboardData["activeInquiriesList"][number]>("inquiries",
          `select=id,event_type,city,status,negotiations_count,expires_at` +
          `&user_id=eq.${user.id}&status=eq.open&order=submitted_at.desc&limit=5`),

        // Активные negotiations (count считаем по строкам — эквивалент head:true)
        pgrstGet<{ id: string; status: string }>("negotiations",
          `select=id,status&user_id=eq.${user.id}` +
          `&status=${encodeURIComponent('in.("pending_confectioner","quoted","counter_offered")')}`),

        // Профиль (для бонусов) — single-строка: limit=1 + take(0)
        pgrstGet<{ bonus_balance: number | null; loyalty_level: string | null }>("profiles",
          `select=bonus_balance,loyalty_level&id=eq.${user.id}&limit=1`),

        // Считаем completed orders и total spent
        pgrstGet<{ total: number | null; status: string }>("orders",
          `select=total,status&user_id=eq.${user.id}`),
      ]);

      const profile = profileRows[0];
      const completedOrders = allOrders.filter(
        (o) => o.status === "COMPLETED" || o.status === "DELIVERED"
      );

      return {
        stats: {
          activeOrders: allOrders.filter(
            (o) => !["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status)
          ).length,
          completedOrders: completedOrders.length,
          bonusBalance: profile?.bonus_balance || 0,
          loyaltyLevel: profile?.loyalty_level || "BRONZE",
          favoritesCount: favorites.length,
          activeInquiries: inquiries.length,
          activeNegotiations: negotiations.length,
          totalSpent: completedOrders.reduce((sum, o) => sum + (o.total || 0), 0),
        },
        recentOrders,
        favorites,
        activeInquiriesList: inquiries,
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
      // Аутентификация: единый app-JWT (sessionStorage, @/lib/api-client).
      // supabaseBrowser.auth.getUser() (GoTrue) в локальном runtime всегда
      // пуст → вкладки дашборда показывали «Не авторизован» при живой
      // сессии (подтверждено браузерной приёмкой: заказ UK-2026-985818
      // существовал, кабинет был недоступен).
      const user = appSessionUser();
      if (!user) throw new Error("Не авторизован");

      // Те же PostgREST-запросы (тот же шим /rest/v1, та же SQL-семантика),
      // но с Bearer app-JWT: supabaseBrowser шлёт только anon-key → роль anon
      // → пустые выборки даже после замены гейта.
      const [inquiries, negotiations, activeOrders, pendingOrders, products] = await Promise.all([
        pgrstGet<ConfectionerDashboardData["incomingInquiries"][number]>("inquiries",
          `select=${encodeURIComponent("id,event_type,base,filling,servings,city,delivery_date,estimated_price,expires_at,user_id")}` +
          `&status=eq.open&order=submitted_at.desc&limit=10`),
        pgrstGet<{ id: string; status: string; quoted_price: number | null; inquiry_id: string }>("negotiations",
          `select=id,status,quoted_price,inquiry_id&confectioner_id=eq.${user.id}` +
          `&status=${encodeURIComponent('in.("pending_confectioner","quoted","counter_offered")')}&order=created_at.desc`),
        pgrstGet<ConfectionerDashboardData["activeOrders"][number]>("orders",
          `select=${encodeURIComponent("id,number,user_id,total,status,delivery_date,delivery_address,items:order_items(product_title,quantity)")}` +
          `&confectioner_id=eq.${user.id}&status=${encodeURIComponent('in.("CONFIRMED","PREPARING","READY","IN_DELIVERY")')}` +
          `&order=${encodeURIComponent("delivery_date.asc.nullsfirst")}&limit=10`),
        // Новые заказы (PENDING) — без них новая заявка не видна нигде в кабинете
        pgrstGet<ConfectionerDashboardData["pendingOrders"][number]>("orders",
          `select=${encodeURIComponent("id,number,user_id,total,status,delivery_date,delivery_address,items:order_items(product_title,quantity)")}` +
          `&confectioner_id=eq.${user.id}&status=eq.PENDING&order=created_at.desc&limit=10`),
        pgrstGet<{ id: string; title: string; price: number; status: string; is_featured: boolean | null }>("products",
          `select=id,title,price,status,is_featured&confectioner_id=eq.${user.id}&deleted_at=is.null&order=created_at.desc`),
      ]);

      // Платежи по активным заказам (отдельный запрос, зависит от orderIds).
      // number НЕ встраиваем (orders!inner — шим не резолвит связь из payments);
      // номер берём из уже загруженных activeOrders (Map по id).
      const orderIds = activeOrders.map((o) => o.id);
      const numberByOrderId = new Map(activeOrders.map((o) => [o.id, o.number] as const));
      let recentEarnings: ConfectionerDashboardData["recentEarnings"] = [];
      if (orderIds.length > 0) {
        const pays = await pgrstGet<{ id: string; amount: number; status: string; created_at: string; order_id: string }>("payments",
          `select=id,amount,status,created_at,order_id` +
          `&status=eq.succeeded&order_id=${encodeURIComponent(`in.(${orderIds.join(",")})`)}` +
          `&order=created_at.desc&limit=10`);
        recentEarnings = pays.map((p) => {
          const num = numberByOrderId.get(p.order_id);
          return { ...p, order: num ? { number: num } : undefined };
        });
      }

      // Завершённые заказы + суммарный доход
      const completedOrders = await pgrstGet<{ id: string; total: number; status: string }>("orders",
        `select=id,total,status&confectioner_id=eq.${user.id}` +
        `&status=${encodeURIComponent('in.("COMPLETED","DELIVERED")')}`);
      const totalEarnings = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      return {
        stats: {
          activeNegotiations: negotiations.length,
          pendingInquiries: inquiries.length,
          activeOrders: activeOrders.length,
          completedOrders: completedOrders.length,
          totalEarnings,
          rating: 0, // TODO: считать из reviews
          productsCount: products.length,
          publishedProducts: products.filter((p) => p.status === "published").length,
        },
        incomingInquiries: inquiries,
        activeOrders,
        pendingOrders,
        recentEarnings,
      };
    },
    staleTime: 30 * 1000,
  });
}

/** Supplier dashboard — заказы, товары, склад, доход.
 * Аутентификация: единый app-JWT (как в useConfectionerDashboard, 0a8de5d).
 * Дефект исправлен: inventory_items не имеет колонки confectioner_id —
 * владелец склада определяется owner_id (RLS inventory_own).
 */
export function useSupplierDashboard() {
  return useQuery<SupplierDashboardData>({
    queryKey: ["supplier-dashboard-v2"],
    queryFn: async () => {
      const user = appSessionUser();
      if (!user) throw new Error("Не авторизован");

      const [products, orders, inventory] = await Promise.all([
        // Товары поставщика (через products.confectioner_id — supplier тоже кондитер в v1.0)
        pgrstGet<{ id: string; title: string; price: number; status: string; is_featured: boolean | null }>("products",
          `select=id,title,price,status,is_featured&confectioner_id=eq.${user.id}` +
          `&deleted_at=is.null&order=created_at.desc`),

        // Заказы где есть товары этого поставщика (через order_items)
        pgrstGet<{ id: string; number: string; total: number; status: string; created_at: string; items: unknown[] }>("orders",
          `select=${encodeURIComponent("id,number,total,status,created_at,items:order_items(product_id,quantity)")}` +
          `&confectioner_id=eq.${user.id}&order=created_at.desc&limit=10`),

        // Склад поставщика: владелец — owner_id (колонки confectioner_id в таблице нет)
        pgrstGet<{ id: string; quantity: number; cost_per_unit: number | null; min_quantity: number | null }>("inventory_items",
          `select=id,quantity,cost_per_unit,min_quantity&owner_id=eq.${user.id}`),
      ]);

      const totalProducts = products.length;
      const lowStockItems = inventory.filter(
        (i) => i.quantity <= (i.min_quantity ?? 0)
      ).length;

      // Доход = сумма succeeded платежей для заказов этого поставщика
      const orderIds = orders.map((o) => o.id);
      let revenue = 0;
      if (orderIds.length > 0) {
        const payments = await pgrstGet<{ amount: number | null }>("payments",
          `select=amount&status=eq.succeeded` +
          `&order_id=${encodeURIComponent(`in.(${orderIds.join(",")})`)}`);
        revenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      }

      return {
        stats: {
          activeOrders: orders.filter(
            (o) => !["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status)
          ).length,
          completedOrders: orders.filter(
            (o) => o.status === "COMPLETED"
          ).length,
          totalProducts,
          lowStockItems,
          revenue,
          rating: 0,
        },
        recentOrders: orders.map((o) => ({
          id: o.id,
          number: o.number,
          customer_name: "—", // TODO: join с user
          items_count: Array.isArray(o.items) ? o.items.length : 0,
          total: o.total,
          status: o.status,
          created_at: o.created_at,
        })),
        products: products.map((p) => ({
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

/** Courier dashboard — активные доставки, история, заработок.
 * Аутентификация: единый app-JWT (как в useConfectionerDashboard, 0a8de5d).
 * Выборки ограничены courier_id = auth.uid() + RLS deliveries_select_own.
 */
export function useCourierDashboard() {
  return useQuery<CourierDashboardData>({
    queryKey: ["courier-dashboard-v2"],
    queryFn: async () => {
      const user = appSessionUser();
      if (!user) throw new Error("Не авторизован");

      const today = new Date(new Date().setHours(0, 0, 0, 0));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const [activeDeliveries, todayCompleted, monthCompleted] = await Promise.all([
        // Активные доставки (assigned или on_the_way)
        pgrstGet<CourierDashboardData["activeDeliveries"][number]>("deliveries",
          `select=${encodeURIComponent("id,order_id,address,status,estimated_time,cost,courier_earnings")}` +
          `&courier_id=eq.${user.id}` +
          `&status=${encodeURIComponent('in.("assigned","picked_up","on_the_way")')}` +
          `&order=created_at.desc`),

        // Сегодня завершённые
        pgrstGet<CourierDashboardData["recentCompleted"][number]>("deliveries",
          `select=${encodeURIComponent("id,order_id,address,delivered_at,courier_earnings")}` +
          `&courier_id=eq.${user.id}&status=eq.delivered` +
          `&delivered_at=gte.${encodeURIComponent(today.toISOString())}` +
          `&order=delivered_at.desc`),

        // За месяц завершённые (для подсчёта earnings)
        pgrstGet<{ courier_earnings: number | null }>("deliveries",
          `select=courier_earnings&courier_id=eq.${user.id}&status=eq.delivered` +
          `&delivered_at=gte.${encodeURIComponent(monthStart.toISOString())}`),
      ]);

      const earningsToday = todayCompleted.reduce(
        (sum, d) => sum + (d.courier_earnings || 0),
        0
      );
      const earningsMonth = monthCompleted.reduce(
        (sum, d) => sum + (d.courier_earnings || 0),
        0
      );

      return {
        stats: {
          activeDeliveries: activeDeliveries.length,
          completedToday: todayCompleted.length,
          earningsToday,
          earningsMonth,
          rating: 0, // TODO: считать из reviews
        },
        activeDeliveries,
        recentCompleted: todayCompleted,
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
