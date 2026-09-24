import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "http://supabase-kong:8000", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(async (req: Request) => {
  const { userId, title, body, url } = await req.json();
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, keys").eq("user_id", userId);
  if (!subs || subs.length === 0) return new Response(JSON.stringify({ ok: false, message: "No subscriptions" }), { headers: { "Content-Type": "application/json" } });
  // В production: использовать Web Push API через deno-web-push
  console.log(`[send-push] To: ${userId}, Title: ${title}`);
  return new Response(JSON.stringify({ ok: true, sent: subs.length }), { headers: { "Content-Type": "application/json" } });
});
