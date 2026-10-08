/**
 * /api/wishlist — избранное пользователя (таблица product_favorites, 0002).
 *
 * GET    — карточки избранного (готовые для рендера): product_id + данные
 *          товара (id, title, price, images, slug, is_available).
 * POST   — toggle: {productId} → есть запись → удалить, нет → добавить.
 * DELETE — ?productId=... → удалить.
 *
 * Auth обязателен; скоуп — только свои записи (фильтр user_id, как в
 * /api/orders). supabaseAdmin используется как в остальных роутах.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FavoriteRow {
  product_id: string;
  created_at: string;
  product: {
    id: string;
    title: string;
    price: number;
    images: string[] | null;
    slug: string;
    is_available: boolean | null;
  } | null;
}

interface ProductImageRow {
  product_id: string;
  url: string;
}

async function loadWishlistCards(userId: string): Promise<NextResponse> {
  const { data: favs, error } = await supabaseAdmin
    .from("product_favorites")
    .select(
      `
      product_id,
      created_at,
      product:products(id, title, price, images, slug, is_available)
    `
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200) as { data: FavoriteRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("[wishlist] GET:", error.message);
    return NextResponse.json({ error: "Не удалось загрузить избранное" }, { status: 500 });
  }

  const rows = (favs || []).filter((f) => f.product);

  // Фолбэк-обложка: products.images пуст у витринных товаров — берём из
  // product_images (первая по sort_order).
  const emptyImageIds = rows
    .filter((f) => !f.product!.images || f.product!.images.length === 0)
    .map((f) => f.product_id);

  const imageFallback = new Map<string, string>();
  if (emptyImageIds.length > 0) {
    const { data: imgs } = await supabaseAdmin
      .from("product_images")
      .select("product_id, url")
      .in("product_id", emptyImageIds)
      .order("sort_order", { ascending: true }) as { data: ProductImageRow[] | null };
    for (const img of imgs || []) {
      if (!imageFallback.has(img.product_id)) imageFallback.set(img.product_id, img.url);
    }
  }

  return NextResponse.json({
    items: rows.map((f) => {
      const p = f.product!;
      const images = Array.isArray(p.images) && p.images.length > 0
        ? p.images
        : imageFallback.has(f.product_id)
          ? [imageFallback.get(f.product_id)!]
          : [];
      return {
        productId: f.product_id,
        id: p.id,
        title: p.title,
        price: Number(p.price) || 0,
        images,
        slug: p.slug,
        available: p.is_available !== false,
        addedAt: f.created_at,
      };
    }),
    total: rows.length,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    return await loadWishlistCards(user.userId);
  } catch (err) {
    console.error("GET /api/wishlist error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { productId?: unknown } | null;
    const productId = typeof body?.productId === "string" ? body.productId : "";
    if (!productId || !UUID_RE.test(productId)) {
      return NextResponse.json({ error: "Некорректный productId" }, { status: 400 });
    }

    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("id", productId)
      .maybeSingle();
    if (!product) {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }

    const { data: existing } = await supabaseAdmin
      .from("product_favorites")
      .select("id")
      .eq("user_id", user.userId)
      .eq("product_id", productId)
      .maybeSingle();

    if (existing) {
      const { error: delErr } = await supabaseAdmin
        .from("product_favorites")
        .delete()
        .eq("id", existing.id);
      if (delErr) {
        console.error("[wishlist] POST delete:", delErr.message);
        return NextResponse.json({ error: "Не удалось обновить избранное" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, action: "removed" as const });
    }

    const { error: insErr } = await supabaseAdmin
      .from("product_favorites")
      .insert({ user_id: user.userId, product_id: productId });
    if (insErr) {
      // P1.1: гонка toggle (два параллельных POST) — UNIQUE(user_id, product_id)
      // даёт 23505; повтор идемпотентен: товар уже в избранном, второй запрос
      // вернёт «added» вместо 500 (§14: сервер — источник истины).
      if ((insErr as { code?: string }).code === "23505") {
        return NextResponse.json({ ok: true, action: "added" as const }, { status: 201 });
      }
      console.error("[wishlist] POST insert:", insErr.message);
      return NextResponse.json({ error: "Не удалось обновить избранное" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "added" as const }, { status: 201 });
  } catch (err) {
    console.error("POST /api/wishlist error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const productId = request.nextUrl.searchParams.get("productId") || "";
    if (!productId || !UUID_RE.test(productId)) {
      return NextResponse.json({ error: "Некорректный productId" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("product_favorites")
      .delete()
      .eq("user_id", user.userId)
      .eq("product_id", productId);
    if (error) {
      console.error("[wishlist] DELETE:", error.message);
      return NextResponse.json({ error: "Не удалось обновить избранное" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/wishlist error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
