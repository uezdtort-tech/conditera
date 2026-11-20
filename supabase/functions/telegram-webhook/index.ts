/**
 * Legacy internal Edge Function intentionally disabled.
 *
 * The production Telegram Bot API webhook is the Next.js endpoint
 * /api/telegram/webhook. It validates Telegram's secret-token header and
 * contains the current command/support workflow. Keep this legacy route
 * JWT-protected; do not configure it as Telegram's public webhook.
 */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  return Response.json(
    { error: "Use the application endpoint /api/telegram/webhook" },
    { status: 410 },
  );
});
