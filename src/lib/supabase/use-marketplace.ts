/**
 * use-marketplace.ts — TanStack Query hooks для маркетплейса.
 *
 * Query hooks (чтение):
 *   - useCategories() — список 28 категорий
 *   - useProducts(filters) — каталог с фильтрами
 *   - useProduct(id) — карточка товара
 *   - useProductReviews(id) — отзывы
 *   - useFavorites() — избранное пользователя
 *   - useCart() — корзина (текущий пользователь)
 *   - useOrders() — заказы пользователя
 *   - useOrder(id) — детали заказа
 *   - useSearchProducts(query) — поиск через Postgres FTS
 *
 * Mutation hooks (изменение):
 *   - useAddToCart() — добавить товар в корзину
 *   - useRemoveFromCart() — удалить товар из корзины
 *   - useUpdateCartQuantity() — изменить количество
 *   - useClearCart() — очистить корзину
 *   - useCreateOrder() — оформить заказ
 *   - useCreatePayment() — создать платёж Yookassa
 *   - useToggleFavorite() — добавить/убрать из избранного
 *   - useCreateReview() — оставить отзыв
 *   - useUpdateOrderStatus() — сменить статус заказа
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { Product as StoreProduct, ProductCategory } from "@/lib/types";

// ==================== Types ====================
export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  description: string | null;
  group_name: string;
  link: string | null;
  sort_order: number;
}

export interface Product {
  id: string;
  confectioner_id: string;
  category_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  long_description: string | null;
  price: number;
  old_price: number | null;
  weight_grams: number | null;
  servings: number | null;
  tags: string[] | null;
  dietary_features: string[] | null;
  status: string;
  is_featured: boolean;
  views_count: number;
  sales_count: number;
  rating_average: number;
  reviews_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined relations
  category?: Category;
  images?: ProductImage[];
  confectioner?: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  };
}

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
}

export interface CartItem {
  id: string;
  user_id: string | null;
  session_id: string | null;
  product_id: string;
  quantity: number;
  selected_attributes: Record<string, string> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  product?: Product;
}

export interface Order {
  id: string;
  number: string;
  user_id: string;
  confectioner_id: string | null;
  subtotal: number;
  delivery_cost: number;
  discount: number;
  total: number;
  status: string;
  type: string;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_date: string | null;
  delivery_type: string;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  // Joined
  items?: OrderItem[];
  payment?: Payment;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_title: string;
  product_image: string | null;
  unit_price: number;
  quantity: number;
  total: number;
}

export interface Payment {
  id: string;
  order_id: string;
  yookassa_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ProductFilters {
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
  dietary?: string[];
  tags?: string[];
  sort?: "newest" | "price_asc" | "price_desc" | "rating" | "popular";
  limit?: number;
  offset?: number;
}

// ==================== Query hooks ====================

/** Список 28 категорий */
export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("product_categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw new Error(error.message);
      return data as Category[];
    },
    staleTime: 10 * 60 * 1000, // 10 минут (категории меняются редко)
  });
}

/** Каталог товаров с фильтрами */
export function useProducts(filters: ProductFilters = {}) {
  return useQuery<Product[]>({
    queryKey: ["products", filters],
    queryFn: async () => {
      let query = supabaseBrowser
        .from("products")
        .select(`
          *,
          category:product_categories(*),
          images:product_images(*)
        `)
        .eq("status", "published")
        .is("deleted_at", null);

      // Фильтр по категории
      if (filters.categorySlug) {
        const { data: cat } = await supabaseBrowser
          .from("product_categories")
          .select("id")
          .eq("slug", filters.categorySlug)
          .single();
        if (cat) query = query.eq("category_id", cat.id);
      }

      // Фильтр по цене
      if (filters.minPrice !== undefined) {
        query = query.gte("price", filters.minPrice);
      }
      if (filters.maxPrice !== undefined) {
        query = query.lte("price", filters.maxPrice);
      }

      // Фильтр по dietary features (PostgreSQL array contains)
      if (filters.dietary && filters.dietary.length > 0) {
        query = query.contains("dietary_features", filters.dietary);
      }

      // Фильтр по tags
      if (filters.tags && filters.tags.length > 0) {
        query = query.contains("tags", filters.tags);
      }

      // Сортировка
      switch (filters.sort) {
        case "price_asc":
          query = query.order("price", { ascending: true });
          break;
        case "price_desc":
          query = query.order("price", { ascending: false });
          break;
        case "rating":
          query = query.order("rating_average", { ascending: false });
          break;
        case "popular":
          query = query.order("sales_count", { ascending: false });
          break;
        case "newest":
        default:
          query = query.order("published_at", { ascending: false, nullsFirst: false });
      }

      // Пагинация
      const limit = filters.limit || 24;
      const offset = filters.offset || 0;
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as unknown as Product[];
    },
    staleTime: 60 * 1000, // 1 минута
  });
}

