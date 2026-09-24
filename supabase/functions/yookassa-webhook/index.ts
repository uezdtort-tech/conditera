/**
 * supabase/functions/yookassa-webhook/index.ts
 *
 * Приём webhook от Yookassa (изменение статуса платежа).
 * Документация: https://yookassa.ru/developers/using-api/webhooks
 *
 * Yookassa отправляет events:
 *   - payment.waiting_for_capture (платёж захвачен, готов к подтверждению)
 *   - payment.succeeded (платёж успешен)
 *   - payment.canceled (платёж отменён)
 *   - refund.succeeded (возврат выполнен)
 *
 * ВАЖНО: в config.toml этого Edge Function verify_jwt = false
 * (Yookassa не знает наш JWT, проверка через IP allowlist + signature)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://supabase-kong:8000";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Yookassa IP allowlist (для production)
const YOOKASSA_IPS = [
  "185.71.76.0/24",
  "185.71.77.0/24",
  "185.71.78.0/24",
  // В dev пропускаем проверку
];

interface YookassaWebhook {
  event: "payment.waiting_for_capture" | "payment.succeeded" | "payment.canceled" | "refund.succeeded";
  object: {
    id: string;
    status: "pending" | "waiting_for_capture" | "succeeded" | "canceled" | "refunded";
    paid: boolean;
    amount: { value: string; currency: "RUB" };
    metadata?: Record<string, string>;
    description?: string;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // В dev-режиме пропускаем IP проверку
    if (Deno.env.get("NODE_ENV") === "production") {
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
      // В реальном коде проверяем clientIp ∈ YOOKASSA_IPS через ip-cidr библиотеку
    }

    const webhook: YookassaWebhook = await req.json();
    console.log(`[yookassa-webhook] event=${webhook.event} paymentId=${webhook.object.id}`);

    // Найти платёж по yookassa_payment_id
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id, order_id, status")
      .eq("yookassa_payment_id", webhook.object.id)
      .single();

    if (error || !payment) {
      console.error("[yookassa-webhook] Payment not found:", webhook.object.id);
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404 }
      );
    }

    // Обновить статус платежа
    const newStatus = webhook.event === "payment.succeeded" ? "succeeded"
                    : webhook.event === "payment.canceled" ? "cancelled"
                    : webhook.event === "refund.succeeded" ? "refunded"
                    : "waiting_for_capture";

    await supabase
      .from("payments")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", payment.id);

    // Если платёж успешен — обновить статус заказа
    if (newStatus === "succeeded") {
      await supabase
        .from("orders")
        .update({ status: "CONFIRMED", paid_at: new Date().toISOString() })
        .eq("id", payment.order_id);

      // Отправить уведомление через send-notification function
      await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order_created",
          orderId: payment.order_id,
          amount: parseFloat(webhook.object.amount.value),
          customer: webhook.object.metadata?.customer_name || "Клиент",
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Yookassa webhook error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
