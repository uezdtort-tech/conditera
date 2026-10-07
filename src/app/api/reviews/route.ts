/**
 * /api/reviews
 *
 * GET  — публичный список одобренных отзывов (для витрины).
 *        ?mine=1 — отзывы ТЕКУЩЕГО пользователя (любой статус) с order_id,
 *        используется кабинетом клиента для состояния «Отзыв отправлен».
 *
 * POST — отзыв по завершённому заказу (ТЗ §15). Auth обязателен.
 *   Body: { orderId, rating 1-5, text?, photos? (≤3 URL из /api/upload) }
 *   Проверки: заказ принадлежит пользователю; статус DELIVERED/COMPLETED;
 *   товар из order_items[0].product_id (custom без product → 422);
 *   ONE order → ONE review (409); один отзыв на товар (409).
 *
 *   Ответ: { reviews: [{ id, rating, text, pros, cons, helpfulCount,
 *   createdAt, author: { name, avatarUrl }, product: { title, slug } }] }
 *
 * GET без mine — публичный (без auth): только status='approved', имена — из
 * профилей (без email/телефонов). Сортировка по helpful_count, затем по дате.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

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

    // === ?mine=1 — отзывы текущего пользователя (для кабинета клиента) ===
    if (sp.get("mine") === "1") {
      const user = await getUserFromRequest(request);
      if (!user) {
        return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
      }
      const { data: mine, error: mineErr } = await supabaseAdmin
        .from("product_reviews")
        .select("id, rating, text, photos, status, order_id, product_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100) as { data: { id: string; rating: number; text: string | null; photos: string[] | string | null; status: string; order_id: string | null; product_id: string; created_at: string }[] | null; error: { message: string } | null };

      if (mineErr) {
        console.error("[reviews] GET mine:", mineErr.message);
        return NextResponse.json({ error: "Не удалось загрузить отзывы" }, { status: 500 });
      }

      return NextResponse.json({
        reviews: (mine || []).map((r) => ({
          id: r.id,
          rating: r.rating,
          text: r.text || "",
          photos: Array.isArray(r.photos) ? r.photos : [],
          status: r.status,
          orderId: r.order_id,
          productId: r.product_id,
          createdAt: r.created_at,
        })),
        total: (mine || []).length,
      });
    }

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

// ===== POST — отзыв по завершённому заказу (ТЗ §15) =====

interface OrderItemRow {
  product_id: string | null;
  product_title: string | null;
}

interface OrderRow {
  id: string;
  number: string | null;
  user_id: string;
  status: string;
  items: OrderItemRow[];
}

const REVIEW_ALLOWED_STATUSES = new Set(["DELIVERED", "COMPLETED"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      orderId?: unknown;
      rating?: unknown;
      text?: unknown;
      photos?: unknown;
    } | null;

    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    const rating = Number(body?.rating);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const photos = Array.isArray(body?.photos)
      ? (body!.photos as unknown[]).filter(
          (p): p is string => typeof p === "string" && p.length > 0
        )
      : [];

    if (!orderId || !UUID_RE.test(orderId)) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Некорректный orderId" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Оценка должна быть от 1 до 5" },
        { status: 400 }
      );
    }
    if (photos.length > 3) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Можно приложить не более 3 фото" },
        { status: 400 }
      );
    }
    if (text.length > 2000) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Текст отзыва — до 2000 символов" },
        { status: 400 }
      );
    }

    // Заказ + первая позиция (товар берём из order_items[0])
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("id, number, user_id, status, items:order_items(product_id, product_title)")
      .eq("id", orderId)
      .maybeSingle() as { data: OrderRow | null; error: { message: string } | null };

    if (orderErr) {
      console.error("[reviews] POST order load:", orderErr.message);
      return NextResponse.json({ error: "Не удалось загрузить заказ" }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    if (order.user_id !== user.id) {
      return NextResponse.json({ error: "Это не ваш заказ" }, { status: 403 });
    }
    if (!REVIEW_ALLOWED_STATUSES.has(order.status)) {
      return NextResponse.json(
        { error: "REVIEW_NOT_ALLOWED", message: "Отзыв можно оставить после доставки заказа" },
        { status: 422 }
      );
    }

    const firstItem = (order.items || [])[0];
    if (!firstItem || !firstItem.product_id) {
      return NextResponse.json(
        { error: "REVIEW_NOT_ALLOWED", message: "Товар недоступен для отзыва" },
        { status: 422 }
      );
    }
    const productId = firstItem.product_id;

    // ONE order → ONE review
    const { data: byOrder } = await supabaseAdmin
      .from("product_reviews")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (byOrder) {
      return NextResponse.json(
        { error: "ALREADY_REVIEWED", message: "Отзыв по этому заказу уже отправлен" },
        { status: 409 }
      );
    }

    // Один отзыв на товар (UNIQUE product_id, user_id; повторная покупка
    // обновляет не создаёт — по ТЗ «Повторно отправлять запрос не нужно»)
    const { data: byProduct } = await supabaseAdmin
      .from("product_reviews")
      .select("id")
      .eq("product_id", productId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (byProduct) {
      return NextResponse.json(
        { error: "ALREADY_REVIEWED", message: "Вы уже оставляли отзыв на этот товар" },
        { status: 409 }
      );
    }

    // status='approved': публичная витрина читает только approved (см. GET),
    // конвейера auto-approve в системе нет (seed пишет approved напрямую);
    // ручная модерация остаётся доступной в админке.
    const { data: review, error: insertErr } = await supabaseAdmin
      .from("product_reviews")
      .insert({
        product_id: productId,
        user_id: user.id,
        order_id: orderId,
        rating,
        text: text || null,
        photos,
        status: "approved",
      })
      .select("id, rating, text, photos, status, order_id, product_id, created_at")
      .single();

    if (insertErr || !review) {
      // Гонка с UNIQUE(product_id, user_id) — тот же ответ, что и pre-check
      if (insertErr && /duplicate key|unique/i.test(insertErr.message)) {
        return NextResponse.json(
          { error: "ALREADY_REVIEWED", message: "Вы уже оставляли отзыв на этот товар" },
          { status: 409 }
        );
      }
      console.error("[reviews] POST insert:", insertErr?.message);
      return NextResponse.json({ error: "Не удалось сохранить отзыв" }, { status: 500 });
    }

    return NextResponse.json(
      {
        review: {
          id: review.id,
          rating: review.rating,
          text: review.text || "",
          photos: Array.isArray(review.photos) ? review.photos : [],
          status: review.status,
          orderId: review.order_id,
          productId: review.product_id,
          createdAt: review.created_at,
        },
        message: "Спасибо за отзыв!",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/reviews error:", (err as Error)?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