/** Карточка товара */
export function useProduct(slug: string) {
  return useQuery<Product>({
    queryKey: ["product", slug],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("products")
        .select(`
          *,
          category:product_categories(*),
          images:product_images(*),
          attributes:product_attributes(*)
        `)
        .eq("slug", slug)
        .eq("status", "published")
        .is("deleted_at", null)
        .single();

      if (error) throw new Error(error.message);
      return data as Product;
    },
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000, // 5 минут
  });
}

/** Поиск через Postgres FTS */
export function useSearchProducts(query: string, limit = 20) {
  return useQuery<Product[]>({
    queryKey: ["products", "search", query],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .rpc("search_products", {
          search_query: query,
          result_limit: limit,
        });

      if (error) throw new Error(error.message);
      return (data || []) as Product[];
    },
    enabled: Boolean(query && query.length > 2),
    staleTime: 30 * 1000,
  });
}

/** Отзывы на товар */
export function useProductReviews(productId: string) {
  return useQuery({
    queryKey: ["product-reviews", productId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("product_reviews")
        .select("*")
        .eq("product_id", productId)
        .eq("status", "approved")
        .order("helpful_count", { ascending: false });

      if (error) throw new Error(error.message);
      return data;
    },
    enabled: Boolean(productId),
    staleTime: 60 * 1000,
  });
}

/** Избранное текущего пользователя */
export function useFavorites() {
  return useQuery({
    queryKey: ["favorites"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabaseBrowser
        .from("product_favorites")
        .select(`
          *,
          product:products(*)
        `)
        .eq("user_id", user.id);

      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 30 * 1000,
  });
}

/** Корзина текущего пользователя */
export function useCart() {
  return useQuery<CartItem[]>({
    queryKey: ["cart"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabaseBrowser
        .from("cart_items")
        .select(`
          *,
          product:products(
            *,
            images:product_images(*)
          )
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data || []) as CartItem[];
    },
    staleTime: 30 * 1000,
  });
}

/** Заказы текущего пользователя */
export function useOrders() {
  return useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabaseBrowser
        .from("orders")
        .select(`
          *,
          items:order_items(*),
          payment:payments(*)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data || []) as Order[];
    },
    staleTime: 30 * 1000,
  });
}

/** Детали конкретного заказа */
export function useOrder(orderId: string) {
  return useQuery<Order>({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("orders")
        .select(`
          *,
          items:order_items(*),
          payment:payments(*),
          delivery:deliveries(*)
        `)
        .eq("id", orderId)
        .single();

      if (error) throw new Error(error.message);
      return data as Order;
    },
    enabled: Boolean(orderId),
  });
}

// ==================== Mutation hooks ====================

/** Добавить в корзину */
export function useAddToCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      productId,
      quantity = 1,
      selectedAttributes,
      notes,
    }: {
      productId: string;
      quantity?: number;
      selectedAttributes?: Record<string, string>;
      notes?: string;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("cart_items")
        .insert({
          user_id: user.id,
          product_id: productId,
          quantity,
          selected_attributes: selectedAttributes,
          notes,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      toast.success("Добавлено в корзину");
    },
    onError: (error: Error) => {
      toast.error("Ошибка добавления в корзину", { description: error.message });
    },
  });
}

/** Удалить из корзины */
export function useRemoveFromCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cartItemId: string) => {
      const { error } = await supabaseBrowser
        .from("cart_items")
        .delete()
        .eq("id", cartItemId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      toast.success("Удалено из корзины");
    },
    onError: (error: Error) => {
      toast.error("Ошибка удаления", { description: error.message });
    },
  });
}

