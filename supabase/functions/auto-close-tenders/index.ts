/**
 * Close expired tenders through the protected PostgREST RPC.
 * This worker is internal-only: Kong requires service_role key-auth + ACL.
 */

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!SERVICE_ROLE_KEY) {
    console.error("[auto-close-tenders] service-role key is not configured");
    return Response.json({ error: "Worker is not configured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/close_expired_tenders`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("[auto-close-tenders] RPC failed:", response.status);
      return Response.json({ error: "Tender cleanup failed" }, { status: 502 });
    }
    return Response.json({ ok: true, result });
  } catch (error) {
    console.error("[auto-close-tenders] Request failed:", error);
    return Response.json({ error: "Tender cleanup failed" }, { status: 502 });
  }
});
