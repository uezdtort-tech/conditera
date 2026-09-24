/**
 * POST /api/loyalty/redeem — списать бонусы для заказа (AUTHENTICATED).
 *
 * Body: { orderId, requestedPoints }
 * Использует redeemPoints из @/lib/loyalty с проверкой баланса и идемпотентностью.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { redeemPoints } from "@/lib/loyalty";
import { MIN_REDEMPTION_POINTS, MAX_REDEMPTION_PERCENT } from "@/lib/loyalty-config";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { orderId, requestedPoints } = await req.json();
    if (!orderId || !requestedPoints || requestedPoints < MIN_REDEMPTION_POINTS) {
      return NextResponse.json({ error: `Минимум ${MIN_REDEMPTION_POINTS} баллов для списывания` }, { status: 400 });
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, total, user_id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    if (order.user_id !== user.id) return NextResponse.json({ error: "Чужой заказ" }, { status: 403 });
    if (order.status !== "PENDING" && order.status !== "NEGOTIATING") {
      return NextResponse.json({ error: "Можно списывать только в неподтверждённом заказе" }, { status: 400 });
    }

    // Check max redemption percent
    const maxPoints = Math.floor(Number(order.total) * MAX_REDEMPTION_PERCENT / 100);
    if (requestedPoints > maxPoints) {
      return NextResponse.json({ error: `Максимум ${maxPoints} баллов для заказа ${order.total}₽` }, { status: 400 });
    }

    // Redeem points (checks balance, creates REDEEM transaction, prevents double-spend)
    const result = await redeemPoints(user.id, orderId, Number(order.total), requestedPoints);

    // Update order with redeemed points
    await supabaseAdmin
      .from("orders")
      .update({
        bonus_points_redeemed: result.redeemedPoints,
        bonus_discount_rub: result.discountRub,
      })
      .eq("id", orderId);

    return NextResponse.json({
      success: true,
      redeemedPoints: result.redeemedPoints,
      discountRub: result.discountRub,
      newBalance: result.newBalance,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Ошибка списания" }, { status: 400 });
  }
}
