import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "http://supabase-kong:8000", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const { data, error } = await supabase.from("tastings").select("id, date, start_time, atelier:ateliers(name)").eq("date", tomorrow).eq("status", "scheduled");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const { data: bookings } = await supabase.from("tasting_bookings").select("user_id, tasting_id").in("tasting_id", (data || []).map(t => t.id)).eq("status", "confirmed");
  console.log(`[tasting-reminder] Found ${bookings?.length || 0} bookings for tomorrow`);
  return new Response(JSON.stringify({ ok: true, count: bookings?.length || 0 }), { headers: { "Content-Type": "application/json" } });
});
