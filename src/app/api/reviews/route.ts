/**
 * GET /api/reviews — публичный список одобренных отзывов (для витрины).
 *
 * Query: ?limit=1..20 (по умолчанию 6)
 *
 * Ответ: { reviews: [{ id, rating, text, pros, cons, helpfulCount,
 *   createdAt, author: { name, avatarUrl }, product: { title, slug } }] }
 *
 * Публичный (без auth): только status='approved', имена — из профилей
 * (без email/телефонов). Сортировка по helpful_count, затем по дате.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface ReviewRow {
  id: string;
  rating: number;
  text: string | null;
  pros: string | null;
  cons: string | null;
  helpful_count: number | null;
  created_at: string;
  user_id: string;
  product_id: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "6", 10) || 6, 1), 20);

    const { data: reviews, error } = await supabaseAdmin
      .from("product_reviews")
      .select("id, rating, text, pros, cons, helpful_count, created_at, user_id, product_id")
      .eq("status", "approved")
      .order("helpful_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit) as { data: ReviewRow[] | null; error: { message: string } | null };

    if (error) {
      console.error("[reviews] GET:", error.message);
      return NextResponse.json({ error: "Не удалось загрузить отзывы" }, { status: 500 });
    }

    const rows = reviews || [];

    // Имена авторов + названия товаров (shim-совместимо: отдельные запросы)
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const productIds = [...new Set(rows.map((r) => r.product_id))];

    const [profilesRes, productsRes] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, name, avatar_url").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null; avatar_url: string | null }[], error: null }),
      productIds.length
        ? supabaseAdmin.from("products").select("id, title, slug").in("id", productIds)
        : Promise.resolve({ data: [] as { id: string; title: string; slug: string }[], error: null }),
    ]);

    const profileMap = new Map(
      ((profilesRes.data as { id: string; name: string | null; avatar_url: string | null }[]) || []).map(
        (pr) => [pr.id, pr]
      )
    );
    const productMap = new Map(
      ((productsRes.data as { id: string; title: string; slug: string }[]) || []).map((pr) => [pr.id, pr])
    );

    return NextResponse.json({
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        text: r.text || "",
        pros: r.pros || undefined,
        cons: r.cons || undefined,
        helpfulCount: r.helpful_count ?? 0,
        createdAt: r.created_at,
        author: {
          name: profileMap.get(r.user_id)?.name || "Покупатель",
          avatarUrl: profileMap.get(r.user_id)?.avatar_url || undefined,
        },
        product: productMap.has(r.product_id)
          ? {
              title: productMap.get(r.product_id)!.title,
              slug: productMap.get(r.product_id)!.slug,
            }
          : undefined,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error("GET /api/reviews error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
