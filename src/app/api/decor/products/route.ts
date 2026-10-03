/**
 * GET /api/decor/products — товары витрины декора (decor_products, 0040).
 *
 * Public: активные товары (?shopId= фильтр, ?limit= до 200). Ответ:
 *   { products: [...], total }
 *
 * images — jsonb (массив URL-строк). price — рубли (число).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface SupabaseError { message: string }

interface DecorProductRow {
  id: string;
  shop_id: string | null;
  title: string;
  description: string | null;
  price: number | string | null;
  images: unknown;
  category: string | null;
  in_stock: boolean | null;
  is_active: boolean | null;
  created_at: string;
}

function normalizeImages(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((i): i is string => typeof i === "string" && i.length > 0);
  }
  // jsonb может прийти строкой — пробуем распарсить
  if (typeof raw === "string" && raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((i): i is string => typeof i === "string" && i.length > 0);
      }
    } catch {
      // повреждённый jsonb — возвращаем пусто
    }
  }
  return [];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const shopId = sp.get("shopId");
    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "60", 10) || 60, 1), 200);

    let query = supabaseAdmin
      .from("decor_products")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (shopId) query = query.eq("shop_id", shopId);

    const { data, error } = await query as {
      data: DecorProductRow[] | null;
      error: SupabaseError | null;
    };

    if (error) {
      console.error("[decor/products] GET error:", error.message);
      return NextResponse.json(
        { error: "Не удалось загрузить товары декора", products: [], total: 0 },
        { status: 500 }
      );
    }

    const products = (data || []).map((row) => ({
      id: row.id,
      shopId: row.shop_id,
      title: row.title,
      description: row.description || "",
      price: Number(row.price ?? 0), // рубли
      images: normalizeImages(row.images),
      category: row.category || null,
      inStock: row.in_stock !== false,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ products, total: products.length });
  } catch (err) {
    console.error("[decor/products] unexpected:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка", products: [], total: 0 },
      { status: 500 }
    );
  }
}
