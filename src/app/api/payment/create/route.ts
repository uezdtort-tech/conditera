/**
 * POST /api/payment/create — создание платежа через YooKassa.
 *
 * Тело: { orderId, installmentPlanId? }
 * Возвращает: { paymentUrl, paymentId }
 *
 * Auth: AUTHENTICATED
 * Rate limit: 5 запросов/мин с IP
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { createPayment, isYookassaConfigured } from "@/lib/yookassa";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(
      request,
      `payment-create:${ip}`,
      RATE_LIMITS.payment.limit,
      RATE_LIMITS.payment.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { orderId, installmentPlanId } = await request.json();

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    if (order.user_id !== user.id) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
    if (order.payment_status === "paid" || order.payment_status === "escrow") {
      return NextResponse.json({ error: "Заказ уже оплачен" }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    if (!isYookassaConfigured()) {
      return NextResponse.json({ error: "Платёжный шлюз не настроен" }, { status: 503 });
    }

    const paymentResult = await createPayment({
      amount: Number(order.total),
      description: `Заказ ${order.number || orderId}`,
      returnUrl: `${appUrl}/checkout?order=${orderId}`,
      orderId,
      metadata: installmentPlanId ? { installmentPlanId } : undefined,
    });

    if (!paymentResult?.success || !paymentResult.payment?.confirmation?.confirmation_url) {
      return NextResponse.json({ error: "Не удалось создать платёж" }, { status: 500 });
    }

    // Save payment to DB
    await supabaseAdmin.from("payments").insert({
      order_id: orderId,
      user_id: user.id,
      amount: Number(order.total),
      status: "pending",
      gateway_response: paymentResult,
      gateway_txn_id: paymentResult.payment.id,
      created_at: new Date().toISOString(),
    });

    // Update order payment status
    await supabaseAdmin
      .from("orders")
      .update({ payment_status: "pending" })
      .eq("id", orderId);

    return NextResponse.json({
      paymentUrl: paymentResult.payment.confirmation.confirmation_url,
      paymentId: paymentResult.payment.id,
    });
  } catch (error: any) {
    console.error("[payment/create] error:", error?.message);
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
