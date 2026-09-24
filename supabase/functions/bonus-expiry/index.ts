/**
 * supabase/functions/bonus-expiry/index.ts
 *
 * Scheduled Edge Function (запускается каждый день в 00:00 MSK через pg_cron).
 * Находит бонусы с просроченной датой и списывает их.
 *
 * pg_cron schedule:
 *   SELECT cron.schedule('bonus-expiry',
 *     '0 0 * * *',
 *     $$SELECT net.http_post(
 *       url:='http://supabase-kong:8000/functions/v1/bonus-expiry',
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
    console.log("[bonus-expiry] Running at", new Date().toISOString());

    // В v2.0 будет реальная логика:
    // 1. Найти loyalty_transactions с type=EARN и expiresAt < NOW()
    // 2. Создать loyalty_transactions с type=EXPIRE
    // 3. Обновить profiles.bonus_balance
    // 4. Отправить уведомление пользователю

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Bonus expiry will be implemented in v2.0",
        processedAt: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Bonus expiry error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
