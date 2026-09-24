/**
 * Authentication helper for cron API endpoints.
 *
 * Cron endpoints are called by n8n (or any external scheduler) using a shared
 * secret passed in the X-Cron-Secret header. This is simpler than JWT for
 * machine-to-machine calls.
 *
 * Set CRON_SECRET in .env (or docker-compose env) to enable.
 * If CRON_SECRET is unset, the endpoints refuse to run (defensive default).
 */
export function verifyCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.warn("[cron] CRON_SECRET not set — refusing to run");
    return false;
  }
  const got = req.headers.get("X-Cron-Secret");
  if (!got || got !== expected) {
    return false;
  }
  return true;
}

export function cronUnauthorized() {
  return new Response(
    JSON.stringify({ error: "Unauthorized — invalid or missing X-Cron-Secret" }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}
