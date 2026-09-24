/**
 * GET /api/b2b/catalog — каталог товаров с оптовыми ценами.
 *
 * Возвращает товары, у которых есть активные оптовые цены,
 * вместе с этими ценами (для B2B-покупок).
 *
 * Query параметры:
 *  - category — фильтр по категории
 *  - limit    — по умолчанию 100, макс 500
 *  - offset   — по умолчанию 0
 *
 * Auth: CORPORATE_CLIENT или WHOLESALER (через requireAnyRole).
 *
 * Соответствует таблицам:
 *  - wholesale_prices (оптовые цены, isActive=true)
 *  - products (товары с этими id)
 *  - confectioners (данные кондитера)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

interface WholesalePrice {
  id: string;
  product_id: string;
  min_quantity: number;
  price: number;
  currency: string;
}

interface B2BProduct {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  price: number;
  category: string | null;
  images: string[];
  weight: number | null;
  confectioner_id: string;
  wholesale_prices: WholesalePrice[];
}

/**
 * GET /api/b2b/catalog — каталог товаров с оптовыми ценами.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверка роли — CORPORATE_CLIENT или WHOLESALER
    const guard = await requireAnyRole(user.id, ["CORPORATE_CLIENT", "WHOLESALER"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // 1) Получить все активные оптовые цены
    const { data: wholesalePrices, error: wpErr } = await supabaseAdmin
      .from("wholesale_prices")
      .select("id, product_id, min_quantity, price, currency")
      .eq("is_active", true)
      .order("min_quantity", { ascending: true });

    if (wpErr) {
      console.error("[b2b/catalog] wholesale_prices query error:", wpErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: wpErr.message },
        { status: 500 }
      );
    }

    if (!wholesalePrices || wholesalePrices.length === 0) {
      return NextResponse.json({ products: [], total: 0 });
    }

    // Уникальные product_ids
    const productIds = Array.from(
      new Set(wholesalePrices.map((wp) => (wp as WholesalePrice).product_id))
    );

    // 2) Получить товары по этим id
    let productQuery = supabaseAdmin
      .from("products")
      .select(
        `
        id, title, slug, description, price, category, images, weight,
        confectioner_id
      `
      )
      .in("id", productIds)
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (category) {
      productQuery = productQuery.eq("category", category);
    }

    const { data: products, error: productsErr } = await productQuery;

    if (productsErr) {
      console.error("[b2b/catalog] products query error:", productsErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: productsErr.message },
        { status: 500 }
      );
    }

    // 3) Склеить оптовые цены по product_id
    const wpByProduct = new Map<string, WholesalePrice[]>();
    for (const wp of wholesalePrices as WholesalePrice[]) {
      const arr = wpByProduct.get(wp.product_id) || [];
      arr.push(wp);
      wpByProduct.set(wp.product_id, arr);
    }

    const result: B2BProduct[] = (products || []).map((p: any) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      description: p.description,
      price: Number(p.price),
      category: p.category,
      images: p.images || [],
      weight: p.weight,
      confectioner_id: p.confectioner_id,
      wholesale_prices: wpByProduct.get(p.id) || [],
    }));

    return NextResponse.json({
      products: result,
      total: result.length,
    });
  } catch (error: any) {
    console.error("GET /api/b2b/catalog error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