/** Изменить количество в корзине */
export function useUpdateCartQuantity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ cartItemId, quantity }: { cartItemId: string; quantity: number }) => {
      if (quantity < 1) throw new Error("Количество должно быть > 0");

      const { error } = await supabaseBrowser
        .from("cart_items")
        .update({ quantity })
        .eq("id", cartItemId);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
    },
    onError: (error: Error) => {
      toast.error("Ошибка обновления", { description: error.message });
    },
  });
}

/** Очистить корзину */
export function useClearCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { error } = await supabaseBrowser
        .from("cart_items")
        .delete()
        .eq("user_id", user.id);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      toast.success("Корзина очищена");
    },
  });
}

/** Добавить/убрать из избранного */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      // Проверяем, есть ли уже в избранном
      const { data: existing } = await supabaseBrowser
        .from("product_favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("product_id", productId)
        .single();

      if (existing) {
        // Удалить
        const { error } = await supabaseBrowser
          .from("product_favorites")
          .delete()
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        return { action: "removed" as const };
      } else {
        // Добавить
        const { error } = await supabaseBrowser
          .from("product_favorites")
          .insert({ user_id: user.id, product_id: productId });
        if (error) throw new Error(error.message);
        return { action: "added" as const };
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
      toast.success(
        result.action === "added" ? "Добавлено в избранное" : "Убрано из избранного"
      );
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}

/** Создать заказ (через POST /api/checkout) */
export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      cartItems,
      deliveryAddress,
      deliveryCity,
      deliveryDate,
      deliveryType = "delivery",
      notes,
    }: CreateOrderInput) => {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cartItems,
          deliveryAddress,
          deliveryCity,
          deliveryDate,
          deliveryType,
          notes,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return response.json() as Promise<{ orderId: string; paymentUrl: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Заказ создан");
    },
    onError: (error: Error) => {
      toast.error("Ошибка оформления заказа", { description: error.message });
    },
  });
}

/**
 * Входные данные для создания заказа (используется в useCreateOrder и тестах).
 * Соответствует телу запроса POST /api/checkout.
 */
export interface CreateOrderInput {
  cartItems: Array<{
    id: string;
    product_id: string;
    quantity: number;
    selected_attributes?: Record<string, string>;
  }>;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryDate?: string;
  deliveryType?: "delivery" | "pickup";
  notes?: string;
}

/** Создать отзыв */
export function useCreateReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      productId,
      rating,
      text,
      pros,
      cons,
    }: {
      productId: string;
      rating: number;
      text?: string;
      pros?: string;
      cons?: string;
    }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabaseBrowser
        .from("product_reviews")
        .insert({
          product_id: productId,
          user_id: user.id,
          rating,
          text,
          pros,
          cons,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["product-reviews", variables.productId] });
      toast.success("Отзыв отправлен на модерацию");
    },
    onError: (error: Error) => {
      toast.error("Ошибка отправки отзыва", { description: error.message });
    },
  });
}

/** Обновить статус заказа (для кондитера/курьера/админа) */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      status,
    }: {
      orderId: string;
      status: string;
    }) => {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", variables.orderId] });
      toast.success(`Заказ: статус → ${variables.status}`);
    },
    onError: (error: Error) => {
      toast.error("Ошибка обновления статуса", { description: error.message });
    },
  });
}

// ==================== Confectioners (public) ====================

/** Публичный профиль кондитера (минимум полей для витрины). */
export interface ConfectionerPublic {
  id: string;
  userId: string;
  businessName: string;
  slug: string;
  description: string;
  avatar: string;
  cover: string | null;
  city: string;
  location: unknown;
  rating: number;
  reviewsCount: number;
  ordersCount: number;
  verified: boolean;
  verificationStatus: string;
  trustLevel: string;
  tariff: string;
  specialization: string[];
  portfolioImages: string[];
  followersCount: number;
  responseTime: string;
  joinedAt: string;
  selfPickup: boolean;
  deliveryOptions: string[];
  ecoBadges: string[];
}

export interface ConfectionersQuery {
  city?: string;
  sort?: "rating" | "orders" | "followers";
  limit?: number;
}

