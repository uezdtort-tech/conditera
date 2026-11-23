/**
 * Legacy internal Edge Function.
 *
 * External YooKassa callbacks are handled by the verified Next.js endpoint
 * /api/payment/webhook. Do not expose this function as a public webhook:
 * payment verification, provider API reconciliation, amount checks and
 * idempotency live in the application route.
 *
 * JWT remains required for this legacy function to prevent accidental public use.
 */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  return Response.json(
    { error: "Use the verified application endpoint /api/payment/webhook" },
    { status: 410 },
  );
});
