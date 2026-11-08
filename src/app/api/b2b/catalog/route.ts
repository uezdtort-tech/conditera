/**
 * GET /api/b2b/catalog — публичный B2B-каталог товаров поставщиков (Z-v17).
 *
 * Переписан: старая версия читала несуществующую колонку products.category
 * (битый запрос). Источник — supplier_products × supplier_profiles.
 *
 * Видимость (серверная, не клиентская фильтрация):
 *   - поставщик: verificationStatus='approved' AND isActive=true (ID-набор
 *     берётся из БД до запроса товаров);
 *   - товар: status='published' AND is_active=true.
 * Приватные поля поставщика (email/телефон/ИНН/контакты) не отдаются.
 *
 * Фильтры: q, category, supplierId, unit, priceMin/priceMax (копейки),
 *          onlyAvailable, sort (price-asc|price-desc|name|newest).
 * Auth: любой аутентифицированный пользователь.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();
    const category = searchParams.get("category")?.trim();
    const supplierId = searchParams.get("supplierId")?.trim();
    const unit = searchParams.get("unit")?.trim();
    const priceMin = Number(searchParams.get("priceMin") ?? NaN);
    const priceMax = Number(searchParams.get("priceMax") ?? NaN);
    const onlyAvailable = searchParams.get("onlyAvailable") === "1";
    const sort = searchParams.get("sort") ?? "name";
    const limit = Math.min(Number(searchParams.get("limit") ?? 100) || 100, 500);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0) || 0, 0);

    // Шаг 1: одобренные и активные поставщики (серверная видимость).
    let supplierQuery = supabaseAdmin
      .from("supplier_profiles")
      .select(
        `userId, companyName, description, specialization, region,
         deliveryGeography, deliveryTerms, pickupAvailable, deliveryAvailable,
         minOrderAmount, rating`
      )
      .eq("verificationStatus", "approved")
      .eq("isActive", true);

    if (supplierId) supplierQuery = supplierQuery.eq("userId", supplierId);

    const { data: approvedSuppliers, error: supErr } = await supplierQuery;
    if (supErr) {
      console.error("[b2b/catalog] suppliers error:", supErr.message);
      return NextResponse.json({ error: "Ошибка чтения поставщиков" }, { status: 500 });
    }
    const supplierByUserId = new Map(
      (approvedSuppliers ?? []).map((s: Record<string, unknown>) => [String(s.userId), s])
    );
    const approvedIds = [...supplierByUserId.keys()];
    if (approvedIds.length === 0) {
      return NextResponse.json({ items: [], total: 0 });
    }

    // Шаг 2: опубликованные товары только этих поставщиков.
    let query = supabaseAdmin
      .from("supplier_products")
      .select(
        `id, product_name, sku, category, description, unit, quantity, reserved_quantity,
         price, currency, image_url, producer, brand, min_order_qty, order_step,
         shelf_life_days, storage_conditions, delivery_region, status, published_at, supplier_id`,
        { count: "exact" }
      )
      .eq("status", "published")
      .eq("is_active", true)
      .in("supplier_id", approvedIds)
      .limit(limit)
      .range(offset, offset + limit - 1);

    if (category) query = query.eq("category", category);
    if (unit) query = query.eq("unit", unit);
    if (q)
      query = query.or(
        `product_name.ilike.%${q}%,description.ilike.%${q}%,producer.ilike.%${q}%,brand.ilike.%${q}%`
      );
    if (Number.isFinite(priceMin)) query = query.gte("price", Math.max(0, priceMin));
    if (Number.isFinite(priceMax)) query = query.lte("price", Math.max(0, priceMax));

    const { data, error, count } = await query;
    if (error) {
      console.error("[b2b/catalog] GET error:", error.message);
      return NextResponse.json({ error: "Ошибка чтения каталога" }, { status: 500 });
    }

    let items = (data ?? []) as Record<string, unknown>[];
    if (onlyAvailable) {
      items = items.filter(
        (it) => Number(it.quantity ?? 0) - Number(it.reserved_quantity ?? 0) > 0
      );
    }
    if (sort === "price-asc") items.sort((a, b) => Number(a.price) - Number(b.price));
    else if (sort === "price-desc") items.sort((a, b) => Number(b.price) - Number(a.price));
    else if (sort === "newest")
      items.sort(
        (a, b) =>
          new Date(String(b.published_at ?? 0)).getTime() -
          new Date(String(a.published_at ?? 0)).getTime()
      );
    else items.sort((a, b) => String(a.product_name).localeCompare(String(b.product_name), "ru"));

    const enriched = items.map((it) => {
      const supplier = supplierByUserId.get(String(it.supplier_id)) ?? null;
      return {
        id: it.id,
        productName: it.product_name,
        sku: it.sku,
        category: it.category,
        description: it.description,
        unit: it.unit,
        price: Number(it.price),
        currency: it.currency,
        imageUrl: it.image_url,
        producer: it.producer,
        brand: it.brand,
        minOrderQty: Number(it.min_order_qty ?? 1),
        orderStep: Number(it.order_step ?? 1),
        shelfLifeDays: it.shelf_life_days,
        storageConditions: it.storage_conditions,
        deliveryRegion: it.delivery_region,
        publishedAt: it.published_at,
        supplierId: it.supplier_id,
        availableQuantity: Number(it.quantity ?? 0) - Number(it.reserved_quantity ?? 0),
        supplier,
      };
    });

    return NextResponse.json({ items: enriched, total: count ?? enriched.length });
  } catch (e: any) {
    console.error("[b2b/catalog] GET:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