/**
 * useConfectioners — список верифицированных кондитеров (через публичный API).
 *
 * Запрос идёт на GET /api/confectioners (server-side), который через supabaseAdmin
 * тянет из public.confectioners (migration 0017, camelCase) с RLS-aware политикой.
 * Если БД пуста или Supabase не поднят — клиентский store сохраняет MOCK_CONFECTIONERS.
 *
 * staleTime: 60 секунд (для живой бегущей строки — авто-обновление при регистрации
 * новых кондитеров через минуту).
 */
export function useConfectioners(opts: ConfectionersQuery = {}) {
  return useQuery<ConfectionerPublic[]>({
    queryKey: ["confectioners", opts],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts.city) params.set("city", opts.city);
      if (opts.sort) params.set("sort", opts.sort);
      if (opts.limit) params.set("limit", String(opts.limit));
      params.set("verified_only", "true");

      const res = await fetch(`/api/confectioners?${params.toString()}`, {
        // Next.js 16: тег для ревалидации по cron при регистрации нового кондитера
        next: { tags: ["confectioners", "marquee"], revalidate: 60 },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as { confectioners?: ConfectionerPublic[] };
      return json.confectioners ?? [];
    },
    staleTime: 60 * 1000, // 1 минута — баланс свежести и нагрузки
    refetchOnWindowFocus: false,
    retry: 1, // не спамим запросами если БД недоступна
  });
}

/* ------------------------------------------------------------------ *
 * useLiveProducts — витрина магазина на live-данных                   *
 * ------------------------------------------------------------------ */

interface ApiProduct {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  price: number; // копейки
  old_price: number | null;
  weight_grams: number | null;
  servings: number | null;
  tags: string[] | null;
  rating_average: number | null;
  reviews_count: number | null;
  is_featured: boolean | null;
  images: string[];
  confectioner: { id: string; businessName: string; avatar: string; verified: boolean; city: string } | null;
}

function guessCategory(title: string, tags: string[] | null): ProductCategory {
  const hay = `${title} ${(tags || []).join(" ")}`.toLowerCase();
  if (hay.includes("капкейк")) return "cupcakes";
  if (hay.includes("макарун")) return "macarons";
  if (hay.includes("шоколад")) return "chocolate";
  if (hay.includes("печень")) return "cookies";
  if (hay.includes("бенто")) return "bento";
  if (hay.includes("эклер") || hay.includes("пирожн") || hay.includes("профитрол")) return "pastries";
  if (hay.includes("зефир") || hay.includes("десерт") || hay.includes("мусс")) return "desserts";
  return "cakes";
}

export function mapApiProductToProduct(p: ApiProduct): StoreProduct {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    description: p.description || "",
    // price в БД — копейки; в store/mock — рубли
    price: Math.round(p.price / 100),
    oldPrice: p.old_price ? Math.round(p.old_price / 100) : undefined,
    category: guessCategory(p.title, p.tags),
    images: p.images || [],
    confectionerId: p.confectioner?.id || "",
    confectionerName: p.confectioner?.businessName || undefined,
    confectionerAvatar: p.confectioner?.avatar || undefined,
    rating: Number(p.rating_average ?? 0),
    reviewsCount: p.reviews_count ?? 0,
    servings: p.servings ?? undefined,
    weight: p.weight_grams ? `${p.weight_grams} г` : undefined,
    prepTime: p.is_featured ? "1 день" : "2–5 дней",
    isHit: Boolean(p.is_featured) || (p.reviews_count ?? 0) >= 20,
    isPopular: (p.reviews_count ?? 0) > 0,
    tags: p.tags || [],
  };
}

/**
 * useLiveProducts — опубликованные товары из БД (через публичный /api/products).
 * Пустой список = в БД нет товаров (витрина остаётся на mock-fallback).
 */
