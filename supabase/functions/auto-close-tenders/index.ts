import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "http://supabase-kong:8000", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
Deno.serve(async () => {
  const { error } = await supabase.rpc("close_expired_tenders");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
