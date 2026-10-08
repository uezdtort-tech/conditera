/**
 * GET /api/recommendations — «Вам может понравиться» (P2.3, ТЗ §9 ⑥, §15).
 *
 * Auth опционален:
 *   • авторизован — персональные рекомендации: якоря = избранное
 *     (product_favorites) + история заказов (orders ≠ CANCELLED →
 *     order_items.product_id); причины «Похоже на то, что вы…»;
 *   • аноним — детерминированный популярный fallback по надёжному
 *     показателю reviews_count (реальные отзывы), personalized: false.
 *
 * Правила движка: сами якоря не рекомендуются; снятые с продажи не
 * рекомендуются; без ML/AI; сортировка детерминирована.
 *
 * Ответ: { items: [...], personalized: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { recommendForYou, type RecommendationSubject } from "@/lib/recommendations";
import {
  buildResponseItem,
  loadProductRowsByIds,
  loadRecommendationData,
  rowToSubject,
} from "@/lib/server/recommendation-data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

async function loadWishlistSubjects(
  userId: string,
  slugById: Map<string, string>
): Promise<RecommendationSubject[]> {
  const { data: favs, error } = await supabaseAdmin
    .from("product_favorites")
    .select("product_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[recommendations] wishlist:", error.message);
    return [];
  }
  const ids = (favs || [])
    .map((f: { product_id: string }) => f.product_id)
    .filter(Boolean);
  const rows = await loadProductRowsByIds(ids);
  return rows.map((row) => rowToSubject(row, slugById));
}

async function loadHistorySubjects(
  userId: string,
  slugById: Map<string, string>
): Promise<RecommendationSubject[]> {
  const { data: orders, error } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .neq("status", "CANCELLED")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    console.error("[recommendations] orders:", error.message);
    return [];
  }
  const orderIds = (orders || []).map((o: { id: string }) => o.id);
  if (orderIds.length === 0) return [];

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("order_items")
    .select("product_id")
    .in("order_id", orderIds)
    .limit(500);
  if (itemsError) {
    console.error("[recommendations] order_items:", itemsError.message);
    return [];
  }
  const productIds = Array.from(
    new Set(
      (items || [])
        .map((i: { product_id: string | null }) => i.product_id)
        .filter((pid: string | null): pid is string => Boolean(pid))
    )
  );
  const rows = await loadProductRowsByIds(productIds);
  return rows.map((row) => rowToSubject(row, slugById));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") || "6");
    const limit = Number.isFinite(rawLimit)
      ? Math.min(12, Math.max(1, Math.floor(rawLimit)))
      : 6;

    const pool = await loadRecommendationData();
    const user = await getUserFromRequest(request);

    let wishlist: RecommendationSubject[] = [];
    let history: RecommendationSubject[] = [];
    if (user?.userId) {
      [wishlist, history] = await Promise.all([
        loadWishlistSubjects(user.userId, pool.slugById),
        loadHistorySubjects(user.userId, pool.slugById),
      ]);
    }

    const { items, personalized } = recommendForYou(pool.subjects, {
      limit,
      context: { wishlist, history },
    });

    return NextResponse.json(
      {
        items: items.map((rec) => buildResponseItem(rec, pool.metaById)),
        personalized,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[recommendations] GET error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
