/**
 * supabase/functions/abandoned-cart/index.ts
 *
 * Scheduled Edge Function (запускается каждый час через pg_cron).
 * Находит брошенные корзины (cart_items без заказов > 1 часа) и
 * отправляет напоминание пользователю через email/push/telegram.
 *
 * pg_cron schedule:
 *   SELECT cron.schedule('abandoned-cart',
 *     '0 * * * *',
 *     $$SELECT net.http_post(
 *       url:='http://supabase-kong:8000/functions/v1/abandoned-cart',
 *       headers:='{"Content-Type":"application/json"}'::jsonb,
 *       body:='{}'::jsonb
 *     )$$);
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://supabase-kong:8000";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
    // В v2.0 будет реальная логика:
    // 1. Найти корзины, где updated_at < NOW() - 1 час
    // 2. Для каждой — отправить уведомление пользователю
    // 3. Помечать cart_items.notified = true

    console.log("[abandoned-cart] Running at", new Date().toISOString());

    // STUB: возвращает что было обработано
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Abandoned cart notifications will be implemented in v2.0",
        processedAt: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Abandoned cart error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
