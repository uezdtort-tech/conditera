/**
 * POST /api/payment/refund — Создать возврат (Модуль 10).
 *
 * Тело: { paymentId, amount, reason }
 * Возвращает: { refund }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    const { paymentId, amount, reason } = await request.json() as { paymentId: string; amount: number; reason: string };
    if (!paymentId || !amount || !reason) return NextResponse.json({ error: "paymentId, amount, reason обязательны" }, { status: 400 });

    // Загрузить платёж
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("payments").select("*").eq("id", paymentId).single();
    if (payErr || !payment) return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });

    // Проверить права
    const isAdmin = user.roles.some((r: string) => ["ADMIN", "SUPER_ADMIN", "INSPECTOR"].includes(r));
    const { data: order } = await supabaseAdmin.from("orders").select("user_id, confectioner_id").eq("id", payment.order_id).single();
    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

    if (!isAdmin && order.user_id !== user.id) return forbiddenResponse("Только владелец или админ");

    // Создать возврат
    const { data: refund, error: refundErr } = await supabaseAdmin
      .from("refunds").insert({
        payment_id: paymentId, order_id: payment.order_id,
        amount, reason, initiated_by: user.id, status: "requested",
      }).select().single();

    if (refundErr) return NextResponse.json({ error: refundErr.message }, { status: 500 });

    // Yookassa refund (если настроено)
    const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
    const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
    if (YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY && payment.yookassa_payment_id) {
      const authHeader = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64");
      const yookassaRes = await fetch(`https://api.yookassa.ru/v3/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${authHeader}`, "Idempotence-Key": `refund-${refund.id}` },
        body: JSON.stringify({
          payment_id: payment.yookassa_payment_id,
          amount: { value: (amount / 100).toFixed(2), currency: "RUB" },
        }),
      });
      if (yookassaRes.ok) {
        const yookassaRefund = await yookassaRes.json();
        await supabaseAdmin.from("refunds").update({
          yookassa_refund_id: yookassaRefund.id, status: "processed", processed_at: new Date().toISOString(),
        }).eq("id", refund.id);
        await supabaseAdmin.from("payments").update({ status: "refunded" }).eq("id", paymentId);
      }
    }

    return NextResponse.json({ refund }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
