/**
 * GET /api/supplier/dashboard — сводная статистика поставщика.
 *
 * Возвращает:
 *   - totalProducts: количество товаров в каталоге
 *   - totalStockValue: стоимость склада (Σ quantity * cost_per_unit)
 *   - totalOrders: количество регулярных заказов (RecurringOrder)
 *   - revenue: суммарная стоимость склада как proxy выручки
 *
 * Auth: SUPPLIER role.
 *
 * Stub mode: если БД недоступна или у пользователя нет supplier profile,
 * возвращает demo-данные (для dev и preview).
 *
 * Безопасность:
 *   • GET: требует роль SUPPLIER (в dev fallback на stub без auth).
 *   • Все 3 запроса (profile, products, recurring_orders) параллельны через Promise.all.
 *   • Type-safe interfaces для всех возвращаемых данных.
 *   • При сбое БД — fallback на stub (для dev/preview).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface SupplierProfileRow {
  id: string;
  user_id: string;
  company_name: string;
  is_active: boolean | null;
  rating: number | null;
}

interface InventoryItemRow {
  quantity: number;
  cost_per_unit: number;
  min_quantity: number;
}

interface RecurringOrderRow {
  id: string;
  status: string;
  next_run_at: string | null;
}

const STUB_DATA = {
  stats: {
    totalProducts: 12,
    totalStockValue: 234000,
    lowStockItems: 2,
    totalOrders: 4,
    activeOrders: 3,
    revenue: 234000,
    companyName: "Демо-Поставщик",
    rating: 4.8,
    isActive: true,
  },
  supplier: {
    businessName: "Демо-Поставщик",
    avatar: "https://i.pravatar.cc/100?u=supplier-demo",
    location: { city: "Москва", region: "Московская область" },
    minOrder: 5000,
    deliveryTime: "1-3 дня",
    rating: 4.8,
    legalInfo: { status: "legal", documentsVerified: true },
    deliveryRegions: ["Москва", "СПб", "Екатеринбург"],
    deliveryOptions: ["СДЭК", "ПЭК", "самовывоз"],
  },
  orders: [
    { id: "so1", number: "SO-2025-0001", customer: "Сладкая уездная", items: 3, total: 4520, status: "PROCESSING", date: "2026-08-12" },
    { id: "so2", number: "SO-2025-0002", customer: "Татьяна-Кондитер", items: 5, total: 6890, status: "SHIPPED", date: "2026-08-10" },
    { id: "so3", number: "SO-2025-0003", customer: "Сахарный Лебедь", items: 2, total: 3980, status: "DELIVERED", date: "2026-08-05" },
    { id: "so4", number: "SO-2025-0004", customer: "Кондитерская Купец", items: 8, total: 12400, status: "PROCESSING", date: "2026-08-15" },
  ],
  revenue: [
    { month: "Мар", value: 145000 },
    { month: "Апр", value: 168000 },
    { month: "Май", value: 192000 },
    { month: "Июн", value: 178000 },
    { month: "Июл", value: 215000 },
    { month: "Авг", value: 234000 },
  ],
  products: [
    { id: "p1", title: "Мука высшего сорта 5кг", price: 350, inStock: 45, unit: "шт", image: "https://images.unsplash.com/photo-1574323397132-e4f471d0ede6?w=200" },
    { id: "p2", title: "Сахар-песок 1кг", price: 90, inStock: 120, unit: "шт", image: "https://images.unsplash.com/photo-1608094884249-7d8de1a93501?w=200" },
    { id: "p3", title: "Сливочное масло 200г", price: 280, inStock: 18, unit: "шт", image: "https://images.unsplash.com/photo-1589985270812-62ac2a2ec469?w=200" },
    { id: "p4", title: "Какао-порошок 500г", price: 450, inStock: 32, unit: "шт", image: "https://images.unsplash.com/photo-1606918398204-elerin-kakao?w=200" },
  ],
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);

    // Stub mode: если нет auth или БД недоступна — возвращаем demo-данные
    if (!user) {
      if (process.env.NODE_ENV === "development") {
        return NextResponse.json({ ...STUB_DATA, stub: true });
      }
      throw new HttpError(401, "Не авторизован");
    }

    if (!user.roles.includes("SUPPLIER")) {
      if (process.env.NODE_ENV === "development") {
        return NextResponse.json({ ...STUB_DATA, stub: true });
      }
      throw new HttpError(403, "Нет прав");
    }

    // Параллельная загрузка: profile + products + recurring_orders
    // supabase-js возвращает PostgrestFilterBuilder (thenable), не Promise —
    // поэтому приводим через unknown для type safety.
    const [supplierResult, productsResult, recurringOrdersResult] = await Promise.all([
      supabaseAdmin
        .from("supplier_profiles")
        .select("id, user_id, company_name, is_active, rating")
        .eq("user_id", user.userId)
        .maybeSingle() as unknown as Promise<{ data: SupplierProfileRow | null; error: SupabaseError | null }>,
      supabaseAdmin
        .from("inventory_items")
        .select("quantity, cost_per_unit, min_quantity")
        .eq("confectioner_id", user.userId) as unknown as Promise<{ data: InventoryItemRow[] | null; error: SupabaseError | null }>,
      supabaseAdmin
        .from("recurring_orders")
        .select("id, status, next_run_at")
        .eq("supplier_id", user.userId) as unknown as Promise<{ data: RecurringOrderRow[] | null; error: SupabaseError | null }>,
    ]);

    // Если любая ошибка БД — fallback на stub
    if (supplierResult.error || productsResult.error || recurringOrdersResult.error) {
      const errMsg = supplierResult.error?.message || productsResult.error?.message || recurringOrdersResult.error?.message;
      console.warn("[supplier/dashboard] DB error, returning stub:", errMsg);
      return NextResponse.json({ ...STUB_DATA, stub: true });
    }

    const supplier = supplierResult.data;
    const products = productsResult.data || [];
    const recurringOrders = recurringOrdersResult.data || [];

    // Если нет реальных данных — возвращаем stub
    if (!supplier && products.length === 0) {
      return NextResponse.json({ ...STUB_DATA, stub: true });
    }

    const totalProducts = products.length;
    const totalStockValue = products.reduce(
      (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.cost_per_unit) || 0),
      0
    );
    const lowStockItems = products.filter(
      (p) => (Number(p.quantity) || 0) <= (Number(p.min_quantity) || 0)
    ).length;

    const activeOrders = recurringOrders.filter((o) => o.status === "active").length;

    return NextResponse.json({
      stats: {
        totalProducts,
        totalStockValue,
        lowStockItems,
        totalOrders: recurringOrders.length,
        activeOrders,
        revenue: totalStockValue,
        companyName: supplier?.company_name || null,
        rating: supplier?.rating || 0,
        isActive: supplier?.is_active ?? false,
      },
      stub: false,
    });
  } catch (error) {
    // В dev возвращаем stub даже при ошибке
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json({ ...STUB_DATA, stub: true });
    }
    return handleRouteError(error);
  }
}
