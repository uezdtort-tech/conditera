/**
 * supabase/functions/daily-digest/index.ts
 *
 * Scheduled Edge Function (запускается каждый день в 9:00 MSK через pg_cron).
 * Отправляет ежедневный дайджест: активные заказы, новые лиды, выплаты.
 *
 * pg_cron schedule:
 *   SELECT cron.schedule('daily-digest',
 *     '0 9 * * *',
 *     $$SELECT net.http_post(
 *       url:='http://supabase-kong:8000/functions/v1/daily-digest',
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
    console.log("[daily-digest] Running at", new Date().toISOString());

    // В v2.0 будет реальная логика:
    // 1. Найти всех админов
    // 2. Для каждого собрать статистику за последние 24 часа:
    //    - Новые заказы
    //    - Новые лиды
    //    - Запросы выплат
    //    - Активные тикеты
    // 3. Отправить email через SMTP

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Daily digest will be implemented in v2.0",
        processedAt: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Daily digest error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