export function useLiveProducts(limit = 60) {
  return useQuery<StoreProduct[]>({
    queryKey: ["live-products", limit],
    queryFn: async () => {
      const res = await fetch(`/api/products?limit=${limit}&sort=popular`, {
        next: { tags: ["products", "vitrina"], revalidate: 60 },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { products?: ApiProduct[] };
      return (json.products ?? []).map(mapApiProductToProduct);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ==================== Live-услуги (/api/services) ====================

/** Сырая строка service_products из GET /api/services (snake_case, копейки). */
export interface ApiServiceRow {
  id: string;
  provider_id: string;
  provider_role: string;
  title: string;
  description: string | null;
  category: string;
  price_type: string;
  price: number;
  old_price: number | null;
  duration_minutes: number | null;
  age_min: number | null;
  age_max: number | null;
  city: string | null;
  service_format: string;
  images: string[] | null;
  tags: string[] | null;
  includes: string[] | null;
  safety_note: string | null;
  customizable: boolean | null;
  suitable_for: string[] | null;
  is_active: boolean;
  is_verified: boolean;
  rating: number | null;
  reviews_count: number | null;
  bookings_count: number | null;
  created_at: string;
  provider?: {
    id: string;
    name: string | null;
    avatar_url: string | null;
    is_verified: boolean | null;
  } | null;
}

/** Копейки → рубли. */
function kopToRub(kop: number): number {
  return Math.round(kop / 100);
}

/** 90 → "1 ч 30 мин", 45 → "45 мин". */
function formatDuration(minutes: number | null): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

/** price_type → priceUnit сторового ServiceProduct. */
function mapPriceType(priceType: string): StoreServiceProduct["priceUnit"] {
  switch (priceType) {
    case "per_hour": return "hour";
    case "per_event": return "event";
    case "per_guest": return "person";
    default: return "item";
  }
}

type StoreServiceProduct = import("@/lib/types").ServiceProduct;

/**
 * mapApiServiceToServiceProduct — приведение live-строки БД к сторовому типу
 * ServiceProduct, который рендерит ServicesShopPage. Unknown-category
 * fallback → "animator_show" (группа «Аниматоры»), чтобы бейдж не был пустым.
 */
export function mapApiServiceToServiceProduct(s: ApiServiceRow): StoreServiceProduct {
  const KNOWN_CATEGORIES = new Set([
    "fireworks_indoor", "fireworks_outdoor", "fireworks_stage",
    "balloons_helium", "balloons_composition", "balloons_arch", "balloons_release",
    "animator_clown", "animator_hero", "animator_show", "animator_facepaint", "animator_quest",
    "photographer", "videographer", "music", "host",
    "print_gingerbread", "print_sugar_paper", "print_rice_paper", "print_wafer_paper",
    "print_chocolate", "print_icing_sheet", "print_custom_cookie", "print_edible_stickers",
    "print_design", "masterclass", "trampoline", "kids_room",
  ]);
  const category = (KNOWN_CATEGORIES.has(s.category) ? s.category : "animator_show") as import("@/lib/types").ServiceCategory;

  const created = new Date(s.created_at).getTime();
  const isNew = Date.now() - created < 14 * 24 * 60 * 60 * 1000;

  return {
    id: s.id,
    shopId: s.provider_id,
    shopName: s.provider?.name || "Партнёр платформы",
    shopAvatar: s.provider?.avatar_url || undefined,
    title: s.title,
    description: s.description || "",
    category,
    price: kopToRub(s.price),
    oldPrice: s.old_price ? kopToRub(s.old_price) : undefined,
    priceUnit: mapPriceType(s.price_type),
    images: s.images && s.images.length > 0 ? s.images : ["https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800"],
    duration: formatDuration(s.duration_minutes),
    programDuration: s.duration_minutes ?? undefined,
    ageRange: s.age_min != null && s.age_max != null ? `${s.age_min}–${s.age_max} лет` : undefined,
    customizable: Boolean(s.customizable),
    suitableFor: s.suitable_for || [],
    rating: Number(s.rating ?? 0),
    reviewsCount: s.reviews_count ?? 0,
    isPopular: (s.bookings_count ?? 0) >= 50,
    isNew,
    inStock: 1,
    available: s.is_active,
    safetyNote: s.safety_note || undefined,
    productionTime: undefined,
  };
}

/**
 * useLiveServices — активные услуги из БД (через публичный /api/services).
 * Пустой список = в БД нет услуг (витрина остаётся на mock-fallback).
 */
export function useLiveServices(limit = 60) {
  return useQuery<StoreServiceProduct[]>({
    queryKey: ["live-services", limit],
    queryFn: async () => {
      const res = await fetch(`/api/services?limit=${limit}&sort=popular`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { services?: ApiServiceRow[] };
      return (json.services ?? []).map(mapApiServiceToServiceProduct);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
