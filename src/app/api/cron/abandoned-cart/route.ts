/**
 * GET  /api/cron/abandoned-cart — find users with abandoned carts (>2h old, not ordered)
 * PATCH /api/cron/abandoned-cart — mark a cart as notified (so we don't send twice)
 *
 * Called by n8n every hour. Returns the list of users whose carts have been
 * sitting untouched for ≥2 hours and who haven't placed an order yet.
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблицам:
 *  - cart_items (агрегация по user_id)
 *  - profiles (получение email/name)
 *  - orders (проверка что нет заказов за последние 24ч)
 *  - notification_preferences (opt-out для abandonedCart)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const ABANDONED_HOURS = 2;
const RECENT_ORDER_HOURS = 24;

interface AbandonedCartInfo {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  itemsCount: number;
  total: number;
  lastActivity: string;
  notifiedAt: null;
}

/**
 * GET /api/cron/abandoned-cart — список пользователей с брошенными корзинами.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const cutoff = new Date(Date.now() - ABANDONED_HOURS * 60 * 60 * 1000);
    const recentOrderCutoff = new Date(Date.now() - RECENT_ORDER_HOURS * 60 * 60 * 1000);

    // 1. Найти все cart_items старше 2 часов
    const { data: cartItems, error: cartErr } = await supabaseAdmin
      .from("cart_items")
      .select("user_id, price, created_at")
      .lt("created_at", cutoff.toISOString())
      .order("created_at", { ascending: false });

    if (cartErr) {
      console.error("[cron/abandoned-cart] cart query error:", cartErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: cartErr.message },
        { status: 500 }
      );
    }

    if (!cartItems || cartItems.length === 0) {
      return NextResponse.json({ carts: [], total: 0, cutoff: cutoff.toISOString() });
    }

    // 2. Агрегировать по user_id
    const byUser = new Map<string, { count: number; total: number; lastActivity: Date }>();
    for (const item of cartItems) {
      const userId = item.user_id as string;
      const price = Number(item.price || 0);
      const createdAt = new Date(item.created_at);
      const existing = byUser.get(userId);
      if (existing) {
        existing.count++;
        existing.total += price;
        if (createdAt > existing.lastActivity) {
          existing.lastActivity = createdAt;
        }
      } else {
        byUser.set(userId, { count: 1, total: price, lastActivity: createdAt });
      }
    }

    // 3. Для каждого пользователя — проверить заказы и prefs
    const cartsWithUserInfo: (AbandonedCartInfo | null)[] = await Promise.all(
      Array.from(byUser.entries()).map(async ([userId, info]) => {
        // Получить профиль пользователя
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from("profiles")
          .select("id, email, name, is_blocked")
          .eq("id", userId)
          .maybeSingle();

        if (profileErr || !profile) return null;
        if (profile.is_blocked) return null;

        // Проверить, есть ли заказы за последние 24 часа
        const { data: recentOrders } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("user_id", userId)
          .gt("created_at", recentOrderCutoff.toISOString())
          .limit(1);

        if (recentOrders && recentOrders.length > 0) return null; // уже заказал

        // Получить notification preferences
        const { data: prefs } = await supabaseAdmin
          .from("notification_preferences")
          .select("promotions, email_enabled")
          .eq("user_id", userId)
          .maybeSingle();

        // Если пользователь отключил промо-уведомления — пропускаем
        if (prefs && prefs.promotions === false) return null;

        return {
          id: `cart_${userId}`,
          userId: profile.id,
          userName: profile.name,
          userEmail: profile.email,
          itemsCount: info.count,
          total: Number(info.total.toFixed(2)),
          lastActivity: info.lastActivity.toISOString(),
          notifiedAt: null,
        };
      })
    );

    const validCarts = cartsWithUserInfo.filter((c): c is AbandonedCartInfo => c !== null);

    return NextResponse.json({
      carts: validCarts,
      total: validCarts.length,
      cutoff: cutoff.toISOString(),
    });
  } catch (error: any) {
    console.error("GET /api/cron/abandoned-cart error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/cron/abandoned-cart — отметить корзину как обработанную.
 * В проде должно сохраняться в отдельную таблицу abandoned_cart_logs.
 * Пока просто логируем.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { cartId, action } = body;

    if (action !== "mark_notified" || !cartId) {
      return NextResponse.json(
        { error: "Invalid action or cartId" },
        { status: 400 }
      );
    }

    // В прод-окружении здесь должна быть запись в abandoned_cart_logs:
    //   await supabaseAdmin.from('abandoned_cart_logs').insert({
    //     cart_id: cartId, notified_at: new Date().toISOString(),
    //   });
    // Пока логируем
    console.info(`[cron/abandoned-cart] cart ${cartId} marked as notified`);

    return NextResponse.json({ success: true, cartId, action });
  } catch (error: any) {
    console.error("PATCH /api/cron/abandoned-cart error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
